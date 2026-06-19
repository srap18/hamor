import { createPolarCheckout } from "./polar-checkout.functions";
import { isNativeApp } from "./platform";

/**
 * Start a Polar checkout for a given pack id.
 * Web: redirects the current tab to Polar's hosted checkout.
 * Native: opens checkout in the in-app browser.
 * Polar then redirects back to /payment-success?polar_checkout_id=<id>.
 */
export async function buyPackWithPolar(packId: string): Promise<void> {
  const origin = typeof window !== "undefined" ? window.location.origin : undefined;
  const res = await createPolarCheckout({ data: { packId, origin } });
  if (!res?.checkoutUrl) throw new Error("تعذر إنشاء طلب الدفع");

  if (isNativeApp()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: res.checkoutUrl, presentationStyle: "fullscreen" });
      return;
    } catch (e) {
      console.warn("[polar] Capacitor Browser failed, falling back", e);
    }
  }

  // Web: same-tab redirect — preserves Supabase session on return.
  window.location.href = res.checkoutUrl;
}
