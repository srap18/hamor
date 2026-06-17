import { resolveShopifyPackForCheckout } from "./shopify-checkout.functions";
import { createCheckoutForVariant } from "./shopify-storefront";
import { isNativeApp } from "./platform";

/**
 * Initiate a Shopify checkout for a given pack id.
 *
 * 1. Server function resolves the variant GID + re-runs eligibility checks.
 * 2. Client calls the Storefront API to create a cart with
 *    `user_id`/`pack_id` attributes (the webhook reads these to credit
 *    the right account).
 * 3. Open the checkout URL — system browser on native (iOS/Android via
 *    @capacitor/browser in-app browser), new tab on the web.
 */
export async function buyPackWithShopify(packId: string): Promise<void> {
  const resolved = await resolveShopifyPackForCheckout({
    data: { packId },
  });

  const checkout = await createCheckoutForVariant({
    variantGid: resolved.variantGid,
    quantity: 1,
    email: resolved.email,
    attributes: [
      { key: "user_id", value: resolved.userId },
      { key: "pack_id", value: resolved.packId },
    ],
  });

  if (!checkout?.checkoutUrl) {
    throw new Error("تعذر إنشاء صفحة الدفع. حاول مرة ثانية.");
  }

  await openCheckoutUrl(checkout.checkoutUrl);
}

async function openCheckoutUrl(url: string): Promise<void> {
  if (isNativeApp()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, presentationStyle: "fullscreen" });
      return;
    } catch (e) {
      console.warn("[shopify] Capacitor Browser failed, falling back", e);
    }
  }
  window.open(url, "_blank");
}

