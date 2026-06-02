import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import piratesBg from "@/assets/pirates-bg.jpg";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useProfile, refreshProfile } from "@/hooks/use-auth";
import { FISH, type Fish as CatalogFish } from "@/lib/fish";
import { fishMarketCapacity } from "@/lib/ships";
import { confirmDialog } from "@/components/ConfirmDialog";
import { CoinIcon } from "@/components/CurrencyIcon";
import { serverNow, serverNowMs } from "@/lib/server-time";
import { sellFish } from "@/lib/economy";

export const Route = createFileRoute("/fish-market")({
  head: () => ({
    meta: [
      { title: "سوق السمك — Ocean Catch" },
      { name: "description", content: "بيع صيدك في سوق السمك بأسعار متغيرة كل ساعة" },
    ],
  }),
  component: FishMarket,
});

type Fish = {
  id: string;
  name: string;
  emoji: string;
  basePrice: number;
  volatility: number; // 0.1 - 0.6
  qty: number;
  color: string;
};

// Tier → color gradient + volatility (higher tier = more volatile / more valuable swings)
const TIER_COLOR: Record<number, string> = {
  1: "from-sky-300 to-sky-500",
  2: "from-emerald-300 to-emerald-600",
  3: "from-indigo-400 to-sky-700",
  4: "from-fuchsia-400 to-purple-700",
  5: "from-amber-400 to-orange-600",
  6: "from-rose-400 to-rose-700",
};
const TIER_VOL: Record<number, number> = { 1: 0.15, 2: 0.22, 3: 0.30, 4: 0.38, 5: 0.45, 6: 0.55 };

function fishMeta(id: string): Omit<Fish, "qty"> | null {
  const f: CatalogFish | undefined = FISH[id];
  if (!f) return null;
  return {
    id: f.id,
    name: f.name,
    emoji: f.emoji,
    basePrice: f.price,
    volatility: TIER_VOL[f.tier] ?? 0.3,
    color: TIER_COLOR[f.tier] ?? "from-sky-400 to-sky-700",
  };
}

const HOURS = ["12", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"];

// Deterministic pseudo-random walk so chart is stable per fish
function priceHistory(fish: Fish): number[] {
  let seed = 0;
  for (const c of fish.id) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return (seed % 10000) / 10000;
  };
  const out: number[] = [];
  let p = fish.basePrice;
  for (let i = 0; i < 12; i++) {
    const delta = (rand() - 0.5) * 2 * fish.volatility * fish.basePrice;
    p = Math.max(fish.basePrice * 0.25, p + delta);
    out.push(Math.round(p * 10) / 10);
  }
  return out;
}

type MarketState = {
  trader_until: string | null;
  freeze_until: string | null;
  freeze_started_at: string | null;
  frozen_prices: Record<string, { current: number; min: number; max: number; forecast: number[] }>;
};

function FishMarket() {
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  const [ageMap, setAgeMap] = useState<Record<string, string>>({});
  const [stockIdsMap, setStockIdsMap] = useState<Record<string, string[]>>({});
  const [priceMap, setPriceMap] = useState<Record<string, { current: number; min: number; max: number }>>({});
  const { user } = useAuth();
  const { profile } = useProfile();
  const coins = profile?.coins ?? 0;
  const gems = profile?.gems ?? 0;
  const rubies = profile?.rubies ?? 0;
  const [selected, setSelected] = useState<string | null>(null);
  const [pop, setPop] = useState<string | null>(null);
  const [lvl, setLvl] = useState<number>(1);
  const [upgradingTo, setUpgradingTo] = useState<number | null>(null);
  const [upgradeEndsAt, setUpgradeEndsAt] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [upPreview, setUpPreview] = useState<{ cost_coins: number; seconds: number } | null>(null);
  const [upBusy, setUpBusy] = useState<null | "start" | "boost">(null);
  const [upToast, setUpToast] = useState<string | null>(null);
  const [selling, setSelling] = useState(false);
  const [marketState, setMarketState] = useState<MarketState>({ trader_until: null, freeze_until: null, freeze_started_at: null, frozen_prices: {} });

  const showUpToast = (m: string) => {
    setUpToast(m);
    window.setTimeout(() => setUpToast(null), 1800);
  };

  const [forecastMap, setForecastMap] = useState<Record<string, number[]>>({});

  const loadMarketState = async () => {
    if (!user) return;
    const { data } = await (supabase as any)
      .from("user_market_state")
      .select("trader_until, freeze_until, freeze_started_at, frozen_prices")
      .eq("user_id", user.id)
      .maybeSingle();
    if (data) {
      setMarketState({
        trader_until: data.trader_until,
        freeze_until: data.freeze_until,
        freeze_started_at: data.freeze_started_at,
        frozen_prices: (data.frozen_prices as MarketState["frozen_prices"]) ?? {},
      });
    } else {
      setMarketState({ trader_until: null, freeze_until: null, freeze_started_at: null, frozen_prices: {} });
    }
  };
  useEffect(() => { loadMarketState(); }, [user?.id]);

  // Load dynamic fish prices from DB + subscribe to hourly updates
  useEffect(() => {
    const loadPrices = async () => {
      const { data } = await (supabase as any)
        .from("fish_market_prices")
        .select("fish_id, current_price, min_price, max_price, forecast");
      const m: Record<string, { current: number; min: number; max: number }> = {};
      const fm: Record<string, number[]> = {};
      for (const row of (data ?? []) as Array<{ fish_id: string; current_price: number; min_price: number; max_price: number; forecast?: unknown }>) {
        m[row.fish_id] = {
          current: Number(row.current_price) || 0,
          min: Number(row.min_price) || 0,
          max: Number(row.max_price) || 0,
        };
        if (Array.isArray(row.forecast)) {
          fm[row.fish_id] = (row.forecast as unknown[])
            .map((v) => Number(v))
            .filter((n) => Number.isFinite(n));
        }
      }
      setPriceMap(m);
      setForecastMap(fm);
    };
    loadPrices();
    const ch = supabase
      .channel("fish_market_prices_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "fish_market_prices" }, () => loadPrices())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Freeze protects freshness/rot only. Market price itself always stays live.
  const freezeActive = !!(marketState.freeze_until && new Date(marketState.freeze_until).getTime() > serverNowMs());
  const traderActiveGlobal = !!(marketState.trader_until && new Date(marketState.trader_until).getTime() > serverNowMs());


  const loadMarket = async () => {
    if (!user) { setLvl(1); setUpgradingTo(null); setUpgradeEndsAt(null); return; }
    await supabase.rpc("finalize_fish_market_upgrades" as never);
    const { data } = await supabase
      .from("user_fish_market" as never)
      .select("level, upgrading_to, upgrade_ends_at")
      .eq("user_id", user.id)
      .maybeSingle();
    const row = (data as { level?: number; upgrading_to?: number | null; upgrade_ends_at?: string | null } | null);
    setLvl(row?.level ?? 1);
    setUpgradingTo(row?.upgrading_to ?? null);
    setUpgradeEndsAt(row?.upgrade_ends_at ?? null);
  };

  useEffect(() => { loadMarket(); }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    supabase.rpc("fish_market_upgrade_cost" as never, { _level: lvl } as never).then(({ data }) => {
      const row = (data as Array<{ cost_coins: number; seconds: number }> | null)?.[0] ?? null;
      setUpPreview(row);
    });
  }, [user?.id, lvl]);

  useEffect(() => {
    if (!upgradeEndsAt) { setSecondsLeft(0); return; }
    const tick = () => {
      const diff = Math.max(0, Math.ceil((new Date(upgradeEndsAt).getTime() - serverNowMs()) / 1000));
      setSecondsLeft(diff);
      if (diff === 0) loadMarket();
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [upgradeEndsAt]);

  const startFishUpgrade = async () => {
    if (!user || upgradingTo) return;
    const ok = await confirmDialog({
      title: "ترقية سوق السمك",
      message: "هل تريد بدء ترقية سوق السمك إلى المستوى التالي؟",
      confirmText: "ترقية",
    });
    if (!ok) return;
    setUpBusy("start");
    const { error } = await supabase.rpc("fish_market_start_upgrade" as never);
    setUpBusy(null);
    if (error) { showUpToast(error.message || "تعذر بدء الترقية"); return; }
    await loadMarket();
    refreshProfile();
    showUpToast("بدأت ترقية سوق السمك");
  };

  const finishFishUpgrade = async () => {
    if (!user || !upgradingTo || secondsLeft <= 0) return;
    const ok = await confirmDialog({
      title: "إنهاء الترقية فورًا",
      message: "هل تريد إنهاء الترقية الآن باستخدام الجواهر؟",
      confirmText: "إنهاء بالجواهر",
    });
    if (!ok) return;
    setUpBusy("boost");
    const { error } = await supabase.rpc("fish_market_finish_upgrade_with_gems" as never);
    setUpBusy(null);
    if (error) { showUpToast(error.message || "تعذر التسريع"); return; }
    await loadMarket();
    refreshProfile();
    showUpToast("تم إنهاء الترقية");
  };

  const accelCost = Math.max(1, Math.ceil(secondsLeft / 60));



  // Load owned fish quantities + ages from the real market stock.
  const loadFish = async () => {
    if (!user) { setQtyMap({}); setAgeMap({}); setStockIdsMap({}); return; }
    const rows: Array<{ id: string; fish_id: string; caught_at: string }> = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("fish_stock")
        .select("id, fish_id, caught_at")
        .eq("user_id", user.id)
        .order("caught_at", { ascending: true })
        .range(from, from + 999);
      if (error) break;
      const batch = (data ?? []) as Array<{ id: string; fish_id: string; caught_at: string }>;
      rows.push(...batch);
      if (batch.length < 1000) break;
    }
    const map: Record<string, number> = {};
    const ages: Record<string, string> = {};
    const ids: Record<string, string[]> = {};
    for (const row of rows) {
      map[row.fish_id] = (map[row.fish_id] ?? 0) + 1;
      (ids[row.fish_id] ??= []).push(row.id);
      if (!ages[row.fish_id] || new Date(row.caught_at) < new Date(ages[row.fish_id])) {
        ages[row.fish_id] = row.caught_at;
      }
    }
    setQtyMap(map);
    setAgeMap(ages);
    setStockIdsMap(ids);
  };
  useEffect(() => {
    loadFish();
    if (!user) return;
    const onFocus = () => loadFish();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const ch = supabase
      .channel(`fish_stock_${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "fish_stock", filter: `user_id=eq.${user.id}` },
        () => loadFish()
      )
      .subscribe();
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      supabase.removeChannel(ch);
    };
  }, [user?.id]);

  // Rot helpers: -1% per hour from oldest catch, floor 50%
  const rotMult = (fishId: string): number => {
    const t = ageMap[fishId];
    if (!t) return 1;
    const caughtAt = new Date(t).getTime();
    const freezeStart = freezeActive && marketState.freeze_started_at ? new Date(marketState.freeze_started_at).getTime() : 0;
    const ageEnd = freezeStart > 0 ? Math.max(caughtAt, freezeStart) : serverNowMs();
    const hours = Math.max(0, (ageEnd - caughtAt) / 3_600_000);
    return Math.max(0.5, 1 - 0.01 * hours);
  };

  // Only show fish the player owns (qty > 0)
  const fish: Fish[] = Object.entries(qtyMap)
    .map(([id, qty]): Fish | null => {
      const meta = fishMeta(id);
      if (!meta) return null;
      const live = priceMap[id]?.current;
      const basePrice = typeof live === "number" && live > 0 ? live : meta.basePrice;
      return { ...meta, basePrice, qty };
    })
    .filter((f): f is Fish => !!f && f.qty > 0)
    .sort((a, b) => b.basePrice - a.basePrice);

  const capUsed = fish.reduce((s, f) => s + f.qty, 0);
  const capMax = fishMarketCapacity(lvl);
  

  const sel = fish.find((f) => f.id === selected) || null;

  useEffect(() => {
    if (selected && (qtyMap[selected] ?? 0) <= 0) setSelected(null);
  }, [selected, qtyMap]);

  const sell = async (amount: number) => {
    if (!sel || !user || selling) return;
    const livePrice = priceMap[sel.id]?.current;
    const rawPrice = typeof livePrice === "number" && livePrice > 0 ? livePrice : priceHistory(sel)[priceHistory(sel).length - 1];
    const price = Math.max(0.1, Math.round(rawPrice * rotMult(sel.id) * 100) / 100);
    const requestedQty = Math.min(amount, sel.qty);
    if (requestedQty <= 0) return;

    const availableIds = stockIdsMap[sel.id] ?? [];
    const fishStockIds = availableIds.slice(0, requestedQty);
    if (fishStockIds.length <= 0) {
      await loadFish();
      setPop("تم تحديث المخزن، حاول البيع مرة ثانية");
      setTimeout(() => setPop(null), 1800);
      return;
    }

    const qty = fishStockIds.length;
    const earned = Math.round(qty * price);
    setSelling(true);

    // Optimistic local update
    setQtyMap((curr) => ({ ...curr, [sel.id]: Math.max(0, (curr[sel.id] ?? 0) - qty) }));
    setStockIdsMap((curr) => ({ ...curr, [sel.id]: (curr[sel.id] ?? []).slice(qty) }));
    setPop(`+${earned.toLocaleString()} ذهب`);
    setTimeout(() => setPop(null), 1500);

    // Atomic server-side sale: deletes rows from fish_stock and credits coins.
    const { data, error } = await sellFish(fishStockIds);
    if (error) {
      // Rollback optimistic update on failure
      setQtyMap((curr) => ({ ...curr, [sel.id]: (curr[sel.id] ?? 0) + qty }));
      setStockIdsMap((curr) => ({ ...curr, [sel.id]: [...fishStockIds, ...(curr[sel.id] ?? [])] }));
      setPop(`❌ ${error.message || "تعذر البيع"}`);
      setTimeout(() => setPop(null), 2500);
      setSelling(false);
      return;
    }
    const serverEarned = Number(data ?? earned);
    setPop(`${qty < requestedQty ? "تم تحديث الكمية • " : ""}+${serverEarned.toLocaleString()} ذهب`);
    setTimeout(() => setPop(null), 1500);
    await loadFish();
    refreshProfile();
    setSelling(false);
  };

  return (
    <div className="fixed inset-0 overflow-hidden text-white" dir="rtl">
      {/* Pirate background */}
      <img
        src={piratesBg}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60" />

      {/* TOP HUD */}
      <div className="absolute top-0 left-0 right-0 z-30 p-2 flex items-center gap-2">
        <Link to="/" className="w-10 h-10 rounded-xl glass-hud border border-accent/40 flex items-center justify-center text-lg active:scale-95">
          ←
        </Link>
        <div className="flex-1 glass-hud rounded-xl px-3 py-1.5 flex items-center justify-around gap-2">
          <ResChip icon="💎" v={gems} color="text-rose-300" />
          <ResChip icon="🔷" v={rubies} color="text-cyan-200" />
          <ResChip icon={<CoinIcon size={16} />} v={coins} color="text-amber-300" />
        </div>
      </div>

      {/* MAIN CONTENT — Storage view */}
      {!sel && (
        <StorageView
          fish={fish}
          capUsed={capUsed}
          capMax={capMax}
          lvl={lvl}
          upgradingTo={upgradingTo}
          secondsLeft={secondsLeft}
          upPreview={upPreview}
          accelCost={accelCost}
          upBusy={upBusy}
          onUpgrade={startFishUpgrade}
          onBoost={finishFishUpgrade}
          onPick={setSelected}
        />
      )}

      {/* MAIN CONTENT — Sell view */}
      {sel && (
        <SellView
          fish={sel}
          userId={user?.id ?? "anon"}
          forecast={forecastMap[sel.id] ?? []}
          freezeActive={freezeActive}
          freezeUntil={marketState.freeze_until}
          traderActive={traderActiveGlobal}
          traderUntil={marketState.trader_until}
          rotPct={Math.round(rotMult(sel.id) * 100)}
          selling={selling}
          onBack={() => setSelected(null)}
          onSell={sell}
          onPurchased={() => { loadMarketState(); refreshProfile(); }}
        />
      )}

      {/* Bottom nav */}
      <BottomNav />

      {upToast && (
        <div className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-xl border border-accent/30 bg-card px-4 py-3 text-sm font-bold text-foreground shadow-2xl">
          {upToast}
        </div>
      )}

      {/* Floating earn popup */}
      {pop && (
        <div
          className="fixed left-1/2 top-1/3 z-50 -translate-x-1/2 text-2xl font-extrabold text-amber-300 text-glow pointer-events-none animate-float-up"
        >
          {pop}
        </div>
      )}
    </div>
  );
}

/* ───────────────── Storage view ───────────────── */

function formatDur(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}س ${m % 60}د`;
  }
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}


function StorageView({
  fish,
  capUsed,
  capMax,
  lvl,
  upgradingTo,
  secondsLeft,
  upPreview,
  accelCost,
  upBusy,
  onUpgrade,
  onBoost,
  onPick,
}: {
  fish: Fish[];
  capUsed: number;
  capMax: number;
  lvl: number;
  upgradingTo: number | null;
  secondsLeft: number;
  upPreview: { cost_coins: number; seconds: number } | null;
  accelCost: number;
  upBusy: null | "start" | "boost";
  onUpgrade: () => void;
  onBoost: () => void;
  onPick: (id: string) => void;
}) {
  const pct = (capUsed / capMax) * 100;
  return (
    <>
      {/* Title banner */}
      <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20">
        <div className="relative px-8 py-1.5 rounded-md bg-gradient-to-b from-sky-500 to-sky-700 border-2 border-cyan-200 shadow-lg">
          <span className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-sky-700 rotate-45 border-l-2 border-b-2 border-cyan-200" />
          <span className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-sky-700 rotate-45 border-r-2 border-t-2 border-cyan-200" />
          <h1 className="relative text-sm font-bold text-glow whitespace-nowrap">
            مخزن السمك lvl {lvl}
          </h1>
        </div>
        <div className="text-center text-white text-xs mt-1 font-bold text-glow">
          <span className="text-amber-200">{capUsed.toLocaleString()}</span>
          <span className="opacity-80">/{capMax.toLocaleString()} السعة</span>
        </div>
      </div>

      {/* Fish storage panel */}
      <div className="absolute top-32 left-2 right-2 bottom-28 z-10 rounded-2xl bg-gradient-to-b from-sky-700/85 to-sky-900/85 border-2 border-cyan-300/70 shadow-2xl p-3 overflow-y-auto">
        {fish.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center text-cyan-100 gap-2">
            <div className="text-5xl opacity-70">🎣</div>
            <div className="text-sm font-bold text-glow">المخزن فارغ</div>
            <div className="text-[11px] opacity-80">اصطد سمك من السفن أولًا ثم بعه هنا</div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3">
          {fish.map((f) => (
            <button
              key={f.id}
              onClick={() => onPick(f.id)}
              className="relative rounded-xl border-2 border-cyan-200/60 bg-gradient-to-b from-sky-300/70 to-sky-600/70 p-2 flex flex-col items-center active:scale-95 transition-transform"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.35), transparent 60%)",
              }}
            >
              {/* tab top */}
              <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 bg-cyan-200 rotate-45 border-r-2 border-b-2 border-cyan-100" />
              <div className="text-[11px] font-extrabold text-rose-200 text-glow mb-1">
                X{f.qty.toLocaleString()}
              </div>
              <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center shadow-inner overflow-hidden`}>
                <img src={FISH[f.id]?.img} alt={f.name} loading="lazy" width={56} height={56} className="max-h-14 max-w-full object-contain drop-shadow" />
              </div>
              <div className="text-[10px] font-bold mt-1 text-white text-glow">
                {f.name}
              </div>
            </button>
          ))}
        </div>

        {/* Capacity meter */}
        <div className="mt-4 px-1">
          <div className="text-[10px] text-cyan-100 mb-1 font-bold">السعة</div>
          <div className="relative h-3 rounded-full bg-black/40 overflow-hidden border border-cyan-300/40">
            <div
              className="h-full bg-gradient-to-r from-emerald-400 to-cyan-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Upgrade footer */}
      <div className="absolute bottom-16 left-2 right-2 z-20 flex items-center gap-3">
        {upgradingTo ? (
          <>
            <div className="flex-1 glass-hud rounded-xl px-3 py-2 flex flex-col gap-0.5">
              <div className="text-[11px] text-cyan-100 font-bold">جارٍ الترقية {lvl} → {upgradingTo}</div>
              <div className="text-amber-300 text-sm font-extrabold tabular-nums">{formatDur(secondsLeft)}</div>
            </div>
            <button
              onClick={onBoost}
              disabled={upBusy === "boost"}
              className="px-5 py-3 rounded-xl bg-gradient-to-b from-rose-300 to-rose-500 border-2 border-rose-200 shadow-lg text-rose-950 font-extrabold active:scale-95 disabled:opacity-50"
            >
              💎 {accelCost}
            </button>
          </>
        ) : (
          <>
            <div className="flex-1 glass-hud rounded-xl px-3 py-2 flex flex-col gap-1">
              <div className="flex items-center gap-1 text-amber-300 text-sm font-bold">
                <CoinIcon size={16} /> <span className="text-rose-300">{(upPreview?.cost_coins ?? 0).toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1 text-cyan-200 text-xs font-bold">
                ⏱ <span>{formatDur(upPreview?.seconds ?? 0)}</span>
              </div>
            </div>
            <button
              onClick={onUpgrade}
              disabled={upBusy === "start" || lvl >= 30}
              className="px-8 py-3 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 border-2 border-amber-200 shadow-lg text-amber-950 font-extrabold active:scale-95 disabled:opacity-50"
            >
              {lvl >= 30 ? "أعلى مستوى" : upBusy === "start" ? "..." : "ترقية"}
            </button>
          </>
        )}
      </div>
    </>
  );
}

/* ───────────────── Sell view ───────────────── */

const PAST_HOURS = 2;
const FUTURE_HOURS = 9;

function forecastPrices(fish: Fish, startPrice: number, bucketSeed: number, hours: number): number[] {
  let seed = bucketSeed >>> 0;
  for (const c of fish.id) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const rand = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed % 10000) / 10000; };
  const out: number[] = [];
  let p = startPrice;
  const minBound = Math.max(0.1, fish.basePrice * 0.25);
  for (let i = 0; i < hours; i++) {
    const delta = (rand() - 0.5) * 2 * fish.volatility * fish.basePrice;
    p = Math.max(minBound, p + delta);
    out.push(Math.round(p * 10) / 10);
  }
  return out;
}

function formatHHMMSS(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${ss}`;
}

function hourLabel(d: Date) {
  let h = d.getHours();
  const ampm = h < 12 ? "am" : "pm";
  h = h % 12; if (h === 0) h = 12;
  return { h: String(h), ampm };
}

function SellView({
  fish, userId, forecast, freezeActive, freezeUntil, traderActive, traderUntil, rotPct, selling, onBack, onSell, onPurchased,
}: {
  fish: Fish;
  userId: string;
  forecast: number[];
  freezeActive: boolean;
  freezeUntil: string | null;
  traderActive: boolean;
  traderUntil: string | null;
  rotPct: number;
  selling: boolean;
  onBack: () => void;
  onSell: (amount: number) => void;
  onPurchased: () => void;
}) {
  void userId;
  const past = useMemo(() => {
    const startBase = fish.basePrice * 0.9;
    const arr = forecastPrices(fish, startBase, 1337, PAST_HOURS);
    arr.push(fish.basePrice);
    return arr;
  }, [fish.id, fish.basePrice]);
  const currentPrice = past[past.length - 1];
  const effectivePrice = Math.max(0.1, Math.round(currentPrice * (rotPct / 100) * 100) / 100);

  const [now, setNow] = useState<number>(() => serverNowMs());
  useEffect(() => {
    const id = window.setInterval(() => setNow(serverNowMs()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const traderMs = traderUntil ? Math.max(0, new Date(traderUntil).getTime() - now) : 0;
  const freezeMs = freezeUntil ? Math.max(0, new Date(freezeUntil).getTime() - now) : 0;

  const future = useMemo(() => {
    if (!traderActive) return [] as number[];
    if (forecast && forecast.length > 0) return forecast.slice(0, FUTURE_HOURS);
    return forecastPrices(fish, currentPrice, 42, FUTURE_HOURS);
  }, [traderActive, fish.id, currentPrice, forecast]);

  const showFuture = traderActive;
  const allPoints = showFuture ? [...past, ...future] : past;
  const minP = Math.min(...allPoints);
  const maxP = Math.max(...allPoints);
  const range = Math.max(0.1, maxP - minP);
  const yLabels = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < 5; i++) out.push(Math.round((minP + (range * (4 - i)) / 4) * 10) / 10);
    return out;
  }, [minP, range]);

  const hourLabels = useMemo(() => {
    const base = serverNow();
    base.setMinutes(0, 0, 0);
    const labels: { h: string; ampm: string }[] = [];
    for (let i = -PAST_HOURS; i <= (showFuture ? FUTURE_HOURS : 0); i++) {
      labels.push(hourLabel(new Date(base.getTime() + i * 3600_000)));
    }
    return labels;
  }, [showFuture, now]);

  const [amount, setAmount] = useState(fish.qty);
  useEffect(() => { setAmount(fish.qty); }, [fish.qty]);

  const [buyOpen, setBuyOpen] = useState<null | "trader" | "freeze">(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const buyTrader = async () => {
    setBusy(true); setErr(null);
    const { error } = await (supabase as any).rpc("buy_trader_unlock");
    setBusy(false);
    if (error) { setErr(error.message || "تعذر الشراء"); return; }
    setBuyOpen(null); onPurchased();
  };
  const buyFreeze = async (hours: number) => {
    setBusy(true); setErr(null);
    const { error } = await (supabase as any).rpc("buy_market_freeze", { _hours: hours });
    setBusy(false);
    if (error) { setErr(error.message || "تعذر الشراء"); return; }
    setBuyOpen(null); onPurchased();
  };

  return (
    <>
      <button onClick={onBack} className="absolute top-2 right-2 z-30 w-10 h-10 rounded-full bg-gradient-to-b from-rose-400 to-rose-600 border-2 border-rose-200 text-white text-lg font-bold flex items-center justify-center shadow-lg active:scale-95">✕</button>

      <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center">
        <div className="relative w-24 h-28 rounded-xl bg-gradient-to-b from-emerald-300 to-emerald-600 border-2 border-emerald-200 shadow-xl p-2 flex flex-col items-center">
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 bg-emerald-200 rotate-45 border-r-2 border-b-2 border-emerald-100" />
          <img src={FISH[fish.id]?.img} alt={fish.name} loading="lazy" width={56} height={56} className="mt-2 h-14 w-14 object-contain drop-shadow" />
          <div className="text-[11px] font-bold text-white text-glow mt-1">{fish.name}</div>
        </div>
      </div>

      {traderActive && (
        <div className="absolute top-[42%] left-3 z-20 rounded-lg bg-black/70 border-2 border-amber-300/70 px-3 py-1.5 text-amber-200 font-extrabold tabular-nums shadow-lg">
          {formatHHMMSS(traderMs)}
        </div>
      )}

      <button
        onClick={() => { if (!traderActive) setBuyOpen("trader"); }}
        disabled={traderActive}
        className={`absolute top-[46%] left-3 z-20 rounded-lg border-2 shadow-lg px-4 py-2 text-center active:scale-95 ${traderActive ? "bg-gradient-to-b from-slate-300 to-slate-500 border-slate-200 opacity-70 cursor-not-allowed" : "bg-gradient-to-b from-emerald-300 to-emerald-500 border-emerald-200"}`}
        style={traderActive ? { marginTop: 36 } : undefined}
      >
        <div className="text-base font-extrabold text-emerald-950">10H</div>
        <div className="text-[10px] font-bold text-emerald-950">{traderActive ? "التاجر يعمل" : "توقع السعر"}</div>
      </button>

      <div className="absolute top-[55%] left-2 right-2 z-20 h-7 rounded-md bg-gradient-to-r from-lime-400 to-emerald-500 border border-lime-200 flex items-center justify-between px-2 shadow">
        <button onClick={() => setBuyOpen("freeze")} className={`text-[10px] font-bold px-2 py-0.5 rounded ${freezeActive ? "bg-cyan-300 text-cyan-950" : "bg-sky-700/70 text-sky-100"}`}>
          {freezeActive ? `🧊 ${formatHHMMSS(freezeMs)}` : "تجميد"}
        </button>
        <div className="text-xs font-bold text-white text-glow">الجودة: {rotPct}%</div>
        <span className="w-5 h-5 rounded-full bg-white/90 text-sky-700 text-xs font-bold flex items-center justify-center">i</span>
      </div>

      <div className="absolute top-[60%] left-2 right-2 z-10 bottom-32 rounded-xl bg-gradient-to-b from-amber-100 to-amber-200 border-4 border-amber-700/70 shadow-2xl p-2">
        <PriceChart past={past} future={future} hourLabels={hourLabels} yLabels={yLabels} minP={minP} range={range} currentPrice={currentPrice} traderActive={showFuture} />
      </div>

      <div className="absolute bottom-16 left-2 right-2 z-20 flex flex-col gap-1.5">
        <div className="text-center text-white text-sm font-bold text-glow" dir="rtl">
          السعر بعد التعفّن: <span className="text-amber-300">{effectivePrice}</span>
          {rotPct < 100 && <span className="text-rose-300 text-[10px] mr-2">(من {currentPrice})</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white text-sm font-bold text-glow tabular-nums">{amount.toLocaleString()}/{fish.qty.toLocaleString()}</span>
          <input type="range" min={0} max={fish.qty} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="flex-1 accent-amber-400 h-2" />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-amber-300 font-bold">
            <CoinIcon size={16} /> <span className="text-emerald-300 text-sm">{Math.round(amount * effectivePrice).toLocaleString()}</span>
          </div>
          <button onClick={() => onSell(amount)} disabled={amount === 0 || selling} className="px-8 py-2 rounded-lg bg-gradient-to-b from-amber-300 to-amber-500 border-2 border-amber-200 shadow-lg text-amber-950 font-extrabold active:scale-95 disabled:opacity-50">{selling ? "..." : "بيع"}</button>
        </div>
      </div>

      {buyOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => !busy && setBuyOpen(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-gradient-to-b from-slate-800 to-slate-900 border-2 border-amber-300/60 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {buyOpen === "trader" ? (
              <>
                <div className="text-center text-amber-300 text-lg font-extrabold mb-1">🧑‍💼 التاجر</div>
                <div className="text-center text-xs text-slate-200 mb-3">يكشف لك توقّعات الأسعار لكامل السوق لمدة <b>10 ساعات</b> بدقة 100%.</div>
                <button onClick={buyTrader} disabled={busy} className="w-full py-3 rounded-xl bg-gradient-to-b from-rose-300 to-rose-500 border-2 border-rose-200 text-rose-950 font-extrabold disabled:opacity-50">
                  {busy ? "..." : "اشترِ الآن 💎 250"}
                </button>
              </>
            ) : (
              <>
                <div className="text-center text-cyan-200 text-lg font-extrabold mb-1">🧊 طاقم تجميد التعفّن</div>
                <div className="text-center text-xs text-slate-200 mb-3">يوقف نقص جودة السمك بسبب التعفّن للمدة المختارة، والسعر يبقى يتغير طبيعي.</div>
                <div className="grid grid-cols-3 gap-2">
                  {[{ h: 2, p: 50 }, { h: 9, p: 100 }, { h: 24, p: 150 }].map((o) => (
                    <button key={o.h} onClick={() => buyFreeze(o.h)} disabled={busy || freezeActive} className="py-3 rounded-xl bg-gradient-to-b from-cyan-300 to-cyan-500 border-2 border-cyan-200 text-cyan-950 font-extrabold disabled:opacity-50">
                      <div className="text-sm">{o.h}س</div>
                      <div className="text-[11px]">💎 {o.p}</div>
                    </button>
                  ))}
                </div>
                {freezeActive && <div className="text-center text-[11px] text-cyan-200 mt-2">التجميد فعّال — انتظر انتهاءه</div>}
              </>
            )}
            {err && <div className="mt-3 text-center text-xs text-rose-300 font-bold">{err}</div>}
            <button onClick={() => setBuyOpen(null)} disabled={busy} className="mt-3 w-full text-xs text-slate-300 underline">إلغاء</button>
          </div>
        </div>
      )}
    </>
  );
}


function PriceChart({
  past, future, hourLabels, yLabels, minP, range, currentPrice, traderActive,
}: {
  past: number[];
  future: number[];
  hourLabels: { h: string; ampm: string }[];
  yLabels: number[];
  minP: number;
  range: number;
  currentPrice: number;
  traderActive: boolean;
}) {
  const W = 320, H = 160, PAD_L = 36, PAD_R = 12, PAD_T = 14, PAD_B = 22;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const totalPts = past.length + future.length;
  const xAt = (i: number) => PAD_L + (i / Math.max(1, totalPts - 1)) * innerW;
  const yAt = (v: number) => PAD_T + innerH - ((v - minP) / range) * innerH;

  const pastPts = past.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");
  const futureStartIdx = past.length - 1; // anchor at current point
  const futurePts = future.length
    ? [`${xAt(futureStartIdx)},${yAt(currentPrice)}`, ...future.map((v, i) => `${xAt(futureStartIdx + 1 + i)},${yAt(v)}`)].join(" ")
    : "";

  const currentX = xAt(futureStartIdx);
  const currentY = yAt(currentPrice);

  return (
    <div className="w-full h-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
        {yLabels.map((v, i) => {
          const y = PAD_T + (i * innerH) / (yLabels.length - 1);
          return (
            <g key={i}>
              <text x={4} y={y + 3} fontSize="9" fill="#7a4a18" fontWeight="bold">{v}$</text>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#c89860" strokeWidth="0.4" strokeDasharray="2,2" opacity="0.4" />
            </g>
          );
        })}

        {/* Past line (red) */}
        <polyline points={pastPts} fill="none" stroke="#ee4f2e" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />

        {/* Future line (blue) when trader is active */}
        {traderActive && futurePts && (
          <>
            <polyline points={futurePts} fill="none" stroke="#3b82f6" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
            <line x1={currentX} y1={PAD_T} x2={currentX} y2={H - PAD_B} stroke="#6b7280" strokeWidth="0.6" />
            <text x={W - PAD_R} y={PAD_T - 2} fontSize="9" fill="#2563eb" fontWeight="bold" textAnchor="end">السعر المستقبلي</text>
          </>
        )}

        {/* Current price marker */}
        <circle cx={currentX} cy={currentY} r="4" fill="#4ade80" stroke="#fff" strokeWidth="1.2" />
        <text x={currentX - 18} y={currentY - 8} fontSize="10" fill="#7a4a18" fontWeight="bold">{currentPrice}</text>

        {/* X-axis hour labels */}
        {hourLabels.map((lab, i) => (
          <g key={i}>
            <text x={xAt(i)} y={H - 8} fontSize="8" fill="#7a4a18" fontWeight="bold" textAnchor="middle">{lab.h}</text>
            <text x={xAt(i)} y={H - 1} fontSize="7" fill="#7a4a18" textAnchor="middle">{lab.ampm}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ───────────────── Shared ───────────────── */

function ResChip({ icon, v, color }: { icon: ReactNode; v: number; color: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-base inline-flex items-center">{icon}</span>
      <span className={`text-[11px] font-bold tabular-nums ${color}`}>{v.toLocaleString()}</span>
    </div>
  );
}

function BottomNav() {
  const items = [
    { e: "✉️", l: "البريد" },
    { e: "🏛️", l: "المتجر" },
    { e: "⚔️", l: "القبائل" },
    { e: "🎉", l: "الفعاليات" },
    { e: "📜", l: "المهام" },
  ];
  return (
    <div className="absolute bottom-0 left-0 right-0 z-30 glass-hud border-t border-accent/30 px-2 py-1.5 flex items-center justify-around">
      {items.map((it, i) => (
        <button key={i} className="flex flex-col items-center gap-0.5 px-2 active:scale-95">
          <div className="w-8 h-8 rounded-full bg-gradient-to-b from-amber-700/80 to-amber-900/80 border border-accent/60 flex items-center justify-center text-sm">
            {it.e}
          </div>
          <span className="text-[8px] text-accent/90 font-medium">{it.l}</span>
        </button>
      ))}
    </div>
  );
}
