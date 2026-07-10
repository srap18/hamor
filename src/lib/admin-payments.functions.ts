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

    const custRes = await gatewayFetch(
      data.environment,
      `/customers?email=${encodeURIComponent(email)}`,
    );
    if (!custRes.ok) return { ok: false, reason: `customer_lookup_${custRes.status}`, grantedCount: 0 };
    const custBody = await custRes.json();
    const customers: any[] = custBody?.data ?? [];

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

        // Elite VIP subscription path
        const eliteTier = ELITE_VIP_TIERS.find((t) => t.paddlePriceId === packId);
        if (eliteTier) {
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          await supabaseAdmin
            .from("profiles")
            .update({
              elite_vip_level: eliteTier.level,
              elite_vip_expires_at: expiresAt,
            } as never)
            .eq("id", data.userId);
          await supabaseAdmin.from("paddle_purchases").insert({
            user_id: data.userId,
            paddle_transaction_id: txn.id,
            pack_id: packId,
            status: "completed",
            environment: data.environment,
            granted: true,
            granted_at: new Date().toISOString(),
            amount_cents: Number(txn.details?.totals?.total ?? 0),
          } as never);
          granted.push(packId);
          grantedCount += 1;
          continue;
        }

        const pack = STORE_PACKS.find((p) => p.id === packId);
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
        if (alreadyGranted) continue;

        if (reward.items?.length) {
          for (const it of reward.items) {
            await supabaseAdmin.rpc("grant_inventory_item", {
              _user: data.userId,
              _item_type: it.itemType,
              _item_id: it.itemId,
              _qty: it.qty,
            });
          }
        }
        if (reward.phoenixShips && reward.phoenixShips > 0) {
          const rows = Array.from({ length: reward.phoenixShips }, () => ({
            user_id: data.userId,
            template_id: 31,
            hp: 13000,
            max_hp: 13000,
            at_sea: false,
            catalog_code: "ship-lvl-31",
          }));
          await supabaseAdmin.from("ships_owned").insert(rows);
        }
        const dragonGrants: { qty?: number; level: number; hp: number; code: string }[] = [
          { qty: reward.dragonT1Ships, level: 34, hp: 20000, code: "dragon-t1" },
          { qty: reward.dragonT2Ships, level: 35, hp: 40000, code: "dragon-t2" },
          { qty: reward.dragonT3Ships, level: 36, hp: 60000, code: "dragon-t3" },
        ];
        for (const g of dragonGrants) {
          if (!g.qty || g.qty <= 0) continue;
          const rows = Array.from({ length: g.qty }, () => ({
            user_id: data.userId, template_id: g.level, hp: g.hp, max_hp: g.hp, at_sea: false, catalog_code: g.code,
          }));
          await supabaseAdmin.from("ships_owned").insert(rows);
        }



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
