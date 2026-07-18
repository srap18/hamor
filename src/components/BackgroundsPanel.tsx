import { useEffect, useState } from "react";
import {
  BACKGROUNDS,
  type SceneBg,
  getOwnedBgIds,
  setOwnedBgIds,
  getSelectedBgId,
  setSelectedBgId,
} from "@/lib/backgrounds";
import { supabase } from "@/integrations/supabase/client";
import { rateLimit } from "@/lib/rate-limit";

import { useAuth, useProfile, refreshProfile } from "@/hooks/use-auth";
import { CoinIcon, GemIcon } from "@/components/CurrencyIcon";
import { repairBurnedBg } from "@/components/BurnedBgOverlay";
import { showBanner } from "@/components/Banner";
import { serverNowMs } from "@/lib/server-time";
import { useServerTick } from "@/lib/use-server-tick";

const RARITY_COLOR: Record<SceneBg["rarity"], string> = {
  common: "border-stone-300 from-stone-500 to-stone-700",
  rare: "border-sky-300 from-sky-500 to-sky-700",
  epic: "border-violet-300 from-violet-500 to-violet-700",
  legendary: "border-amber-300 from-amber-400 to-amber-700",
};

export function BackgroundsPanel() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const coins = profile?.coins ?? 0;
  const gems = profile?.gems ?? 0;
  const burnedUntil = (profile as any)?.bg_burned_until as string | null | undefined;
  const isBurned = !!burnedUntil && new Date(burnedUntil).getTime() > serverNowMs();
  const [owned, setOwned] = useState<string[]>(["onepiece"]);
  const [expiries, setExpiries] = useState<Record<string, number>>({});
  const now = useServerTick();
  const [selected, setSelected] = useState<string>("onepiece");
  const [pop, setPop] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [repairing, setRepairing] = useState(false);

  useEffect(() => {
    setSelected(getSelectedBgId());
    if (!user) {
      const base = ["onepiece"];
      setOwned(base);
      setOwnedBgIds(base);
      return;
    }
    // Source of truth = server inventory. Premium backgrounds must exist there.
    supabase
      .from("inventory")
      .select("item_id, meta")
      .eq("user_id", user.id)
      .eq("item_type", "background")
      .then(({ data }) => {
        const nowMs = serverNowMs();
        const exp: Record<string, number> = {};
        const serverIds = (data || [])
          .map((r: any) => {
            const id = r.item_id as string;
            const expAt = r?.meta?.expires_at ? new Date(r.meta.expires_at).getTime() : null;
            if (expAt && expAt <= nowMs) return null; // expired -> hide
            if (expAt) exp[id] = expAt;
            return id;
          })
          .filter((id): id is string => !!id && BACKGROUNDS.some((b) => b.id === id));
        const next = Array.from(new Set(["onepiece", ...serverIds]));
        setOwned(next);
        setExpiries(exp);
        setOwnedBgIds(next);
      });
  }, [user]);

  const flash = (m: string) => { setPop(m); setTimeout(() => setPop(null), 1500); };

  const msLeft = burnedUntil ? new Date(burnedUntil).getTime() - now : 0;
  const fmtLeft = () => {
    const s = Math.max(0, Math.floor(msLeft / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${d}ي ${h}س ${m}د`;
  };

  const handleRepair = async () => {
    if (repairing) return;
    if (gems < 100) { flash("💎 تحتاج 100 جوهرة للإصلاح"); return; }
    if (!window.confirm("إصلاح الخلفية المحترقة مقابل 100 جوهرة؟")) return;
    setRepairing(true);
    const { error } = await repairBurnedBg();
    setRepairing(false);
    if (error) { flash("تعذّر الإصلاح"); return; }
    flash("✨ رجعت الخلفية سليمة!");
    refreshProfile();
  };

  const buy = async (b: SceneBg) => {
    const isTimed = !!b.durationDays;
    if (owned.includes(b.id) && !isTimed) {
      setSelectedBgId(b.id); setSelected(b.id); flash(`تم تركيب ${b.name}`); return;
    }
    if (!user || !profile) { flash("سجّل الدخول أولاً"); return; }
    if (busy) return;
    if (!(await rateLimit("purchase", 1000))) { flash("تمهّل قليلاً قبل المحاولة مجدداً"); return; }


    if (b.currency === "gems") {
      if ((profile.gems ?? 0) < b.price) { flash(`💎 تحتاج ${b.price.toLocaleString()} جوهرة`); return; }
      const renew = isTimed && owned.includes(b.id);
      const confirmMsg = isTimed
        ? (renew
            ? `تجديد ${b.name} لمدة ${b.durationDays} أيام مقابل ${b.price.toLocaleString()} جوهرة؟`
            : `شراء ${b.name} لمدة ${b.durationDays} أيام مقابل ${b.price.toLocaleString()} جوهرة؟`)
        : `شراء ${b.name} مقابل ${b.price.toLocaleString()} جوهرة؟`;
      if (!window.confirm(confirmMsg)) return;
      setBusy(true);
      const { error } = await supabase.rpc("buy_background_gems", { _bg_id: b.id, _gems: b.price });
      setBusy(false);
      if (error) { flash(error.message || "فشل الشراء"); return; }
      if (isTimed) {
        setExpiries((e) => ({ ...e, [b.id]: Date.now() + b.durationDays! * 86400_000 }));
      }
    } else {
      const shortfall = Math.max(0, b.price - coins);
      const gemsNeeded = Math.ceil(shortfall / 1000);
      if (shortfall > 0 && (profile.gems ?? 0) < gemsNeeded) { flash(`غير كافية (تحتاج ${gemsNeeded} جوهرة لتغطية النقص)`); return; }
      if (shortfall > 0 && !window.confirm(`الذهب غير كافٍ. سيُخصم ${gemsNeeded} جوهرة لتغطية النقص (1 جوهرة = 1000 ذهب). متابعة؟`)) return;
      setBusy(true);
      const { error } = await supabase.rpc("buy_background", { _bg_id: b.id, _price: b.price });
      setBusy(false);
      if (error) { flash(error.message || "فشل الشراء"); return; }
    }

    const next = [...owned, b.id];
    setOwned(next); setOwnedBgIds(next);
    setSelectedBgId(b.id); setSelected(b.id);
    flash(`اشتريت ${b.name}`);
    showBanner({ kind: "purchase", title: b.name, subtitle: `${b.price.toLocaleString()} ${b.currency === "gems" ? "جوهرة" : "ذهب"} • خلفية${isTimed ? ` • ${b.durationDays} أيام` : ""}`, image: b.image, emoji: "🖼️" });
    refreshProfile();
  };

  const fmtRemaining = (until: number) => {
    const s = Math.max(0, Math.floor((until - now) / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}ي ${h}س`;
    if (h > 0) return `${h}س ${m}د`;
    return `${m}د`;
  };

  const equip = (b: SceneBg) => {
    setSelectedBgId(b.id); setSelected(b.id); flash(`تم تركيب ${b.name}`);
  };

  return (
    <div dir="rtl" className="px-2 pt-2">
      {isBurned && (
        <div className="mb-2 rounded-xl border-2 border-rose-400/70 bg-gradient-to-b from-rose-900/90 to-rose-950/90 px-3 py-2 shadow-2xl flex items-center gap-2">
          <span className="text-2xl">🔥</span>
          <div className="flex-1 min-w-0">
            <div className="text-rose-100 text-[12px] font-extrabold">خلفيتك محترقة</div>
            <div className="text-rose-200/80 text-[10px]">تنتهي خلال {fmtLeft()} — أو أصلحها فوراً</div>
          </div>
          <button
            onClick={handleRepair}
            disabled={repairing}
            className="px-3 py-1.5 rounded-lg bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200 text-white text-[11px] font-extrabold shadow-lg active:scale-95 flex items-center gap-1 disabled:opacity-60"
          >
            🛠️ إصلاح <GemIcon size={14} /><span className="tabular-nums">100</span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 auto-rows-min content-start gap-3">
        {BACKGROUNDS.map((b) => {
          const isOwned = owned.includes(b.id);
          const isEquipped = selected === b.id;
          return (
            <div
              key={b.id}
              className={`relative rounded-xl border-2 bg-gradient-to-b ${RARITY_COLOR[b.rarity]} p-1.5 shadow-lg`}
            >
              <div className="relative w-full aspect-[16/9] rounded-lg overflow-hidden border border-white/30 bg-black">
                <div className="absolute inset-y-0 right-0 w-1/2 overflow-hidden border-r border-white/20">
                  <img src={b.image} alt={b.name} loading="lazy" className="absolute inset-0 h-full w-full object-cover animate-bg-drift" />
                  <div className="absolute right-1 bottom-1 px-1.5 py-0.5 rounded bg-emerald-700/90 border border-emerald-200 text-[9px] font-bold">سليمة</div>
                </div>
                <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
                  <img src={b.burnedImage} alt={b.burnedName} loading="lazy" className="absolute inset-0 h-full w-full object-cover animate-bg-drift animate-bg-burned-pulse" />
                  <div className="absolute left-1 bottom-1 px-1.5 py-0.5 rounded bg-rose-700/90 border border-rose-200 text-[9px] font-bold">محترقة</div>
                </div>
                {b.animated && (
                  <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-fuchsia-600/90 border border-fuchsia-200 text-[9px] font-bold">متحركه</div>
                )}
                {isEquipped && (
                  <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-emerald-600 border border-emerald-200 text-[9px] font-bold">مركّبه</div>
                )}
                {!isOwned && (
                  <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 border border-white/30 text-[9px] font-bold capitalize">{b.rarity}</div>
                )}
              </div>
              <div className="mt-1.5 text-center text-[12px] font-extrabold text-white text-glow truncate">{b.name}</div>
              {isOwned && expiries[b.id] && (
                <div className="text-center text-[10px] font-bold text-amber-200">
                  ⏳ متبقّي {fmtRemaining(expiries[b.id])}
                </div>
              )}
              {isOwned ? (
                <button
                  onClick={() => equip(b)}
                  disabled={isEquipped}
                  className={`mt-1 w-full py-1.5 rounded text-xs font-extrabold border-2 active:scale-95 ${
                    isEquipped ? "bg-stone-700 border-stone-500 text-stone-300" : "bg-gradient-to-b from-emerald-400 to-emerald-700 border-emerald-200 text-white"
                  }`}
                >
                  {isEquipped ? "مركّبه الآن" : "تركيب"}
                </button>
              ) : (
                <button
                  onClick={() => buy(b)}
                  className="mt-1 w-full py-1.5 rounded bg-gradient-to-b from-amber-300 to-amber-600 border-2 border-amber-200 text-amber-950 text-xs font-extrabold active:scale-95 flex items-center justify-center gap-1"
                >
                  {b.currency === "gems" ? <GemIcon size={16} /> : <CoinIcon size={16} />}
                  <span className="tabular-nums">{b.price.toLocaleString()}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {pop && (
        <div className="fixed left-1/2 top-1/3 -translate-x-1/2 z-[60] text-base font-bold text-amber-200 text-glow pointer-events-none animate-float-up bg-stone-900/85 px-4 py-2 rounded-xl border border-amber-400/40">
          {pop}
        </div>
      )}
    </div>
  );
}
