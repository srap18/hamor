import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gatewayFetch, type PaddleEnv } from "@/lib/paddle.server";
import { STORE_PACKS } from "@/lib/store-catalog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPaddlePackId(txn: any): string | undefined {
  const item = txn.items?.[0];
  return (
    txn.custom_data?.packId ||
    txn.customData?.packId ||
    item?.price?.import_meta?.external_id ||
    item?.price?.importMeta?.externalId ||
    item?.price?.custom_data?.externalId ||
    item?.price?.customData?.externalId ||
    item?.price?.external_id ||
    item?.price?.externalId
  );
}

/**
 * Instant client-triggered grant after Paddle's `checkout.completed` event.
 * Verifies the transaction with Paddle, then calls `grant_paddle_purchase`
 * (idempotent on _txn_id, so the webhook re-running is safe).
 */
export const claimPaddleTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { transactionId: string; environment: PaddleEnv }) => {
    if (!d?.transactionId || typeof d.transactionId !== "string" || d.transactionId.length > 64) {
      throw new Error("invalid transactionId");
    }
    if (d.environment !== "sandbox" && d.environment !== "live") {
      throw new Error("invalid environment");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await gatewayFetch(
      data.environment,
      `/transactions/${encodeURIComponent(data.transactionId)}`,
    );
    if (!res.ok) throw new Error(`paddle fetch failed: ${res.status}`);
    const body = await res.json();
    const txn = body?.data;
    if (!txn) throw new Error("transaction not found");

    const status = txn.status;
    if (status !== "completed" && status !== "paid" && status !== "billed") {
      // Not paid yet — webhook will catch it later.
      return { granted: false, reason: `status:${status}` };
    }

    const ownerId = txn.custom_data?.userId;
    if (ownerId && ownerId !== userId) throw new Error("transaction owner mismatch");

    const item = txn.items?.[0];
    // Prefer checkout customData.packId. Paddle webhook payloads may omit import_meta,
    // while the transaction API may expose it as import_meta.external_id.
    let packId: string | undefined = getPaddlePackId(txn);
    if (!packId && item?.price?.id) {
      const pr = await gatewayFetch(
        data.environment,
        `/prices/${encodeURIComponent(item.price.id)}`,
      );
      if (pr.ok) {
        const pb = await pr.json();
        packId =
          pb?.data?.import_meta?.external_id ??
          pb?.data?.importMeta?.externalId ??
          pb?.data?.external_id ??
          undefined;
      }
    }
    if (!packId) throw new Error("missing price external_id");

    const pack = STORE_PACKS.find((p) => p.id === packId);
    const reward = pack?.reward ?? {};
    const amountCents = Number(txn.details?.totals?.total ?? 0);

    const { data: grantRes, error } = await supabaseAdmin.rpc("grant_paddle_purchase", {
      _txn_id: txn.id,
      _user: userId,
      _pack_id: packId,
      _amount_cents: amountCents,
      _gems: reward.gems ?? 0,
      _coins: reward.coins ?? 0,
      _rubies: reward.rubies ?? 0,
      _shield_days: reward.shieldDays ?? 0,
      _vip_days: reward.vipDays ?? 0,
      _env: data.environment,
    });
    if (error) throw new Error(error.message);

    // Skip extras (inventory items, phoenix ships) if the webhook (or a prior call)
    // already granted this transaction — prevents double-grants.
    const alreadyGranted = !!(grantRes as { already_granted?: boolean } | null)?.already_granted;

    // Elite VIP fallback — activate level immediately even if SubscriptionCreated
    // never fires for this price config.
    const eliteMatch = /^elite_vip_([1-5])_monthly$/.exec(packId);
    if (!alreadyGranted && eliteMatch) {
      const level = Number(eliteMatch[1]);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await supabaseAdmin
        .from("profiles")
        .update({ elite_vip_level: level, elite_vip_expires_at: expiresAt } as never)
        .eq("id", userId);
    }


    if (!alreadyGranted && reward.items?.length) {
      for (const it of reward.items) {
        await supabaseAdmin.rpc("grant_inventory_item", {
          _user: userId,
          _item_type: it.itemType,
          _item_id: it.itemId,
          _qty: it.qty,
        });
      }
    }

    if (!alreadyGranted && reward.phoenixShips && reward.phoenixShips > 0) {
      const rows = Array.from({ length: reward.phoenixShips }, () => ({
        user_id: userId,
        template_id: 31,
        hp: 13000,
        max_hp: 13000,
        at_sea: false,
        catalog_code: "ship-lvl-31",
      }));
      await supabaseAdmin.from("ships_owned").insert(rows);
    }

    return { granted: true, packId, alreadyGranted };
  });
