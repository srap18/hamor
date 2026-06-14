/**
 * In-App Purchases bridge for the native (Capacitor) builds.
 *
 * On native (Android/iOS) the store catalog is provided by Google Play
 * Billing / Apple StoreKit. We access the
 * `@capacitor-community/in-app-purchases` plugin at runtime through
 * `window.Capacitor.Plugins.InAppPurchases` so the web build never has to
 * bundle the plugin.
 *
 * The plugin must be installed in the native projects:
 *   bun add @capacitor-community/in-app-purchases
 *   npx cap sync
 *
 * Web builds never call any of these functions — `isNativeApp()` guards the
 * UI components first.
 */
import { isAndroidApp, isIosApp, isNativeApp } from "@/lib/platform";

/** Product IDs configured in Play Console / App Store Connect. */
export const IAP_PRODUCT_IDS = [
  "gems_small",
  "gems_medium",
  "gems_large",
  "vip_monthly",
] as const;

export type IapProductId = (typeof IAP_PRODUCT_IDS)[number];

/** Subscriptions vs consumables — the plugin needs the distinction. */
export const IAP_SUBSCRIPTIONS: IapProductId[] = ["vip_monthly"];

export type IapProduct = {
  productId: IapProductId;
  title: string;
  description: string;
  price: string; // localized price string, e.g. "29.00 SAR"
  currency?: string;
};

export type IapPurchase = {
  productId: IapProductId;
  transactionId: string;
  receipt: string; // platform-specific receipt to verify server-side
  platform: "android" | "ios";
};

type IapPlugin = {
  getProducts: (opts: { productIdentifiers: string[] }) => Promise<{ products: any[] }>;
  purchase: (opts: { productIdentifier: string }) => Promise<{ transaction: any }>;
  restorePurchases?: () => Promise<{ transactions: any[] }>;
};

function getPlugin(): IapPlugin | null {
  if (!isNativeApp()) return null;
  try {
    const plugins = window.Capacitor?.Plugins as Record<string, unknown> | undefined;
    const p = plugins?.InAppPurchases as IapPlugin | undefined;
    return p ?? null;
  } catch {
    return null;
  }
}

/** True only when the native IAP plugin is wired in the running app. */
export function isIapAvailable(): boolean {
  return getPlugin() !== null;
}

/** Fetch product metadata from the store. Returns [] on web or if plugin missing. */
export async function fetchIapProducts(
  ids: readonly IapProductId[] = IAP_PRODUCT_IDS,
): Promise<IapProduct[]> {
  const plugin = getPlugin();
  if (!plugin) return [];
  try {
    const res = await plugin.getProducts({ productIdentifiers: [...ids] });
    return (res.products || []).map((p: any) => ({
      productId: p.identifier ?? p.productId,
      title: p.title ?? p.localizedTitle ?? p.productId,
      description: p.description ?? p.localizedDescription ?? "",
      price: p.priceString ?? p.localizedPrice ?? String(p.price ?? ""),
      currency: p.currencyCode ?? p.priceCurrencyCode,
    }));
  } catch (e) {
    console.warn("[iap] fetchIapProducts failed", e);
    return [];
  }
}

/**
 * Launches the native purchase flow. Returns the receipt for server-side
 * verification, or null if cancelled / unavailable.
 *
 * IMPORTANT: the receipt MUST be verified server-side before granting the
 * benefit (gems / VIP). See `src/lib/iap-verify.functions.ts`.
 */
export async function purchaseIap(productId: IapProductId): Promise<IapPurchase | null> {
  const plugin = getPlugin();
  if (!plugin) return null;
  try {
    const res = await plugin.purchase({ productIdentifier: productId });
    const tx = res.transaction || {};
    return {
      productId,
      transactionId: tx.transactionId ?? tx.orderId ?? "",
      receipt:
        tx.receipt ??
        tx.purchaseToken ??
        tx.transactionReceipt ??
        JSON.stringify(tx),
      platform: isIosApp() ? "ios" : "android",
    };
  } catch (e) {
    console.warn("[iap] purchase failed", e);
    return null;
  }
}

/** Restore previous non-consumable purchases (mainly iOS requirement). */
export async function restoreIapPurchases(): Promise<IapPurchase[]> {
  const plugin = getPlugin();
  if (!plugin?.restorePurchases) return [];
  try {
    const res = await plugin.restorePurchases();
    const platform: "android" | "ios" = isIosApp() ? "ios" : "android";
    return (res.transactions || []).map((tx: any) => ({
      productId: (tx.productIdentifier ?? tx.productId) as IapProductId,
      transactionId: tx.transactionId ?? tx.orderId ?? "",
      receipt: tx.receipt ?? tx.purchaseToken ?? tx.transactionReceipt ?? JSON.stringify(tx),
      platform,
    }));
  } catch (e) {
    console.warn("[iap] restore failed", e);
    return [];
  }
}

/** Convenience: which store provides this purchase. */
export function currentStoreLabel(): "Google Play" | "App Store" | "Web" {
  if (isAndroidApp()) return "Google Play";
  if (isIosApp()) return "App Store";
  return "Web";
}
