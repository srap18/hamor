// Polar webhook handler — verifies Standard Webhooks signature, then grants
// the purchase via grant_polar_purchase RPC. Idempotent on checkout id.
//
// Polar dashboard → Settings → Webhooks → New endpoint:
//   URL:    https://<your-domain>/api/public/polar/webhook
//   Events: order.paid (required), order.refunded (optional)
// Copy the signing secret into the POLAR_WEBHOOK_SECRET env var.

import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getPack } from "@/lib/store-catalog";

type PolarWebhookEnvelope = {
  type: string;
  data: Record<string, unknown>;
};

type PolarOrder = {
  id: string;
  status?: string;
  amount?: number | null;
  net_amount?: number | null;
  currency?: string;
  customer_id?: string | null;
  customer?: { external_id?: string | null; id?: string | null } | null;
  metadata?: Record<string, unknown> | null;
  product_id?: string | null;
  checkout_id?: string | null;
  product?: { id?: string; metadata?: Record<string, unknown> | null } | null;
};

function verifyStandardWebhook(
  rawBody: string,
  headers: Headers,
  secret: string,
): boolean {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  // Reject events older than 5 minutes
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 5 * 60) return false;

  // Polar's signing secret comes as `whsec_<base64>` — strip prefix, decode.
  const cleaned = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBuf: Buffer;
  try {
    keyBuf = Buffer.from(cleaned, "base64");
    if (keyBuf.length === 0) keyBuf = Buffer.from(cleaned, "utf8");
  } catch {
    keyBuf = Buffer.from(cleaned, "utf8");
  }

  const signedPayload = `${id}.${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", keyBuf).update(signedPayload).digest("base64");

  // Header format: "v1,sig v1,sig2" — any one match wins.
  const parts = signatureHeader.split(" ");
  for (const p of parts) {
    const [, sig] = p.split(",", 2);
    if (!sig) continue;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

async function handleOrderPaid(order: PolarOrder): Promise<void> {
  const checkoutId = order.checkout_id;
  if (!checkoutId) {
    console.warn("[polar webhook] order.paid missing checkout_id", order.id);
    return;
  }

  // Resolve pack_id from metadata (checkout metadata propagated to order).
  const orderMd = (order.metadata as Record<string, unknown> | null) || {};
  const productMd = (order.product?.metadata as Record<string, unknown> | null) || {};
  const packId =
    (typeof orderMd.pack_id === "string" && orderMd.pack_id) ||
    (typeof productMd.pack_id === "string" && productMd.pack_id) ||
    null;
  if (!packId) {
    console.warn("[polar webhook] order has no pack_id metadata", order.id);
    return;
  }

  // Resolve user id from external_id (set at checkout) or metadata fallback.
  const userId =
    order.customer?.external_id ||
    (typeof orderMd.user_id === "string" ? orderMd.user_id : null);
  if (!userId) {
    console.warn("[polar webhook] order has no external user id", order.id);
    return;
  }

  const pack = getPack(packId);
  const reward = pack?.reward ?? {};
  const amountCents = Math.round(Number(order.amount ?? 0));

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const env =
    (process.env.POLAR_ENV || "").toLowerCase() === "live" ? "live" : "sandbox";

  const { data: granted, error } = await supabaseAdmin.rpc("grant_polar_purchase", {
    _checkout_id: checkoutId,
    _order_id: order.id,
    _user: userId,
    _pack_id: packId,
    _amount_cents: amountCents,
    _gems: reward.gems ?? 0,
    _coins: reward.coins ?? 0,
    _rubies: reward.rubies ?? 0,
    _shield_days: reward.shieldDays ?? 0,
    _vip_days: reward.vipDays ?? 0,
    _env: env,
  });
  if (error) throw new Error(`grant_polar_purchase failed: ${error.message}`);
  if (!granted) return; // already granted — idempotent

  if (reward.items?.length) {
    for (const it of reward.items) {
      await supabaseAdmin.rpc("grant_inventory_item", {
        _user: userId,
        _item_type: it.itemType,
        _item_id: it.itemId,
        _qty: it.qty,
      });
    }
  }

  if (reward.phoenixShips && reward.phoenixShips > 0) {
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

  if (amountCents > 0) {
    await supabaseAdmin.rpc("grant_referral_bonus", {
      _user: userId,
      _txn_id: `polar_${order.id}`,
      _amount_cents: amountCents,
    });
  }
}

export const Route = createFileRoute("/api/public/polar/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.POLAR_WEBHOOK_SECRET;
        if (!secret) {
          console.error("[polar webhook] POLAR_WEBHOOK_SECRET not configured");
          return new Response("misconfigured", { status: 500 });
        }

        const raw = await request.text();
        if (!verifyStandardWebhook(raw, request.headers, secret)) {
          return new Response("invalid signature", { status: 401 });
        }

        let env: PolarWebhookEnvelope;
        try {
          env = JSON.parse(raw) as PolarWebhookEnvelope;
        } catch {
          return new Response("bad json", { status: 400 });
        }

        try {
          if (env.type === "order.paid") {
            await handleOrderPaid(env.data as PolarOrder);
          }
          // Other events are acknowledged but ignored for now.
          return new Response("ok", { status: 200 });
        } catch (err) {
          console.error("[polar webhook] handler error", err);
          // Return 500 so Polar retries.
          return new Response("error", { status: 500 });
        }
      },
    },
  },
});
