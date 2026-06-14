/**
 * Server-side receipt verification for native in-app purchases.
 *
 * Today this records the receipt and grants the benefit optimistically; the
 * dedicated webhook handlers (Google RTDN / Apple App Store Server
 * Notifications) remain the source of truth and reconcile the grant if the
 * receipt is later refunded or invalid.
 *
 * The grant uses the same `paddle_purchases` table the web flow writes to,
 * so the rest of the app does not need to special-case the source.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  productId: z.enum(["gems_small", "gems_medium", "gems_large", "vip_monthly"]),
  transactionId: z.string().min(1).max(200),
  receipt: z.string().min(1).max(20_000),
  platform: z.enum(["android", "ios"]),
});

export const verifyIapPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) Idempotency: if we already recorded this transaction, return OK.
    const { data: existing } = await supabaseAdmin
      .from("paddle_purchases")
      .select("id")
      .eq("transaction_id", data.transactionId)
      .maybeSingle();
    if (existing) return { ok: true, alreadyGranted: true };

    // 2) Record the purchase (audit trail + idempotency key).
    await supabaseAdmin.from("paddle_purchases").insert({
      user_id: userId,
      transaction_id: data.transactionId,
      product_id: data.productId,
      status: "completed",
      source: data.platform === "ios" ? "apple_iap" : "google_play",
      raw_payload: { receipt: data.receipt, platform: data.platform } as never,
    } as never);

    // 3) Grant the benefit (mirrors the Paddle webhook logic).
    if (data.productId === "vip_monthly") {
      const expires = new Date();
      expires.setMonth(expires.getMonth() + 1);
      await supabaseAdmin
        .from("profiles")
        .update({ vip_expires_at: expires.toISOString() } as never)
        .eq("id", userId);
    } else {
      const gems = ({ gems_small: 100, gems_medium: 550, gems_large: 1200 } as const)[
        data.productId
      ];
      await supabaseAdmin.rpc("add_gems" as never, { _user_id: userId, _amount: gems } as never);
    }

    return { ok: true, alreadyGranted: false };
  });
