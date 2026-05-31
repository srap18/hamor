import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import piratesBg from "@/assets/pirates-bg.jpg";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useProfile, refreshProfile } from "@/hooks/use-auth";
import { FISH, type Fish as CatalogFish } from "@/lib/fish";
import { fishMarketCapacity } from "@/lib/ships";
import { confirmDialog } from "@/components/ConfirmDialog";
import { CoinIcon } from "@/components/CurrencyIcon";

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

function FishMarket() {
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
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

  const showUpToast = (m: string) => {
    setUpToast(m);
    window.setTimeout(() => setUpToast(null), 1800);
  };

  const [forecastMap, setForecastMap] = useState<Record<string, number[]>>({});

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
      const diff = Math.max(0, Math.ceil((new Date(upgradeEndsAt).getTime() - Date.now()) / 1000));
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


  // Load owned fish quantities from DB (only fish the player actually has)
  const loadFish = async () => {
    if (!user) { setQtyMap({}); return; }
    const { data } = await supabase
      .from("fish_caught")
      .select("fish_id, quantity")
      .eq("user_id", user.id);
    const map: Record<string, number> = {};
    for (const row of data ?? []) {
      map[row.fish_id] = (map[row.fish_id] ?? 0) + (row.quantity ?? 0);
    }
    setQtyMap(map);
  };
  useEffect(() => {
    loadFish();
    if (!user) return;
    // Refresh whenever the tab regains focus / becomes visible
    const onFocus = () => loadFish();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    // Realtime: any change to this user's fish_caught rows → reload
    const ch = supabase
      .channel(`fish_caught_${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "fish_caught", filter: `user_id=eq.${user.id}` },
        () => loadFish()
      )
      .subscribe();
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      supabase.removeChannel(ch);
    };
  }, [user?.id]);

  // Only show fish the player owns (qty > 0). basePrice is overridden by the
  // live hourly price from the DB when available.
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

  // Auto-exit sell view if the fish ran out
  useEffect(() => {
    if (selected && (qtyMap[selected] ?? 0) <= 0) setSelected(null);
  }, [selected, qtyMap]);

  const sell = async (amount: number) => {
    if (!sel || !user) return;
    // Use live DB price when available; fall back to local history
    const livePrice = priceMap[sel.id]?.current;
    const price = typeof livePrice === "number" && livePrice > 0
      ? livePrice
      : priceHistory(sel)[priceHistory(sel).length - 1];
    const qty = Math.min(amount, sel.qty);
    if (qty <= 0) return;
    const earned = Math.round(qty * price);

    // Optimistic local update
    setQtyMap((curr) => ({ ...curr, [sel.id]: Math.max(0, (curr[sel.id] ?? 0) - qty) }));
    setPop(`+${earned.toLocaleString()} 🪙`);
    setTimeout(() => setPop(null), 1500);

    // Atomic server-side sale: decrements fish_caught and credits coins
    // in one transaction so concurrent clicks can't race and "return" fish.
    const { error } = await (supabase as any).rpc("sell_fish_caught", {
      _fish_id: sel.id,
      _qty: qty,
      _unit_price: price,
    });
    if (error) {
      // Rollback optimistic update on failure
      setQtyMap((curr) => ({ ...curr, [sel.id]: (curr[sel.id] ?? 0) + qty }));
      setPop(`❌ ${error.message || "تعذر البيع"}`);
      setTimeout(() => setPop(null), 2500);
      return;
    }
    loadFish();
    refreshProfile();
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
          onBack={() => setSelected(null)}
          onSell={sell}
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

const TRADER_DURATION_MS = 9 * 60 * 60 * 1000;
const PAST_HOURS = 2; // past + current shown in red
const FUTURE_HOURS = 9; // future shown in blue when trader is active

function traderKey(userId: string) {
  return `trader_active_until_${userId}`;
}

function getTraderEndsAt(userId: string): number {
  try {
    const v = localStorage.getItem(traderKey(userId));
    if (!v) return 0;
    const t = parseInt(v, 10);
    return Number.isFinite(t) && t > Date.now() ? t : 0;
  } catch {
    return 0;
  }
}

function activateTrader(userId: string): number {
  const ends = Date.now() + TRADER_DURATION_MS;
  try { localStorage.setItem(traderKey(userId), String(ends)); } catch {}
  return ends;
}

// Deterministic forecast seeded by fish + activation bucket so it doesn't change between renders
function forecastPrices(fish: Fish, startPrice: number, bucketSeed: number, hours: number): number[] {
  let seed = bucketSeed >>> 0;
  for (const c of fish.id) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return (seed % 10000) / 10000;
  };
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
  h = h % 12;
  if (h === 0) h = 12;
  return { h: String(h), ampm };
}

function SellView({
  fish,
  userId,
  forecast,
  onBack,
  onSell,
}: {
  fish: Fish;
  userId: string;
  forecast: number[];
  onBack: () => void;
  onSell: (amount: number) => void;
}) {
  // Past series (red) — deterministic walk landing on the current live price
  const past = useMemo(() => {
    const startBase = fish.basePrice * 0.9;
    const arr = forecastPrices(fish, startBase, 1337, PAST_HOURS);
    arr.push(fish.basePrice); // ends at current price
    return arr;
  }, [fish.id, fish.basePrice]);
  const currentPrice = past[past.length - 1];

  // Trader countdown
  const [traderEndsAt, setTraderEndsAt] = useState<number>(() => getTraderEndsAt(userId));
  const [now, setNow] = useState<number>(() => Date.now());
  const [traderError, setTraderError] = useState<string | null>(null);
  const traderActive = traderEndsAt > now;
  const msLeft = Math.max(0, traderEndsAt - now);

  useEffect(() => {
    if (!traderActive) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [traderActive]);

  // Auto-activate the 9H forecast when the user has an active assigned "trader" crew
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("inventory")
        .select("meta")
        .eq("user_id", userId)
        .eq("item_type", "crew")
        .eq("item_id", "trader");
      if (cancelled || !data) return;
      let best = 0;
      for (const r of data as any[]) {
        const exp = r?.meta?.expires_at;
        const assigned = r?.meta?.assigned_ship_id;
        if (!assigned || !exp) continue;
        const t = new Date(exp).getTime();
        if (t > Date.now() && t > best) best = t;
      }
      if (best > 0) {
        setTraderEndsAt((prev) => Math.max(prev, best));
        try { localStorage.setItem(traderKey(userId), String(best)); } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Forecast (blue) — comes from the DB so the predictions actually
  // materialize when the hour ticks over.
  const future = useMemo(() => {
    if (!traderActive) return [] as number[];
    if (forecast && forecast.length > 0) return forecast.slice(0, FUTURE_HOURS);
    const bucket = Math.floor(traderEndsAt / (60 * 1000));
    return forecastPrices(fish, currentPrice, bucket, FUTURE_HOURS);
  }, [traderActive, traderEndsAt, fish.id, currentPrice, forecast]);

  const allPoints = traderActive ? [...past, ...future] : past;
  const minP = Math.min(...allPoints);
  const maxP = Math.max(...allPoints);
  const range = Math.max(0.1, maxP - minP);
  const yLabels = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < 5; i++) out.push(Math.round((minP + (range * (4 - i)) / 4) * 10) / 10);
    return out;
  }, [minP, range]);

  // Hour labels: past hours (now-PAST_HOURS … now) + future hours (now+1 … now+FUTURE_HOURS)
  const hourLabels = useMemo(() => {
    const base = new Date();
    base.setMinutes(0, 0, 0);
    const labels: { h: string; ampm: string }[] = [];
    for (let i = -PAST_HOURS; i <= (traderActive ? FUTURE_HOURS : 0); i++) {
      const d = new Date(base.getTime() + i * 60 * 60 * 1000);
      labels.push(hourLabel(d));
    }
    return labels;
  }, [traderActive, now]);

  const [amount, setAmount] = useState(fish.qty);
  useEffect(() => { setAmount(fish.qty); }, [fish.qty]);

  const handleTrader = async () => {
    if (traderActive) return;
    setTraderError(null);
    // Verify the player actually owns and has assigned an active "trader" crew
    const { data } = await (supabase as any)
      .from("inventory")
      .select("meta")
      .eq("user_id", userId)
      .eq("item_type", "crew")
      .eq("item_id", "trader");
    let best = 0;
    for (const r of (data ?? []) as any[]) {
      const exp = r?.meta?.expires_at;
      const assigned = r?.meta?.assigned_ship_id;
      if (!assigned || !exp) continue;
      const t = new Date(exp).getTime();
      if (t > Date.now() && t > best) best = t;
    }
    if (best <= 0) {
      setTraderError("تحتاج إلى تعيين تاجر فعّال على إحدى السفن لتفعيل التوقعات");
      window.setTimeout(() => setTraderError(null), 3500);
      return;
    }
    const ends = Math.max(best, activateTrader(userId));
    try { localStorage.setItem(traderKey(userId), String(ends)); } catch {}
    setTraderEndsAt(ends);
    setNow(Date.now());
  };

  return (
    <>
      <button
        onClick={onBack}
        className="absolute top-2 right-2 z-30 w-10 h-10 rounded-full bg-gradient-to-b from-rose-400 to-rose-600 border-2 border-rose-200 text-white text-lg font-bold flex items-center justify-center shadow-lg active:scale-95"
      >
        ✕
      </button>

      {/* Fish header card */}
      <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center">
        <div className="relative w-24 h-28 rounded-xl bg-gradient-to-b from-emerald-300 to-emerald-600 border-2 border-emerald-200 shadow-xl p-2 flex flex-col items-center">
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 bg-emerald-200 rotate-45 border-r-2 border-b-2 border-emerald-100" />
          <img src={FISH[fish.id]?.img} alt={fish.name} loading="lazy" width={56} height={56} className="mt-2 h-14 w-14 object-contain drop-shadow" />
          <div className="text-[11px] font-bold text-white text-glow mt-1">{fish.name}</div>
        </div>
      </div>

      {/* Trader countdown timer (visible while active) */}
      {traderActive && (
        <div className="absolute top-[42%] left-3 z-20 rounded-lg bg-black/70 border-2 border-amber-300/70 px-3 py-1.5 text-amber-200 font-extrabold tabular-nums shadow-lg">
          {formatHHMMSS(msLeft)}
        </div>
      )}

      {/* Predict price button — activates the Trader for 9h */}
      <button
        onClick={handleTrader}
        disabled={traderActive}
        className={`absolute top-[46%] left-3 z-20 rounded-lg border-2 shadow-lg px-4 py-2 text-center active:scale-95 ${traderActive ? "bg-gradient-to-b from-slate-300 to-slate-500 border-slate-200 opacity-70 cursor-not-allowed" : "bg-gradient-to-b from-emerald-300 to-emerald-500 border-emerald-200"}`}
        style={traderActive ? { marginTop: 36 } : undefined}
      >
        <div className="text-base font-extrabold text-emerald-950">9H</div>
        <div className="text-[10px] font-bold text-emerald-950">{traderActive ? "التاجر يعمل" : "توقع السعر"}</div>
      </button>

      {traderError && (
        <div className="absolute top-[52%] left-3 right-3 z-30 rounded-lg bg-rose-900/90 border-2 border-rose-300 px-3 py-2 text-rose-100 text-xs font-bold shadow-lg text-center">
          {traderError}
        </div>
      )}

      {/* Quality + freeze bar */}
      <div className="absolute top-[55%] left-2 right-2 z-20 h-7 rounded-md bg-gradient-to-r from-lime-400 to-emerald-500 border border-lime-200 flex items-center justify-between px-2 shadow">
        <button className="text-[10px] font-bold text-sky-100 bg-sky-700/70 px-2 py-0.5 rounded">تجميد</button>
        <div className="text-xs font-bold text-white text-glow">الجودة: 100%</div>
        <button className="w-5 h-5 rounded-full bg-white/90 text-sky-700 text-xs font-bold flex items-center justify-center">i</button>
      </div>

      {/* Price chart */}
      <div className="absolute top-[60%] left-2 right-2 z-10 bottom-32 rounded-xl bg-gradient-to-b from-amber-100 to-amber-200 border-4 border-amber-700/70 shadow-2xl p-2">
        <PriceChart
          past={past}
          future={future}
          hourLabels={hourLabels}
          yLabels={yLabels}
          minP={minP}
          range={range}
          currentPrice={currentPrice}
          traderActive={traderActive}
        />
      </div>

      <div className="absolute bottom-16 left-2 right-2 z-20 flex flex-col gap-1.5">
        <div className="text-center text-white text-sm font-bold text-glow" dir="rtl">
          السعر الحالي : <span className="text-amber-300">{currentPrice}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white text-sm font-bold text-glow tabular-nums">
            {amount.toLocaleString()}/{fish.qty.toLocaleString()}
          </span>
          <input
            type="range" min={0} max={fish.qty} value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="flex-1 accent-amber-400 h-2"
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-amber-300 font-bold">
            <CoinIcon size={16} /> <span className="text-emerald-300 text-sm">{Math.round(amount * currentPrice).toLocaleString()}</span>
          </div>
          <button
            onClick={() => onSell(amount)} disabled={amount === 0}
            className="px-8 py-2 rounded-lg bg-gradient-to-b from-amber-300 to-amber-500 border-2 border-amber-200 shadow-lg text-amber-950 font-extrabold active:scale-95 disabled:opacity-50"
          >
            بيع
          </button>
        </div>
      </div>
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
