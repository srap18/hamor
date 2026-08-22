import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gatewayFetch, type PaddleEnv } from "@/lib/paddle.server";
import { resolveMySubscription, type MySubscription } from "@/lib/vip-subscription.server";

export type { MySubscription };

/** Read the signed-in user's active Paddle subscription (if any). */
export const getMySubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MySubscription | null> => {
    const { supabase, userId } = context;
    return await resolveMySubscription(supabase as never, userId);
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
    const sub = await resolveMySubscription(supabase as never, userId);

    if (!sub) throw new Error("لا يوجد اشتراك نشط على هذا الحساب");

    const env: PaddleEnv = sub.environment;
    const subId = sub.id;

    let res: Response;
    if (data.enabled) {
      // Remove the scheduled cancellation.
      res = await gatewayFetch(env, `/subscriptions/${subId}`, {
        method: "PATCH",
        body: JSON.stringify({ scheduled_change: null }),
      });
    } else {
      res = await gatewayFetch(env, `/subscriptions/${subId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ effective_from: "next_billing_period" }),
      });
    }

    if (!res.ok) {
      const text = await res.text();
      console.error("paddle auto-renew update failed", res.status, text);
      throw new Error("تعذّر تحديث الاشتراك، حاول لاحقاً");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("subscriptions")
      .update({ cancel_at_period_end: !data.enabled, updated_at: new Date().toISOString() })
      .eq("paddle_subscription_id", subId)
      .eq("user_id", userId);

    return {
      ok: true,
      cancelAtPeriodEnd: !data.enabled,
      currentPeriodEnd: sub.currentPeriodEnd,
    };
  });
