import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BottomNav } from "@/components/BottomNav";
import { useAuth, useProfile, refreshProfile } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { SHIPS, catchPerTrip, shipMarketCapacity, type ShipDef } from "@/lib/ships";
import { buyShipByCode, marketStartUpgrade, marketFinishUpgradeWithGems } from "@/lib/economy";
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

export const Route = createFileRoute("/ship-market")({
  head: () => ({
    meta: [
      { title: "Shipyard — Ocean Catch" },
      { name: "description", content: "ترقية سوق السفن وشراء سفن احترافية بأسلوب بحري واقعي" },
    ],
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
};



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

  const selectedShip = SHIPS.find((ship) => ship.code === selectedCode) ?? SHIPS[0];
  const marketLevel = market?.level ?? 1;
  const acceleratingCost = Math.max(1, Math.ceil(secondsLeft / 60));
  const ownedCount = useMemo(
    () => owned.reduce<Record<string, number>>((acc, ship) => {
      const key = ship.catalog_code ?? "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    [owned],
  );

  const showToast = (message: string) => {
    setToast(message);
    window.clearTimeout((showToast as typeof showToast & { t?: number }).t);
    (showToast as typeof showToast & { t?: number }).t = window.setTimeout(() => setToast(null), 1800);
  };

  const loadData = async () => {
    if (!user) return;
    setLoading(true);
    await supabase.rpc("finalize_market_upgrades");
    const [{ data: marketRow }, { data: ownedRows }] = await Promise.all([
      supabase.from("user_market").select("level, upgrading_to, upgrade_ends_at, upgrade_started_at, upgrade_cost_coins").eq("user_id", user.id).maybeSingle(),
      supabase.from("ships_owned").select("id, catalog_code, hp, max_hp").eq("user_id", user.id).order("acquired_at", { ascending: false }),
    ]);
    setMarket((marketRow as MarketState | null) ?? { level: 1, upgrading_to: null, upgrade_ends_at: null, upgrade_started_at: null, upgrade_cost_coins: null });
    setOwned((ownedRows as OwnedShip[] | null) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  useEffect(() => {
    if (!market?.upgrade_ends_at) {
      setSecondsLeft(0);
      return;
    }

    const tick = () => {
      const diff = Math.max(0, Math.ceil((new Date(market.upgrade_ends_at!).getTime() - Date.now()) / 1000));
      setSecondsLeft(diff);
      if (diff === 0) loadData();
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
    if (owned.length >= 3) {
      showToast("الحد الأقصى 3 سفن في الأسطول — بِع سفينة أولًا");
      return;
    }
    if (marketLevel < ship.marketLevel) {
      showToast("ارفع مستوى السوق أولًا");
      return;
    }
    if (profile.coins < ship.price) {
      showToast("العملات غير كافية للشراء");
      return;
    }

    setBusy(ship.code);
    const { error } = await buyShipByCode(ship.code, ship.marketLevel, ship.price, ship.maxHp);
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
            <Link to="/" className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-card text-lg">←</Link>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black">Shipyard</h1>
                <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[11px] font-bold text-accent">مستوى السوق {marketLevel}/30</span>
                {market?.upgrading_to && <span className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-bold text-primary">جارٍ إلى {market.upgrading_to}</span>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">واجهة عرض بحرية احترافية للسفن الواقعية، الترقية، والتسريع بالـ Gems.</p>
            </div>
            <div className="grid shrink-0 gap-2 text-right">
              <Res icon={iconCoins} label="Coins" value={profile?.coins ?? 0} />
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
                  </div>
                  <span className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-bold text-accent">{selectedShip.rarity}</span>
                </div>

                <div className="relative grid flex-1 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-card/60 px-4 py-6">
                  <div className="absolute bottom-10 left-1/2 h-8 w-3/4 -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
                  <div className="absolute bottom-4 left-1/2 h-6 w-4/5 -translate-x-1/2 rounded-full border border-white/10 bg-white/5" />
                  <img src={selectedShip.image} alt={selectedShip.title} className="animate-[float-up_12s_ease-in-out_infinite] relative z-10 max-h-[320px] w-full object-contain drop-shadow-[0_28px_45px_rgba(0,0,0,0.55)] transition-transform duration-500 hover:scale-[1.03]" width={1280} height={960} />
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
                <img src={iconUpgrade} alt="Upgrade" className="h-9 w-9" width={512} height={512} loading="lazy" />
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
                    <img src={iconGems} alt="Gems" className="h-5 w-5" width={512} height={512} loading="lazy" />
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
            <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">المملوك: {owned.length} سفينة</div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {SHIPS.map((ship) => {
              const locked = ship.marketLevel > marketLevel;
              const count = ownedCount[ship.code] ?? 0;
              const selected = selectedCode === ship.code;
              return (
                <button key={ship.code} onClick={() => setSelectedCode(ship.code)} className={`group rounded-2xl border p-3 text-right transition-all ${selected ? "border-primary bg-primary/10 shadow-[0_0_0_1px_var(--color-primary)]" : "border-border bg-card/70 hover:border-primary/40 hover:bg-card"}`}>
                  <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/20 p-2">
                    <div className="absolute inset-x-6 bottom-2 h-5 rounded-full bg-primary/15 blur-2xl" />
                    <img src={ship.image} alt={ship.title} className="mx-auto h-32 w-full object-contain transition-transform duration-500 group-hover:scale-105" width={1024} height={768} loading="lazy" />
                    <span className="absolute right-2 top-2 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[10px] font-bold text-white/90">Lvl {ship.marketLevel}</span>
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

                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-black">
                      <img src={iconCoins} alt="Coins" className="h-5 w-5" width={512} height={512} loading="lazy" />
                      <span>{ship.price.toLocaleString()}</span>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); buyShip(ship); }} disabled={locked || busy === ship.code || owned.length >= 3} className="rounded-lg bg-primary px-3 py-2 text-xs font-black text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">
                      {locked ? `يتطلب ${ship.marketLevel}` : owned.length >= 3 ? "الأسطول ممتلئ" : busy === ship.code ? "جارٍ الشراء..." : "شراء"}
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
      <BottomNav active="/shop" />
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
        <span className="font-black text-primary">{Math.min(30, level + 1)}</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span>تكلفة Coins</span>
        <span className="font-black">{preview?.cost_coins?.toLocaleString?.() ?? "..."}</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span>المدة</span>
        <span className="font-black">{preview ? formatDuration(preview.seconds) : "..."}</span>
      </div>
      <button onClick={onStart} disabled={busy || level >= 30} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-black text-primary-foreground disabled:opacity-50">
        <img src={iconTimer} alt="Timer" className="h-5 w-5" width={512} height={512} loading="lazy" />
        {level >= 30 ? "وصلت الحد الأقصى" : busy ? "جارٍ البدء..." : "بدء الترقية"}
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
