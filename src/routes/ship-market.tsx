import { createFileRoute, Link } from "@tanstack/react-router";
import { BackButton } from "@/components/BackButton";
import { useEffect, useMemo, useState } from "react";

import { useAuth, useProfile, refreshProfile } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { SHIPS, catchPerTrip, shipBowFacesRight, shipMarketCapacity, type ShipDef } from "@/lib/ships";
import { FISH } from "@/lib/fish";
import { buyShipByCode, marketStartUpgrade, marketFinishUpgradeWithGems } from "@/lib/economy";
import { confirmDialog } from "@/components/ConfirmDialog";
import { MyShipsModal } from "@/components/MyShipsModal";
import { getCached, setCached } from "@/lib/swr-cache";
import iconArmor from "@/assets/icons/icon-armor.png";
import iconCoins from "@/assets/icons/icon-coins.png";
import iconFishing from "@/assets/icons/icon-fishing.png";
import iconGems from "@/assets/icons/icon-gems.png";
import iconHp from "@/assets/icons/icon-hp.png";
import iconRepair from "@/assets/icons/icon-repair.png";
import iconSpeed from "@/assets/icons/icon-speed.png";
import iconStorage from "@/assets/icons/icon-storage.png";
import iconTimer from "@/assets/icons/icon-timer.png";
import iconUpgrade from "@/assets/icons/icon-upgrade.png";
import { serverNowMs } from "@/lib/server-time";

// عرض المستوى المطلوب للناس: السفينة الداخلية مستوى 33 (الغواصة الترقيّة) تظهر كأنها 31.
const displayMarketLevel = (n: number): number => (n === 33 ? 31 : n);

export const Route = createFileRoute("/ship-market")({
  head: () => ({
    meta: [
      { title: "سوق السفن — ملوك القراصنة (هامور شابك)" },
      { name: "description", content: "اشترِ سفن قراصنة وطوّر سوقك في لعبة ملوك القراصنة (هامور شابك). أسطول كامل بانتظارك." },
      { property: "og:title", content: "سوق السفن — ملوك القراصنة" },
      { property: "og:description", content: "أسطول سفن قراصنة كامل في لعبة ملوك القراصنة (هامور شابك)." },
      { property: "og:url", content: "https://www.molok-alqarasna.com/ship-market" },
    ],
    links: [{ rel: "canonical", href: "https://www.molok-alqarasna.com/ship-market" }],
  }),
  component: ShipyardPage,
});

type MarketState = {
  level: number;
  upgrading_to: number | null;
  upgrade_ends_at: string | null;
  upgrade_started_at: string | null;
  upgrade_cost_coins: number | null;
};

type OwnedShip = {
  id: string;
  catalog_code: string | null;
  hp: number;
  max_hp: number;
  in_storage: boolean;
};

type ShipMarketCache = { market: MarketState; owned: OwnedShip[] };



function ShipyardPage() {
  const { user, loading: authLoading } = useAuth();
  const { profile } = useProfile();
  const [market, setMarket] = useState<MarketState | null>(null);
  const [owned, setOwned] = useState<OwnedShip[]>([]);
  const [selectedCode, setSelectedCode] = useState(SHIPS[0].code);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "upgrade" | "boost" | string>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [storageOpen, setStorageOpen] = useState(false);

  const selectedShip = SHIPS.find((ship) => ship.code === selectedCode) ?? SHIPS[0];
  const marketLevel = market?.level ?? 1;
  const acceleratingCost = Math.max(1, Math.ceil(secondsLeft / 60));
  const activeShips = useMemo(() => owned.filter((s) => !s.in_storage), [owned]);
  const storedShips = useMemo(() => owned.filter((s) => s.in_storage), [owned]);
  const ownedCount = useMemo(
    () => owned.reduce<Record<string, number>>((acc, ship) => {
      const key = ship.catalog_code ?? "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    [owned],
  );
  const fleetStorageUsed = useMemo(
    () => activeShips.reduce((sum, s) => {
      if ((s.catalog_code === "submarine" || s.catalog_code === "upgrade-sub") && s.max_hp > 0) return sum + s.max_hp;
      return sum + (SHIPS.find((sh) => sh.code === s.catalog_code)?.storage ?? 0);
    }, 0),
    [activeShips],
  );
  const fleetStorageMax = shipMarketCapacity(marketLevel);
  const MAX_SHIPS = 3;
  const MAX_STORAGE = 3;
  const activeCount = activeShips.length;
  const storageCount = storedShips.length;
  const allFull = activeCount >= MAX_SHIPS && storageCount >= MAX_STORAGE;
  const selectedShipFlip = shipBowFacesRight(selectedShip.marketLevel) ? 1 : -1;

  const showToast = (message: string) => {
    setToast(message);
    window.clearTimeout((showToast as typeof showToast & { t?: number }).t);
    (showToast as typeof showToast & { t?: number }).t = window.setTimeout(() => setToast(null), 1800);
  };

  const loadData = async (showSpinner = true) => {
    if (!user) return;
    const cacheKey = `ship-market:${user.id}`;
    if (showSpinner && !getCached<ShipMarketCache>(cacheKey)) setLoading(true);
    await supabase.rpc("finalize_market_upgrades");
    const [{ data: marketRow }, { data: ownedRows }] = await Promise.all([
      supabase.from("user_market").select("level, upgrading_to, upgrade_ends_at, upgrade_started_at, upgrade_cost_coins").eq("user_id", user.id).maybeSingle(),
      supabase.from("ships_owned").select("id, catalog_code, hp, max_hp, in_storage").eq("user_id", user.id).order("acquired_at", { ascending: false }),
    ]);
    const mr = (marketRow as MarketState | null) ?? { level: 1, upgrading_to: null, upgrade_ends_at: null, upgrade_started_at: null, upgrade_cost_coins: null };
    const ownedNext = (ownedRows as OwnedShip[] | null) ?? [];
    setMarket(mr);
    try { window.localStorage.setItem("ocean.marketLevel", String(Math.max(1, Math.min(31, mr.level || 1)))); } catch {}
    setOwned(ownedNext);
    setCached(cacheKey, { market: mr, owned: ownedNext });
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    const cached = getCached<ShipMarketCache>(`ship-market:${user.id}`);
    if (cached) {
      setMarket(cached.market);
      setOwned(cached.owned);
      setLoading(false);
    }
    loadData(!cached);
  }, [user]);

  useEffect(() => {
    if (!market?.upgrade_ends_at) {
      setSecondsLeft(0);
      return;
    }

    let zeroHits = 0;
    const tick = () => {
      const diff = Math.max(0, Math.ceil((new Date(market.upgrade_ends_at!).getTime() - serverNowMs()) / 1000));
      setSecondsLeft(diff);
      if (diff === 0) {
        zeroHits++;
        // Retry finalize every ~2s in case the server clock is slightly behind
        // the client clock when the timer reaches 0 (otherwise the row stays
        // stuck at "00:00" and never finalizes).
        if (zeroHits === 1 || zeroHits % 2 === 0) loadData(false);
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [market?.upgrade_ends_at]);


  const nextUpgradePreview = async () => {
    const { data } = await supabase.rpc("market_upgrade_cost", { _level: marketLevel });
    return data?.[0] ?? { cost_coins: 0, seconds: 0 };
  };

  const startUpgrade = async () => {
    if (!user || !profile || !market || market.upgrading_to) return;
    const preview = await nextUpgradePreview();
    const ok = await confirmDialog({
      title: "ترقية سوق السفن",
      message: `هل تريد بدء الترقية إلى المستوى ${marketLevel + 1}؟\nالتكلفة: ${preview.cost_coins} عملة\nالمدة: ${Math.ceil((preview.seconds || 0) / 60)} دقيقة`,
      confirmText: "ترقية",
    });
    if (!ok) return;
    setBusy("upgrade");
    const { error } = await marketStartUpgrade();
    setBusy(null);
    if (error) { showToast(error.message || "تعذر بدء الترقية"); return; }
    await loadData();
    showToast("بدأت ترقية السوق");
    refreshProfile();
  };

  const finishWithGems = async () => {
    if (!user || !profile || !market?.upgrading_to || secondsLeft <= 0) return;
    const ok = await confirmDialog({
      title: "إنهاء الترقية فورًا",
      message: "هل تريد إنهاء الترقية الآن باستخدام الجواهر؟",
      confirmText: "إنهاء بالجواهر",
    });
    if (!ok) return;
    setBusy("boost");
    const { error } = await marketFinishUpgradeWithGems();
    setBusy(null);
    if (error) { showToast(error.message || "فشل التسريع"); return; }
    await loadData();
    showToast(`تم إنهاء الترقية`);
    refreshProfile();
  };

  const buyShip = async (ship: ShipDef) => {
    if (!user || !profile) return;
    if (allFull) {
      showToast(`🚫 الأسطول والمخزن ممتلئان (${MAX_SHIPS}+${MAX_STORAGE}) — بِع سفينة أولًا`);
      return;
    }
    const requiredLevel = displayMarketLevel(ship.marketLevel);
    if (marketLevel < requiredLevel) {
      showToast("ارفع مستوى السوق أولًا");
      return;
    }
    if ((profile.coins ?? 0) < ship.price) {
      showToast("الذهب غير كافٍ — شراء السفن بالذهب فقط");
      return;
    }

    setBusy(ship.code);
    const { error } = await buyShipByCode(ship.code, displayMarketLevel(ship.marketLevel), ship.price, ship.maxHp);
    setBusy(null);
    if (error) { showToast(error.message || "تعذر شراء السفينة"); return; }
    await loadData();
    showToast(`تم شراء ${ship.title}`);
    refreshProfile();
  };

  if (authLoading || loading) {
    return <div className="fixed inset-0 grid place-items-center bg-background text-foreground">جاري تجهيز الـ Shipyard...</div>;
  }

  if (!user) {
    return (
      <div className="fixed inset-0 bg-background text-foreground">
        <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-3xl font-black">Shipyard</h1>
          <p className="text-sm text-muted-foreground">سجّل الدخول لفتح سوق السفن الاحترافي وترقية الميناء.</p>
          <Link to="/login" className="rounded-lg bg-primary px-5 py-3 text-sm font-bold text-primary-foreground">تسجيل الدخول</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-y-auto bg-background text-foreground">
      <div className="absolute inset-0 opacity-80" style={{ background: "radial-gradient(circle at top right, oklch(0.38 0.08 220 / 0.35), transparent 35%), linear-gradient(180deg, oklch(0.22 0.04 240), oklch(0.14 0.03 245))" }} />
      <div className="relative mx-auto flex min-h-full w-full max-w-7xl flex-col gap-4 px-3 pb-28 pt-3 md:px-5">
        <header className="glass-hud rounded-2xl px-4 py-4">
          <div className="flex items-start gap-3">
            <BackButton aria-label="العودة إلى الصفحة السابقة" className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-card text-lg">←</BackButton>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black">Shipyard</h1>
                <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[11px] font-bold text-accent">مستوى السوق {marketLevel}/31</span>
                {market?.upgrading_to && <span className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-bold text-primary">جارٍ إلى {market.upgrading_to}</span>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">واجهة عرض بحرية احترافية للسفن الواقعية، الترقية، والتسريع بالـ Gems.</p>
            </div>
            <div className="grid shrink-0 gap-2 text-right">
              <Res icon={iconCoins} label="ذهب" value={profile?.coins ?? 0} />
              <Res icon={iconGems} label="Gems" value={profile?.gems ?? 0} />
            </div>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1.45fr_0.85fr]">
          <div className="glass-hud overflow-hidden rounded-2xl border border-border/80">
            <div className="relative min-h-[420px] p-4 md:p-6">
              <div className="absolute inset-0 opacity-40" style={{ background: "radial-gradient(circle at 70% 25%, oklch(0.75 0.12 85 / 0.18), transparent 22%), radial-gradient(circle at 30% 70%, oklch(0.65 0.12 215 / 0.18), transparent 26%)" }} />
              <div className="relative flex h-full flex-col gap-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Featured Vessel</div>
                    <div className="mt-1 text-3xl font-black">{selectedShip.title}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{selectedShip.flavor}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">يصطاد:</span>
                      {selectedShip.fishPool.map((fid) => {
                        const f = FISH[fid];
                        if (!f) return null;
                        return (
                          <span key={fid} className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] font-bold text-accent">
                            <span>{f.emoji}</span>
                            <span>{f.name}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <span className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-bold text-accent">{selectedShip.rarity}</span>
                </div>

                <div className="relative grid flex-1 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-card/60 px-4 py-6">
                  <div className="absolute bottom-10 left-1/2 h-8 w-3/4 -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
                  <div className="absolute bottom-4 left-1/2 h-6 w-4/5 -translate-x-1/2 rounded-full border border-white/10 bg-white/5" />
                  <div className="relative z-10 w-full" style={{ transform: `scaleX(${selectedShipFlip})` }}>
                    <img src={selectedShip.image} alt={selectedShip.title} className="animate-[float-up_12s_ease-in-out_infinite] max-h-[320px] w-full object-contain drop-shadow-[0_28px_45px_rgba(0,0,0,0.55)] transition-transform duration-500 hover:scale-[1.03]" width={1280} height={960} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                  <Spec icon={iconHp} label="HP" value={selectedShip.maxHp} />
                  <Spec icon={iconArmor} label="Armor" value={selectedShip.armor} />
                  <Spec icon={iconSpeed} label="Speed" value={selectedShip.speed} />
                  <Spec icon={iconStorage} label="Storage" value={selectedShip.storage} />
                  <Spec icon={iconFishing} label="Catch/Trip" value={catchPerTrip(selectedShip)} />
                  <Spec icon={iconRepair} label="Repair" value={formatDuration(selectedShip.repairSeconds)} />
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="glass-hud rounded-2xl p-4">
              <div className="flex items-center gap-2">
                <img src={iconUpgrade} alt="أيقونة الترقية" className="h-9 w-9" width={512} height={512} loading="lazy" />
                <div>
                  <h2 className="text-lg font-black">ترقية السوق</h2>
                  <p className="text-xs text-muted-foreground">تفتح سفنًا أعلى وتزيد قيمة الأسطول مع مرور الوقت.</p>
                </div>
              </div>

              {market?.upgrading_to ? (
                <div className="mt-4 space-y-3 rounded-xl border border-primary/30 bg-primary/10 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span>الترقية الحالية</span>
                    <span className="font-black">{market.level} → {market.upgrading_to}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span>الوقت المتبقي</span>
                    <span className="font-black text-accent">{formatDuration(secondsLeft)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span>تسريع فوري</span>
                    <span className="font-black">{acceleratingCost} Gems</span>
                  </div>
                  <button onClick={finishWithGems} disabled={busy === "boost"} className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-black text-accent-foreground disabled:opacity-50">
                    <img src={iconGems} alt="أيقونة الجواهر" className="h-5 w-5" width={512} height={512} loading="lazy" />
                    {busy === "boost" ? "جارٍ التسريع..." : `إنهاء الآن (${acceleratingCost})`}
                  </button>
                  <div className="text-[11px] text-muted-foreground">المعادلة المستخدمة: ceil(seconds_remaining / 60)</div>
                </div>
              ) : (
                <UpgradePanel level={marketLevel} onStart={startUpgrade} busy={busy === "upgrade"} />
              )}
            </div>

          </div>
        </section>

        <section className="glass-hud rounded-2xl p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black">أسطول الشراء</h2>
              <p className="text-xs text-muted-foreground">يظهر حسب مستوى السوق الحالي، مع عرض فخم وحالة الامتلاك لكل سفينة.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setStorageOpen(true)} className="flex items-center gap-1.5 rounded-lg border-2 border-amber-400/70 bg-gradient-to-b from-amber-500/30 to-amber-700/30 px-3 py-2 text-sm font-black text-amber-100 hover:from-amber-500/40 hover:to-amber-700/40 active:scale-95 shadow-[0_0_18px_rgba(252,191,73,0.35)]">
                📦 مخزن السفن <span className="opacity-90 text-xs">({storageCount}/{MAX_STORAGE})</span>
              </button>
              <div className={`rounded-lg border px-3 py-2 text-xs font-bold ${activeCount >= MAX_SHIPS ? "border-rose-500/50 bg-rose-500/10 text-rose-200" : "border-border bg-card text-muted-foreground"}`}>النشطة: {activeCount} / {MAX_SHIPS}</div>
              <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">السعة: {fleetStorageUsed.toLocaleString()} / {fleetStorageMax.toLocaleString()}</div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {SHIPS.map((ship) => {
              const reqLevel = displayMarketLevel(ship.marketLevel);
              const locked = reqLevel > marketLevel;
              const count = ownedCount[ship.code] ?? 0;
              const selected = selectedCode === ship.code;
              const shipFlip = shipBowFacesRight(ship.marketLevel) ? 1 : -1;
              return (
                <button key={ship.code} onClick={() => setSelectedCode(ship.code)} className={`group rounded-2xl border p-3 text-right transition-all ${selected ? "border-primary bg-primary/10 shadow-[0_0_0_1px_var(--color-primary)]" : "border-border bg-card/70 hover:border-primary/40 hover:bg-card"}`}>
                  <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/20 p-2">
                    <div className="absolute inset-x-6 bottom-2 h-5 rounded-full bg-primary/15 blur-2xl" />
                    <div style={{ transform: `scaleX(${shipFlip})` }}>
                      <img src={ship.image} alt={ship.title} className="mx-auto h-32 w-full object-contain transition-transform duration-500 group-hover:scale-105" width={1024} height={768} loading="lazy" />
                    </div>
                    <span className="absolute right-2 top-2 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[10px] font-bold text-white/90">Lvl {reqLevel}</span>
                  </div>


                  <div className="mt-3 flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-black">{ship.title}</div>
                      <div className="text-[11px] text-muted-foreground">{ship.name}</div>
                    </div>
                    {count > 0 && <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] font-bold text-accent">×{count}</span>}
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                    <Mini icon={iconHp} value={ship.maxHp} />
                    <Mini icon={iconStorage} value={ship.storage} />
                    <Mini icon={iconFishing} value={catchPerTrip(ship)} />
                    <Mini icon={iconArmor} value={ship.armor} />
                    <Mini icon={iconSpeed} value={ship.speed} />
                    <Mini icon={iconRepair} value={formatDuration(ship.repairSeconds)} />
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1">
                    {ship.fishPool.map((fid) => {
                      const f = FISH[fid];
                      if (!f) return null;
                      return (
                        <span key={fid} className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-1.5 py-0.5 text-[10px] font-bold text-foreground/80">
                          <span>{f.emoji}</span>
                          <span>{f.name}</span>
                        </span>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-black">
                      <img src={iconCoins} alt="أيقونة الذهب" className="h-5 w-5" width={512} height={512} loading="lazy" />
                      <span>{ship.price.toLocaleString()}</span>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); buyShip(ship); }} disabled={locked || busy === ship.code || allFull} className="rounded-lg bg-primary px-3 py-2 text-xs font-black text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">
                      {locked ? `يتطلب ${reqLevel}` : allFull ? "ممتلئ" : busy === ship.code ? "جارٍ الشراء..." : activeCount >= MAX_SHIPS ? "شراء (للمخزن)" : "شراء"}
                    </button>

                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {toast && (
          <div className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-xl border border-accent/30 bg-card px-4 py-3 text-sm font-bold text-foreground shadow-2xl">
            {toast}
          </div>
        )}
      </div>
      <MyShipsModal open={storageOpen} onClose={() => { setStorageOpen(false); loadData(); }} />
    </div>
  );
}

function UpgradePanel({ level, onStart, busy }: { level: number; onStart: () => void; busy: boolean }) {
  const [preview, setPreview] = useState<{ cost_coins: number; seconds: number } | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.rpc("market_upgrade_cost", { _level: level }).then(({ data }) => {
      if (mounted) setPreview(data?.[0] ?? null);
    });
    return () => {
      mounted = false;
    };
  }, [level]);

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-border bg-card/70 p-3">
      <div className="flex items-center justify-between text-sm">
        <span>المستوى الحالي</span>
        <span className="font-black">{level}</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span>المستوى التالي</span>
        <span className="font-black text-primary">{Math.min(31, level + 1)}</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span>تكلفة الذهب</span>
        <span className="font-black">{preview?.cost_coins?.toLocaleString?.() ?? "..."}</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span>المدة</span>
        <span className="font-black">{preview ? formatDuration(preview.seconds) : "..."}</span>
      </div>
      <button onClick={onStart} disabled={busy || level >= 31} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-black text-primary-foreground disabled:opacity-50">
        <img src={iconTimer} alt="أيقونة المؤقت" className="h-5 w-5" width={512} height={512} loading="lazy" />
        {level >= 31 ? "وصلت الحد الأقصى" : busy ? "جارٍ البدء..." : "بدء الترقية"}
      </button>
    </div>
  );
}

function Res({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-card/70 px-3 py-2">
      <img src={icon} alt={label} className="h-6 w-6" width={512} height={512} loading="lazy" />
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
        <div className="text-sm font-black">{value.toLocaleString()}</div>
      </div>
    </div>
  );
}

function Spec({ icon, label, value }: { icon: string; label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-border bg-card/70 p-3 text-center">
      <img src={icon} alt={label} className="mx-auto h-8 w-8" width={512} height={512} loading="lazy" />
      <div className="mt-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-black">{value}</div>
    </div>
  );
}

function Mini({ icon, value }: { icon: string; value: number | string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-2 py-1.5">
      <img src={icon} alt="stat" className="h-4 w-4" width={512} height={512} loading="lazy" />
      <span className="text-[11px] font-bold">{value}</span>
    </div>
  );
}

function formatDuration(totalSeconds: number) {
  if (totalSeconds <= 0) return "00:00";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
