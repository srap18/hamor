/**
 * In-App Purchases bridge for the native (Capacitor) builds.
 *
 * The full list of purchasable products is derived **dynamically** from the
 * real game catalog (`STORE_PACKS` + `ELITE_VIP_TIERS`), so every gem pack,
 * gold pack, bundle, weapon pack, crew pack, VIP subscription and Elite VIP
 * tier in the web store is automatically also available natively — there is
 * no separate hand-maintained list.
 *
 * The product identifier used by Google Play Console / App Store Connect is
 * the pack's `id` (e.g. `gp_100`, `vip_monthly`, `elite_vip_3_monthly`),
 * which is also the Paddle `external_id` — keeping one ID per item across
 * every store/platform.
 *
 * The native plugin is loaded at runtime via
 * `window.Capacitor.Plugins.InAppPurchases` so the web bundle never ships
 * it. On native builds you must install:
 *   bun add @capacitor-community/in-app-purchases
 *   npx cap sync
 */
import { isAndroidApp, isIosApp, isNativeApp } from "@/lib/platform";
import { STORE_PACKS, type StorePack, type PackCategory } from "@/lib/store-catalog";
import { ELITE_VIP_TIERS } from "@/lib/elite-vip";
import { toPlayId, fromPlayId } from "@/lib/iap-play-ids";

/** A single purchasable item on the stores. */
export type IapCatalogItem = {
  productId: string;
  title: string;
  description: string;
  priceUSD: number;
  category: PackCategory;
  subscription: boolean;
  emoji?: string;
  tag?: string;
  popular?: boolean;
};

/** Full native catalog — generated once from the canonical game data. */
export const IAP_CATALOG: IapCatalogItem[] = [
  ...STORE_PACKS.map<IapCatalogItem>((p: StorePack) => ({
    productId: p.id,
    title: p.label,
    description: p.description ?? "",
    priceUSD: p.priceUSD,
    category: p.category,
    subscription: !!p.subscription,
    emoji: p.emoji,
    tag: p.tag,
    popular: p.popular,
  })),
  ...ELITE_VIP_TIERS.map<IapCatalogItem>((t) => ({
    productId: t.paddlePriceId, // elite_vip_{1..5}_monthly
    title: `Elite VIP ${t.level} — ${t.nameAr}`,
    description: t.perks.join(" • "),
    priceUSD: t.monthlyPriceUsd,
    category: "vip",
    subscription: true,
    emoji: t.emoji,
    tag: t.level === 5 ? "أعلى مستوى" : undefined,
    popular: t.level === 3,
  })),
];

/** All product IDs registered on the stores. */
export const IAP_PRODUCT_IDS: readonly string[] = IAP_CATALOG.map((i) => i.productId);

/** Subscription IDs — needed by Play Billing / StoreKit for the right flow. */
export const IAP_SUBSCRIPTIONS: readonly string[] = IAP_CATALOG
  .filter((i) => i.subscription)
  .map((i) => i.productId);

export function getIapItem(productId: string): IapCatalogItem | undefined {
  return IAP_CATALOG.find((i) => i.productId === productId);
}

export type IapProduct = {
  productId: string;
  title: string;
  description: string;
  price: string; // localized store price string, e.g. "29.00 SAR"
  currency?: string;
};

export type IapPurchase = {
  productId: string;
  transactionId: string;
  receipt: string;
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
    const plugins = (window as any).Capacitor?.Plugins as Record<string, unknown> | undefined;
    const p = plugins?.InAppPurchases as IapPlugin | undefined;
    return p ?? null;
  } catch {
    return null;
  }
}

export function isIapAvailable(): boolean {
  return getPlugin() !== null;
}

/** Fetch localized product metadata from the store. */
export async function fetchIapProducts(
  ids: readonly string[] = IAP_PRODUCT_IDS,
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
 * IMPORTANT: receipts MUST be verified server-side before granting any
 * benefit — see `src/lib/iap-verify.functions.ts`.
 */
export async function purchaseIap(productId: string): Promise<IapPurchase | null> {
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

/** Restore previous non-consumable / subscription purchases (iOS requirement). */
export async function restoreIapPurchases(): Promise<IapPurchase[]> {
  const plugin = getPlugin();
  if (!plugin?.restorePurchases) return [];
  try {
    const res = await plugin.restorePurchases();
    const platform: "android" | "ios" = isIosApp() ? "ios" : "android";
    return (res.transactions || []).map((tx: any) => ({
      productId: tx.productIdentifier ?? tx.productId ?? "",
      transactionId: tx.transactionId ?? tx.orderId ?? "",
      receipt: tx.receipt ?? tx.purchaseToken ?? tx.transactionReceipt ?? JSON.stringify(tx),
      platform,
    }));
  } catch (e) {
    console.warn("[iap] restore failed", e);
    return [];
  }
}

export function currentStoreLabel(): "Google Play" | "App Store" | "Web" {
  if (isAndroidApp()) return "Google Play";
  if (isIosApp()) return "App Store";
  return "Web";
}
