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

    const ownerId = txn.custom_data?.userId ?? txn.customData?.userId;
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
    const isEliteVip = /^elite_vip_[1-5]_monthly$/.test(packId);
    if (!pack && !isEliteVip) throw new Error(`unknown pack id: ${packId}`);
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

    // Ships — idempotent per txn, always attempted so partial failures self-heal.
    if (
      (reward.phoenixShips ?? 0) > 0 ||
      (reward.dragonT1Ships ?? 0) > 0 ||
      (reward.dragonT2Ships ?? 0) > 0 ||
      (reward.dragonT3Ships ?? 0) > 0
    ) {
      await supabaseAdmin.rpc("grant_pack_ships" as never, {
        _txn_id: txn.id,
        _user: userId,
        _phoenix: reward.phoenixShips ?? 0,
        _dragon_t1: reward.dragonT1Ships ?? 0,
        _dragon_t2: reward.dragonT2Ships ?? 0,
        _dragon_t3: reward.dragonT3Ships ?? 0,
      } as never);
    }

    return { granted: true, packId, alreadyGranted };
  });
