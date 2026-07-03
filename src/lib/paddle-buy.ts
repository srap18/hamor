import { initializePaddle, getPaddlePriceId } from "./paddle";
import { supabase } from "@/integrations/supabase/client";
import { isNativeApp, isAndroidApp, isIosApp } from "@/lib/platform";

/**
 * Open Paddle checkout for a given price external_id (pack id for store packs
 * or paddlePriceId for VIP). Resolves the Paddle internal price id server-side
 * and opens the Paddle.js overlay. Paddle will redirect to /payment-success
 * with `_ptxn` on success; webhook + claim function grant the rewards.
 */
export async function buyPackWithPaddle(externalPriceId: string): Promise<void> {
  await initializePaddle();
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  const email = u.user?.email;
  if (!userId) throw new Error("سجّل الدخول أولاً");

  const priceId = await getPaddlePriceId(externalPriceId);
  const successUrl = `${window.location.origin}/payment-success`;

  window.Paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customer: email ? { email } : undefined,
    customData: { packId: externalPriceId, userId },
    settings: {
      successUrl,
      displayMode: "overlay",
      theme: "dark",
      locale: "ar",
      allowLogout: false,
    },
  });
}
