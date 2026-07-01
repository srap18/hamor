import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  checkPackEligibility,
  getStorePurchaseStatus,
} from "@/lib/paddle-checkout.functions";
import { reconcileMyPaddlePurchases } from "@/lib/paddle-reconcile.functions";
import { getPaddleEnvironment } from "@/lib/paddle";
import { refreshProfile } from "@/hooks/use-auth";
import { sound } from "@/lib/sound";
import { buyPackWithPaddle } from "@/lib/paddle-buy";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { CoinIcon } from "@/components/CurrencyIcon";
import { STORE_PACKS, getPack, type StorePack, type PackCategory } from "@/lib/store-catalog";
import { RewardPopup } from "@/components/RewardPopup";
import { formatSarFromUsd } from "@/lib/currency";
import { isNativeApp } from "@/lib/platform";
import { NativePurchaseBlock } from "@/components/NativePurchaseButton";

const SUB_TABS: { id: PackCategory; label: string; emoji: string }[] = [
  { id: "offers", label: "عروض", emoji: "🔥" },
  { id: "bundle", label: "باقات", emoji: "🎁" },
  { id: "gems", label: "جواهر", emoji: "💎" },
  { id: "coins", label: "ذهب", emoji: "🪙" },
  { id: "crew", label: "طواقم", emoji: "⚓" },
  { id: "weapon", label: "أسلحة", emoji: "💣" },
  { id: "shield", label: "دروع", emoji: "🛡️" },
];

const TAG_STYLES: Record<string, string> = {
  "أفضل قيمة": "bg-amber-400 text-amber-950",
  "الأكثر طلباً": "bg-rose-500 text-white",
  محدود: "bg-rose-500 text-white",
  جديد: "bg-emerald-400 text-emerald-950",
  "لمرة واحدة فقط": "bg-violet-500 text-white",
  "محدود 2/أسبوع": "bg-sky-500 text-white",
  "خصم 40%": "bg-gradient-to-r from-rose-500 to-amber-400 text-white",
  "حصري": "bg-gradient-to-r from-purple-600 to-fuchsia-500 text-white",
  "ملكي": "bg-gradient-to-r from-amber-500 to-yellow-300 text-amber-950",
  "قوي": "bg-orange-500 text-white",
  "أسطوري": "bg-gradient-to-r from-fuchsia-600 to-rose-500 text-white",
};

export function RechargePanel() {
  const eligibility = useServerFn(checkPackEligibility);
  const getStatus = useServerFn(getStorePurchaseStatus);
  const reconcile = useServerFn(reconcileMyPaddlePurchases);

  const [userId, setUserId] = useState<string | null>(null);
  const [, setUserEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pop, setPop] = useState<string | null>(null);
  const [sub, setSub] = useState<PackCategory>("offers");
  const [shieldsThisWeek, setShieldsThisWeek] = useState(0);
  const [shieldLimit, setShieldLimit] = useState(2);
  const [boughtStarter, setBoughtStarter] = useState(false);
  const [reward, setReward] = useState<StorePack | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recoverMsg, setRecoverMsg] = useState<string | null>(null);

  const runRecovery = async () => {
    if (recovering) return;
    setRecovering(true);
    setRecoverMsg(null);
    try {
      const r = await reconcile({ data: { environment: getPaddleEnvironment() } });
      refreshProfile();
      if (r?.grantedCount && r.grantedCount > 0) {
        setRecoverMsg(`✅ تم استرجاع ${r.grantedCount} عملية شراء. تحقق من حسابك.`);
        sound.play("coin");
      } else {
        setRecoverMsg("لا توجد مشتريات معلقة. كل شي وصلك. لو فيه مشكلة راسل الدعم.");
      }
    } catch (e) {
      console.error(e);
      setRecoverMsg("تعذر التحقق الآن. حاول بعد لحظات أو راسل الدعم.");
    } finally {
      setRecovering(false);
    }
  };

  const flash = (m: string) => {
    setPop(m);
    setTimeout(() => setPop(null), 3000);
  };

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      setUserId(u.user.id);
      setUserEmail(u.user.email ?? null);
      try {
        const status = await getStatus({ data: {} });
        setShieldsThisWeek(status.shieldsThisWeek);
        setShieldLimit(status.shieldWeeklyLimit);
        setBoughtStarter(status.hasBoughtStarter);
      } catch {
        /* non-fatal */
      }
    })();
  }, [getStatus]);

  // Re-sync purchase status when user returns from Shopify checkout tab.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !userId) return;
      refreshProfile();
      getStatus({ data: {} })
        .then((s) => {
          setShieldsThisWeek(s.shieldsThisWeek);
          setBoughtStarter(s.hasBoughtStarter);
        })
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [userId, getStatus]);

  const purchase = async (pack: StorePack) => {
    if (!userId || busy) return;
    setBusy(pack.id);
    try {
      await eligibility({ data: { packId: pack.id } });
      await buyPackWithPaddle(pack.id);
      flash("✨ تم فتح صفحة الدفع. أكمل العملية ثم ارجع للعبة.");
      sound.play("coin");
    } catch (e) {
      console.error("[purchase] failed", e);
      flash(e instanceof Error ? e.message : "خطأ غير متوقع");
    } finally {
      setBusy(null);
    }
  };


  const list = useMemo(
    () => STORE_PACKS.filter((p) => p.category === sub && !p.disabled),
    [sub],
  );

  // On native apps we still show the Shopify storefront — checkout opens
  // in the in-app browser via @capacitor/browser.
  void isNativeApp;
  void NativePurchaseBlock;


  return (
    <div className="text-white" dir="rtl">
      {reward && <RewardPopup pack={reward} onClose={() => setReward(null)} />}
      <PaymentTestModeBanner />

      {/* Self-service recovery: claim any paid Paddle purchases that didn't deliver */}
      <div className="mx-2 mt-2 p-2 rounded-xl bg-amber-950/40 border border-amber-400/40 text-center">
        <button
          onClick={runRecovery}
          disabled={recovering || !userId}
          className="w-full py-2 rounded-lg bg-amber-600/30 border border-amber-300/60 text-amber-100 text-xs font-extrabold disabled:opacity-50"
        >
          {recovering ? "⏳ جاري التحقق..." : "🔄 ما وصلتك مشترياتك؟ اضغط للاسترجاع"}
        </button>
        {recoverMsg && (
          <p className="mt-1 text-[11px] text-amber-100/90">{recoverMsg}</p>
        )}
      </div>


      {/* Sub-tabs */}
      <div className="px-2 pt-2 grid grid-cols-7 gap-1">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            className={`py-1.5 rounded-lg text-[11px] font-bold border-2 transition-all flex items-center justify-center gap-1 ${
              sub === t.id
                ? "bg-gradient-to-b from-amber-400 to-amber-700 border-amber-200 text-amber-950 shadow-[0_0_12px_rgba(251,191,36,0.5)]"
                : "bg-stone-900/60 border-stone-700 text-stone-300"
            }`}
          >
            <span>{t.emoji}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {sub === "shield" && (
        <div className="mx-2 mt-2 p-2 rounded-xl bg-sky-950/50 border border-sky-400/40 text-center">
          <p className="text-[11px] font-bold text-sky-200">
            🛡️ مشترياتك هذا الأسبوع:{" "}
            <span className="text-white">
              {shieldsThisWeek} / {shieldLimit}
            </span>
          </p>
        </div>
      )}

      <div className="p-2 pb-4 space-y-2">
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
              className={`relative rounded-2xl p-2.5 border-2 ${
                p.popular
                  ? "border-amber-300 shadow-[0_0_24px_rgba(251,191,36,0.45)] bg-gradient-to-br from-amber-950/60 via-stone-900/80 to-stone-950/90"
                  : "border-stone-700 bg-gradient-to-b from-stone-900/80 to-stone-950/90"
              } overflow-hidden`}
            >
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

              <div className="flex items-center gap-2.5">
                {p.images?.length ? (
                  <div className="relative w-20 h-20 shrink-0 rounded-xl bg-gradient-to-b from-amber-900/40 to-stone-950/70 border border-amber-400/40 overflow-hidden flex items-center justify-center">
                    <img
                      src={p.images[0]}
                      alt={p.label}
                      className="w-full h-full object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)]"
                    />
                    {p.images[1] && (
                      <img
                        src={p.images[1]}
                        alt=""
                        className="absolute bottom-0 left-0 w-8 h-8 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)]"
                      />
                    )}
                    {p.reward.phoenixShips && p.reward.phoenixShips > 1 && (
                      <span className="absolute top-0 right-0 bg-rose-600 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-bl-lg">
                        ×{p.reward.phoenixShips}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-4xl drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]">
                    {p.emoji}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm text-white truncate">
                    {p.label}
                  </div>

                  <div className="mt-1 rounded-lg border border-emerald-400/40 bg-emerald-950/40 p-1.5">
                    <div className="text-[9px] font-extrabold text-emerald-300 mb-1 flex items-center gap-1">
                      🎁 <span>تحصل على:</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {r.phoenixShips ? (
                        <span className="text-[10px] font-extrabold text-rose-100 bg-gradient-to-r from-rose-600 to-orange-500 border border-rose-300/50 px-1.5 py-0.5 rounded">
                          🦅 ×{r.phoenixShips} سفينة العنقاء
                        </span>
                      ) : null}
                      {r.gems ? (
                        <span className="text-[10px] font-extrabold text-cyan-200 bg-cyan-900/50 border border-cyan-400/40 px-1.5 py-0.5 rounded">
                          {r.gems.toLocaleString()} 💎
                        </span>
                      ) : null}
                      {r.coins ? (
                        <span className="text-[10px] font-extrabold text-amber-200 bg-amber-900/50 border border-amber-400/40 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                          {r.coins.toLocaleString()} <CoinIcon size={11} />
                        </span>
                      ) : null}
                      {r.rubies ? (
                        <span className="text-[10px] font-extrabold text-rose-200 bg-rose-900/50 border border-rose-400/40 px-1.5 py-0.5 rounded">
                          {r.rubies} 🔴
                        </span>
                      ) : null}
                      {r.shieldDays ? (
                        <span className="text-[10px] font-extrabold text-sky-200 bg-sky-900/50 border border-sky-400/40 px-1.5 py-0.5 rounded">
                          🛡️ {r.shieldDays} أيام
                        </span>
                      ) : null}
                      {r.vipDays ? (
                        <span className="text-[10px] font-extrabold text-violet-200 bg-violet-900/50 border border-violet-400/40 px-1.5 py-0.5 rounded">
                          👑 VIP {r.vipDays}ي
                        </span>
                      ) : null}
                      {r.items?.map((it) => {
                        const labels: Record<string, string> = {
                          ad_bomb: "📺 قنبلة إعلانية",
                          rocket_small: "🚀 صاروخ صغير",
                          rocket_medium: "🚀 صاروخ متوسط",
                          rocket_large: "🚀 صاروخ كبير",
                          nuke: "☢️ نووية",
                          thief: "🥷 السارق",
                          police: "👮 شرطي",
                          trader: "💰 التاجر",
                          luck: "🍀 الحظ",
                          sailor: "⛵ بحار",
                          guide: "🧭 المرشد",
                          fixer_1: "🔧 مصلح صغير",
                          fixer_2: "🛠️ مصلح متوسط",
                          fixer_3: "⚒️ مصلح كبير",
                          fixer_4: "🏆 مصلح أسطوري",
                        };
                        return (
                          <span
                            key={`${it.itemType}:${it.itemId}`}
                            className="text-[10px] font-extrabold text-fuchsia-200 bg-fuchsia-900/50 border border-fuchsia-400/40 px-1.5 py-0.5 rounded"
                          >
                            ×{it.qty} {labels[it.itemId] ?? it.itemId}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  {p.description && (
                    <div className="text-[10px] text-stone-300 mt-1 leading-snug line-clamp-2">
                      {p.description}
                    </div>
                  )}
                </div>


                <button
                  onClick={() => purchase(p)}
                  disabled={disabled}
                  className="px-2.5 py-2 rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200 text-white font-extrabold active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center leading-tight shadow-[0_4px_14px_rgba(16,185,129,0.5)] shrink-0 min-w-[72px]"
                >
                  {busy === p.id ? (
                    <span className="text-[10px]">⏳</span>
                  ) : disabledLabel ? (
                    <span className="text-[10px]">{disabledLabel}</span>
                  ) : (
                    <>
                      <span className="text-[9px] font-bold opacity-90">السعر</span>
                      <span className="text-sm">{formatSarFromUsd(p.priceUSD)}</span>
                      <span className="text-[8px] font-medium opacity-80 leading-none">شامل الضريبة</span>
                      <span className="text-[9px] font-bold mt-0.5 bg-white/20 px-1.5 rounded">ادفع</span>

                    </>
                  )}
                </button>

              </div>
            </div>
          );
        })}

        <p className="text-center text-[10px] text-stone-400 pt-2 leading-relaxed px-4">
          🔒 الدفع آمن. ستُفتح صفحة الدفع وتُضاف المشتريات تلقائياً بعد إتمام الطلب.
        </p>
      </div>

      {pop && (
        <div className="fixed left-1/2 bottom-24 -translate-x-1/2 z-[60] text-sm font-bold text-amber-200 bg-stone-900/95 px-4 py-2 rounded-xl border border-amber-400/50 max-w-[90%] text-center shadow-2xl">
          {pop}
        </div>
      )}
    </div>
  );
}
