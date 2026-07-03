import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ELITE_VIP_TIERS, getEliteVipTier } from "@/lib/elite-vip";
import { EliteVipBadge } from "@/components/EliteVipBadge";
import { useEliteVipLevel } from "@/hooks/use-elite-vip";
import { useAuth } from "@/hooks/use-auth";

import { BackButton } from "@/components/BackButton";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { formatSarFromUsd } from "@/lib/currency";
import { toast } from "sonner";
import { isNativeApp } from "@/lib/platform";
import { NativePurchaseBlock } from "@/components/NativePurchaseButton";

export const Route = createFileRoute("/vip")({
  ssr: false,
  component: VipPage,
  head: () => ({
    meta: [
      { title: "Elite VIP — ملوك القراصنة" },
      { name: "description", content: "نظام Elite VIP الحصري — 5 مستويات اشتراك فاخرة بشارات وامتيازات أسطورية." },
    ],
  }),
});

function VipPage() {
  const { user } = useAuth();
  const { level: currentLevel } = useEliteVipLevel();
  const [busy, setBusy] = useState<number | null>(null);
  const currentTier = getEliteVipTier(currentLevel);

  async function handleSubscribe(priceId: string, level: number) {
    if (!user) {
      toast.error("سجّل الدخول أولاً للاشتراك");
      return;
    }
    if (currentLevel === level) {
      toast.info("أنت مشترك بالفعل في هذا المستوى");
      return;
    }
    setBusy(level);
    try {
      const { buyPackWithPaddle } = await import("@/lib/paddle-buy");
      await buyPackWithPaddle(priceId);
      toast.success("تم فتح صفحة الدفع — أكمل العملية وارجع للعبة.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر فتح الدفع. حاول مرة أخرى.");
      console.error(e);
    } finally {
      setBusy(null);
    }
  }


  // Native apps (Android / iOS) — Elite VIP subscriptions must go through
  // Google Play Billing / Apple IAP. Paddle overlay is web-only.
  if (isNativeApp()) {
    return (
      <div dir="rtl" className="h-full overflow-y-auto bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 text-slate-100 pb-20" style={{ WebkitOverflowScrolling: "touch" }}>
        <div className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur border-b border-amber-500/20 px-4 py-3 flex items-center justify-between">
          <BackButton>رجوع</BackButton>
          <h1 className="text-lg font-extrabold bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400 bg-clip-text text-transparent">
            🏆 Elite VIP الحصري
          </h1>
          <div className="w-8" />
        </div>
        <NativePurchaseBlock productIds={ELITE_VIP_TIERS.map((t) => t.paddlePriceId)} />
      </div>
    );
  }


  return (
    <div dir="rtl" className="h-full overflow-y-auto overflow-x-hidden bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 text-slate-100 pb-20" style={{ WebkitOverflowScrolling: "touch" }}>
      <PaymentTestModeBanner />
      <div className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur border-b border-amber-500/20 px-4 py-3 flex items-center justify-between">
        <BackButton>رجوع</BackButton>
        <h1 className="text-lg font-extrabold bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400 bg-clip-text text-transparent">
          🏆 Elite VIP الحصري
        </h1>
        <div className="w-8" />
      </div>


      {/* Hero */}
      <div className="px-4 pt-6 pb-4 text-center">
        <h2 className="text-2xl md:text-3xl font-black bg-gradient-to-r from-amber-300 to-yellow-500 bg-clip-text text-transparent">
          نظام Elite VIP
        </h2>
        <p className="text-sm text-amber-200/80 mt-2 max-w-md mx-auto">
          5 مستويات حصرية للاشتراك الشهري فقط — لا تُمنح عن طريق اللعب أو عملات اللعبة.
          امتيازات قتالية، خصومات متجر، شارات فاخرة، وأسماء متوهجة.
        </p>
        {currentTier && (
          <div className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full bg-amber-500/15 border border-amber-400/40">
            <EliteVipBadge level={currentLevel} size="md" />
            <span className="text-amber-200 font-bold">
              مستواك الحالي: Elite VIP {currentLevel} — {currentTier.nameAr}
            </span>
          </div>
        )}
      </div>

      {/* Tiers grid */}
      <div className="px-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-6xl mx-auto">
        {ELITE_VIP_TIERS.map((t) => {
          const isCurrent = currentLevel === t.level;
          const isUpgrade = currentLevel < t.level;
          return (
            <div
              key={t.level}
              className={`relative rounded-2xl border-2 p-4 flex flex-col transition ${
                isCurrent
                  ? "bg-gradient-to-b from-emerald-900/40 to-slate-900 border-emerald-400/70 shadow-[0_0_30px_rgba(52,211,153,0.4)]"
                  : t.level === 5
                    ? "bg-gradient-to-b from-purple-950/70 to-slate-950 border-fuchsia-400/60 shadow-[0_0_25px_rgba(232,121,249,0.35)]"
                    : t.level === 4
                      ? "bg-gradient-to-b from-indigo-950/70 to-slate-950 border-sky-400/50"
                      : t.level === 3
                        ? "bg-gradient-to-b from-amber-950/70 to-slate-950 border-amber-400/50"
                        : t.level === 2
                          ? "bg-gradient-to-b from-slate-800/70 to-slate-950 border-slate-300/40"
                          : "bg-gradient-to-b from-orange-950/70 to-slate-950 border-amber-700/50"
              }`}
            >
              {isCurrent && (
                <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500 text-white font-bold">
                  مستواك الحالي
                </span>
              )}
              {t.level === 5 && !isCurrent && (
                <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-gradient-to-r from-fuchsia-500 to-amber-400 text-white font-bold">
                  أعلى مستوى
                </span>
              )}

              <div className="flex justify-center mb-3">
                <img
                  src={t.badge}
                  alt={`Elite VIP ${t.level}`}
                  loading="lazy"
                  width={144}
                  height={144}
                  className="w-36 h-36 object-contain drop-shadow-[0_5px_15px_rgba(0,0,0,0.5)]"
                />
              </div>

              <div className="text-center mb-3">
                <div className="text-xs text-amber-300/70 font-bold tracking-widest">
                  ELITE VIP {t.level}
                </div>
                <div className={`text-xl font-extrabold mt-1 ${t.nameColorClass || "text-amber-100"}`}>
                  {t.emoji} {t.nameAr}
                </div>
                <div className="mt-2">
                  <span className="text-3xl font-black text-white">{formatSarFromUsd(t.monthlyPriceUsd)}</span>
                  <span className="text-sm text-slate-400">/شهر</span>
                  <span className="block text-[11px] text-slate-400 mt-0.5">شامل الضريبة</span>
                </div>
              </div>

              <ul className="flex-1 space-y-1.5 text-sm text-slate-200 mb-4">
                {t.perks.map((p, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <span>{p}</span>
                  </li>
                ))}
              </ul>

              <button
                disabled={busy !== null || isCurrent}
                onClick={() => handleSubscribe(t.paddlePriceId, t.level)}
                className={`w-full py-3 rounded-xl font-extrabold text-sm transition disabled:opacity-50 disabled:cursor-not-allowed ${
                  isCurrent
                    ? "bg-emerald-700 text-white cursor-default"
                    : t.level === 5
                      ? "bg-gradient-to-r from-fuchsia-500 via-amber-400 to-fuchsia-500 text-slate-900 hover:brightness-110 shadow-lg"
                      : "bg-gradient-to-r from-amber-500 to-yellow-400 text-slate-900 hover:brightness-110 shadow-lg"
                }`}
              >
                {busy === t.level
                  ? "جاري الفتح..."
                  : isCurrent
                    ? "✓ مشترك حالياً"
                    : isUpgrade
                      ? `ترقية إلى المستوى ${t.level}`
                      : `الاشتراك الآن — ${formatSarFromUsd(t.monthlyPriceUsd)}`}
              </button>
            </div>
          );
        })}
      </div>

      <div className="px-4 mt-8 max-w-2xl mx-auto text-center">
        <p className="text-xs text-slate-400">
          الاشتراك متجدد شهرياً. يمكنك الإلغاء في أي وقت من بوابة العميل.
          عند الإلغاء، تبقى المميزات نشطة حتى نهاية فترة الفوترة الحالية.
        </p>
        <Link to="/" className="inline-block mt-4 text-amber-300 hover:underline text-sm">
          العودة للعبة
        </Link>
      </div>
    </div>
  );
}

