import { createPaddleTransaction, initializePaddle } from "./paddle";
import { supabase } from "@/integrations/supabase/client";

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

  const { transactionId, checkoutUrl } = await createPaddleTransaction(externalPriceId);

  window.Paddle.Checkout.open({
    transactionId,
    customer: email ? { email } : undefined,
    settings: {
      successUrl: `${window.location.origin}/payment-success?_ptxn=${encodeURIComponent(transactionId)}`,
      displayMode: "overlay",
      theme: "dark",
      locale: "ar",
      allowLogout: false,
    },
  });

  window.setTimeout(() => {
    const frame = document.querySelector('iframe[src*="paddle"], #paddle-checkout-frame');
    if (!frame) window.location.assign(checkoutUrl);
  }, 2500);
}
