import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gatewayFetch, type PaddleEnv } from "@/lib/paddle.server";
import { STORE_PACKS } from "@/lib/store-catalog";

/* eslint-disable @typescript-eslint/no-explicit-any */
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
 * "ما وصلني الشحن" recovery. Lists the user's recent Paddle transactions
 * (matched by the email on their auth account) and grants any completed
 * ones that aren't already recorded in paddle_purchases. Idempotent.
 */
export const reconcileMyPaddlePurchases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { environment: PaddleEnv }) => {
    if (d.environment !== "sandbox" && d.environment !== "live") {
      throw new Error("invalid environment");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email =
      (claims as { email?: string } | undefined)?.email ?? undefined;
    if (!email) return { ok: false, reason: "no_email", grantedCount: 0 };

    // 1) Look up the Paddle customer by email.
    const custRes = await gatewayFetch(
      data.environment,
      `/customers?email=${encodeURIComponent(email)}`,
    );
    if (!custRes.ok) return { ok: false, reason: `customer_lookup_${custRes.status}`, grantedCount: 0 };
    const custBody = await custRes.json();
    const customers: any[] = custBody?.data ?? [];
    if (customers.length === 0) return { ok: true, grantedCount: 0, reason: "no_customer" };

    let grantedCount = 0;
    const granted: string[] = [];
    const skipped: { id: string; reason: string }[] = [];

    for (const cust of customers) {
      // 2) List recent completed transactions for this customer.
      const txRes = await gatewayFetch(
        data.environment,
        `/transactions?customer_id=${encodeURIComponent(cust.id)}&status=completed&per_page=30&order_by=created_at[DESC]`,
      );
      if (!txRes.ok) continue;
      const txBody = await txRes.json();
      const txns: any[] = txBody?.data ?? [];

      for (const txn of txns) {
        // Already in our DB and granted? skip.
        const { data: existing } = await supabaseAdmin
          .from("paddle_purchases")
          .select("granted")
          .eq("paddle_transaction_id", txn.id)
          .maybeSingle();
        if (existing?.granted) continue;

        // Only grant if customData userId matches (or is missing → trust email match).
        const ownerId = txn.custom_data?.userId ?? txn.customData?.userId;
        if (ownerId && ownerId !== userId) {
          skipped.push({ id: txn.id, reason: "owner_mismatch" });
          continue;
        }

        let packId = getPaddlePackId(txn);
        if (!packId && txn.items?.[0]?.price?.id) {
          const pr = await gatewayFetch(
            data.environment,
            `/prices/${encodeURIComponent(txn.items[0].price.id)}`,
          );
          if (pr.ok) {
            const pb = await pr.json();
            packId =
              pb?.data?.import_meta?.external_id ??
              pb?.data?.importMeta?.externalId ??
              pb?.data?.external_id ??
              pb?.data?.externalId ??
              undefined;
          }
        }
        if (!packId) {
          skipped.push({ id: txn.id, reason: "no_pack_id" });
          continue;
        }

        const pack = STORE_PACKS.find((p) => p.id === packId);
        if (!pack) {
          skipped.push({ id: txn.id, reason: `unknown_pack_id:${packId}` });
          continue;
        }
        const reward = pack.reward;
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
        if (error) {
          skipped.push({ id: txn.id, reason: `rpc:${error.message}` });
          continue;
        }
        const alreadyGranted = !!(grantRes as { already_granted?: boolean } | null)?.already_granted;

        // Ships — idempotent per txn; run even when currency was already granted so
        // partial past failures self-heal on the next reconcile.
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

        if (alreadyGranted) continue;

        if (reward.items?.length) {
          for (const it of reward.items) {
            await supabaseAdmin.rpc("grant_inventory_item", {
              _user: userId,
              _item_type: it.itemType,
              _item_id: it.itemId,
              _qty: it.qty,
            });
          }
        }

        granted.push(packId);
        grantedCount += 1;
      }
    }

    return { ok: true, grantedCount, granted, skipped };
  });
