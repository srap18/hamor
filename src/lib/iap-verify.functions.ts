/**
 * Server-side receipt verification for native in-app purchases.
 *
 * Resolves the product identifier against the real game catalog
 * (`STORE_PACKS` + `ELITE_VIP_TIERS`) and grants the corresponding reward
 * through the same `grant_paddle_purchase` RPC the Paddle web flow uses,
 * so the rest of the app does not need to special-case the source.
 *
 * The dedicated webhook handlers (Google RTDN / Apple App Store Server
 * Notifications) remain the source of truth and will reconcile / revoke
 * if the receipt is later refunded or invalid.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { STORE_PACKS } from "@/lib/store-catalog";
import { ELITE_VIP_TIERS } from "@/lib/elite-vip";

const InputSchema = z.object({
  productId: z.string().min(1).max(100),
  transactionId: z.string().min(1).max(200),
  receipt: z.string().min(1).max(20_000),
  platform: z.enum(["android", "ios"]),
});

export const verifyIapPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Resolve product to either a store pack or an Elite VIP tier.
    const pack = STORE_PACKS.find((p) => p.id === data.productId);
    const eliteTier = ELITE_VIP_TIERS.find((t) => t.paddlePriceId === data.productId);
    if (!pack && !eliteTier) {
      throw new Error(`unknown product: ${data.productId}`);
    }

    // 1) Idempotency — bail if this receipt was already processed.
    const { data: existing } = await supabaseAdmin
      .from("paddle_purchases")
      .select("id")
      .eq("paddle_transaction_id", data.transactionId)
      .maybeSingle();
    if (existing) return { ok: true, alreadyGranted: true, productId: data.productId };

    // 2) Server-side receipt verification with the store.
    //    Android: Google Play Developer API. iOS: TODO (App Store Server API).
    if (data.platform === "android") {
      const { toPlayId } = await import("@/lib/iap-play-ids");
      const {
        verifyPlayProduct,
        verifyPlaySubscription,
        acknowledgePlayProduct,
        acknowledgePlaySubscription,
      } = await import("@/lib/play-verify.server");
      const playSku = toPlayId(data.productId);
      const isSubscription = !!eliteTier || !!pack?.subscription;
      try {
        if (isSubscription) {
          const sub = await verifyPlaySubscription(playSku, data.receipt);
          // paymentState: 1 = received, 2 = free trial. 0 = pending, don't grant.
          if (sub.paymentState !== 1 && sub.paymentState !== 2) {
            throw new Error(`subscription not paid (state=${sub.paymentState})`);
          }
          const expiry = Number(sub.expiryTimeMillis ?? 0);
          if (expiry && expiry < Date.now()) {
            throw new Error("subscription already expired");
          }
          if (sub.acknowledgementState === 0) {
            await acknowledgePlaySubscription(playSku, data.receipt);
          }
        } else {
          const prod = await verifyPlayProduct(playSku, data.receipt);
          // purchaseState: 0 = purchased. 1 = canceled, 2 = pending.
          if (prod.purchaseState !== 0) {
            throw new Error(`product not purchased (state=${prod.purchaseState})`);
          }
          if (prod.acknowledgementState === 0) {
            await acknowledgePlayProduct(playSku, data.receipt);
          }
        }
      } catch (e: any) {
        console.error("[iap-verify] Google Play verification failed", e?.message ?? e);
        throw new Error(`google play verification failed: ${e?.message ?? "unknown"}`);
      }
    }

    const env = data.platform === "ios" ? "apple_iap" : "google_play";

    // 2) Elite VIP subscription path.
    if (eliteTier) {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await supabaseAdmin
        .from("profiles")
        .update({
          elite_vip_level: eliteTier.level,
          elite_vip_expires_at: expiresAt,
        } as never)
        .eq("id", userId);
      await supabaseAdmin.from("paddle_purchases").insert({
        user_id: userId,
        paddle_transaction_id: data.transactionId,
        pack_id: data.productId,
        status: "completed",
        environment: env,
        granted: true,
        granted_at: new Date().toISOString(),
      } as never);
      return { ok: true, alreadyGranted: false, productId: data.productId };
    }

    // 3) Regular store pack — reuse the canonical grant RPC.
    const reward = pack!.reward;
    const amountCents = Math.round(pack!.priceUSD * 100);

    const { data: grantRes, error } = await supabaseAdmin.rpc("grant_paddle_purchase" as never, {
      _txn_id: data.transactionId,
      _user: userId,
      _pack_id: pack!.id,
      _amount_cents: amountCents,
      _gems: reward.gems ?? 0,
      _coins: reward.coins ?? 0,
      _rubies: reward.rubies ?? 0,
      _shield_days: reward.shieldDays ?? 0,
      _vip_days: reward.vipDays ?? 0,
      _env: env,
    } as never);
    if (error) throw new Error(error.message);

    const alreadyGranted = !!(grantRes as { already_granted?: boolean } | null)?.already_granted;

    if (!alreadyGranted && reward.items?.length) {
      for (const it of reward.items) {
        await supabaseAdmin.rpc("grant_inventory_item" as never, {
          _user: userId,
          _item_type: it.itemType,
          _item_id: it.itemId,
          _qty: it.qty,
        } as never);
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
      await supabaseAdmin.from("ships_owned").insert(rows as never);
    }

    if (!alreadyGranted) {
      const dragonGrantsI: { qty?: number; level: number; hp: number; code: string }[] = [
        { qty: reward.dragonT1Ships, level: 34, hp: 20000, code: "dragon-t1" },
        { qty: reward.dragonT2Ships, level: 35, hp: 40000, code: "dragon-t2" },
        { qty: reward.dragonT3Ships, level: 36, hp: 60000, code: "dragon-t3" },
      ];
      for (const g of dragonGrantsI) {
        if (!g.qty || g.qty <= 0) continue;
        const rows = Array.from({ length: g.qty }, () => ({
          user_id: userId, template_id: g.level, hp: g.hp, max_hp: g.hp, at_sea: false, catalog_code: g.code,
        }));
        await supabaseAdmin.from("ships_owned").insert(rows as never);
      }
    }

    return { ok: true, alreadyGranted, productId: data.productId };
  });
