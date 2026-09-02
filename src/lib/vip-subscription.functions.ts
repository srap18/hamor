import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type MySubscription = {
  id: string;
  status: string;
  productId: string;
  priceId: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  environment: "sandbox" | "live";
};

/** Read the signed-in user's active Paddle subscription (if any). */
export const getMySubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MySubscription | null> => {
    const { supabase, userId } = context;
    const { resolveMySubscription } = await import("@/lib/vip-subscription.server");
    return await resolveMySubscription(supabase as never, userId);
  });

/**
 * Guard before opening an Elite VIP checkout: a user who already has a live
 * Paddle subscription must manage/upgrade it instead of creating a second one
 * (which caused duplicate monthly charges).
 */
export const assertEliteVipPurchaseAllowed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { resolveMySubscription } = await import("@/lib/vip-subscription.server");
    const sub = await resolveMySubscription(supabase as never, userId);
    if (sub && (sub.status === "active" || sub.status === "trialing")) {
      throw new Error(
        "لديك اشتراك Elite VIP فعّال بالفعل. ألغِ الاشتراك الحالي من صفحة «اشتراكي» قبل شراء اشتراك جديد حتى لا يتم خصم مبلغين.",
      );
    }
    return { ok: true };
  });

/**
 * Turn auto-renew on/off for the caller's own subscription.
 * `cancel` => schedule cancellation at the end of the billing period.
 * `resume` => remove the scheduled cancellation (auto-renew back on).
 */
export const setAutoRenew = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { enabled: boolean }) => {
    if (typeof d?.enabled !== "boolean") throw new Error("invalid input");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { updateMySubscriptionAutoRenew } = await import("@/lib/vip-subscription.server");
    return await updateMySubscriptionAutoRenew(supabase as never, userId, data.enabled);
  });
