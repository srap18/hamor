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

export const createPolarCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { packId: string; origin?: string }) => {
    if (!d?.packId || typeof d.packId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(d.packId)) {
      throw new Error("invalid packId");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { findProductByPackId, createCheckout } = await import("./polar.server");

    // If it's a store pack, enforce eligibility limits (weekly/oneTime)
    const storePack = getPack(data.packId);
    if (storePack) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      if (storePack.weeklyLimit && storePack.category === "shield") {
        const { data: weekly } = await supabaseAdmin.rpc("shield_purchases_last_week", {
          _user: context.userId,
        });
        if ((weekly ?? 0) >= storePack.weeklyLimit) {
          throw new Error("بلغت حد الشراء الأسبوعي لهذا المنتج");
        }
      }
      if (storePack.oneTime) {
        const { data: bought } = await supabaseAdmin.rpc("has_bought_starter", {
          _user: context.userId,
        });
        if (bought) throw new Error("هذا العرض لمرة واحدة فقط");
      }
    } else if (!data.packId.startsWith("elite_vip_")) {
      // Only allow known store packs OR elite VIP tier IDs
      throw new Error("معرف الباقة غير معروف");
    }

    const product = await findProductByPackId(data.packId);
    if (!product) {
      throw new Error(
        `المنتج غير موجود في Polar. تأكد أن منتج Polar يحتوي على metadata.pack_id = "${data.packId}"`,
      );
    }

    const origin = safeOrigin(data.origin);
    const successUrl = `${origin}/payment-success?polar_checkout_id={CHECKOUT_ID}`;

    const checkout = await createCheckout({
      productId: product.id,
      externalCustomerId: context.userId,
      successUrl,
      metadata: {
        pack_id: data.packId,
        user_id: context.userId,
      },
    });

    return { checkoutId: checkout.id, checkoutUrl: checkout.url };
  });

export const verifyPolarCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { checkoutId: string }) => {
    if (!d?.checkoutId || typeof d.checkoutId !== "string" || d.checkoutId.length > 128) {
      throw new Error("invalid checkoutId");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { getCheckout } = await import("./polar.server");
    const co = await getCheckout(data.checkoutId);

    // External customer id must match the signed-in user
    if (co.customer_external_id && co.customer_external_id !== context.userId) {
      throw new Error("Checkout does not belong to current user");
    }
    const md = (co.metadata as Record<string, unknown> | null) || {};
    const packId =
      typeof md.pack_id === "string" && md.pack_id ? md.pack_id : null;

    return {
      status: co.status,
      packId,
      isPaid: co.status === "succeeded" || co.status === "confirmed",
    };
  });

// Keep a tiny helper export so consumers don't import unused names
export const _STORE_PACKS_COUNT = STORE_PACKS.length;
