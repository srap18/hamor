import { createPayPalOrder } from "./paypal-checkout.functions";
import { isNativeApp } from "./platform";

/**
 * Start a PayPal checkout for a given pack id.
 * Opens PayPal's hosted approval page in a new tab (web) or
 * in-app browser (native), then PayPal redirects back to
 * /payment-success?paypal=1&token=<orderId> for capture.
 */
export async function buyPackWithPayPal(packId: string): Promise<void> {
  let preOpened: Window | null = null;
  if (!isNativeApp() && typeof window !== "undefined") {
    try {
      preOpened = window.open("about:blank", "_blank");
    } catch {
      preOpened = null;
    }
  }

  try {
    const origin = typeof window !== "undefined" ? window.location.origin : undefined;
    const order = await createPayPalOrder({ data: { packId, origin } });
    if (!order?.approveUrl) {
      preOpened?.close();
      throw new Error("تعذر إنشاء طلب الدفع");
    }
    await openUrl(order.approveUrl, preOpened);
  } catch (e) {
    preOpened?.close();
    throw e;
  }
}

async function openUrl(url: string, preOpened: Window | null): Promise<void> {
  if (isNativeApp()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, presentationStyle: "fullscreen" });
      return;
    } catch (e) {
      console.warn("[paypal] Capacitor Browser failed, falling back", e);
    }
  }
  if (preOpened && !preOpened.closed) {
    try {
      preOpened.location.href = url;
      return;
    } catch {
      /* fall through */
    }
  }
  const opened = window.open(url, "_blank");
  if (!opened) window.location.href = url;
}
