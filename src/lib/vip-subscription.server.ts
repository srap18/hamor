/**
 * Server-only helpers to resolve the caller's Paddle subscription.
 *
 * Historically only webhook-created rows existed in `subscriptions`, so most
 * subscribers (whose rows were never written) saw no "manage subscription"
 * card at all. This resolver falls back to the Paddle API using the user's
 * latest Elite VIP transaction and backfills the row when found.
 */
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

const LIVE_STATUSES = ["active", "trialing", "past_due", "paused"];

type AnyClient = {
  from: (t: string) => any;
};

async function readDbRow(supabase: AnyClient, userId: string): Promise<MySubscription | null> {
  const { data } = await supabase
    .from("subscriptions")
    .select(
      "paddle_subscription_id, status, product_id, price_id, current_period_end, cancel_at_period_end, environment",
    )
    .eq("user_id", userId)
    .in("status", LIVE_STATUSES)
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
}

/** Look up the subscription behind the user's latest Elite VIP transaction. */
async function resolveFromPaddle(userId: string): Promise<MySubscription | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: purchases } = await supabaseAdmin
    .from("paddle_purchases")
    .select("paddle_transaction_id, environment, created_at, pack_id")
    .eq("user_id", userId)
    .ilike("pack_id", "elite_vip_%")
    .order("created_at", { ascending: false })
    .limit(5);

  for (const p of purchases ?? []) {
    const txnId = String((p as any).paddle_transaction_id ?? "");
    if (!txnId.startsWith("txn_")) continue;
    const env: PaddleEnv = (p as any).environment === "sandbox" ? "sandbox" : "live";

    try {
      const txnRes = await gatewayFetch(env, `/transactions/${txnId}`);
      if (!txnRes.ok) continue;
      const txn = (await txnRes.json()) as any;
      const subId: string | undefined = txn?.data?.subscription_id;
      if (!subId) continue;

      const subRes = await gatewayFetch(env, `/subscriptions/${subId}`);
      if (!subRes.ok) continue;
      const sub = (await subRes.json()) as any;
      const d = sub?.data;
      if (!d || !LIVE_STATUSES.includes(String(d.status))) continue;

      const item = Array.isArray(d.items) ? d.items[0] : null;
      const priceId: string = item?.price?.id ?? "";
      const productId: string = item?.price?.product_id ?? "";
      const periodEnd: string | null = d.current_billing_period?.ends_at ?? null;
      const cancelAtPeriodEnd = d.scheduled_change?.action === "cancel";

      // Backfill so subsequent reads are instant.
      await supabaseAdmin.from("subscriptions").upsert(
        {
          user_id: userId,
          paddle_subscription_id: subId,
          status: d.status,
          product_id: productId,
          price_id: priceId,
          current_period_end: periodEnd,
          cancel_at_period_end: cancelAtPeriodEnd,
          environment: env,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "paddle_subscription_id" },
      );

      return {
        id: subId,
        status: String(d.status),
        productId,
        priceId,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd,
        environment: env,
      };
    } catch (e) {
      console.error("[vip-subscription] paddle lookup failed", (e as Error)?.message);
    }
  }
  return null;
}

export async function resolveMySubscription(
  supabase: AnyClient,
  userId: string,
): Promise<MySubscription | null> {
  const row = await readDbRow(supabase, userId);
  if (row) return row;
  return await resolveFromPaddle(userId);
}
