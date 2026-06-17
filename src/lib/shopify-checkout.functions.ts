import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { STORE_PACKS, getPack } from "./store-catalog";

/**
 * Resolves the Shopify variant GID for a given pack id and re-runs the
 * eligibility checks (weekly limits, one-time packs) so the client can
 * never bypass them by just calling Storefront directly with their own id.
 */
export const resolveShopifyPackForCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { packId: string }) => {
    if (
      !d?.packId ||
      typeof d.packId !== "string" ||
      d.packId.length > 64 ||
      !/^[a-zA-Z0-9_-]+$/.test(d.packId)
    ) {
      throw new Error("invalid packId");
    }
    if (!STORE_PACKS.some((p) => p.id === d.packId)) {
      throw new Error("unknown packId");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const pack = getPack(data.packId);
    if (!pack) throw new Error("الباقة غير موجودة");

    // Eligibility checks (mirror of checkPackEligibility)
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    if (pack.weeklyLimit && pack.category === "shield") {
      const { data: count, error } = await supabaseAdmin.rpc(
        "shield_purchases_last_week",
        { _user: userId },
      );
      if (error) throw new Error(error.message);
      if (((count as number) ?? 0) >= pack.weeklyLimit) {
        throw new Error(
          `وصلت الحد الأقصى (${pack.weeklyLimit} دروع في الأسبوع). جرب بعد فترة.`,
        );
      }
    }
    if (pack.oneTime) {
      const { data: bought } = await supabaseAdmin.rpc("has_bought_starter", {
        _user: userId,
      });
      if (bought) throw new Error("هذي الباقة لمرة وحدة فقط وقد اشتريتها.");
    }

    // Look up the Shopify mapping
    const { data: mapping, error: mErr } = await supabase
      .from("shopify_products")
      .select("variant_gid")
      .eq("pack_id", data.packId)
      .maybeSingle();

    if (mErr) throw new Error(mErr.message);
    if (!mapping?.variant_gid) {
      throw new Error(
        "هذي الباقة لسه ما تم ربطها بـ Shopify بعد. تواصل مع الإدارة.",
      );
    }

    // Buyer email (optional, pre-fills Shopify checkout)
    const email = (context.claims as { email?: string } | undefined)?.email;

    return {
      variantGid: mapping.variant_gid,
      userId,
      packId: pack.id,
      email,
    };
  });
