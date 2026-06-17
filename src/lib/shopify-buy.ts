import { resolveShopifyPackForCheckout } from "./shopify-checkout.functions";
import { createCheckoutForVariant } from "./shopify-storefront";

/**
 * Initiate a Shopify checkout for a given pack id.
 *
 * 1. Server function resolves the variant GID + re-runs eligibility checks.
 * 2. Client calls the Storefront API to create a cart with
 *    `user_id`/`pack_id` attributes (the webhook reads these to credit
 *    the right account).
 * 3. Open the checkout URL in a new tab.
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

  window.open(checkout.checkoutUrl, "_blank");
}
