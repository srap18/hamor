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
            const info = await verifyPlaySubscription(subscriptionId, purchaseToken);
            const expiry = Number(info.expiryTimeMillis ?? 0);
            // Update matching profile's elite VIP / VIP expiry if we track this token.
            const { data: purch } = await supabaseAdmin
              .from("paddle_purchases")
              .select("user_id, pack_id")
              .eq("paddle_transaction_id", purchaseToken)
              .maybeSingle();
            if (purch?.user_id && expiry) {
              // notificationType 13 = expired, 3 = canceled (still active until expiry)
              if (sub.notificationType === 13) {
                await supabaseAdmin
                  .from("profiles")
                  .update({
                    elite_vip_level: 0,
                    elite_vip_expires_at: null,
                  } as never)
                  .eq("id", purch.user_id);
              } else if (sub.notificationType === 2) {
                // Renewed — extend expiry.
                await supabaseAdmin
                  .from("profiles")
                  .update({
                    elite_vip_expires_at: new Date(expiry).toISOString(),
                  } as never)
                  .eq("id", purch.user_id);
              }
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
