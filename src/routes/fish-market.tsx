import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import piratesBg from "@/assets/pirates-bg.jpg";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useProfile, refreshProfile, applyOptimisticProfileDelta } from "@/hooks/use-auth";
import { FISH, type Fish as CatalogFish } from "@/lib/fish";
import { fishMarketCapacity } from "@/lib/ships";
import { confirmDialog } from "@/components/ConfirmDialog";
import { CoinIcon } from "@/components/CurrencyIcon";
import { serverNow, serverNowMs, syncServerTime } from "@/lib/server-time";
import { useServerTick } from "@/lib/use-server-tick";
import { getCached, setCached } from "@/lib/swr-cache";
import tier1Asset from "@/assets/sell-results/tier1_yaes.png.asset.json";
import tier2Asset from "@/assets/sell-results/tier2_khaser.png.asset.json";
import tier3Asset from "@/assets/sell-results/tier3_motad.png.asset.json";
import tier4Asset from "@/assets/sell-results/tier4_rae3.png.asset.json";
import tier5Asset from "@/assets/sell-results/tier5_momtaz.png.asset.json";

type SellResult = {
  tier: 1 | 2 | 3 | 4 | 5;
  gross: number;
  rotLoss: number;
  net: number;
  fishName: string;
  marketExpertBoost?: { basePrice: number; boostedPrice: number; qty: number } | null;
};

const TIER_INFO: Record<1|2|3|4|5, { img: string; label: string; stars: number; text: string }> = {
  1: { img: tier1Asset.url, label: "يائس", stars: 1, text: "أنت تاجر سمك سيء، كنت تقوم ببيع السمك عندما تكون الأسعار في أدنى مستوياتها، وأسماكك فاسدة في ذات الوقت." },
  2: { img: tier2Asset.url, label: "خاسر", stars: 1, text: "أسماكك طازجة ولكنك قمت ببيعها بسعر أقل، حاول تحسين هامش الربح في المرات القادمة وبيع أسماكك بأعلى الأسعار." },
  3: { img: tier3Asset.url, label: "كالمعتاد", stars: 2, text: "لقد بعت سمكك بسعر متوسط، لحسن حظك أن سمكك مازال طازجاً، مازال لديك فرصة في الحصول على أرباح قليلة." },
  4: { img: tier4Asset.url, label: "عمل رائع", stars: 3, text: "لقد بعت سمكك بسعر ممتاز، أسماكك طازجة وحصلت على أرباح ممتازة في هذه الصفقة." },
  5: { img: tier5Asset.url, label: "ممتاز", stars: 3, text: "تهانينا! لديك فرصة للحصول على أفضل الصفقات بما أن سمكك من النوع الممتاز والمرغوب في السوق، قد تتمكن من الحصول على صافي أرباح قد تصل إلى 500% في هذه المرحلة." },
};

function computeTier(opts: { marketRank: number; rotMult: number }): 1|2|3|4|5 {
  // marketRank = (currentPrice - minRecent) / (maxRecent - minRecent) ∈ [0,1]
  // rotMult = fish freshness 0..1
  const { marketRank, rotMult } = opts;
  // Very rotten → يائس regardless of price
  if (rotMult < 0.6) return 1;
  // Top of recent price window + fresh → ممتاز
  if (marketRank >= 0.85 && rotMult >= 0.85) return 5;
  // Upper third, decent quality → عمل رائع
  if (marketRank >= 0.6 && rotMult >= 0.8) return 4;
  // Mid range → كالمعتاد
  if (marketRank >= 0.35) return 3;
  // Near the bottom of the window → خاسر
  return 2;
}


export const Route = createFileRoute("/fish-market")({
  head: () => ({
    meta: [
      { title: "سوق السمك — ملوك القراصنة (هامور شابك)" },
      { name: "description", content: "بِع صيدك في سوق السمك الحي بأسعار متغيرة كل ساعة — لعبة ملوك القراصنة (هامور شابك)." },
      { property: "og:title", content: "سوق السمك — ملوك القراصنة" },
      { property: "og:description", content: "أسعار سمك متغيرة كل ساعة في لعبة ملوك القراصنة (هامور شابك)." },
      { property: "og:url", content: "https://www.molok-alqarasna.com/fish-market" },
    ],
    links: [{ rel: "canonical", href: "https://www.molok-alqarasna.com/fish-market" }],
  }),
  component: FishMarket,
});

type Fish = {
  id: string;
  name: string;
  emoji: string;
  basePrice: number;
  minPrice: number;
  maxPrice: number;
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
    minPrice: Math.max(0.0001, f.price * 0.25),
    maxPrice: Math.max(0.0001, f.price * 1.75),
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
  rot_freeze_offset_seconds: number;
  frozen_prices: Record<string, { current: number; min: number; max: number; forecast: number[] }>;
};

type TraderCache = { until: string | null; active: boolean; owned: number };
type PriceCache = {
  prices: Record<string, { current: number; min: number; max: number }>;
  forecast: Record<string, number[]>;
  history: Record<string, number[]>;
};
type FishMarketLevelCache = { level: number; upgradingTo: number | null; upgradeEndsAt: string | null };
type FishStockCache = { qty: Record<string, number>; ages: Record<string, string> };
type SaleQuote = { sold: number; total_amount: number; effective_unit_price: number; current_price: number; rot: number };
const FISH_MARKET_CLIENT_VERSION = "fish-market-v20260626-force-update-1";

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
  const [sellResult, setSellResult] = useState<SellResult | null>(null);
  const [marketState, setMarketState] = useState<MarketState>({ trader_until: null, freeze_until: null, freeze_started_at: null, rot_freeze_offset_seconds: 0, frozen_prices: {} });

  const showUpToast = (m: string) => {
    setUpToast(m);
    window.setTimeout(() => setUpToast(null), 1800);
  };

  const [forecastMap, setForecastMap] = useState<Record<string, number[]>>({});
  const [historyMap, setHistoryMap] = useState<Record<string, number[]>>({});

  const loadMarketState = async () => {
    if (!user) return;
    const cacheKey = `fish-market:state:${user.id}`;
    const { data } = await (supabase as any)
      .from("user_market_state")
      .select("trader_until, freeze_until, freeze_started_at, rot_freeze_offset_seconds, frozen_prices")
      .eq("user_id", user.id)
      .maybeSingle();
    let nextState: MarketState;
    if (data) {
      nextState = {
        trader_until: data.trader_until,
        freeze_until: data.freeze_until,
        freeze_started_at: data.freeze_started_at,
        rot_freeze_offset_seconds: Number(data.rot_freeze_offset_seconds ?? 0),
        frozen_prices: (data.frozen_prices as MarketState["frozen_prices"]) ?? {},
      };
    } else {
      nextState = { trader_until: null, freeze_until: null, freeze_started_at: null, rot_freeze_offset_seconds: 0, frozen_prices: {} };
    }
    setMarketState(nextState);
    setCached(cacheKey, nextState);
  };
  useEffect(() => {
    if (!user) return;
    const cached = getCached<MarketState>(`fish-market:state:${user.id}`);
    if (cached) setMarketState(cached);
    loadMarketState();
    // Re-load when crews are activated elsewhere (e.g. inventory page),
    // when the tab regains focus, or on any inventory mutation.
    const onChanged = () => { loadMarketState(); refreshProfile(); };
    window.addEventListener("inventory-changed", onChanged);
    window.addEventListener("focus", onChanged);
    return () => {
      window.removeEventListener("inventory-changed", onChanged);
      window.removeEventListener("focus", onChanged);
    };
  }, [user?.id]);

  // If the user has an active "trader" crew assigned to one of their ships,
  // it grants the same forecast as the paid market unlock — no 250💎 needed.
  // The "trader" crew gives the player the same price-forecast benefit as the
  // paid market unlock. As soon as the player owns one (or has one assigned to
  // a ship), treat the trader as active — no 250💎 needed.
  const [traderCrewUntil, setTraderCrewUntil] = useState<string | null>(null);
  const [traderCrewActive, setTraderCrewActive] = useState<boolean>(false);
  const [ownedTraderQty, setOwnedTraderQty] = useState(0);
  const [traderPrice, setTraderPrice] = useState(30);
  useEffect(() => {
    if (!user) { setTraderCrewUntil(null); setTraderCrewActive(false); setOwnedTraderQty(0); return; }
    const cacheKey = `fish-market:trader:${user.id}`;
    const cached = getCached<TraderCache>(cacheKey);
    if (cached) {
      setTraderCrewUntil(cached.until);
      setTraderCrewActive(cached.active);
      setOwnedTraderQty(cached.owned);
    }
    const load = async () => {
      const { data } = await supabase
        .from("inventory")
        .select("quantity, meta")
        .eq("user_id", user.id)
        .eq("item_type", "crew")
        .eq("item_id", "trader");
      const nowMs = serverNowMs();
      let bestExp: number | null = null;
      let active = false;
      let owned = 0;
      for (const r of (data ?? []) as Array<{ quantity: number; meta: { assigned_ship_id?: string | null; expires_at?: string | null } | null }>) {
        if ((r.quantity ?? 0) <= 0) continue;
        const exp = r.meta?.expires_at ? new Date(r.meta.expires_at).getTime() : null;
        if (!r.meta?.assigned_ship_id) owned += r.quantity ?? 0;
        if (r.meta?.assigned_ship_id && exp != null && exp > nowMs) {
          active = true;
          if (bestExp == null || exp > bestExp) bestExp = exp;
        }
      }
      const next = { until: bestExp != null ? new Date(bestExp).toISOString() : null, active, owned };
      setOwnedTraderQty(next.owned);
      setTraderCrewActive(next.active);
      setTraderCrewUntil(next.until);
      setCached(cacheKey, next);
    };
    load();
    const ch = supabase
      .channel(`inv_trader_${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory", filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]);

  useEffect(() => {
    (supabase as any)
      .from("client_item_prices")
      .select("price_gems")
      .eq("item_type", "crew")
      .eq("item_id", "trader")
      .maybeSingle()
      .then(({ data }: { data: { price_gems?: number } | null }) => {
        const price = Number(data?.price_gems ?? 0);
        if (price > 0) setTraderPrice(price);
      });
  }, []);

  // Load dynamic fish prices from DB + subscribe to hourly updates
  useEffect(() => {
    const cacheKey = "fish-market:prices";
    const cached = getCached<PriceCache>(cacheKey);
    if (cached) {
      setPriceMap(cached.prices);
      setForecastMap(cached.forecast);
      setHistoryMap(cached.history);
    }
    const loadPrices = async () => {
      const { data } = await (supabase as any)
        .from("fish_market_prices")
        .select("fish_id, current_price, min_price, max_price, forecast, history");
      const m: Record<string, { current: number; min: number; max: number }> = {};
      const fm: Record<string, number[]> = {};
      const hm: Record<string, number[]> = {};
      for (const row of (data ?? []) as Array<{ fish_id: string; current_price: number; min_price: number; max_price: number; forecast?: unknown; history?: unknown }>) {
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
        if (Array.isArray(row.history)) {
          hm[row.fish_id] = (row.history as unknown[])
            .map((v) => Number(v))
            .filter((n) => Number.isFinite(n));
        }
      }
      setPriceMap(m);
      setForecastMap(fm);
      setHistoryMap(hm);
      setCached(cacheKey, { prices: m, forecast: fm, history: hm });
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
  const traderUnlockUntilMs = marketState.trader_until ? new Date(marketState.trader_until).getTime() : 0;
  const traderCrewUntilMs = traderCrewUntil ? new Date(traderCrewUntil).getTime() : 0;
  const traderActiveGlobal = traderUnlockUntilMs > serverNowMs() || traderCrewActive;
  const effectiveTraderUntil = traderCrewActive && traderCrewUntilMs === 0
    ? null // crew assigned without explicit expiry — show as active, no countdown
    : (traderUnlockUntilMs >= traderCrewUntilMs ? marketState.trader_until : traderCrewUntil);


  const loadMarket = async () => {
    if (!user) { setLvl(1); setUpgradingTo(null); setUpgradeEndsAt(null); return; }
    const cacheKey = `fish-market:level:${user.id}`;
    await supabase.rpc("finalize_fish_market_upgrades" as never);
    const { data } = await supabase
      .from("user_fish_market" as never)
      .select("level, upgrading_to, upgrade_ends_at")
      .eq("user_id", user.id)
      .maybeSingle();
    const row = (data as { level?: number; upgrading_to?: number | null; upgrade_ends_at?: string | null } | null);
    const lvlVal = row?.level ?? 1;
    setLvl(lvlVal);
    setUpgradingTo(row?.upgrading_to ?? null);
    setUpgradeEndsAt(row?.upgrade_ends_at ?? null);
    setCached(cacheKey, { level: lvlVal, upgradingTo: row?.upgrading_to ?? null, upgradeEndsAt: row?.upgrade_ends_at ?? null });
    try { window.localStorage.setItem("ocean.fishMarketLevel", String(Math.max(1, Math.min(30, lvlVal)))); } catch {}
  };

  useEffect(() => {
    if (!user) return;
    const cached = getCached<FishMarketLevelCache>(`fish-market:level:${user.id}`);
    if (cached) {
      setLvl(cached.level);
      setUpgradingTo(cached.upgradingTo);
      setUpgradeEndsAt(cached.upgradeEndsAt);
    }
    loadMarket();
  }, [user?.id]);

  useEffect(() => {
    if (!user) { setUpPreview(null); return; }
    setUpPreview(null); // clear stale price until fresh value loads (prevents 500-gold exploit)
    supabase.rpc("fish_market_upgrade_cost" as never, { _level: lvl } as never).then(({ data }) => {
      const row = (data as Array<{ cost_coins: number; seconds: number }> | null)?.[0] ?? null;
      setUpPreview(row);
    });
  }, [user?.id, lvl]);

  const tickNow = useServerTick();

  const marketExpertUntil = (profile as any)?.market_expert_until as string | null | undefined;
  const marketExpertMs = marketExpertUntil ? Math.max(0, new Date(marketExpertUntil).getTime() - tickNow) : 0;
  const marketExpertActive = marketExpertMs > 0;
  useEffect(() => {
    if (!upgradeEndsAt) { setSecondsLeft(0); return; }
    const diff = Math.max(0, Math.ceil((new Date(upgradeEndsAt).getTime() - tickNow) / 1000));
    setSecondsLeft(diff);
    // When the timer reaches 0, retry finalize every ~2s in case the server
    // clock is slightly behind the client clock (otherwise the row stays
    // stuck at "00:00" and never finalizes).
    if (diff === 0) {
      const id = window.setTimeout(() => { syncServerTime(true).then(() => loadMarket()); }, 2000);
      return () => window.clearTimeout(id);
    }
  }, [upgradeEndsAt, tickNow]);

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
    if (!user || !upgradingTo) return;
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

  const accelCost = secondsLeft <= 10 ? 0 : Math.max(1, Math.ceil(secondsLeft / 60));



  // Load owned fish quantities + ages via fast aggregate RPC (avoids loading
  // tens of thousands of rows for large stocks which causes "Load failed").
  const loadFish = async () => {
    if (!user) { setQtyMap({}); setAgeMap({}); setStockIdsMap({}); return; }
    const cacheKey = `fish-market:stock:${user.id}`;
    const { data, error } = await supabase.rpc("get_fish_stock_summary" as never);
    if (error) return;
    const rows = (data ?? []) as Array<{ fish_id: string; qty: number | string; oldest_caught_at: string }>;
    const map: Record<string, number> = {};
    const ages: Record<string, string> = {};
    for (const row of rows) {
      const q = typeof row.qty === "string" ? parseInt(row.qty, 10) : row.qty;
      if (!q || q <= 0) continue;
      map[row.fish_id] = q;
      if (row.oldest_caught_at) ages[row.fish_id] = row.oldest_caught_at;
    }
    setQtyMap(map);
    setAgeMap(ages);
    setCached(cacheKey, { qty: map, ages });
    // IDs are fetched on demand during sale to avoid huge payloads.
    setStockIdsMap({});
  };
  useEffect(() => {
    if (user) {
      const cached = getCached<FishStockCache>(`fish-market:stock:${user.id}`);
      if (cached) {
        setQtyMap(cached.qty);
        setAgeMap(cached.ages);
        setStockIdsMap({});
      }
    }
    loadFish();
    if (!user) return;
    const onFocus = () => loadFish();
    const onStockChanged = () => loadFish();
    const onStorage = (e: StorageEvent) => { if (e.key === "fish-stock-ping") loadFish(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("fish-stock-changed", onStockChanged);
    window.addEventListener("storage", onStorage);
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
      window.removeEventListener("fish-stock-changed", onStockChanged);
      window.removeEventListener("storage", onStorage);
      supabase.removeChannel(ch);
    };
  }, [user?.id]);


  // Rot helpers: -1% per hour from oldest catch, floor 50%.
  // Freeze pauses the rot clock; after freeze expires rot resumes from where it paused.
  const rotMult = (fishId: string): number => {
    const t = ageMap[fishId];
    if (!t) return 1;
    const caughtAt = new Date(t).getTime();
    const now = serverNowMs();
    const fStart = marketState.freeze_started_at ? new Date(marketState.freeze_started_at).getTime() : 0;
    const fUntil = marketState.freeze_until ? new Date(marketState.freeze_until).getTime() : 0;
    let frozenSec = 0;
    if (fStart > 0 && fUntil > fStart) {
      frozenSec = Math.max(0, (Math.min(fUntil, now) - Math.max(fStart, caughtAt)) / 1000);
    }
    const offsetSec = Math.max(0, marketState.rot_freeze_offset_seconds || 0);
    const elapsedSec = Math.max(0, (now - caughtAt) / 1000 - offsetSec - frozenSec);
    const hours = elapsedSec / 3600;
    return Math.max(0.5, 1 - 0.01 * hours);
  };

  // Only show fish the player owns (qty > 0)
  const fish: Fish[] = Object.entries(qtyMap)
    .map(([id, qty]): Fish | null => {
      const meta = fishMeta(id);
      if (!meta) return null;
      const livePrice = priceMap[id];
      const live = livePrice?.current;
      const basePrice = typeof live === "number" && live > 0 ? live : meta.basePrice;
      const minPrice = typeof livePrice?.min === "number" && livePrice.min > 0 ? livePrice.min : meta.minPrice;
      const maxPrice = typeof livePrice?.max === "number" && livePrice.max > minPrice ? livePrice.max : meta.maxPrice;
      return { ...meta, basePrice, minPrice, maxPrice, qty };
    })
    .filter((f): f is Fish => !!f && f.qty > 0)
    .sort((a, b) => b.basePrice - a.basePrice);

  const capUsed = fish.reduce((s, f) => s + f.qty, 0);
  const capMax = fishMarketCapacity(lvl);
  

  const sel = fish.find((f) => f.id === selected) || null;

  useEffect(() => {
    if (selected && (qtyMap[selected] ?? 0) <= 0) setSelected(null);
  }, [selected, qtyMap]);

  const sell = async (amount: number, ctx: { currentPrice: number; rotMult: number; minPrice: number; maxPrice: number }) => {
    if (!sel || !user || selling) return;
    const requestedQty = Math.min(amount, sel.qty);
    if (requestedQty <= 0) return;

    setSelling(true);
    const fishName = sel.name;
    setQtyMap((curr) => ({ ...curr, [sel.id]: Math.max(0, (curr[sel.id] ?? 0) - requestedQty) }));

    try {
      const { data, error } = await supabase.rpc("sell_fish_by_qty" as never, {
        _fish_id: sel.id,
        _qty: requestedQty,
        _client_version: FISH_MARKET_CLIENT_VERSION,
      } as never);
      if (error) {
        const msg = error.message || "";
        if (msg.includes("update_required")) {
          setPop("🔄 جاري تحديث اللعبة...");
          try {
            if ("caches" in window) {
              const keys = await caches.keys();
              await Promise.all(keys.map((k) => caches.delete(k)));
            }
          } catch {}
          setTimeout(() => {
            const url = new URL(window.location.href);
            url.searchParams.set("_v", Date.now().toString());
            window.location.replace(url.toString());
          }, 800);
          return;
        }
        setPop(`❌ ${msg || "تعذر البيع"}`);
        setTimeout(() => setPop(null), 2500);
        await loadFish();
        return;
      }
      const serverEarned = Number(data ?? 0);
      if (serverEarned <= 0) {
        setPop("تم تحديث المخزن، حاول البيع مرة ثانية");
        setTimeout(() => setPop(null), 1800);
        await loadFish();
        return;
      }
      applyOptimisticProfileDelta({ coins: +serverEarned });
      const baseUnit = Math.round(ctx.currentPrice);
      // When Market Expert is active, the server sells every fish at the
      // fish's max price — reflect that in the "gross" so the math on-screen
      // (gross - rotLoss = net) is always consistent.
      const effectiveUnit = marketExpertActive ? Math.max(baseUnit, Math.round(ctx.maxPrice)) : baseUnit;
      const gross = effectiveUnit * requestedQty;
      const rotLoss = Math.max(0, gross - serverEarned);
      const span = Math.max(0.0001, ctx.maxPrice - ctx.minPrice);
      const marketRank = Math.max(0, Math.min(1, (ctx.currentPrice - ctx.minPrice) / span));
      const tier = computeTier({ marketRank, rotMult: ctx.rotMult });
      // Always show the expert boost card while the buff is active so the
      // user sees the price uplift even when the market is already at peak.
      const boost = marketExpertActive
        ? { basePrice: baseUnit, boostedPrice: effectiveUnit, qty: requestedQty }
        : null;
      setSellResult({ tier, gross, rotLoss, net: serverEarned, fishName, marketExpertBoost: boost });
      await loadFish();
      refreshProfile();
    } finally {
      setSelling(false);
    }
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
      <div className="absolute top-0 left-0 right-0 z-30 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] mt-10 flex items-center gap-2">
        <Link to="/" className="w-10 h-10 rounded-xl glass-hud border border-accent/40 flex items-center justify-center text-lg active:scale-95">
          ←
        </Link>
        <div className="flex-1 glass-hud rounded-xl px-3 py-1.5 flex items-center justify-around gap-2">
          <ResChip icon="💎" v={gems} color="text-rose-300" />
          <ResChip icon="🔷" v={rubies} color="text-cyan-200" />
          <ResChip icon={<CoinIcon size={16} />} v={coins} color="text-amber-300" />
      </div>

      {marketExpertActive && (
        <div className="mt-1.5 mx-0 rounded-xl border-2 border-emerald-300/70 bg-gradient-to-b from-emerald-600/95 to-emerald-900/95 px-3 py-1 text-center shadow-xl flex items-center justify-center gap-2 pointer-events-none">
          <span className="text-[11px] font-extrabold text-emerald-100">📈 خبير الأسواق مفعّل</span>
          <span className="text-[11px] font-bold text-amber-200 tabular-nums">{formatHHMMSS(marketExpertMs)}</span>
        </div>
      )}

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
          history={historyMap[sel.id] ?? []}
          freezeActive={freezeActive}
          freezeUntil={marketState.freeze_until}
          traderActive={traderActiveGlobal}
          traderUntil={effectiveTraderUntil}
          ownedTraderQty={ownedTraderQty}
          traderPrice={traderPrice}
          rot={rotMult(sel.id)}
          selling={selling}
          marketExpertActive={marketExpertActive}
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

      {sellResult && (
        <SellResultModal result={sellResult} onClose={() => { setSellResult(null); setSelected(null); }} />
      )}

    </div>
  );
}


function SellResultModal({ result, onClose }: { result: SellResult; onClose: () => void }) {
  const info = TIER_INFO[result.marketExpertBoost ? 5 : result.tier];
  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4" dir="rtl" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border-4 shadow-2xl overflow-hidden"
        style={{ background: "linear-gradient(180deg, #f5d9a8 0%, #e9bf7e 100%)", borderColor: "#8a5a2b" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center py-2 font-extrabold text-white text-base" style={{ background: "linear-gradient(180deg,#6b4326,#3e2614)" }}>
          السعر النهائي
        </div>
        <div className="p-3 flex flex-col items-center gap-3">
          <div className="w-full rounded-xl overflow-hidden border-2 border-amber-900/40 bg-white/40 flex items-center justify-center">
            <img src={info.img} alt={info.label} className="w-full h-auto object-contain" />
          </div>

          <div className="w-full text-right text-amber-950 font-bold space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                {[1,2,3].map(i => (
                  <span key={i} className={i <= info.stars ? "text-yellow-400" : "text-gray-400"} style={{ fontSize: 18, lineHeight: 1 }}>★</span>
                ))}
              </div>
              <div>السعر الاجمالي: <span className="tabular-nums">{result.gross.toLocaleString()}</span>ذهب</div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                {[1,2,3].map(i => (
                  <span key={i} className={i <= info.stars ? "text-yellow-400" : "text-gray-400"} style={{ fontSize: 18, lineHeight: 1 }}>★</span>
                ))}
              </div>
              <div>صلاحية السمك: <span className="tabular-nums">-{result.rotLoss.toLocaleString()}</span>ذهب</div>
            </div>
            <div className="pt-1 text-base">
              الدخل: <span className="tabular-nums text-amber-900">{result.net.toLocaleString()}</span>ذهب
            </div>
            {result.marketExpertBoost && (
              <div className="mt-2 rounded-lg border-2 border-emerald-700/50 bg-emerald-100/70 p-2 text-[12px] font-bold text-emerald-950 space-y-0.5">
                <div className="flex items-center gap-1 text-emerald-800">
                  <span>📈</span><span>خبير الأسواق</span>
                </div>
                <div>كان سعر السوق: <span className="tabular-nums">{result.marketExpertBoost.basePrice.toLocaleString()}</span> ذهب للسمكة</div>
                <div>رفعتُه إلى: <span className="tabular-nums text-emerald-900">{result.marketExpertBoost.boostedPrice.toLocaleString()}</span> ذهب للسمكة</div>
                <div className="pt-0.5">ربح إضافي: <span className="tabular-nums text-emerald-900">+{((result.marketExpertBoost.boostedPrice - result.marketExpertBoost.basePrice) * result.marketExpertBoost.qty).toLocaleString()}</span> ذهب</div>
              </div>
            )}
            <p className="pt-1 text-[13px] leading-relaxed text-amber-950/90 font-semibold">
              {info.text}
            </p>
          </div>

          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg text-white font-extrabold text-base shadow-lg active:scale-95"
            style={{ background: "linear-gradient(180deg,#f0a040,#d77520)", border: "2px solid #b35c10" }}
          >
            الرئيسية
          </button>
        </div>
      </div>
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
      <div className="absolute top-32 left-1/2 -translate-x-1/2 z-20">
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
      <div className="absolute top-52 left-2 right-2 bottom-40 z-10 rounded-2xl bg-gradient-to-b from-sky-700/85 to-sky-900/85 border-2 border-cyan-300/70 shadow-2xl p-3 overflow-y-auto">
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

      {/* Sell All button removed per admin request */}

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
              {accelCost === 0 ? "إكمال" : `💎 ${accelCost}`}
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
              disabled={upBusy === "start" || lvl >= 30 || !upPreview}
              className="px-8 py-3 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 border-2 border-amber-200 shadow-lg text-amber-950 font-extrabold active:scale-95 disabled:opacity-50"
            >
              {lvl >= 30 ? "أعلى مستوى" : !upPreview ? "..." : upBusy === "start" ? "..." : "ترقية"}
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
  fish, userId, forecast, history, freezeActive, freezeUntil, traderActive, traderUntil, ownedTraderQty, traderPrice, rot, selling, marketExpertActive, onBack, onSell, onPurchased,
}: {
  fish: Fish;
  userId: string;
  forecast: number[];
  history: number[];
  freezeActive: boolean;
  freezeUntil: string | null;
  traderActive: boolean;
  traderUntil: string | null;
  ownedTraderQty: number;
  traderPrice: number;
  rot: number;
  selling: boolean;
  marketExpertActive: boolean;
  onBack: () => void;
  onSell: (amount: number, ctx: { currentPrice: number; rotMult: number; minPrice: number; maxPrice: number }) => void;
  onPurchased: () => void;
}) {
  const past = useMemo(() => {
  // When Market Expert is active, every sale goes through at the fish's max
  // price. Reflect that in the chart / "from X" reference so the on-screen
  // math matches the server-earned amount exactly.
  const displayBase = marketExpertActive ? fish.maxPrice : fish.basePrice;
  const past = useMemo(() => {
    // Use real recent history from DB so past chart values match what actually happened.
    const tail = marketExpertActive ? [] : (history ?? []).slice(-PAST_HOURS);
    while (tail.length < PAST_HOURS) {
      // Pad with current price if we don't have enough history yet
      tail.unshift(displayBase);
    }
    tail.push(displayBase);
    return tail;
  }, [fish.id, displayBase, marketExpertActive, history]);
  const currentPrice = past[past.length - 1];
  const fallbackEffectivePrice = Math.max(0.0001, currentPrice * rot);

  const now = useServerTick();

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
  const [saleQuote, setSaleQuote] = useState<SaleQuote | null>(null);
  useEffect(() => {
    if (!userId || userId === "anon" || amount <= 0) { setSaleQuote(null); return; }
    let alive = true;
    const id = window.setTimeout(async () => {
      const { data, error } = await (supabase as any).rpc("quote_fish_sale_by_qty", { _fish_id: fish.id, _qty: amount });
      if (!alive) return;
      if (error) { setSaleQuote(null); return; }
      const row = (Array.isArray(data) ? data[0] : data) as SaleQuote | undefined;
      setSaleQuote(row ?? null);
    }, 120);
    return () => { alive = false; window.clearTimeout(id); };
  }, [userId, fish.id, amount]);

  const effectivePrice = Number(saleQuote?.effective_unit_price ?? fallbackEffectivePrice);
  const rotPct = Math.round(Number(saleQuote?.rot ?? rot) * 100);
  const requestedAmount = Math.max(0, Math.min(Math.floor(amount), fish.qty));
  const quoteSold = Number(saleQuote?.sold ?? 0);
  const quoteReady = !!saleQuote && quoteSold >= requestedAmount && Number(saleQuote.total_amount) > 0;
  const saleTotal = quoteReady ? Number(saleQuote.total_amount) : Math.round(fallbackEffectivePrice * requestedAmount);
  const effectivePriceText = effectivePrice >= 100 ? Math.round(effectivePrice).toLocaleString() : effectivePrice.toFixed(2);

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
      <button onClick={onBack} className="absolute top-12 right-2 z-30 w-10 h-10 rounded-full bg-gradient-to-b from-rose-400 to-rose-600 border-2 border-rose-200 text-white text-lg font-bold flex items-center justify-center shadow-lg active:scale-95">✕</button>

      <div className="absolute top-32 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center">
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
          السعر بعد التعفّن: <span className="text-amber-300 tabular-nums">{effectivePriceText}</span>
          {rotPct < 100 && <span className="text-rose-300 text-[10px] mr-2">(من {currentPrice})</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white text-sm font-bold text-glow tabular-nums">{amount.toLocaleString()}/{fish.qty.toLocaleString()}</span>
          <input type="range" min={0} max={fish.qty} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="flex-1 accent-amber-400 h-2" />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-amber-300 font-bold">
            <CoinIcon size={16} /> <span className="text-emerald-300 text-sm">{saleTotal.toLocaleString()}</span>
          </div>
          <button onClick={() => onSell(requestedAmount, { currentPrice: Number(saleQuote?.current_price ?? currentPrice), rotMult: Number(saleQuote?.rot ?? rot), minPrice: fish.minPrice, maxPrice: fish.maxPrice })} disabled={requestedAmount === 0 || selling} className="px-8 py-2 rounded-lg bg-gradient-to-b from-amber-300 to-amber-500 border-2 border-amber-200 shadow-lg text-amber-950 font-extrabold active:scale-95 disabled:opacity-50">{selling ? "..." : "بيع"}</button>
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
                  {busy ? "..." : ownedTraderQty > 0 ? "استخدام التاجر من المخزن" : `اشترِ الآن 💎 ${traderPrice}`}
                </button>
              </>
            ) : (
              <>
                <div className="text-center text-cyan-200 text-lg font-extrabold mb-1">🧊 طاقم تجميد التعفّن</div>
                <div className="text-center text-xs text-slate-200 mb-3">يوقف نقص جودة السمك بسبب التعفّن للمدة المختارة، والسعر يبقى يتغير طبيعي. تقدر تشتري أكثر من مرة والوقت يتراكم فوق التجميد الحالي.</div>
                <div className="grid grid-cols-3 gap-2">
                  {[{ h: 2, p: 50 }, { h: 9, p: 100 }, { h: 24, p: 150 }].map((o) => (
                    <button key={o.h} onClick={() => buyFreeze(o.h)} disabled={busy} className="py-3 rounded-xl bg-gradient-to-b from-cyan-300 to-cyan-500 border-2 border-cyan-200 text-cyan-950 font-extrabold disabled:opacity-50">
                      <div className="text-sm">{freezeActive ? `+${o.h}س` : `${o.h}س`}</div>
                      <div className="text-[11px]">💎 {o.p}</div>
                    </button>
                  ))}
                </div>
                {freezeActive && <div className="text-center text-[11px] text-cyan-200 mt-2">التجميد فعّال — الشراء يمدد الوقت الحالي</div>}
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
  const W = 320, H = 190, PAD_L = 36, PAD_R = 12, PAD_T = 22, PAD_B = 26;
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

  const fmt = (v: number) => (v >= 100 ? Math.round(v).toString() : v.toFixed(2));

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

        {/* Per-hour price labels on past line */}
        {past.map((v, i) => (
          <g key={`pl-${i}`}>
            <circle cx={xAt(i)} cy={yAt(v)} r="1.8" fill="#ee4f2e" />
            <text x={xAt(i)} y={yAt(v) - 5} fontSize="7.5" fill="#b3300f" fontWeight="bold" textAnchor="middle">{fmt(v)}</text>
          </g>
        ))}

        {/* Future line (blue) when trader is active */}
        {traderActive && futurePts && (
          <>
            <polyline points={futurePts} fill="none" stroke="#3b82f6" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
            <line x1={currentX} y1={PAD_T} x2={currentX} y2={H - PAD_B} stroke="#6b7280" strokeWidth="0.6" />
            <text x={W - PAD_R} y={PAD_T - 8} fontSize="9" fill="#2563eb" fontWeight="bold" textAnchor="end">السعر المستقبلي</text>
            {future.map((v, i) => (
              <g key={`fl-${i}`}>
                <circle cx={xAt(futureStartIdx + 1 + i)} cy={yAt(v)} r="1.8" fill="#3b82f6" />
                <text
                  x={xAt(futureStartIdx + 1 + i)}
                  y={yAt(v) - 5}
                  fontSize="7.5"
                  fill="#1d4ed8"
                  fontWeight="bold"
                  textAnchor="middle"
                >{fmt(v)}</text>
              </g>
            ))}
          </>
        )}

        {/* Current price marker */}
        <circle cx={currentX} cy={currentY} r="4" fill="#4ade80" stroke="#fff" strokeWidth="1.2" />
        <rect x={currentX - 16} y={currentY - 18} width="32" height="11" rx="3" fill="#064e3b" opacity="0.92" />
        <text x={currentX} y={currentY - 10} fontSize="8.5" fill="#fef3c7" fontWeight="bold" textAnchor="middle">{fmt(currentPrice)}</text>

        {/* X-axis hour labels */}
        {hourLabels.map((lab, i) => (
          <g key={i}>
            <text x={xAt(i)} y={H - 10} fontSize="8" fill="#7a4a18" fontWeight="bold" textAnchor="middle">{lab.h}</text>
            <text x={xAt(i)} y={H - 2} fontSize="7" fill="#7a4a18" textAnchor="middle">{lab.ampm}</text>
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
