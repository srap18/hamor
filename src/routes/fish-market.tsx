import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import piratesBg from "@/assets/pirates-bg.jpg";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useProfile, refreshProfile } from "@/hooks/use-auth";
import { FISH, type Fish as CatalogFish } from "@/lib/fish";
import { fishMarketCapacity } from "@/lib/ships";

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

  // Only show fish the player owns (qty > 0)
  const fish: Fish[] = Object.entries(qtyMap)
    .map(([id, qty]): Fish | null => {
      const meta = fishMeta(id);
      return meta ? { ...meta, qty } : null;
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
    const history = priceHistory(sel);
    const price = history[history.length - 1];
    const qty = Math.min(amount, sel.qty);
    if (qty <= 0) return;
    const earned = Math.round(qty * price);

    // Optimistic local update
    setQtyMap((curr) => ({ ...curr, [sel.id]: Math.max(0, (curr[sel.id] ?? 0) - qty) }));
    setPop(`+${earned.toLocaleString()} 🪙`);
    setTimeout(() => setPop(null), 1500);

    // Persist: decrement fish_caught + add coins to profile
    const remaining = Math.max(0, (qtyMap[sel.id] ?? 0) - qty);
    if (remaining > 0) {
      await supabase
        .from("fish_caught")
        .update({ quantity: remaining, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("fish_id", sel.id);
    } else {
      await supabase
        .from("fish_caught")
        .delete()
        .eq("user_id", user.id)
        .eq("fish_id", sel.id);
    }
    // Re-read coins from DB to avoid overwriting concurrent updates
    const { data: freshProfile } = await supabase
      .from("profiles")
      .select("coins")
      .eq("id", user.id)
      .maybeSingle();
    const baseCoins = freshProfile?.coins ?? coins;
    await supabase
      .from("profiles")
      .update({ coins: baseCoins + earned })
      .eq("id", user.id);
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
          <ResChip icon="🪙" v={coins} color="text-amber-300" />
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
                🪙 <span className="text-rose-300">{(upPreview?.cost_coins ?? 0).toLocaleString()}</span>
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

function SellView({
  fish,
  onBack,
  onSell,
}: {
  fish: Fish;
  onBack: () => void;
  onSell: (amount: number) => void;
}) {
  const history = useMemo(() => priceHistory(fish), [fish.id]);
  const currentPrice = history[history.length - 1];
  const minP = Math.min(...history);
  const maxP = Math.max(...history);
  const range = Math.max(0.1, maxP - minP);
  const yLabels = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < 5; i++) {
      out.push(Math.round((minP + (range * (4 - i)) / 4) * 10) / 10);
    }
    return out;
  }, [minP, range]);

  const [amount, setAmount] = useState(fish.qty);
  useEffect(() => {
    setAmount(fish.qty);
  }, [fish.qty]);

  return (
    <>
      {/* Close button */}
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

      {/* Predict price button */}
      <button className="absolute top-[46%] left-3 z-20 rounded-lg bg-gradient-to-b from-emerald-300 to-emerald-500 border-2 border-emerald-200 shadow-lg px-4 py-2 text-center active:scale-95">
        <div className="text-base font-extrabold text-emerald-950">10H</div>
        <div className="text-[10px] font-bold text-emerald-950">توقع السعر</div>
      </button>

      {/* Quality + freeze bar */}
      <div className="absolute top-[55%] left-2 right-2 z-20 h-7 rounded-md bg-gradient-to-r from-lime-400 to-emerald-500 border border-lime-200 flex items-center justify-between px-2 shadow">
        <button className="text-[10px] font-bold text-sky-100 bg-sky-700/70 px-2 py-0.5 rounded">
          تجميد
        </button>
        <div className="text-xs font-bold text-white text-glow">الجودة: 100%</div>
        <button className="w-5 h-5 rounded-full bg-white/90 text-sky-700 text-xs font-bold flex items-center justify-center">
          i
        </button>
      </div>

      {/* Price chart panel */}
      <div className="absolute top-[60%] left-2 right-2 z-10 bottom-32 rounded-xl bg-gradient-to-b from-amber-100 to-amber-200 border-4 border-amber-700/70 shadow-2xl p-2">
        <PriceChart history={history} yLabels={yLabels} minP={minP} range={range} currentPrice={currentPrice} />
      </div>

      {/* Current price + capacity + sell */}
      <div className="absolute bottom-16 left-2 right-2 z-20 flex flex-col gap-1.5">
        <div className="text-center text-white text-sm font-bold text-glow" dir="rtl">
          السعر الحالي : <span className="text-amber-300">{currentPrice}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white text-sm font-bold text-glow tabular-nums">
            {amount.toLocaleString()}/{fish.qty.toLocaleString()}
          </span>
          <input
            type="range"
            min={0}
            max={fish.qty}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="flex-1 accent-amber-400 h-2"
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-amber-300 font-bold">
            🪙 <span className="text-emerald-300 text-sm">{Math.round(amount * currentPrice).toLocaleString()}</span>
          </div>
          <button
            onClick={() => onSell(amount)}
            disabled={amount === 0}
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
  history,
  yLabels,
  minP,
  range,
  currentPrice,
}: {
  history: number[];
  yLabels: number[];
  minP: number;
  range: number;
  currentPrice: number;
}) {
  // SVG viewport
  const W = 320;
  const H = 160;
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 10;
  const PAD_B = 22;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const xAt = (i: number) => PAD_L + (i / (history.length - 1)) * innerW;
  const yAt = (v: number) => PAD_T + innerH - ((v - minP) / range) * innerH;

  const pts = history.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");
  const lastX = xAt(history.length - 1);
  const lastY = yAt(currentPrice);

  return (
    <div className="w-full h-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
        {/* Y-axis labels */}
        {yLabels.map((v, i) => {
          const y = PAD_T + (i * innerH) / (yLabels.length - 1);
          return (
            <g key={i}>
              <text x={4} y={y + 3} fontSize="9" fill="#7a4a18" fontWeight="bold">
                {v}$
              </text>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#c89860" strokeWidth="0.4" strokeDasharray="2,2" opacity="0.4" />
            </g>
          );
        })}

        {/* Line */}
        <polyline
          points={pts}
          fill="none"
          stroke="#ee4f2e"
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Current price marker */}
        <circle cx={lastX} cy={lastY} r="4" fill="#4ade80" stroke="#fff" strokeWidth="1.2" />
        <text x={lastX - 18} y={lastY - 8} fontSize="10" fill="#7a4a18" fontWeight="bold">
          {currentPrice}
        </text>

        {/* X-axis labels */}
        {HOURS.map((h, i) => (
          <text
            key={i}
            x={xAt(i)}
            y={H - 8}
            fontSize="8"
            fill="#7a4a18"
            fontWeight="bold"
            textAnchor="middle"
          >
            {h}
          </text>
        ))}
        {HOURS.map((_, i) => (
          <text
            key={`m${i}`}
            x={xAt(i)}
            y={H - 1}
            fontSize="7"
            fill="#7a4a18"
            textAnchor="middle"
          >
            am
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ───────────────── Shared ───────────────── */

function ResChip({ icon, v, color }: { icon: string; v: number; color: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-base">{icon}</span>
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
