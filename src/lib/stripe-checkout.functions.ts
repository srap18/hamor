import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import Stripe from "stripe";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { STORE_PACKS, getPack } from "./store-catalog";

const Input = z.object({
  packId: z.string().min(1).max(64),
  origin: z.string().url(),
});

export const createStripeCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const pack = getPack(data.packId);
    if (!pack) throw new Error("الباقة غير موجودة");

    // Enforce weekly shield limit BEFORE creating session
    if (pack.weeklyLimit && pack.category === "shield") {
      const { data: count, error } = await supabaseAdmin.rpc(
        "shield_purchases_last_week",
        { _user: userId }
      );
      if (error) throw new Error(error.message);
      if ((count ?? 0) >= pack.weeklyLimit) {
        throw new Error(
          `وصلت الحد الأقصى (${pack.weeklyLimit} دروع في الأسبوع). جرب بعد فترة.`
        );
      }
    }

    // Enforce one-time pack (starter)
    if (pack.oneTime) {
      const { data: bought } = await supabaseAdmin.rpc("has_bought_starter", {
        _user: userId,
      });
      if (bought) {
        throw new Error("هذي الباقة لمرة وحدة فقط وقد اشتريتها.");
      }
    }

    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY غير مكوّن");
    const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion });

    // Get user email for receipt
    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = userData?.user?.email ?? undefined;

    // Reuse Stripe customer if one exists for this email
    let customerId: string | undefined;
    if (email) {
      const existing = await stripe.customers.list({ email, limit: 1 });
      if (existing.data.length > 0) customerId = existing.data[0].id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: pack.subscription ? "subscription" : "payment",
      customer: customerId,
      customer_email: customerId ? undefined : email,
      line_items: [{ price: pack.stripePriceId, quantity: 1 }],
      success_url: `${data.origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${data.origin}/recharge`,
      metadata: {
        user_id: userId,
        pack_id: pack.id,
      },
      // For subscriptions, also pass metadata to the subscription
      ...(pack.subscription && {
        subscription_data: {
          metadata: { user_id: userId, pack_id: pack.id },
        },
      }),
    });

    // Record pending purchase (idempotent on session_id)
    await supabaseAdmin.from("stripe_purchases").insert({
      user_id: userId,
      stripe_session_id: session.id,
      pack_id: pack.id,
      status: "pending",
      amount_cents: Math.round(pack.priceUSD * 100),
    });

    return { url: session.url };
  });

const VerifyInput = z.object({ sessionId: z.string().min(1).max(200) });

export const verifyStripePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => VerifyInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY غير مكوّن");
    const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion });

    const session = await stripe.checkout.sessions.retrieve(data.sessionId);
    if (!session) throw new Error("Session غير موجود");

    // Make sure this session belongs to the calling user
    const sessUser = session.metadata?.user_id;
    if (sessUser && sessUser !== userId) {
      throw new Error("لا تملك صلاحية لهذه العملية");
    }
    const packId = session.metadata?.pack_id;
    if (!packId) throw new Error("بيانات الباقة مفقودة");

    const paid =
      session.payment_status === "paid" || session.status === "complete";
    if (!paid) {
      return { ok: false, status: session.payment_status, packId };
    }

    const pack = getPack(packId);
    if (!pack) throw new Error("الباقة غير موجودة");

    // Apply rewards via RPC (idempotent on session_id)
    const { data: result, error } = await supabaseAdmin.rpc(
      "grant_stripe_purchase",
      {
        _session_id: session.id,
        _user: userId,
        _pack_id: pack.id,
        _amount_cents: Math.round(pack.priceUSD * 100),
        _gems: pack.reward.gems ?? 0,
        _coins: pack.reward.coins ?? 0,
        _rubies: pack.reward.rubies ?? 0,
        _shield_days: pack.reward.shieldDays ?? 0,
        _vip_days: pack.reward.vipDays ?? 0,
      }
    );
    if (error) throw new Error(error.message);

    return { ok: true, packId: pack.id, reward: pack.reward, result };
  });

const StatusInput = z.object({}).optional();

// Used by the UI to know how many shields the user already bought this week,
// and whether they've redeemed the starter pack.
export const getStorePurchaseStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    const { userId } = context;
    const [{ data: shieldCount }, { data: starter }] = await Promise.all([
      supabaseAdmin.rpc("shield_purchases_last_week", { _user: userId }),
      supabaseAdmin.rpc("has_bought_starter", { _user: userId }),
    ]);
    return {
      shieldsThisWeek: shieldCount ?? 0,
      shieldWeeklyLimit:
        STORE_PACKS.find((p) => p.id === "shield_2d")?.weeklyLimit ?? 2,
      hasBoughtStarter: !!starter,
    };
  });
