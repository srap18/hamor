import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPack, STORE_PACKS } from "./store-catalog";

const ALLOWED_HOSTS = new Set([
  "www.molok-alqarasna.com",
  "molok-alqarasna.com",
  "hamor.lovable.app",
]);

function safeOrigin(originHeader: string | null | undefined): string {
  try {
    if (!originHeader) return "https://www.molok-alqarasna.com";
    const u = new URL(originHeader);
    if (ALLOWED_HOSTS.has(u.host)) return `${u.protocol}//${u.host}`;
  } catch {
    /* noop */
  }
  return "https://www.molok-alqarasna.com";
}

export const createPayPalOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { packId: string; origin?: string }) => {
    if (!d?.packId || typeof d.packId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(d.packId)) {
      throw new Error("invalid packId");
    }
    if (!STORE_PACKS.some((p) => p.id === d.packId)) throw new Error("unknown packId");
    return d;
  })
  .handler(async ({ data, context }) => {
    const pack = getPack(data.packId);
    if (!pack) throw new Error("الباقة غير موجودة");

    const { createOrder } = await import("./paypal.server");
    const origin = safeOrigin(data.origin);
    const order = await createOrder({
      packId: pack.id,
      userId: context.userId,
      amountUsd: pack.priceUSD,
      description: pack.label,
      returnUrl: `${origin}/payment-success?paypal=1`,
      cancelUrl: `${origin}/shop?paypal=cancel`,
    });
    return { orderId: order.id, approveUrl: order.approveUrl };
  });

export const capturePayPalOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orderId: string }) => {
    if (!d?.orderId || typeof d.orderId !== "string" || d.orderId.length > 64) {
      throw new Error("invalid orderId");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { captureOrder } = await import("./paypal.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const result = await captureOrder(data.orderId);
    if (result.userId && result.userId !== context.userId) {
      throw new Error("Order does not belong to current user");
    }
    if (result.status !== "COMPLETED") {
      return { ok: false, status: result.status, packId: result.packId };
    }

    const pack = getPack(result.packId);
    if (!pack) throw new Error("Unknown pack in order");
    const reward = pack.reward;
    const amountCents = Math.round(result.amountUsd * 100);

    const { error } = await supabaseAdmin.rpc("grant_paddle_purchase", {
      _txn_id: `pp_${result.captureId}`,
      _user: context.userId,
      _pack_id: pack.id,
      _amount_cents: amountCents,
      _gems: reward.gems ?? 0,
      _coins: reward.coins ?? 0,
      _rubies: reward.rubies ?? 0,
      _shield_days: reward.shieldDays ?? 0,
      _vip_days: reward.vipDays ?? 0,
      _env: "live",
    });
    if (error) throw new Error(`grant failed: ${error.message}`);

    if (reward.items?.length) {
      for (const it of reward.items) {
        await supabaseAdmin.rpc("grant_inventory_item", {
          _user: context.userId,
          _item_type: it.itemType,
          _item_id: it.itemId,
          _qty: it.qty,
        });
      }
    }

    if (reward.phoenixShips && reward.phoenixShips > 0) {
      const rows = Array.from({ length: reward.phoenixShips }, () => ({
        user_id: context.userId,
        template_id: 31,
        hp: 13000,
        max_hp: 13000,
        at_sea: false,
        catalog_code: "ship-lvl-31",
      }));
      await supabaseAdmin.from("ships_owned").insert(rows);
    }

    if (amountCents > 0) {
      await supabaseAdmin.rpc("grant_referral_bonus", {
        _user: context.userId,
        _txn_id: `pp_${result.captureId}`,
        _amount_cents: amountCents,
      });
    }

    return { ok: true, status: "COMPLETED", packId: pack.id };
  });
