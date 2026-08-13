import { initializePaddle, getPaddlePriceId, onPaddleEvent } from "./paddle";
import { supabase } from "@/integrations/supabase/client";
import { isNativeApp, isAndroidApp, isIosApp } from "@/lib/platform";

/**
 * Open Paddle checkout for a given price external_id (pack id for store packs
 * or paddlePriceId for VIP). Resolves the Paddle internal price id server-side
 * and opens the Paddle.js overlay. Paddle will redirect to /payment-success
 * with `_ptxn` on success; webhook + claim function grant the rewards.
 */
export async function buyPackWithPaddle(externalPriceId: string): Promise<void> {
  // Defensive guard: Paddle is web-only. Native apps MUST use IAP.
  if (isNativeApp()) {
    const store = isAndroidApp() ? "Google Play" : isIosApp() ? "App Store" : "المتجر";
    throw new Error(`الدفع داخل التطبيق يتم عبر ${store} فقط.`);
  }
  await initializePaddle();
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  const email = u.user?.email;
  if (!userId) throw new Error("سجّل الدخول أولاً");

  const priceId = await getPaddlePriceId(externalPriceId);
  const successUrl = `${window.location.origin}/payment-success`;

  const open = (withCustomer: boolean) => {
    window.Paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      ...(withCustomer && email ? { customer: { email } } : {}),
      customData: { packId: externalPriceId, userId },
      settings: {
        successUrl,
        displayMode: "overlay",
        theme: "dark",
        locale: "ar",
        ...(withCustomer && email ? { allowLogout: false } : {}),
      },
    });
  };

  // Some accounts fail to open the overlay (e.g. the prefilled email already
  // belongs to a different Paddle customer profile) and Paddle shows its own
  // generic "Something went wrong" screen. Retry once without the prefill.
  let retried = false;
  const off = onPaddleEvent((event) => {
    const name = event?.name ?? "";
    if (name === "checkout.error" || name === "checkout.warning") {
      if (retried) { off(); return; }
      retried = true;
      try { window.Paddle.Checkout.close?.(); } catch { /* noop */ }
      setTimeout(() => { try { open(false); } catch { /* noop */ } }, 250);
      return;
    }
    if (name === "checkout.completed" || name === "checkout.closed") off();
  });
  setTimeout(() => off(), 120000);

  open(true);
}

