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
  return STORE_PACKS.find((p) => p.id === packId)?.reward;
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

// Map Paddle price_id → elite_vip_level. Single source of truth on the server.
function eliteLevelFromPriceId(priceId: string | undefined): number | null {
  if (!priceId) return null;
  const m = priceId.match(/^elite_vip_([1-5])_monthly$/);
  return m ? Number(m[1]) : null;
}

async function setEliteVipLevel(userId: string, level: number, expiresAt: string | null) {
  const { error } = await getSupabase()
    .from("profiles")
    .update({
      elite_vip_level: level,
      elite_vip_expires_at: level > 0 ? expiresAt : null,
    })
    .eq("id", userId);
  if (error) {
    console.error("setEliteVipLevel failed:", error);
    // Throw so Paddle retries the webhook — never silently leave a paid VIP inactive.
    throw new Error(`setEliteVipLevel failed for ${userId}: ${error.message}`);
  }
}


// Fallback: if Paddle doesn't send currentBillingPeriod.endsAt, use +30 days
function resolveExpiry(data: any): string {
  const endsAt = data?.currentBillingPeriod?.endsAt;
  if (endsAt) return new Date(endsAt).toISOString();
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
}

async function handleSubscriptionCreated(data: any, env: PaddleEnv) {
  const userId = data.customData?.userId ?? data.custom_data?.userId;
  if (!userId) return console.error("No userId in customData");
  const item = data.items?.[0];
  const priceId =
    item?.price?.importMeta?.externalId ??
    item?.price?.import_meta?.external_id ??
    item?.price?.externalId ??
    item?.price?.external_id;
  const productId =
    item?.product?.importMeta?.externalId ??
    item?.product?.import_meta?.external_id ??
    item?.product?.externalId ??
    item?.product?.external_id;
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

  // Elite VIP — grant the level immediately on activation.
  const eliteLevel = eliteLevelFromPriceId(priceId);
  if (eliteLevel && (data.status === "active" || data.status === "trialing")) {
    await setEliteVipLevel(userId, eliteLevel, resolveExpiry(data));
  }
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

  // Sync elite_vip_level — if status drops to canceled/past_due/paused, revoke.
  const userId = data.customData?.userId ?? data.custom_data?.userId;
  const item = data.items?.[0];
  const priceId =
    item?.price?.importMeta?.externalId ??
    item?.price?.import_meta?.external_id ??
    item?.price?.externalId ??
    item?.price?.external_id;
  const eliteLevel = eliteLevelFromPriceId(priceId);
  if (eliteLevel && userId) {
    const active = data.status === "active" || data.status === "trialing";
    await setEliteVipLevel(userId, active ? eliteLevel : 0, active ? resolveExpiry(data) : null);
  }
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
  // Revoke Elite VIP level on cancel (immediate per business rule).
  if (sub) {
    const eliteLevel = eliteLevelFromPriceId((sub as any).price_id);
    if (eliteLevel) {
      await setEliteVipLevel((sub as any).user_id, 0, null);
    }
  }
}

async function recordUnmapped(
  txnId: string,
  reason: string,
  env: PaddleEnv,
  data: any,
) {
  try {
    await getSupabase().from("unmapped_payments").upsert(
      {
        paddle_transaction_id: txnId,
        reason,
        amount_cents: Number(data?.details?.totals?.total ?? 0),
        environment: env,
        email: data?.customer?.email ?? data?.customData?.email ?? null,
        user_id_hint: data?.customData?.userId ?? data?.custom_data?.userId ?? null,
        pack_id_hint: getPackIdFromTransaction(data) ?? null,
        raw: data,
      },
      { onConflict: "paddle_transaction_id" },
    );
  } catch (e) {
    console.error("recordUnmapped failed:", e);
  }
}

async function handleTransactionCompleted(data: any, env: PaddleEnv) {
  const userId = data.customData?.userId ?? data.custom_data?.userId;
  if (!userId) {
    await recordUnmapped(data.id, "missing_user_id", env, data);
    // Throw so Paddle retries the webhook — never silently drop a paid txn.
    throw new Error("transaction: no userId in customData");
  }
  const priceExt = getPackIdFromTransaction(data);
  if (!priceExt) {
    await recordUnmapped(data.id, "missing_pack_id", env, data);
    throw new Error("transaction: missing pack id");
  }
  // Never mark an unknown paid product as granted with an empty reward.
  // Keep it recoverable and force a retry instead.
  const reward = rewardFor(priceExt);
  if (!reward) {
    await recordUnmapped(data.id, `unknown_pack_id:${priceExt}`, env, data);
    throw new Error(`transaction: unknown pack id ${priceExt}`);
  }
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
    await recordUnmapped(data.id, `grant_rpc:${error.message}`, env, data);
    console.error("grant_paddle_purchase failed:", error);
    throw new Error(`grant_paddle_purchase failed: ${error.message}`);
  }

  // Elite VIP activation is now handled atomically INSIDE grant_paddle_purchase
  // (same transaction as the paid-row insert). No separate UPDATE needed here.




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

  // Ships (Phoenix + Dragon T1/T2/T3) — idempotent per Paddle txn.
  if (
    (reward.phoenixShips ?? 0) > 0 ||
    (reward.dragonT1Ships ?? 0) > 0 ||
    (reward.dragonT2Ships ?? 0) > 0 ||
    (reward.dragonT3Ships ?? 0) > 0
  ) {
    const { error: shipErr } = await getSupabase().rpc("grant_pack_ships", {
      _txn_id: data.id,
      _user: userId,
      _phoenix: reward.phoenixShips ?? 0,
      _dragon_t1: reward.dragonT1Ships ?? 0,
      _dragon_t2: reward.dragonT2Ships ?? 0,
      _dragon_t3: reward.dragonT3Ships ?? 0,
    });
    if (shipErr) {
      console.error("grant_pack_ships failed:", shipErr);
      throw new Error(`grant_pack_ships failed: ${shipErr.message}`);
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

async function handleAdjustment(data: any, _env: PaddleEnv) {
  // Strict "no refunds" policy — gems are digital & delivered instantly.
  // Any refund/chargeback = permanent ban of the account + all its devices.
  const action: string = data.action || data.type || "";
  if (action !== "refund" && action !== "chargeback") {
    console.log("[adjustment] ignored action:", action);
    return;
  }
  const status: string = data.status || "";
  if (status && status !== "approved" && status !== "completed") {
    console.log("[adjustment] not approved yet:", status);
    return;
  }
  const txnId: string | undefined = data.transaction_id || data.transactionId;
  if (!txnId) {
    console.warn("[adjustment] missing transaction_id");
    return;
  }

  const supabase = getSupabase();
  const { data: banRes, error } = await supabase.rpc("refund_ban_user", {
    _txn_id: txnId,
    _reason: `${action}${data.reason ? ": " + data.reason : ""}`,
  });
  if (error) {
    console.error("refund_ban_user failed:", error);
    throw new Error(`refund_ban_user failed: ${error.message}`);
  }
  console.log("[adjustment] refund ban applied:", txnId, banRes);
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
    case EventName.AdjustmentCreated:
    case EventName.AdjustmentUpdated:
      await handleAdjustment(event.data, env);
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
