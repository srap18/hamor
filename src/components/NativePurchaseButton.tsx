/**
 * Native in-app purchase block — replaces the Paddle UI inside the
 * Capacitor (Android / iOS) builds. Pulls the catalog dynamically from
 * `IAP_CATALOG` (which mirrors STORE_PACKS + ELITE_VIP_TIERS), shows
 * category tabs, and launches the native purchase sheet on tap.
 *
 * The web build never renders this — callers gate with `isNativeApp()`.
 */
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  IAP_CATALOG,
  type IapCatalogItem,
  type IapProduct,
  currentStoreLabel,
  fetchIapProducts,
  getIapItem,
  isIapAvailable,
  purchaseIap,
  restoreIapPurchases,
} from "@/lib/iap";
import { verifyIapPurchase } from "@/lib/iap-verify.functions";
import { formatSarFromUsd } from "@/lib/currency";
import type { PackCategory } from "@/lib/store-catalog";

const CATEGORY_TABS: { id: PackCategory; label: string; emoji: string }[] = [
  { id: "offers", label: "عروض", emoji: "🔥" },
  { id: "bundle", label: "باقات", emoji: "🎁" },
  { id: "gems", label: "جواهر", emoji: "💎" },
  { id: "coins", label: "ذهب", emoji: "🪙" },
  { id: "vip", label: "VIP", emoji: "👑" },
  { id: "crew", label: "طواقم", emoji: "⚓" },
  { id: "weapon", label: "أسلحة", emoji: "💣" },
  { id: "shield", label: "دروع", emoji: "🛡️" },
];

export function NativePurchaseBlock({
  productIds,
}: {
  /** Optional whitelist. When omitted, the full catalog is shown. */
  productIds?: string[];
}) {
  const verify = useServerFn(verifyIapPurchase);
  const available = isIapAvailable();
  const store = currentStoreLabel();

  // Catalog the page is allowed to show.
  const allowed = useMemo<IapCatalogItem[]>(() => {
    if (!productIds || productIds.length === 0) return IAP_CATALOG;
    return productIds.map(getIapItem).filter((x): x is IapCatalogItem => !!x);
  }, [productIds]);

  // Default tab = first category that has any item.
  const tabsWithItems = useMemo(
    () => CATEGORY_TABS.filter((t) => allowed.some((i) => i.category === t.id)),
    [allowed],
  );
  const [tab, setTab] = useState<PackCategory>(() => tabsWithItems[0]?.id ?? "offers");
  useEffect(() => {
    if (!tabsWithItems.some((t) => t.id === tab) && tabsWithItems[0]) setTab(tabsWithItems[0].id);
  }, [tabsWithItems, tab]);

  // Localized prices from the store, keyed by productId.
  const [storePrices, setStorePrices] = useState<Record<string, IapProduct>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!available) {
      setLoading(false);
      return;
    }
    fetchIapProducts(allowed.map((i) => i.productId)).then((list) => {
      if (!alive) return;
      const map: Record<string, IapProduct> = {};
      for (const p of list) map[p.productId] = p;
      setStorePrices(map);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [available, allowed]);

  const buy = async (item: IapCatalogItem) => {
    if (busy) return;
    setBusy(item.productId);
    try {
      const purchase = await purchaseIap(item.productId);
      if (!purchase) return; // user cancelled
      const res = await verify({ data: purchase });
      if (res.ok) {
        toast.success(res.alreadyGranted ? "تم تأكيد الشراء مسبقاً" : "تم الشراء بنجاح ✓");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر إتمام الشراء");
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    setBusy("__restore__");
    try {
      const prev = await restoreIapPurchases();
      for (const p of prev) {
        await verify({ data: p }).catch(() => null);
      }
      toast.success(prev.length ? `تم استرجاع ${prev.length} عملية شراء` : "لا توجد مشتريات سابقة");
    } finally {
      setBusy(null);
    }
  };

  if (!available) {
    return (
      <div dir="rtl" className="mx-auto max-w-md p-4">
        <div className="rounded-2xl border-2 border-amber-400/50 bg-gradient-to-b from-slate-900 to-slate-950 p-6 text-center shadow-2xl">
          <div className="text-5xl mb-3">🛒</div>
          <div className="text-amber-300 font-extrabold text-lg mb-2">
            الشراء داخل التطبيق غير متاح في هذا الإصدار
          </div>
          <div className="text-amber-50/80 text-sm leading-relaxed">
            حدّث التطبيق من {store === "App Store" ? "App Store" : "Google Play"} لتفعيل الشراء.
          </div>
        </div>
      </div>
    );
  }

  const visible = allowed.filter((i) => i.category === tab);

  return (
    <div dir="rtl" className="mx-auto max-w-md p-3 space-y-3">
      <div className="text-center text-amber-200 text-xs">
        الدفع عبر {store} — آمن وسريع
      </div>

      {tabsWithItems.length > 1 && (
        <div className="grid grid-cols-4 gap-1">
          {tabsWithItems.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`py-1.5 rounded-lg text-[11px] font-bold border-2 transition-all flex items-center justify-center gap-1 ${
                tab === t.id
                  ? "bg-gradient-to-b from-amber-400 to-amber-700 border-amber-200 text-amber-950"
                  : "bg-stone-900/60 border-stone-700 text-stone-300"
              }`}
            >
              <span>{t.emoji}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="text-center text-amber-100/70 text-sm py-6">جاري تحميل الأسعار…</div>
      )}
      {!loading && visible.length === 0 && (
        <div className="text-center text-amber-300 text-sm py-6">
          لا توجد منتجات في هذه الفئة.
        </div>
      )}

      {visible.map((item) => {
        const live = storePrices[item.productId];
        const isBusy = busy === item.productId;
        const priceLabel = live?.price || formatSarFromUsd(item.priceUSD);
        return (
          <button
            key={item.productId}
            onClick={() => buy(item)}
            disabled={!!busy}
            className={`relative w-full p-3 rounded-2xl border-2 text-right active:scale-[0.98] disabled:opacity-60 flex items-center justify-between gap-3 ${
              item.popular
                ? "border-amber-300 bg-gradient-to-br from-amber-950/60 via-stone-900/90 to-stone-950 shadow-[0_0_18px_rgba(251,191,36,0.35)]"
                : "border-amber-600/40 bg-gradient-to-b from-stone-900 to-stone-950"
            }`}
          >
            {item.tag && (
              <span className="absolute top-1 left-1 text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-rose-500 text-white">
                {item.tag}
              </span>
            )}
            <div className="min-w-0 flex items-center gap-2">
              <span className="text-2xl shrink-0">{item.emoji ?? "🛒"}</span>
              <div className="min-w-0 text-right">
                <div className="font-extrabold text-amber-200 truncate">
                  {live?.title || item.title}
                </div>
                <div className="text-[11px] text-amber-100/70 line-clamp-2 leading-snug">
                  {live?.description || item.description}
                </div>
                {item.subscription && (
                  <div className="text-[10px] text-violet-300 mt-0.5">↻ تجديد تلقائي شهري</div>
                )}
              </div>
            </div>
            <div className="shrink-0 px-3 py-2 rounded-lg bg-amber-500 text-amber-950 font-extrabold text-sm whitespace-nowrap">
              {isBusy ? "..." : priceLabel}
            </div>
          </button>
        );
      })}

      <button
        onClick={restore}
        disabled={!!busy}
        className="w-full py-2 text-amber-200/80 text-xs underline"
      >
        استعادة المشتريات السابقة
      </button>
    </div>
  );
}
