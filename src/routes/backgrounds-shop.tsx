import { createFileRoute, Link } from "@tanstack/react-router";
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
import { useAuth, useProfile, refreshProfile } from "@/hooks/use-auth";
import { CoinIcon } from "@/components/CurrencyIcon";

export const Route = createFileRoute("/backgrounds-shop")({
  head: () => ({
    meta: [
      { title: "متجر الخلفيات — Ocean Catch" },
      { name: "description", content: "اشتري خلفيات بحريه فاخره وغيّر مشهد لعبتك" },
    ],
  }),
  component: BackgroundsShop,
});

const RARITY_COLOR: Record<SceneBg["rarity"], string> = {
  common: "border-stone-300 from-stone-500 to-stone-700",
  rare: "border-sky-300 from-sky-500 to-sky-700",
  epic: "border-violet-300 from-violet-500 to-violet-700",
  legendary: "border-amber-300 from-amber-400 to-amber-700",
};

function BackgroundsShop() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const coins = profile?.coins ?? 0;
  const [owned, setOwned] = useState<string[]>(["harbor"]);
  const [selected, setSelected] = useState<string>("harbor");
  const [pop, setPop] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOwned(getOwnedBgIds());
    setSelected(getSelectedBgId());
  }, []);

  const flash = (m: string) => { setPop(m); setTimeout(() => setPop(null), 1500); };

  const buy = async (b: SceneBg) => {
    if (owned.includes(b.id)) {
      setSelectedBgId(b.id); setSelected(b.id); flash(`تم تركيب ${b.name}`); return;
    }
    if (!user || !profile) { flash("سجّل الدخول أولاً"); return; }
    const shortfall = Math.max(0, b.price - coins);
    const gemsNeeded = Math.ceil(shortfall / 1000);
    if (shortfall > 0 && (profile.gems ?? 0) < gemsNeeded) { flash(`غير كافية (تحتاج ${gemsNeeded} جوهرة لتغطية النقص)`); return; }
    if (shortfall > 0 && !window.confirm(`الذهب غير كافٍ. سيُخصم ${gemsNeeded} جوهرة لتغطية النقص (1 جوهرة = 1000 ذهب). متابعة؟`)) return;
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("buy_background", { _bg_id: b.id, _price: b.price });
    setBusy(false);
    if (error) { flash(error.message || "فشل الشراء"); return; }
    const next = [...owned, b.id];
    setOwned(next); setOwnedBgIds(next);
    setSelectedBgId(b.id); setSelected(b.id);
    flash(`اشتريت ${b.name}`);
    refreshProfile();
  };

  const equip = (b: SceneBg) => {
    setSelectedBgId(b.id); setSelected(b.id); flash(`تم تركيب ${b.name}`);
  };

  return (
    <div
      className="fixed inset-0 overflow-hidden text-white"
      dir="rtl"
      style={{ background: "radial-gradient(ellipse at top, #1a3a5c 0%, #0a1a30 55%, #03070d 100%)" }}
    >
      {/* TOP HUD */}
      <div className="absolute top-0 left-0 right-0 z-30 p-2 flex items-center gap-2">
        <Link to="/shop" className="w-10 h-10 rounded-xl bg-gradient-to-b from-rose-500 to-rose-800 border-2 border-rose-300 flex items-center justify-center text-lg font-bold shadow-lg active:scale-95">↩</Link>
        <div className="flex-1 glass-hud rounded-xl px-3 py-1.5 flex items-center justify-center gap-2">
          <CoinIcon size={18} />
          <span className="text-amber-300 font-bold tabular-nums">{coins.toLocaleString()}</span>
        </div>
        <Link to="/" className="w-10 h-10 rounded-xl bg-gradient-to-b from-amber-500 to-amber-800 border-2 border-amber-300 flex items-center justify-center text-lg active:scale-95 shadow-lg">🏠</Link>
      </div>

      {/* Title */}
      <div className="absolute top-12 left-0 right-0 z-20 flex justify-center pointer-events-none">
        <div className="bg-gradient-to-b from-amber-500 to-amber-800 border-2 border-amber-300 px-8 py-1.5 rounded-md shadow-xl">
          <span className="text-base font-extrabold text-glow">متجر الخلفيات</span>
        </div>
      </div>

      {/* Grid */}
      <div className="absolute top-24 left-2 right-2 bottom-2 z-10 rounded-2xl bg-gradient-to-b from-[#0e2240]/90 to-[#04101e]/95 border-2 border-sky-900/70 shadow-2xl overflow-hidden">
        <div className="h-full overflow-y-auto p-3 grid grid-cols-2 gap-3">
          {BACKGROUNDS.map((b) => {
            const isOwned = owned.includes(b.id);
            const isEquipped = selected === b.id;
            return (
              <div
                key={b.id}
                className={`relative rounded-xl border-2 bg-gradient-to-b ${RARITY_COLOR[b.rarity]} p-1.5 shadow-lg`}
              >
                {/* Real scene preview */}
                <div className="relative w-full aspect-[16/9] rounded-lg overflow-hidden border border-white/30 bg-black">
                  <div className="absolute inset-y-0 right-0 w-1/2 overflow-hidden border-r border-white/20">
                    <img
                      src={b.image}
                      alt={b.name}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover animate-bg-drift"
                    />
                    <div className="absolute right-1 bottom-1 px-1.5 py-0.5 rounded bg-emerald-700/90 border border-emerald-200 text-[9px] font-bold">
                      سليمة
                    </div>
                  </div>
                  <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
                    <img
                      src={b.burnedImage}
                      alt={b.burnedName}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover animate-bg-drift animate-bg-burned-pulse"
                    />
                    <div className="absolute left-1 bottom-1 px-1.5 py-0.5 rounded bg-rose-700/90 border border-rose-200 text-[9px] font-bold">
                      محترقة
                    </div>
                  </div>

                  {b.animated && (
                    <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-fuchsia-600/90 border border-fuchsia-200 text-[9px] font-bold">
                      متحركه
                    </div>
                  )}
                  {isEquipped && (
                    <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-emerald-600 border border-emerald-200 text-[9px] font-bold">
                      مركّبه
                    </div>
                  )}
                  {!isOwned && (
                    <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 border border-white/30 text-[9px] font-bold capitalize">
                      {b.rarity}
                    </div>
                  )}
                </div>

                {/* Name */}
                <div className="mt-1.5 text-center text-[12px] font-extrabold text-white text-glow truncate">
                  {b.name}
                </div>

                {/* Price / Action */}
                {isOwned ? (
                  <button
                    onClick={() => equip(b)}
                    disabled={isEquipped}
                    className={`mt-1 w-full py-1.5 rounded text-xs font-extrabold border-2 active:scale-95 ${
                      isEquipped
                        ? "bg-stone-700 border-stone-500 text-stone-300"
                        : "bg-gradient-to-b from-emerald-400 to-emerald-700 border-emerald-200 text-white"
                    }`}
                  >
                    {isEquipped ? "مركّبه الآن" : "تركيب"}
                  </button>
                ) : (
                  <button
                    onClick={() => buy(b)}
                    className="mt-1 w-full py-1.5 rounded bg-gradient-to-b from-amber-300 to-amber-600 border-2 border-amber-200 text-amber-950 text-xs font-extrabold active:scale-95 flex items-center justify-center gap-1"
                  >
                    <CoinIcon size={16} />
                    <span className="tabular-nums">{b.price.toLocaleString()}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {pop && (
        <div className="fixed left-1/2 top-1/3 -translate-x-1/2 z-[60] text-base font-bold text-amber-200 text-glow pointer-events-none animate-float-up bg-stone-900/85 px-4 py-2 rounded-xl border border-amber-400/40">
          {pop}
        </div>
      )}
    </div>
  );
}
