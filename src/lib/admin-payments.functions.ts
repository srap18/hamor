/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gatewayFetch, type PaddleEnv } from "@/lib/paddle.server";
import { STORE_PACKS } from "@/lib/store-catalog";
import { ELITE_VIP_TIERS } from "@/lib/elite-vip";

function getPaddlePackId(txn: any): string | undefined {
  const item = txn.items?.[0];
  return (
    txn.custom_data?.packId ||
    txn.customData?.packId ||
    item?.price?.import_meta?.external_id ||
    item?.price?.importMeta?.externalId ||
    item?.price?.external_id ||
    item?.price?.externalId
  );
}

/**
 * Admin tool: reconcile a specific player's Paddle purchases by their userId.
 * Looks up the player's email, finds the Paddle customer(s), and grants any
 * completed transactions that aren't already recorded. Idempotent.
 */
export const adminReconcilePaddleForUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; environment?: PaddleEnv }) => {
    if (!d?.userId) throw new Error("userId required");
    return { userId: d.userId, environment: (d.environment ?? "live") as PaddleEnv };
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: au } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    const email = au?.user?.email;
    if (!email) return { ok: false, reason: "no_email", grantedCount: 0 };

    const { findPaddleCustomers } = await import("@/lib/paddle-customers.server");
    const lookup = await findPaddleCustomers(data.environment, email);
    const customers: any[] = lookup.customers;
    if (customers.length === 0) {
      return { ok: false, reason: lookup.reason ?? "no_customer", grantedCount: 0, email };
    }


    let grantedCount = 0;
    const granted: string[] = [];
    const skipped: { id: string; reason: string }[] = [];

    for (const cust of customers) {
      const txRes = await gatewayFetch(
        data.environment,
        `/transactions?customer_id=${encodeURIComponent(cust.id)}&status=completed&per_page=50&order_by=created_at[DESC]`,
      );
      if (!txRes.ok) continue;
      const txBody = await txRes.json();
      const txns: any[] = txBody?.data ?? [];

      for (const txn of txns) {
        const { data: existing } = await supabaseAdmin
          .from("paddle_purchases")
          .select("granted")
          .eq("paddle_transaction_id", txn.id)
          .maybeSingle();
        if (existing?.granted) continue;

        let packId = getPaddlePackId(txn);
        if (!packId && txn.items?.[0]?.price?.id) {
          const pr = await gatewayFetch(
            data.environment,
            `/prices/${encodeURIComponent(txn.items[0].price.id)}`,
          );
          if (pr.ok) {
            const pb = await pr.json();
            packId = pb?.data?.import_meta?.external_id ?? undefined;
          }
        }
        if (!packId) {
          skipped.push({ id: txn.id, reason: "no_pack_id" });
          continue;
        }

        const pack = STORE_PACKS.find((p) => p.id === packId);
        const eliteTier = ELITE_VIP_TIERS.find((t) => t.paddlePriceId === packId);
        if (!pack && !eliteTier) {
          skipped.push({ id: txn.id, reason: `unknown_pack_id:${packId}` });
          continue;
        }
        const reward = pack?.reward ?? {};
        const amountCents = Number(txn.details?.totals?.total ?? 0);

        const { data: grantRes, error } = await supabaseAdmin.rpc("grant_paddle_purchase", {
          _txn_id: txn.id,
          _user: data.userId,
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

        // Ships — idempotent per txn.
        if (
          (reward.phoenixShips ?? 0) > 0 ||
          (reward.dragonT1Ships ?? 0) > 0 ||
          (reward.dragonT2Ships ?? 0) > 0 ||
          (reward.dragonT3Ships ?? 0) > 0
        ) {
          await supabaseAdmin.rpc("grant_pack_ships" as never, {
            _txn_id: txn.id,
            _user: data.userId,
            _phoenix: reward.phoenixShips ?? 0,
            _dragon_t1: reward.dragonT1Ships ?? 0,
            _dragon_t2: reward.dragonT2Ships ?? 0,
            _dragon_t3: reward.dragonT3Ships ?? 0,
          } as never);
        }

        // Items — always run; idempotent per (txn, item_type, item_id).
        if (reward.items?.length) {
          await supabaseAdmin.rpc("grant_pack_items" as never, {
            _txn_id: txn.id,
            _user: data.userId,
            _items: reward.items,
          } as never);
        }

        if (alreadyGranted) continue;

        granted.push(packId);
        grantedCount += 1;

      }
    }

    // Also attempt to clear any unmapped_payments rows for this email.
    await supabaseAdmin
      .from("unmapped_payments")
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq("email", email)
      .eq("resolved", false);

    return { ok: true, grantedCount, granted, skipped, email };
  });
