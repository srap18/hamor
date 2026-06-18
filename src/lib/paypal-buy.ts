import { createPayPalOrder } from "./paypal-checkout.functions";
import { isNativeApp } from "./platform";

/**
 * Start a PayPal checkout for a given pack id.
 * Web: redirects the current tab to PayPal's approval page (keeps the
 *      Supabase session intact on return).
 * Native: opens PayPal in the in-app browser.
 * PayPal then redirects back to /payment-success?paypal=1&token=<orderId>.
 */
export async function buyPackWithPayPal(packId: string): Promise<void> {
  const origin = typeof window !== "undefined" ? window.location.origin : undefined;
  const order = await createPayPalOrder({ data: { packId, origin } });
  if (!order?.approveUrl) throw new Error("تعذر إنشاء طلب الدفع");

  if (isNativeApp()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: order.approveUrl, presentationStyle: "fullscreen" });
      return;
    } catch (e) {
      console.warn("[paypal] Capacitor Browser failed, falling back", e);
    }
  }

  // Web: same-tab redirect — preserves Supabase session on return.
  window.location.href = order.approveUrl;
}
