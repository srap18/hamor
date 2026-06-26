import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { STORE_PACKS, getPack } from "./store-catalog";

export const getStorePurchaseStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    const { userId } = context;
    const [{ data: shieldCount }, { data: starter }] = await Promise.all([
      supabaseAdmin.rpc("shield_purchases_last_week", { _user: userId }),
      supabaseAdmin.rpc("has_bought_starter", { _user: userId }),
    ]);
    return {
      shieldsThisWeek: (shieldCount as number) ?? 0,
      shieldWeeklyLimit:
        STORE_PACKS.find((p) => p.id === "shield_2d")?.weeklyLimit ?? 2,
      hasBoughtStarter: !!starter,
    };
  });

// Pre-checkout guard: enforce one-time and weekly-limit rules before opening Paddle.
export const checkPackEligibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { packId: string }) => {
    if (!d?.packId || typeof d.packId !== "string" || d.packId.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(d.packId)) {
      throw new Error("invalid packId");
    }
    if (!STORE_PACKS.some((p) => p.id === d.packId)) throw new Error("unknown packId");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const pack = getPack(data.packId);
    if (!pack) throw new Error("الباقة غير موجودة");

    // Block accounts that previously refunded a delivered purchase.
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("purchases_blocked")
      .eq("id", userId)
      .maybeSingle();
    if (prof && (prof as { purchases_blocked?: boolean }).purchases_blocked) {
      throw new Error(
        "تم تعليق إمكانية الشراء على حسابك بسبب استرداد سابق لمشتريات تم تسليمها. تواصل مع الدعم.",
      );
    }

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
    return { ok: true };
  });
