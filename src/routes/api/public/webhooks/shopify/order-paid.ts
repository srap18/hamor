import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { STORE_PACKS } from "@/lib/store-catalog";

/**
 * Shopify `orders/paid` webhook.
 *
 * Configure in Shopify Admin → Settings → Notifications → Webhooks:
 *   - Event:  Order payment
 *   - Format: JSON
 *   - URL:    https://hamor.lovable.app/api/public/webhooks/shopify/order-paid
 *
 * Copy the webhook signing secret into the SHOPIFY_WEBHOOK_SECRET runtime secret.
 *
 * Idempotency: keyed on `shopify_order_id` (UNIQUE constraint on shopify_orders).
 * Reward delivery: reuses the existing `grant_paddle_purchase` RPC with the
 * order id prefixed by `shop_` so a Shopify order never collides with a Paddle txn.
 */
export const Route = createFileRoute("/api/public/webhooks/shopify/order-paid")(
  {
    server: {
      handlers: {
        POST: async ({ request }) => {
          const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
          if (!secret) {
            console.error("[shopify-webhook] missing SHOPIFY_WEBHOOK_SECRET");
            return new Response("server misconfigured", { status: 500 });
          }

          const headerSig = request.headers.get("x-shopify-hmac-sha256") ?? "";
          const rawBody = await request.text();

          const expected = createHmac("sha256", secret)
            .update(rawBody, "utf8")
            .digest("base64");

          let sigOk = false;
          try {
            const a = Buffer.from(headerSig);
            const b = Buffer.from(expected);
            sigOk = a.length === b.length && timingSafeEqual(a, b);
          } catch {
            sigOk = false;
          }
          if (!sigOk) {
            return new Response("invalid signature", { status: 401 });
          }

          let order: any;
          try {
            order = JSON.parse(rawBody);
          } catch {
            return new Response("invalid json", { status: 400 });
          }

          const orderId: number | undefined = order?.id;
          const orderName: string | undefined = order?.name;
          if (!orderId) {
            return new Response("missing order id", { status: 400 });
          }

          // Extract user_id + pack_id from note_attributes (set when cart was created)
          const noteAttrs: Array<{ name: string; value: string }> =
            order?.note_attributes ?? [];
          const getAttr = (k: string) =>
            noteAttrs.find((a) => a.name === k)?.value;
          const userId = getAttr("user_id");
          const packId = getAttr("pack_id");

          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );

          // Insert (idempotent via UNIQUE on shopify_order_id)
          const { error: insErr } = await supabaseAdmin
            .from("shopify_orders")
            .insert({
              shopify_order_id: orderId,
              shopify_order_name: orderName ?? null,
              user_id: userId ?? null,
              pack_id: packId ?? null,
              status: "received",
              amount_usd: Number(order?.current_total_price ?? order?.total_price ?? 0),
              raw_payload: order,
            });

          // Duplicate webhook delivery — already processed
          if (insErr && !insErr.message.includes("duplicate")) {
            console.error("[shopify-webhook] insert error", insErr);
            return new Response("db error", { status: 500 });
          }
          if (insErr) {
            // Duplicate — return 200 so Shopify stops retrying
            return new Response("already processed", { status: 200 });
          }

          if (!userId || !packId) {
            await supabaseAdmin
              .from("shopify_orders")
              .update({
                status: "error",
                error: "missing user_id or pack_id in note_attributes",
              })
              .eq("shopify_order_id", orderId);
            return new Response("missing attributes", { status: 200 });
          }

          const pack = STORE_PACKS.find((p) => p.id === packId);
          if (!pack) {
            await supabaseAdmin
              .from("shopify_orders")
              .update({ status: "error", error: `unknown pack ${packId}` })
              .eq("shopify_order_id", orderId);
            return new Response("unknown pack", { status: 200 });
          }

          const reward = pack.reward;
          const amountCents = Math.round(
            Number(
              order?.current_total_price ?? order?.total_price ?? pack.priceUSD,
            ) * 100,
          );

          const { data: grantRes, error: grantErr } = await supabaseAdmin.rpc(
            "grant_paddle_purchase",
            {
              _txn_id: `shop_${orderId}`,
              _user: userId,
              _pack_id: packId,
              _amount_cents: amountCents,
              _gems: reward.gems ?? 0,
              _coins: reward.coins ?? 0,
              _rubies: reward.rubies ?? 0,
              _shield_days: reward.shieldDays ?? 0,
              _vip_days: reward.vipDays ?? 0,
              _env: "live",
            },
          );

          if (grantErr) {
            await supabaseAdmin
              .from("shopify_orders")
              .update({ status: "error", error: grantErr.message })
              .eq("shopify_order_id", orderId);
            console.error("[shopify-webhook] grant error", grantErr);
            return new Response("grant error", { status: 500 });
          }

          const alreadyGranted = !!(grantRes as { already_granted?: boolean } | null)
            ?.already_granted;

          if (!alreadyGranted && reward.items?.length) {
            for (const it of reward.items) {
              await supabaseAdmin.rpc("grant_inventory_item", {
                _user: userId,
                _item_type: it.itemType,
                _item_id: it.itemId,
                _qty: it.qty,
              });
            }
          }

          if (
            !alreadyGranted &&
            reward.phoenixShips &&
            reward.phoenixShips > 0
          ) {
            const rows = Array.from({ length: reward.phoenixShips }, () => ({
              user_id: userId,
              template_id: 31,
              hp: 13000,
              max_hp: 13000,
              at_sea: false,
              catalog_code: "ship-lvl-31",
            }));
            await supabaseAdmin.from("ships_owned").insert(rows);
          }

          await supabaseAdmin
            .from("shopify_orders")
            .update({
              status: "granted",
              processed_at: new Date().toISOString(),
            })
            .eq("shopify_order_id", orderId);

          return new Response("ok", { status: 200 });
        },
      },
    },
  },
);
