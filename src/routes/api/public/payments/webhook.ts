/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { verifyWebhook, EventName, type PaddleEnv } from "@/lib/paddle.server";
import { STORE_PACKS } from "@/lib/store-catalog";

let _supabase: any = null;
function getSupabase(): any {
  if (!_supabase) {
    _supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _supabase;
}

function rewardFor(packId: string) {
  return STORE_PACKS.find((p) => p.id === packId)?.reward ?? {};
}

function getPackIdFromTransaction(data: any): string | undefined {
  const item = data.items?.[0];
  return (
    data.customData?.packId ||
    data.custom_data?.packId ||
    item?.price?.importMeta?.externalId ||
    item?.price?.import_meta?.external_id ||
    item?.price?.externalId ||
    item?.price?.external_id ||
    data.details?.lineItems?.[0]?.product?.importMeta?.externalId ||
    data.details?.line_items?.[0]?.product?.import_meta?.external_id
  );
}

async function handleSubscriptionCreated(data: any, env: PaddleEnv) {
  const userId = data.customData?.userId;
  if (!userId) return console.error("No userId in customData");
  const item = data.items?.[0];
  const priceId = item?.price?.importMeta?.externalId;
  const productId = item?.product?.importMeta?.externalId;
  if (!priceId || !productId) {
    console.warn("Skipping subscription: missing importMeta.externalId");
    return;
  }
  await getSupabase().from("subscriptions").upsert(
    {
      user_id: userId,
      paddle_subscription_id: data.id,
      paddle_customer_id: data.customerId,
      product_id: productId,
      price_id: priceId,
      status: data.status,
      current_period_start: data.currentBillingPeriod?.startsAt,
      current_period_end: data.currentBillingPeriod?.endsAt,
      environment: env,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "paddle_subscription_id" },
  );
}

async function handleSubscriptionUpdated(data: any, env: PaddleEnv) {
  await getSupabase()
    .from("subscriptions")
    .update({
      status: data.status,
      current_period_start: data.currentBillingPeriod?.startsAt,
      current_period_end: data.currentBillingPeriod?.endsAt,
      cancel_at_period_end: data.scheduledChange?.action === "cancel",
      updated_at: new Date().toISOString(),
    })
    .eq("paddle_subscription_id", data.id)
    .eq("environment", env);
}

async function handleSubscriptionCanceled(data: any, env: PaddleEnv) {
  const supabase = getSupabase();
  await supabase
    .from("subscriptions")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("paddle_subscription_id", data.id)
    .eq("environment", env);

  // Immediate VIP revocation per business rule.
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("user_id, price_id")
    .eq("paddle_subscription_id", data.id)
    .maybeSingle();
  if (sub && (sub as any).price_id === "vip_monthly") {
    await supabase.rpc("revoke_vip_protection", { _user: (sub as any).user_id });
  }
}

async function handleTransactionCompleted(data: any, env: PaddleEnv) {
  const userId = data.customData?.userId;
  if (!userId) return console.error("transaction: no userId in customData");
  const priceExt = getPackIdFromTransaction(data);
  if (!priceExt) {
    console.warn("transaction: missing pack id");
    return;
  }
  // For subscriptions, rewards are granted per renewal cycle too.
  const reward = rewardFor(priceExt);
  const amountCents = Number(data.details?.totals?.total ?? 0);
  const { error } = await getSupabase().rpc("grant_paddle_purchase", {
    _txn_id: data.id,
    _user: userId,
    _pack_id: priceExt,
    _amount_cents: amountCents,
    _gems: reward.gems ?? 0,
    _coins: reward.coins ?? 0,
    _rubies: reward.rubies ?? 0,
    _shield_days: reward.shieldDays ?? 0,
    _vip_days: reward.vipDays ?? 0,
    _env: env,
  });
  if (error) {
    console.error("grant_paddle_purchase failed:", error);
    throw new Error(`grant_paddle_purchase failed: ${error.message}`);
  }

  // Grant inventory items (e.g. ad_bomb_pack → 1× ad_bomb)
  if (reward.items?.length) {
    for (const it of reward.items) {
      const { error: invErr } = await getSupabase().rpc("grant_inventory_item", {
        _user: userId,
        _item_type: it.itemType,
        _item_id: it.itemId,
        _qty: it.qty,
      });
      if (invErr) {
        console.error("grant_inventory_item failed:", invErr, it);
        // Throw so the webhook returns 400 and Paddle retries — better than silent loss.
        throw new Error(`grant_inventory_item failed for ${it.itemType}/${it.itemId}: ${invErr.message}`);
      }
    }
  }

  // Referral bonus: if buyer was invited, reward inviter with 30% of purchase value in gems.
  // Game-funded — no deduction from buyer.
  if (amountCents > 0) {
    const { error: refErr } = await getSupabase().rpc("grant_referral_bonus", {
      _user: userId,
      _txn_id: data.id,
      _amount_cents: amountCents,
    });
    if (refErr) {
      console.error("grant_referral_bonus failed:", refErr);
      // Non-fatal: don't fail the whole webhook for a bonus.
    }
  }
}

async function handleWebhook(req: Request, env: PaddleEnv) {
  const event = await verifyWebhook(req, env);
  switch (event.eventType) {
    case EventName.SubscriptionCreated:
      await handleSubscriptionCreated(event.data, env);
      break;
    case EventName.SubscriptionUpdated:
      await handleSubscriptionUpdated(event.data, env);
      break;
    case EventName.SubscriptionCanceled:
      await handleSubscriptionCanceled(event.data, env);
      break;
    case EventName.TransactionCompleted:
      await handleTransactionCompleted(event.data, env);
      break;
    default:
      console.log("Unhandled event:", event.eventType);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const env = (url.searchParams.get("env") || "sandbox") as PaddleEnv;
        try {
          await handleWebhook(request, env);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
