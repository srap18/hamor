/**
 * Native in-app purchase block — replaces the Paddle UI inside the Capacitor
 * builds. Lists the configured products from Google Play / App Store and
 * launches the native purchase sheet on tap.
 *
 * The web build never renders this — callers gate with `isNativeApp()`.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  IAP_PRODUCT_IDS,
  type IapProduct,
  type IapProductId,
  currentStoreLabel,
  fetchIapProducts,
  isIapAvailable,
  purchaseIap,
  restoreIapPurchases,
} from "@/lib/iap";
import { verifyIapPurchase } from "@/lib/iap-verify.functions";

const FALLBACK_LABELS: Record<IapProductId, { title: string; desc: string }> = {
  gems_small: { title: "حزمة جواهر صغيرة", desc: "100 جوهرة" },
  gems_medium: { title: "حزمة جواهر متوسطة", desc: "550 جوهرة" },
  gems_large: { title: "حزمة جواهر كبيرة", desc: "1200 جوهرة" },
  vip_monthly: { title: "اشتراك VIP شهري", desc: "تجديد تلقائي شهرياً" },
};

export function NativePurchaseBlock({
  productIds = [...IAP_PRODUCT_IDS],
}: {
  productIds?: IapProductId[];
}) {
  const verify = useServerFn(verifyIapPurchase);
  const [products, setProducts] = useState<IapProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<IapProductId | null>(null);
  const available = isIapAvailable();
  const store = currentStoreLabel();

  useEffect(() => {
    let alive = true;
    if (!available) {
      setLoading(false);
      return;
    }
    fetchIapProducts(productIds).then((p) => {
      if (!alive) return;
      setProducts(p);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [available, productIds]);

  const buy = async (id: IapProductId) => {
    if (busy) return;
    setBusy(id);
    try {
      const purchase = await purchaseIap(id);
      if (!purchase) return; // cancelled
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
    setBusy("gems_small");
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

  return (
    <div dir="rtl" className="mx-auto max-w-md p-4 space-y-3">
      <div className="text-center text-amber-200 text-xs">
        الدفع عبر {store} — آمن وسريع
      </div>
      {loading && (
        <div className="text-center text-amber-100/70 text-sm py-6">جاري تحميل الأسعار…</div>
      )}
      {!loading && products.length === 0 && (
        <div className="text-center text-amber-300 text-sm py-6">
          لم يتم العثور على منتجات. أعد المحاولة لاحقاً.
        </div>
      )}
      {products.map((p) => {
        const fallback = FALLBACK_LABELS[p.productId];
        const isBusy = busy === p.productId;
        return (
          <button
            key={p.productId}
            onClick={() => buy(p.productId)}
            disabled={!!busy}
            className="w-full p-4 rounded-2xl border-2 border-amber-600/50 bg-gradient-to-b from-stone-900 to-stone-950 text-right active:scale-[0.98] disabled:opacity-60 flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <div className="font-extrabold text-amber-200 truncate">
                {p.title || fallback?.title}
              </div>
              <div className="text-xs text-amber-100/70 truncate">
                {p.description || fallback?.desc}
              </div>
            </div>
            <div className="shrink-0 px-3 py-2 rounded-lg bg-amber-500 text-amber-950 font-extrabold text-sm">
              {isBusy ? "..." : p.price || "شراء"}
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
