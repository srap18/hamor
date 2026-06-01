import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  checkPackEligibility,
  getStorePurchaseStatus,
} from "@/lib/paddle-checkout.functions";
import { initializePaddle, getPaddlePriceId } from "@/lib/paddle";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { CoinIcon } from "@/components/CurrencyIcon";
import { STORE_PACKS, type StorePack, type PackCategory } from "@/lib/store-catalog";

export const Route = createFileRoute("/recharge")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "متجر العروض — Ocean Catch" },
      { name: "description", content: "اشحن جواهر، باقات حصرية، VIP ودروع حماية" },
    ],
  }),
  component: RechargePage,
});

const TABS: { id: PackCategory; label: string; emoji: string }[] = [
  { id: "bundle", label: "باقات", emoji: "🎁" },
  { id: "vip", label: "VIP", emoji: "⭐" },
  { id: "gems", label: "جواهر", emoji: "💎" },
  { id: "shield", label: "دروع", emoji: "🛡️" },
  { id: "weapon", label: "أسلحة", emoji: "📺" },
];

const TAG_STYLES: Record<string, string> = {
  "أفضل قيمة": "bg-amber-400 text-amber-950",
  محدود: "bg-rose-500 text-white",
  جديد: "bg-emerald-400 text-emerald-950",
  "لمرة واحدة فقط": "bg-violet-500 text-white",
  "محدود 2/أسبوع": "bg-sky-500 text-white",
};

function RechargePage() {
  const nav = useNavigate();
  const eligibility = useServerFn(checkPackEligibility);
  const getStatus = useServerFn(getStorePurchaseStatus);

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [gems, setGems] = useState(0);
  const [coins, setCoins] = useState<number>(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [pop, setPop] = useState<string | null>(null);
  const [tab, setTab] = useState<PackCategory>("bundle");
  const [shieldsThisWeek, setShieldsThisWeek] = useState(0);
  const [shieldLimit, setShieldLimit] = useState(2);
  const [boughtStarter, setBoughtStarter] = useState(false);

  const flash = (m: string) => {
    setPop(m);
    setTimeout(() => setPop(null), 3000);
  };

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        nav({ to: "/login" });
        return;
      }
      setUserId(u.user.id);
      setUserEmail(u.user.email ?? null);
      const { data: p } = await supabase
        .from("profiles")
        .select("gems, coins")
        .eq("id", u.user.id)
        .maybeSingle();
      if (p) {
        setGems(p.gems);
        setCoins(Number(p.coins ?? 0));
      }
      try {
        const status = await getStatus({ data: {} });
        setShieldsThisWeek(status.shieldsThisWeek);
        setShieldLimit(status.shieldWeeklyLimit);
        setBoughtStarter(status.hasBoughtStarter);
      } catch {
        /* non-fatal */
      }
      // Warm up Paddle.js in the background
      initializePaddle().catch(() => {});
    })();
  }, [nav, getStatus]);

  const purchase = async (pack: StorePack) => {
    if (!userId || busy) return;
    setBusy(pack.id);
    try {
      await eligibility({ data: { packId: pack.id } });
      await initializePaddle();
      const paddlePriceId = await getPaddlePriceId(pack.id);
      window.Paddle.Checkout.open({
        items: [{ priceId: paddlePriceId, quantity: 1 }],
        customer: userEmail ? { email: userEmail } : undefined,
        customData: { userId, packId: pack.id },
        settings: {
          displayMode: "overlay",
          successUrl: `${window.location.origin}/payment-success`,
          allowLogout: false,
          variant: "one-page",
        },
      });
      // Paddle overlay handles the rest; reset busy in case user closes it
      setTimeout(() => setBusy(null), 1500);
    } catch (e) {
      flash(e instanceof Error ? e.message : "خطأ غير متوقع");
      setBusy(null);
    }
  };


  const list = useMemo(
    () => STORE_PACKS.filter((p) => p.category === tab),
    [tab]
  );

  return (
    <div
      className="fixed inset-0 overflow-y-auto text-white"
      dir="rtl"
      style={{
        background:
          "radial-gradient(ellipse at top, #1e293b 0%, #0c1424 50%, #050912 100%)",
      }}
    >
      <PaymentTestModeBanner />
      <header className="sticky top-0 z-20 glass-hud border-b border-accent/30 px-3 py-2.5 flex items-center gap-2">
        <Link
          to="/profile"
          className="w-10 h-10 rounded-xl glass-hud flex items-center justify-center text-lg active:scale-95"
        >
          ←
        </Link>
        <h1 className="flex-1 text-base font-bold text-glow">🛒 متجر العروض</h1>
        <div className="flex items-center gap-1 glass-hud px-2 py-1 rounded-lg border border-amber-400/40">
          <CoinIcon size={14} />
          <span className="text-amber-200 font-bold tabular-nums text-[11px]">
            {coins.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-1 glass-hud px-2 py-1 rounded-lg border border-cyan-400/40">
          <span className="text-sm">💎</span>
          <span className="text-cyan-200 font-bold tabular-nums text-[11px]">
            {gems.toLocaleString()}
          </span>
        </div>
      </header>

      {/* Tabs */}
      <div className="px-2 pt-2 grid grid-cols-4 gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`py-2 rounded-xl text-xs font-bold border-2 transition-all flex items-center justify-center gap-1 ${
              tab === t.id
                ? "bg-gradient-to-b from-amber-400 to-amber-700 border-amber-200 text-amber-950 shadow-[0_0_16px_rgba(251,191,36,0.6)]"
                : "bg-secondary/40 border-border text-muted-foreground"
            }`}
          >
            <span>{t.emoji}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Shield weekly counter */}
      {tab === "shield" && (
        <div className="mx-2.5 mt-2.5 p-2.5 rounded-xl bg-sky-950/50 border border-sky-400/40 text-center">
          <p className="text-[12px] font-bold text-sky-200">
            🛡️ مشترياتك هذا الأسبوع:{" "}
            <span className="text-white">
              {shieldsThisWeek} / {shieldLimit}
            </span>
          </p>
          <p className="text-[10px] text-sky-300/80 mt-0.5">
            الحد ينعاد كل 7 أيام — اشترِ بحكمة!
          </p>
        </div>
      )}

      <main className="p-2.5 pb-10 space-y-2.5">
        {list.map((p) => {
          const r = p.reward;
          const disabled =
            !!busy ||
            (p.category === "shield" && shieldsThisWeek >= shieldLimit) ||
            (p.oneTime && boughtStarter);
          const disabledLabel = p.oneTime && boughtStarter
            ? "تم الاستلام"
            : p.category === "shield" && shieldsThisWeek >= shieldLimit
              ? "وصلت الحد"
              : null;

          return (
            <div
              key={p.id}
              className={`relative rounded-2xl p-3 border-2 ${
                p.popular
                  ? "border-amber-300 shadow-[0_0_28px_rgba(251,191,36,0.55)] bg-gradient-to-br from-amber-950/60 via-stone-900/80 to-stone-950/90"
                  : "border-border bg-gradient-to-b from-stone-900/80 to-stone-950/90"
              } overflow-hidden`}
            >
              {p.popular && (
                <>
                  <span className="absolute -top-1 -right-1 text-amber-200 text-sm">
                    ✦
                  </span>
                  <span className="absolute -bottom-1 -left-1 text-amber-200 text-sm">
                    ✦
                  </span>
                </>
              )}

              {p.tag && (
                <span
                  className={`absolute top-2 left-2 z-10 text-[9px] font-extrabold px-1.5 py-0.5 rounded ${
                    TAG_STYLES[p.tag] ?? "bg-cyan-500 text-white"
                  }`}
                >
                  {p.tag}
                </span>
              )}
              {p.popular && (
                <span className="absolute -top-2 right-3 bg-amber-400 text-amber-950 text-[10px] font-extrabold px-2 py-0.5 rounded-full shadow">
                  الأكثر طلباً
                </span>
              )}

              <div className="flex items-center gap-3">
                <div className="text-5xl drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]">
                  {p.emoji}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-bold text-base text-white truncate">
                    {p.label}
                  </div>

                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {r.gems ? (
                      <span className="text-[11px] font-extrabold text-cyan-200 bg-cyan-900/50 border border-cyan-400/40 px-1.5 py-0.5 rounded">
                        +{r.gems.toLocaleString()} 💎
                      </span>
                    ) : null}
                    {r.coins ? (
                      <span className="text-[11px] font-extrabold text-amber-200 bg-amber-900/50 border border-amber-400/40 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                        +{r.coins.toLocaleString()} <CoinIcon size={12} />
                      </span>
                    ) : null}
                    {r.rubies ? (
                      <span className="text-[11px] font-extrabold text-rose-200 bg-rose-900/50 border border-rose-400/40 px-1.5 py-0.5 rounded">
                        +{r.rubies} 🔴
                      </span>
                    ) : null}
                    {r.shieldDays ? (
                      <span className="text-[11px] font-extrabold text-sky-200 bg-sky-900/50 border border-sky-400/40 px-1.5 py-0.5 rounded">
                        🛡️ {r.shieldDays} أيام
                      </span>
                    ) : null}
                    {r.vipDays ? (
                      <span className="text-[11px] font-extrabold text-violet-200 bg-violet-900/50 border border-violet-400/40 px-1.5 py-0.5 rounded">
                        👑 VIP {r.vipDays}ي
                      </span>
                    ) : null}
                  </div>

                  {p.bonus && (
                    <div className="text-[10px] text-emerald-300 font-bold mt-1">
                      🎁 مكافأة {p.bonus}
                    </div>
                  )}
                  {p.description && (
                    <div className="text-[10px] text-stone-300 mt-1 leading-snug">
                      {p.description}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => purchase(p)}
                  disabled={disabled}
                  className="px-3 py-2.5 rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200 text-white font-extrabold active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center leading-tight shadow-[0_4px_14px_rgba(16,185,129,0.5)] shrink-0 min-w-[68px]"
                >
                  {busy === p.id ? (
                    <span className="text-[10px]">⏳ جاري...</span>
                  ) : disabledLabel ? (
                    <span className="text-[10px]">{disabledLabel}</span>
                  ) : (
                    <>
                      <span className="text-sm">${p.priceUSD}</span>
                      <span className="text-[9px] font-bold">شراء</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}

        <p className="text-center text-[11px] text-muted-foreground pt-3 leading-relaxed px-4">
          🔒 الدفع يتم عبر Stripe بأمان. ستُحوّل لصفحة الدفع ثم تعود للعبة تلقائياً.
        </p>
      </main>

      {pop && (
        <div className="fixed left-1/2 top-20 -translate-x-1/2 z-50 text-sm font-bold text-amber-200 bg-stone-900/95 px-4 py-2 rounded-xl border border-amber-400/50 animate-float-up max-w-[90%] text-center">
          {pop}
        </div>
      )}
    </div>
  );
}
