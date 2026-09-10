/**
 * Google Play — Real-time Developer Notifications (RTDN) webhook.
 *
 * Google publishes purchase/subscription lifecycle events to a Pub/Sub
 * topic; a push subscription forwards them to this URL as:
 *
 *   POST /api/public/hooks/play-rtdn?token=<PLAY_RTDN_TOKEN>
 *   { "message": { "data": "<base64 json>", "messageId": "..." },
 *     "subscription": "projects/.../subscriptions/..." }
 *
 * We authenticate by requiring the shared `PLAY_RTDN_TOKEN` query param
 * (configure it on the Pub/Sub push subscription URL) and always ACK
 * (200) to prevent Google from retrying forever, even on internal
 * failures — errors are logged in `play_rtdn_events.error`.
 *
 * Notification types:
 *   SUBSCRIPTION_RENEWED = 2, SUBSCRIPTION_CANCELED = 3,
 *   SUBSCRIPTION_EXPIRED = 13, SUBSCRIPTION_REVOKED = 12
 *   ONE_TIME_PRODUCT_CANCELED = 2 (refund)
 *   VOIDED_PURCHASE — full refund/chargeback
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const PubSubEnvelope = z.object({
  message: z.object({
    data: z.string().optional(),
    messageId: z.string().optional(),
    message_id: z.string().optional(),
  }),
  subscription: z.string().optional(),
});

type PlayNotification = {
  version?: string;
  packageName?: string;
  eventTimeMillis?: string;
  subscriptionNotification?: {
    notificationType: number;
    purchaseToken: string;
    subscriptionId: string;
  };
  oneTimeProductNotification?: {
    notificationType: number;
    purchaseToken: string;
    sku: string;
  };
  voidedPurchaseNotification?: {
    purchaseToken: string;
    orderId: string;
    productType?: number; // 1 = subscription, 2 = one-time
    refundType?: number;
  };
  testNotification?: { version: string };
};

function ack(): Response {
  return new Response("ok", { status: 200 });
}

export const Route = createFileRoute("/api/public/hooks/play-rtdn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // 1) Shared-secret auth (query param — configure on the Pub/Sub push URL).
        const url = new URL(request.url);
        const expected = process.env.PLAY_RTDN_TOKEN;
        if (!expected) {
          console.error("[play-rtdn] PLAY_RTDN_TOKEN not configured");
          return new Response("not configured", { status: 500 });
        }
        if (url.searchParams.get("token") !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        let envelope: z.infer<typeof PubSubEnvelope>;
        try {
          envelope = PubSubEnvelope.parse(await request.json());
        } catch {
          return new Response("bad request", { status: 400 });
        }

        const messageId =
          envelope.message.messageId ?? envelope.message.message_id ?? crypto.randomUUID();
        let decoded: PlayNotification;
        try {
          const raw = envelope.message.data
            ? new TextDecoder().decode(
                Uint8Array.from(atob(envelope.message.data), (c) => c.charCodeAt(0)),
              )
            : "{}";
          decoded = JSON.parse(raw) as PlayNotification;
        } catch (e) {
          console.error("[play-rtdn] failed to decode message", e);
          return ack();
        }

        // Test notifications from Play Console — just ack.
        if (decoded.testNotification) {
          console.log("[play-rtdn] test notification received");
          return ack();
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const sub = decoded.subscriptionNotification;
        const oneTime = decoded.oneTimeProductNotification;
        const voided = decoded.voidedPurchaseNotification;

        const purchaseToken = sub?.purchaseToken ?? oneTime?.purchaseToken ?? voided?.purchaseToken;
        const sku = oneTime?.sku;
        const subscriptionId = sub?.subscriptionId;
        const notificationType = sub
          ? `sub:${sub.notificationType}`
          : oneTime
            ? `product:${oneTime.notificationType}`
            : voided
              ? "voided"
              : "unknown";

        // 2) Idempotent insert (unique(message_id)).
        const { error: insertErr } = await supabaseAdmin
          .from("play_rtdn_events" as never)
          .insert({
            message_id: messageId,
            notification_type: notificationType,
            purchase_token: purchaseToken,
            sku,
            subscription_id: subscriptionId,
            raw: decoded as never,
          } as never);
        if (insertErr) {
          // Duplicate → already processed; ack and move on.
          if (insertErr.code === "23505") return ack();
          console.error("[play-rtdn] insert failed", insertErr);
          return ack();
        }

        // 3) Reconcile based on event type.
        try {
          if (voided && purchaseToken) {
            // Full refund/chargeback — revoke the granted purchase.
            await supabaseAdmin
              .from("paddle_purchases")
              .update({ status: "refunded", granted: false } as never)
              .eq("paddle_transaction_id", purchaseToken);
          }

          if (sub && purchaseToken && subscriptionId) {
            const { verifyPlaySubscription } = await import("@/lib/play-verify.server");
            const info = (await verifyPlaySubscription(subscriptionId, purchaseToken)) as {
              expiryTimeMillis?: string;
              paymentState?: number;
              orderId?: string;
              linkedPurchaseToken?: string;
            };
            const expiry = Number(info.expiryTimeMillis ?? 0);
            const orderId = String(info.orderId ?? "");
            // Renewal order ids look like "GPA.1234-5678-9012-34567..3" —
            // the part before ".." is the id stored for the first payment.
            const baseOrderId = orderId.includes("..") ? orderId.split("..")[0] : orderId;

            // Resolve the buyer: by stored token, by the token this one
            // replaced (upgrade/downgrade/resubscribe), or by the original
            // order id of the very first payment of this subscription.
            const findBuyer = async () => {
              const byToken = await supabaseAdmin
                .from("paddle_purchases")
                .select("id, user_id, pack_id")
                .eq("play_purchase_token", purchaseToken)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (byToken.data?.user_id) return byToken.data;

              if (info.linkedPurchaseToken) {
                const byLinked = await supabaseAdmin
                  .from("paddle_purchases")
                  .select("id, user_id, pack_id")
                  .eq("play_purchase_token", info.linkedPurchaseToken)
                  .order("created_at", { ascending: false })
                  .limit(1)
                  .maybeSingle();
                if (byLinked.data?.user_id) return byLinked.data;
              }

              if (baseOrderId) {
                const byOrder = await supabaseAdmin
                  .from("paddle_purchases")
                  .select("id, user_id, pack_id")
                  .eq("paddle_transaction_id", baseOrderId)
                  .maybeSingle();
                if (byOrder.data?.user_id) return byOrder.data;
              }

              // Legacy rows keyed by the raw token.
              const byRaw = await supabaseAdmin
                .from("paddle_purchases")
                .select("id, user_id, pack_id")
                .eq("paddle_transaction_id", purchaseToken)
                .maybeSingle();
              return byRaw.data ?? null;
            };

            const purch = await findBuyer();

            if (purch?.user_id) {
              // Backfill the token so future renewals resolve instantly.
              await supabaseAdmin
                .from("paddle_purchases")
                .update({ play_purchase_token: purchaseToken } as never)
                .eq("id", purch.id)
                .is("play_purchase_token", null);

              const paid = info.paymentState === 1 || info.paymentState === 2;
              const active = !!expiry && expiry > Date.now();
              // 1 = recovered, 2 = renewed, 4 = purchased, 7 = restarted
              const isPayment = [1, 2, 4, 7].includes(sub.notificationType);

              if (isPayment && paid && active) {
                const { ELITE_VIP_TIERS } = await import("@/lib/elite-vip");
                const { STORE_PACKS } = await import("@/lib/store-catalog");
                const { getLegacyPlayProduct } = await import("@/lib/legacy-play-products");

                const tier = ELITE_VIP_TIERS.find((t) => t.paddlePriceId === subscriptionId);
                const legacy = getLegacyPlayProduct(subscriptionId);
                const packDef = STORE_PACKS.find((p) => p.id === subscriptionId);
                const reward = (packDef?.reward ?? legacy?.reward ?? {}) as {
                  gems?: number;
                  coins?: number;
                  rubies?: number;
                  shieldDays?: number;
                  vipDays?: number;
                };
                const priceUsd =
                  tier?.monthlyPriceUsd ?? packDef?.priceUSD ?? legacy?.priceUSD ?? 0;

                // Idempotent per renewal order id — repeated RTDN deliveries
                // of the same payment never double-grant.
                const txnId = orderId || `${purchaseToken}:${expiry}`;
                const { error: grantErr } = await supabaseAdmin.rpc(
                  "grant_paddle_purchase" as never,
                  {
                    _txn_id: txnId,
                    _user: purch.user_id,
                    _pack_id: subscriptionId,
                    _amount_cents: Math.round(priceUsd * 100),
                    _gems: tier ? 0 : (reward.gems ?? 0),
                    _coins: tier ? 0 : (reward.coins ?? 0),
                    _rubies: tier ? 0 : (reward.rubies ?? 0),
                    _shield_days: tier ? 0 : (reward.shieldDays ?? 0),
                    _vip_days: tier ? 0 : (reward.vipDays ?? 0),
                    _env: "google_play",
                  } as never,
                );
                if (grantErr) throw new Error(`renewal grant failed: ${grantErr.message}`);

                await supabaseAdmin
                  .from("paddle_purchases")
                  .update({ play_purchase_token: purchaseToken } as never)
                  .eq("paddle_transaction_id", txnId);

                if (tier) {
                  await supabaseAdmin
                    .from("profiles")
                    .update({ elite_vip_expires_at: new Date(expiry).toISOString() } as never)
                    .eq("id", purch.user_id);
                } else {
                  // Legacy/plain VIP — keep expiry aligned with Play.
                  await supabaseAdmin
                    .from("profiles")
                    .update({ vip_expires_at: new Date(expiry).toISOString() } as never)
                    .eq("id", purch.user_id);
                }
              } else if (sub.notificationType === 13 || sub.notificationType === 12) {
                // Expired / revoked — end the entitlement now.
                const tierEnd = (await import("@/lib/elite-vip")).ELITE_VIP_TIERS.find(
                  (t) => t.paddlePriceId === subscriptionId,
                );
                await supabaseAdmin
                  .from("profiles")
                  .update(
                    (tierEnd
                      ? { elite_vip_level: 0, elite_vip_expires_at: null }
                      : { vip_expires_at: new Date().toISOString() }) as never,
                  )
                  .eq("id", purch.user_id);
              }
            } else {
              console.error("[play-rtdn] no buyer found for token", purchaseToken, subscriptionId);
            }
          }

          await supabaseAdmin
            .from("play_rtdn_events" as never)
            .update({ processed: true, processed_at: new Date().toISOString() } as never)
            .eq("message_id", messageId);
        } catch (e: any) {
          console.error("[play-rtdn] processing failed", e?.message ?? e);
          await supabaseAdmin
            .from("play_rtdn_events" as never)
            .update({ error: String(e?.message ?? e).slice(0, 500) } as never)
            .eq("message_id", messageId);
        }

        return ack();
      },
    },
  },
});
