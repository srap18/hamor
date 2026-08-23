import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
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
import { getMySubscription, setAutoRenew, type MySubscription } from "@/lib/vip-subscription.functions";

function AutoRenewCard() {
  const { user } = useAuth();
  const { level: vipLevel } = useEliteVipLevel();
  const [sub, setSub] = useState<MySubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      setSub(await getMySubscription());
    } catch {
      setSub(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    void load();
  }, [user, load]);

  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      const r = await setAutoRenew({ data: { enabled } });
      setSub((s) => (s ? { ...s, cancelAtPeriodEnd: r.cancelAtPeriodEnd } : s));
      toast.success(
        enabled
          ? "تم تفعيل التجديد التلقائي مرة أخرى ✅"
          : "تم إلغاء التجديد التلقائي — مميزاتك تبقى حتى نهاية الفترة الحالية",
      );
      setConfirming(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر تحديث الاشتراك");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    if (!user || vipLevel <= 0) return null;
    return (
      <div className="px-4 mt-4 max-w-2xl mx-auto">
        <div className="rounded-2xl border border-amber-400/30 bg-slate-900/70 p-4 text-sm text-slate-300">
          جاري تحميل حالة الاشتراك...
        </div>
      </div>
    );
  }

  // VIP user whose subscription could not be matched automatically
  // (مثلاً اشتراك عبر Google Play أو حساب دفع مختلف) — نعرض له طريقة الإلغاء.
  if (!sub) {
    if (vipLevel <= 0) return null;
    return (
      <div className="px-4 mt-4 max-w-2xl mx-auto">
        <div className="rounded-2xl border border-amber-400/40 bg-slate-900/70 p-4">
          <div className="font-extrabold text-amber-200">إدارة الاشتراك</div>
          <div className="text-xs text-slate-300 mt-2 leading-6">
            لم نتمكن من ربط اشتراكك تلقائياً بهذا الحساب. لإلغاء التجديد التلقائي:
            <br />• إذا اشتركت من <b>تطبيق أندرويد</b>: افتح Google Play ← الحساب ← الدفعات والاشتراكات ← الاشتراكات ← إلغاء.
            <br />• إذا اشتركت من <b>المتصفح</b>: افتح رابط «إدارة الاشتراك» في رسالة الفاتورة على بريدك، أو تواصل مع الدعم وسنلغيه لك فوراً.
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            <a
              href="https://play.google.com/store/account/subscriptions"
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-xl bg-slate-800 border border-amber-400/40 text-amber-200 font-bold text-xs"
            >
              اشتراكات Google Play
            </a>
            <Link
              to="/support"
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 text-slate-900 font-extrabold text-xs"
            >
              طلب إلغاء عبر الدعم
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const end = sub.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd).toLocaleDateString("ar", { year: "numeric", month: "long", day: "numeric" })
    : null;

  return (
    <div className="px-4 mt-4 max-w-2xl mx-auto">
      <div className="rounded-2xl border border-amber-400/40 bg-slate-900/70 p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-extrabold text-amber-200">إدارة الاشتراك</div>
            <div className="text-xs text-slate-300 mt-1">
              {sub.cancelAtPeriodEnd
                ? `التجديد التلقائي متوقف${end ? ` — ينتهي اشتراكك في ${end}` : ""}`
                : `التجديد التلقائي مفعّل${end ? ` — التجديد القادم ${end}` : ""}`}
            </div>
          </div>
          {sub.cancelAtPeriodEnd ? (
            <button
              disabled={busy}
              onClick={() => toggle(true)}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 text-slate-900 font-extrabold text-sm disabled:opacity-50"
            >
              {busy ? "..." : "إعادة تفعيل التجديد"}
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => setConfirming(true)}
              className="px-4 py-2 rounded-xl bg-slate-800 border border-rose-400/50 text-rose-200 font-bold text-sm disabled:opacity-50"
            >
              إلغاء التجديد التلقائي
            </button>
          )}
        </div>

        {confirming && (
          <div className="mt-3 rounded-xl border border-rose-400/40 bg-rose-950/30 p-3 text-sm text-rose-100">
            هل أنت متأكد؟ سيتوقف التجديد التلقائي، وتبقى مميزات Elite VIP فعّالة حتى
            {end ? ` ${end}` : " نهاية الفترة الحالية"}.
            <div className="flex gap-2 mt-3">
              <button
                disabled={busy}
                onClick={() => toggle(false)}
                className="px-4 py-2 rounded-lg bg-rose-600 text-white font-bold text-xs disabled:opacity-50"
              >
                {busy ? "جاري..." : "نعم، ألغِ التجديد"}
              </button>
              <button
                disabled={busy}
                onClick={() => setConfirming(false)}
                className="px-4 py-2 rounded-lg bg-slate-700 text-slate-100 font-bold text-xs"
              >
                تراجع
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


export const Route = createFileRoute("/vip")({
  ssr: false,
  component: VipPage,
  head: () => ({
    meta: [
      { title: "Elite VIP — ملوك القراصنة" },
      { name: "description", content: "نظام Elite VIP الحصري — 5 مستويات اشتراك فاخرة بشارات وامتيازات أسطورية." },
      { property: "og:title", content: "Elite VIP — ملوك القراصنة" },
      { property: "og:description", content: "مستويات Elite VIP الحصرية وامتيازات الاشتراك في ملوك القراصنة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
        <AutoRenewCard />

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
          6 مستويات حصرية للاشتراك الشهري فقط — لا تُمنح عن طريق اللعب أو عملات اللعبة.
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

      <AutoRenewCard />

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
                  : t.level === 6
                    ? "bg-gradient-to-b from-cyan-950/80 to-slate-950 border-cyan-300/70 shadow-[0_0_40px_rgba(34,211,238,0.45)]"
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
              {t.level === 6 && !isCurrent && (
                <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-gradient-to-r from-cyan-400 to-sky-300 text-slate-900 font-bold">
                  أعلى مستوى
                </span>
              )}


              <div className="flex justify-center mb-3">
                <img decoding="async"
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
                    : t.level === 6
                      ? "bg-gradient-to-r from-cyan-300 via-white to-sky-300 text-slate-900 hover:brightness-110 shadow-lg"
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

