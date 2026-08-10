import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gatewayFetch, type PaddleEnv } from "@/lib/paddle.server";

export type MySubscription = {
  id: string;
  status: string;
  productId: string;
  priceId: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  environment: PaddleEnv;
};

/** Read the signed-in user's active Paddle subscription (if any). */
export const getMySubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MySubscription | null> => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("subscriptions")
      .select(
        "paddle_subscription_id, status, product_id, price_id, current_period_end, cancel_at_period_end, environment",
      )
      .eq("user_id", userId)
      .in("status", ["active", "trialing", "past_due", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return null;
    return {
      id: data.paddle_subscription_id,
      status: data.status,
      productId: data.product_id,
      priceId: data.price_id,
      currentPeriodEnd: data.current_period_end,
      cancelAtPeriodEnd: !!data.cancel_at_period_end,
      environment: (data.environment === "live" ? "live" : "sandbox") as PaddleEnv,
    };
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
    const { data: row } = await supabase
      .from("subscriptions")
      .select("paddle_subscription_id, status, environment, current_period_end")
      .eq("user_id", userId)
      .in("status", ["active", "trialing", "past_due", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!row) throw new Error("لا يوجد اشتراك نشط على هذا الحساب");

    const env: PaddleEnv = row.environment === "live" ? "live" : "sandbox";
    const subId = row.paddle_subscription_id;

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
      currentPeriodEnd: row.current_period_end as string | null,
    };
  });
