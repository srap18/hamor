/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { verifyWebhookSignature } from "@/lib/paypal.server";
import { STORE_PACKS } from "@/lib/store-catalog";

let _supabase: any = null;
function getSupabase(): any {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

function parseCustom(custom: string | undefined | null): { userId: string; packId: string } | null {
  if (!custom) return null;
  const [userId = "", packId = ""] = custom.split("|");
  if (!userId || !packId) return null;
  return { userId, packId };
}

async function grantCapture(resource: any) {
  const meta = parseCustom(resource?.custom_id);
  if (!meta) {
    console.warn("[paypal-webhook] capture missing custom_id");
    return;
  }
  const pack = STORE_PACKS.find((p) => p.id === meta.packId);
  if (!pack) {
    console.warn("[paypal-webhook] unknown packId", meta.packId);
    return;
  }
  const reward = pack.reward;
  const amountCents = Math.round(Number(resource?.amount?.value ?? 0) * 100);
  const captureId = resource?.id;
  const sb = getSupabase();

  const { error } = await sb.rpc("grant_paddle_purchase", {
    _txn_id: `pp_${captureId}`,
    _user: meta.userId,
    _pack_id: pack.id,
    _amount_cents: amountCents,
    _gems: reward.gems ?? 0,
    _coins: reward.coins ?? 0,
    _rubies: reward.rubies ?? 0,
    _shield_days: reward.shieldDays ?? 0,
    _vip_days: reward.vipDays ?? 0,
    _env: "live",
  });
  if (error) {
    console.error("[paypal-webhook] grant failed:", error);
    throw new Error(error.message);
  }

  if (reward.items?.length) {
    for (const it of reward.items) {
      await sb.rpc("grant_inventory_item", {
        _user: meta.userId,
        _item_type: it.itemType,
        _item_id: it.itemId,
        _qty: it.qty,
      });
    }
  }

  if (reward.phoenixShips && reward.phoenixShips > 0) {
    const rows = Array.from({ length: reward.phoenixShips }, () => ({
      user_id: meta.userId,
      template_id: 31,
      hp: 13000,
      max_hp: 13000,
      at_sea: false,
      catalog_code: "ship-lvl-31",
    }));
    await sb.from("ships_owned").insert(rows);
  }

  if (amountCents > 0) {
    await sb.rpc("grant_referral_bonus", {
      _user: meta.userId,
      _txn_id: `pp_${captureId}`,
      _amount_cents: amountCents,
    });
  }
}

export const Route = createFileRoute("/api/public/paypal/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const ok = await verifyWebhookSignature(request.headers, rawBody);
        if (!ok) {
          console.warn("[paypal-webhook] signature verification failed");
          return new Response("invalid signature", { status: 401 });
        }
        try {
          const event = JSON.parse(rawBody);
          switch (event.event_type) {
            case "PAYMENT.CAPTURE.COMPLETED":
              await grantCapture(event.resource);
              break;
            case "CHECKOUT.ORDER.APPROVED":
              // No-op: client captures via serverFn on return.
              break;
            case "PAYMENT.CAPTURE.DENIED":
            case "PAYMENT.CAPTURE.REFUNDED":
              console.log("[paypal-webhook]", event.event_type, event.resource?.id);
              break;
            default:
              console.log("[paypal-webhook] unhandled:", event.event_type);
          }
          return Response.json({ received: true });
        } catch (e) {
          console.error("[paypal-webhook] error:", e);
          return new Response("webhook error", { status: 400 });
        }
      },
    },
  },
});
