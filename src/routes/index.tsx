import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { LeaderboardPodium, type PodiumItem } from "@/components/LeaderboardPodium";
import { PrizesModal, type PrizeTier } from "@/components/PrizesModal";
import { useState, useEffect, useRef, useCallback } from "react";
import { markRepairDone } from "@/lib/anti-cheat-cooldown";
import { getShipByMarketLevel, getShipByCode, catchPerTrip, shipBowFacesRight, getUpgradeSubImage, UPGRADE_SUB_STAR_CAPACITY, UPGRADE_SUB_SUCCESS_PCT, UPGRADE_SUB_COST } from "@/lib/ships";
import { ProjectileFx } from "@/components/ProjectileFx";
import { getSceneVisual, getSelectedBgId } from "@/lib/backgrounds";
import { FISH, FISH_TOTAL, fishForShip } from "@/lib/fish";
import { CREWS, FIXER_HEAL } from "@/lib/crews";
import { activateGoldenFisher, tickGoldenFisher, removeGoldenFisher, pauseGoldenFisher, resumeGoldenFisher } from "@/lib/golden-fisher.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  sellShip,
  deleteInventoryRows,
  buyWithCoinsGemFallback,
  buyWithCoins,
  buyWithGems,
  setShipAtSea,
} from "@/lib/economy";
import { useAuth, useProfile, refreshProfile } from "@/hooks/use-auth";
import { useSwrCache, getCached, setCached, invalidateCache } from "@/lib/swr-cache";
import { isLowPerfMode, isHeavyFxDisabled } from "@/lib/perf-mode";
import { useBgMotionPaused } from "@/lib/bg-motion";
import { DailyLoginModal } from "@/components/DailyLoginModal";
import { LuckyBoxButton } from "@/components/LuckyBox";

import { sound } from "@/lib/sound";
import { SettingsModal } from "@/components/SettingsModal";

import { SeamlessVideo } from "@/components/SeamlessVideo";
import { NotificationsBell } from "@/components/NotificationsBell";
import { DragonShoreCreature } from "@/components/DragonShoreCreature";

import { ShieldBadge } from "@/components/ShieldBadge";
import { useIsAdmin } from "@/hooks/use-admin";
import {
  useShipSlotOverrides,
  useShipSlotLayoutReady,
  useShipSlotEditor,
  ShipSlotEditorOverlay,
  ShipSlotEditorToolbar,
} from "@/lib/ship-slot-editor";
import { AuthGuard } from "@/components/AuthGuard";
import { Landing } from "@/components/Landing";
import cloudImg from "@/assets/cloud-realistic.png";
import harborBgPoster from "@/assets/harbor-bg.jpg";
import { getTribeBanner } from "@/lib/tribe-banners";
import { repairBurnedBg } from "@/components/BurnedBgOverlay";
import { DraggableRepairBgButton } from "@/components/DraggableRepairBgButton";
import { AdBombOverlay } from "@/components/AdBombOverlay";
import { DestroyerSign } from "@/components/DestroyerSign";
import { ShipMarketBuilding } from "@/components/ShipMarketBuilding";
import { FishMarketBuilding } from "@/components/FishMarketBuilding";
import { Placeable } from "@/components/AdminLayoutEditor";
import birdImg from "@/assets/bird-realistic.png";
import { CoinIcon, GemIcon } from "@/components/CurrencyIcon";
import { syncServerTime, serverTodayKey, serverNowMs, serverNow, isServerClockSynced } from "@/lib/server-time";
import { useServerTick } from "@/lib/use-server-tick";
import { consumePlayerReturnSource, savePlayerReturnSource } from "@/lib/navigation-source";

import { frameById } from "@/lib/frames";
import { rankTier } from "@/lib/rank-tiers";
import navIconBattle from "@/assets/nav-icon-battle.png";
import navIconTribe from "@/assets/nav-icon-tribe.png";
import navIconArena from "@/assets/nav-icon-arena.png";
import navIconFriends from "@/assets/nav-icon-friends.png";
import navIconInventory from "@/assets/nav-icon-inventory.png";
import navIconShop from "@/assets/nav-icon-shop.png";
import navIconChat from "@/assets/nav-icon-chat.png";
import navIconSettings from "@/assets/nav-icon-settings.png";






export const Route = createFileRoute("/")({
  component: GuardedIndex,
  ssr: false,
  head: () => ({
    meta: [
      { title: "ملوك القراصنة — لعبة هامور شابك العربية | العب مجاناً الآن" },
      { name: "description", content: "ملوك القراصنة (هامور شابك) — لعبة قراصنة عربية مجانية على المتصفح. اصطد، قاتل، وكوّن قبيلتك. تُعرف أيضاً بهامور 360 وشابك 360." },
      { name: "keywords", content: "ملوك القراصنة, لعبة ملوك القراصنة, ملوك القراصنه, هامور شابك, هامور 360, شابك 360, لعبة قراصنة, لعبة قراصنة عربية, لعبة صيد سمك, العب قراصنة, pirate kings, mulook al qarasna" },
      { property: "og:title", content: "ملوك القراصنة — هامور شابك | لعبة القراصنة العربية" },
      { property: "og:description", content: "العب ملوك القراصنة (هامور شابك) مجاناً — لعبة قراصنة وصيد سمك عربية متعددة اللاعبين." },
      { property: "og:url", content: "https://www.molok-alqarasna.com/" },
    ],
    links: [
      { rel: "canonical", href: "https://www.molok-alqarasna.com/" },
      { rel: "preload", as: "image", href: harborBgPoster, fetchpriority: "high" },
    ],
  }),
});

function GuardedIndex() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-stone-950 text-amber-200">
        <div className="animate-pulse text-lg">جاري التحميل...</div>
      </div>
    );
  }
  if (!session) return <Landing />;
  return (
    <AuthGuard>
      <Index />
    </AuthGuard>
  );
}


interface Ship {
  id: number;
  dbId?: string; // ships_owned.id when this ship came from DB
  catalogCode?: string | null; // specific catalog ship variant (matches spectator view)
  img: string;
  progress: number;
  max: number;
  timeLeft: number;
  duration: number; // full fishing trip duration in seconds
  startedAt?: number; // ms timestamp when current fishing trip began
  scale: number;
  top: string;
  dockLeft: number; // % from left when docked — spread across the harbor
  fishing: boolean;
  sail: number; // 0 = docked, 1 = far out at sea
  level: number; // determines fish tier
  hp?: number;
  maxHp?: number;
  destroyedAt?: string | null;
  repairEndsAt?: string | null;
  stealingEndsAt?: string | null;
  stealingTargetUserId?: string | null;
  stealingStartedAt?: string | null;
  seaSide?: "left" | "right";
  stars?: number;
  maxStars?: number;
  sailorAtStart?: boolean; // true if sailor crew was assigned when this trip began
  // Optional per-slot overrides for the "at sea" landing position (admin editor).
  seaLeft?: number;
  seaTop?: number;
  seaScale?: number;

}

// Repair progress 0..1 based on destroyed_at → repair_ends_at window.
function repairProgress(destroyedAt?: string | null, repairEndsAt?: string | null): number {
  if (!destroyedAt || !repairEndsAt) return 1;
  const start = new Date(destroyedAt).getTime();
  const end = new Date(repairEndsAt).getTime();
  const now = serverNowMs();
  if (now >= end) return 1;
  const total = end - start;
  if (total <= 0) return 1;
  return Math.max(0, Math.min(1, (now - start) / total));
}
// A ship is "blocked from fishing" only while current HP is below 30% of max.
// Past that point it can sail and fish (capacity scales with HP on the server),
// even if a repair timer is still ticking in the background.
const FISH_REPAIR_MIN = 0.30;
function isShipBlocked(
  destroyedAt?: string | null,
  repairEndsAt?: string | null,
  hp?: number | null,
  maxHp?: number | null,
): boolean {
  // HP-based rule (preferred): if HP is known, that decides everything.
  if (hp != null && maxHp != null && maxHp > 0) {
    return (hp / maxHp) < FISH_REPAIR_MIN;
  }
  // Fallback: time-based rule when HP isn't known.
  if (!destroyedAt || !repairEndsAt) return false;
  if (new Date(repairEndsAt).getTime() <= serverNowMs()) return false;
  return repairProgress(destroyedAt, repairEndsAt) < FISH_REPAIR_MIN;
}

function repairRemainingSeconds(repairEndsAt?: string | null): number {
  if (!repairEndsAt) return 0;
  const endMs = new Date(repairEndsAt).getTime();
  if (!Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.ceil((endMs - serverNowMs()) / 1000));
}

function formatRepairTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}س ${m}د ${s}ث`;
  if (m > 0) return `${m}د ${s}ث`;
  return `${s}ث`;
}



// Fixed visual slots — each ship in the fleet gets a distinct (top, dockLeft, scale)
// so they never overlap on screen.
const SLOTS = [
  { scale: 0.98, top: "34%", dockLeft: 84 },
  { scale: 1.08, top: "62%", dockLeft: 48 },
  { scale: 0.94, top: "22%", dockLeft: 12 },
];

const INITIAL_SHIPS: Ship[] = [
  { id: 1, img: getShipByMarketLevel(1).image, progress: 0, max: 35000, timeLeft: 1200, duration: 1200, scale: SLOTS[0].scale, top: SLOTS[0].top, dockLeft: SLOTS[0].dockLeft, fishing: false, sail: 0, level: 1 },
];

const FLEET_KEY = "harbor_fleet_v2";
const MAX_FLEET = 3;

// Throttled wrapper for the finalize_ship_repairs RPC.
// The realtime subscription on ships_owned/fish_stock used to trigger this
// RPC dozens of times per minute per player (once per fish caught, per stock
// tick, etc.), which dominated DB time without changing any game outcome —
// the RPC is idempotent and only does work when a repair timer has elapsed.
// We cap it at once per 30s per user, with an escape hatch (`force=true`)
// for the on-timer path that runs exactly when a repair is due.
const __lastFinalizeAt: Record<string, number> = {};
export function maybeFinalizeShipRepairs(uid: string, force = false): Promise<void> {
  const now = Date.now();
  const last = __lastFinalizeAt[uid] || 0;
  if (!force && now - last < 30_000) return Promise.resolve();
  __lastFinalizeAt[uid] = now;
  return Promise.resolve((supabase as any).rpc("finalize_ship_repairs", { _user: uid }))
    .then(() => undefined)
    .catch(() => { /* best-effort repair tick */ });
}
const MIN_FLEET = 1;

type FleetSlot = { id: number; dbId?: string; catalogCode?: string | null; level: number; max: number; timeLeft: number; duration?: number; progress?: number; fishing?: boolean; sail?: number; startedAt?: number; maxHp?: number; stars?: number; maxStars?: number; sailorAtStart?: boolean };

function loadFleet(): Ship[] {
  if (typeof window === "undefined") return INITIAL_SHIPS;
  try {
    const raw = window.localStorage.getItem(FLEET_KEY);
    if (!raw) return INITIAL_SHIPS;
    const slots = JSON.parse(raw) as FleetSlot[];
    if (!Array.isArray(slots)) return INITIAL_SHIPS;
    if (slots.length === 0) return INITIAL_SHIPS; // avoid empty-ocean flash until DB sync confirms fleet
    if (slots.some((s) => s.level >= 31 && !s.catalogCode)) return INITIAL_SHIPS;
    return slots.slice(0, MAX_FLEET).map((s, i) => {
      const slot = SLOTS[i % SLOTS.length];
      const isUpSub = s.catalogCode === "upgrade-sub";
      const def = s.catalogCode ? getShipByCode(s.catalogCode) : getShipByMarketLevel(s.level);
      const realMax = catchAmountForShip({ level: def.marketLevel, catalogCode: s.catalogCode, maxHp: s.maxHp });
      const realDuration = def.fishingSeconds;
      return {
        id: s.id, dbId: s.dbId, catalogCode: s.catalogCode ?? null, level: def.marketLevel,
        max: realMax,
        timeLeft: realDuration,
        duration: realDuration,
        startedAt: s.startedAt,
        scale: slot.scale, top: slot.top, dockLeft: slot.dockLeft,
        img: isUpSub ? getUpgradeSubImage(s.stars ?? 1) : def.image,
        progress: Math.min(s.progress ?? 0, realMax),
        fishing: s.fishing ?? false,
        sail: s.sail ?? (s.fishing ? 1 : 0),
        maxHp: s.maxHp,
        stars: s.stars,
        maxStars: s.maxStars,
        sailorAtStart: s.sailorAtStart,
      };
    });
  } catch {
    return INITIAL_SHIPS;
  }
}

function saveFleet(ships: Ship[]) {
  if (typeof window === "undefined") return;
  const slots: FleetSlot[] = ships.map((s) => ({
    id: s.id, dbId: s.dbId, catalogCode: s.catalogCode, level: s.level, max: s.max, timeLeft: s.timeLeft,
    duration: s.duration, progress: s.progress, fishing: s.fishing, sail: s.sail,
    startedAt: s.startedAt, maxHp: s.maxHp, stars: s.stars, maxStars: s.maxStars, sailorAtStart: s.sailorAtStart,
  }));
  window.localStorage.setItem(FLEET_KEY, JSON.stringify(slots));
}

// How many fish a ship hauls per successful catch — based on its storage stat.
// For VIP submarines (level 32) the per-instance storage equals its max_hp,
// which the server scales by the player's VIP level at claim time.
// Capacity scales linearly with current HP: a ship at 50% HP carries 50% of its
// max capacity (server enforces the same — see collect_fishing_reward).
function catchAmountForShip(ship: Pick<Ship, "level" | "catalogCode" | "maxHp"> & { hp?: number | null }): number {
  let base: number;
  if ((ship.catalogCode === "submarine" || ship.catalogCode === "upgrade-sub" || ship.level === 32 || ship.level === 33) && ship.maxHp && ship.maxHp > 0) {
    base = ship.maxHp;
  } else {
    base = catchPerTrip(ship.catalogCode ? getShipByCode(ship.catalogCode) : getShipByMarketLevel(ship.level));
  }
  // HP-based scaling for partially damaged ships.
  if (ship.maxHp && ship.maxHp > 0 && ship.hp != null && ship.hp < ship.maxHp) {
    const ratio = Math.max(0.05, Math.min(1, ship.hp / ship.maxHp));
    base = Math.max(1, Math.floor(base * ratio));
  }
  return base;
}

function catchAmountForLevel(level: number, maxHp?: number | null, catalogCode?: string | null, hp?: number | null): number {
  return catchAmountForShip({ level, maxHp: maxHp ?? undefined, catalogCode, hp });
}

// Optional fishing guide: when set, ship targets that specific fish id
// Stored in localStorage as: ship_guide_<shipId> = <fishId>
function getShipGuide(shipId: number): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(`ship_guide_${shipId}`);
}

function setShipGuide(shipId: number, fishId: string | null) {
  if (typeof window === "undefined") return;
  if (fishId) window.localStorage.setItem(`ship_guide_${shipId}`, fishId);
  else window.localStorage.removeItem(`ship_guide_${shipId}`);
}

// Crew assignment + inventory (localStorage-backed for now)
function getShipCrew(shipId: number): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(`ship_crew_${shipId}`);
}
function setShipCrew(shipId: number, crewId: string | null) {
  if (typeof window === "undefined") return;
  if (crewId) window.localStorage.setItem(`ship_crew_${shipId}`, crewId);
  else window.localStorage.removeItem(`ship_crew_${shipId}`);
}
// (owned crews now loaded from supabase inventory; see state in Index)
function shipSellPrice(level: number) {
  // Refund 50% of the actual purchase price for this market level
  return Math.max(150, Math.round(getShipByMarketLevel(level).price * 0.5));
}

// Module-scoped flag shared by Index (writer) and ShipSlot (reader).
// Set to true when the last golden fisher tick reported the storehouse
// is full so the deposit can't make progress.
const gfMarketFullRef = { current: false };

const LEADERBOARD_TABS = ["comp", "xp", "gems", "coins", "fish", "ships", "tribes", "tribe_donations", "search"] as const;
type LeaderboardTab = typeof LEADERBOARD_TABS[number];
type LeaderboardRestore = { tab: LeaderboardTab; q?: string; tribeQ?: string };

function isLeaderboardTab(value: unknown): value is LeaderboardTab {
  return typeof value === "string" && (LEADERBOARD_TABS as readonly string[]).includes(value);
}





function Index() {
  const bgPaused = useBgMotionPaused();
  const { isAdmin } = useIsAdmin();
  const [ships, setShips] = useState<Ship[]>(() => loadFleet());
  const [crewTick, setCrewTick] = useState(0); // re-render after crew updates
  const shipsRef = useRef(ships);
  shipsRef.current = ships;
  type SeaStateOverride = { atSea: boolean; startedAt?: number; expiresAt: number };
  const seaStateOverrideRef = useRef<Record<string, SeaStateOverride>>({});
  const collectingRef = useRef<Record<string, boolean>>({});
  const getSeaOverride = (dbId: string): SeaStateOverride | undefined => {
    const override = seaStateOverrideRef.current[dbId];
    if (!override) return undefined;
    if (override.expiresAt <= serverNowMs()) {
      delete seaStateOverrideRef.current[dbId];
      return undefined;
    }
    return override;
  };
  const setSeaOverride = useCallback((dbId: string, atSea: boolean, startedAt?: number) => {
    seaStateOverrideRef.current[dbId] = { atSea, startedAt, expiresAt: serverNowMs() + 8000 };
  }, []);
  const clearSeaOverrideSoon = useCallback((dbId: string, delayMs = 2500) => {
    const marker = seaStateOverrideRef.current[dbId]?.expiresAt;
    window.setTimeout(() => {
      if (seaStateOverrideRef.current[dbId]?.expiresAt === marker) {
        delete seaStateOverrideRef.current[dbId];
      }
    }, delayMs);
  }, []);
  useEffect(() => {
    // Save fleet snapshot every 1s normally, 3s on weak devices to cut wakeups.
    const saveEveryMs = isLowPerfMode ? 3000 : 1000;
    const t = setInterval(() => { if (!document.hidden) saveFleet(shipsRef.current); }, saveEveryMs);
    const onHide = () => saveFleet(shipsRef.current);
    window.addEventListener("beforeunload", onHide);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(t);
      saveFleet(shipsRef.current);
      window.removeEventListener("beforeunload", onHide);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  // Sync purchased ships from DB → harbor fleet. DB is the source of truth:
  // any ship in ships_owned shows up here (up to MAX_FLEET), and placeholder
  // slots without a dbId are evicted to make room for real purchases.
  const syncFleetFromDb = async () => {
    // Don't block on server-time fetch — serverNowMs() falls back to Date.now()
    // and the offset gets refreshed in the background by the caller / interval.
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return;
    // Fire finalize in the background so destroyed/repair status renders immediately
    // from the current DB row instead of waiting for the RPC round-trip.
    // Throttled to at most once per 30s per user — this call used to fire on
    // every ships_owned/fish_stock realtime event (dozens per minute during
    // fishing), which dominated DB time without changing outcomes.
    maybeFinalizeShipRepairs(uid);
    const { data } = await supabase
      .from("ships_owned")
      .select("id, template_id, catalog_code, acquired_at, hp, max_hp, destroyed_at, repair_ends_at, at_sea, fishing_started_at, stealing_ends_at, stealing_target_user_id, stealing_started_at, stars, max_stars")
      .eq("user_id", uid)
      .eq("in_storage", false)
      .order("acquired_at", { ascending: true });
    const owned = (data ?? []) as { id: string; template_id: number | null; catalog_code: string | null; hp: number | null; max_hp: number | null; destroyed_at: string | null; repair_ends_at: string | null; at_sea: boolean | null; fishing_started_at: string | null; stealing_ends_at: string | null; stealing_target_user_id: string | null; stealing_started_at: string | null; stars: number | null; max_stars: number | null }[];

    setShips((curr) => {
      // If the user has zero ships in DB, clear the harbor — a placeholder
      // starter ship must NOT remain visible when the player owns no ships.
      if (owned.length === 0) {
        return curr.filter((s) => s.dbId && false); // → []
      }

      // Keep existing DB-backed ships that are still owned; drop stale + placeholders.
      const ownedIds = new Set(owned.map((o) => o.id));
      const ownedById = new Map(owned.map((o) => [o.id, o]));
      const keptDb = curr
        .filter((s) => s.dbId && ownedIds.has(s.dbId))
        .map((s) => {
          const row = ownedById.get(s.dbId!);
          if (!row) return s;
          const seaOverride = getSeaOverride(s.dbId!);
          // Restore fishing trip from DB only when local state agrees, OR
          // when local has no opinion yet (no startedAt and not fishing).
          // If the user just pressed STOP locally (fishing=false), we MUST
          // trust local and force-sync DB → at_sea=false. Otherwise the
          // realtime/poll cycle re-enables fishing automatically.
          let fishing = s.fishing;
          let startedAt = s.startedAt;
          const onSteal = !!row.stealing_target_user_id;
          const destroyed = isShipBlocked(row.destroyed_at, row.repair_ends_at, row.hp, row.max_hp);
          if (destroyed) {
            // Destroyed ships can't fish. Force them home and clear at_sea in DB.
            fishing = false;
            startedAt = undefined;
            if (row.at_sea) {
              setShipAtSea(s.dbId!, false).catch(() => {});
            }
          } else if (onSteal) {
            // Stealing mission: ship is sailing (at sea) but not fishing
            fishing = false;
            startedAt = undefined;
          } else if (seaOverride) {
            // User just pressed start/stop locally. Keep the UI instant and
            // don't let a slightly older realtime/poll fetch flip it back.
            fishing = seaOverride.atSea;
            startedAt = seaOverride.atSea ? (seaOverride.startedAt ?? startedAt ?? serverNowMs()) : undefined;
          } else if (row.at_sea && row.fishing_started_at) {
            // A completed/old trip is still a valid trip. Never auto-dock it here;
            // only collect_fishing_reward may stop fishing so the result panel is
            // always shown when the player taps collect.
            fishing = true;
            startedAt = new Date(row.fishing_started_at).getTime();
          } else if (!row.at_sea || !row.fishing_started_at) {
            // Server may stop the ship externally (for example when another
            // player starts stealing from it). Reflect that immediately.
            fishing = false;
            startedAt = undefined;
          } else if (s.fishing === false) {
            // Local says STOPPED — that's the source of truth.
            // If DB still says at_sea, push the stop again to fix the race.
            fishing = false;
            startedAt = undefined;
            if (row.at_sea) {
              setShipAtSea(s.dbId!, false).catch(() => {});
            }
          }
          const isUpSub = row.catalog_code === "upgrade-sub";
          const subStars = row.stars ?? 1;
          const catalogCode = row.catalog_code ?? s.catalogCode ?? null;
          const shipDef = catalogCode ? getShipByCode(catalogCode) : getShipByMarketLevel(row.template_id ?? s.level);
          const resolvedLevel = shipDef.marketLevel;
          const max = catchAmountForShip({ level: resolvedLevel, catalogCode, maxHp: row.max_hp ?? s.maxHp, hp: row.hp ?? s.hp });
          const duration = shipDef.fishingSeconds;
          const imgFromCode = row.catalog_code
            ? (isUpSub ? getUpgradeSubImage(subStars) : getShipByCode(row.catalog_code).image)
            : s.img;
          const sameTrip = !!s.fishing && !!fishing && s.startedAt === startedAt;
          const hasSailorNow = crewRowsRef.current.some(
            (r) => r.item_id === "sailor" && isCrewAssignedToShip(r.meta, { id: s.id, dbId: s.dbId }),
          );
          const sailorAtStart = sameTrip
            ? (!!s.sailorAtStart || hasSailorNow)
            : (fishing ? hasSailorNow : false);
          return { ...s, catalogCode, level: resolvedLevel, img: imgFromCode, max, duration, timeLeft: sameTrip ? Math.min(s.timeLeft, duration) : duration, progress: sameTrip ? Math.min(s.progress, max) : 0, hp: row.hp ?? s.hp, maxHp: row.max_hp ?? s.maxHp, destroyedAt: row.destroyed_at, repairEndsAt: row.repair_ends_at, fishing, startedAt, stealingEndsAt: row.stealing_ends_at, stealingTargetUserId: row.stealing_target_user_id, stealingStartedAt: row.stealing_started_at, stars: row.stars ?? s.stars, maxStars: row.max_stars ?? s.maxStars, sailorAtStart };
        });
      const keptDbIds = new Set(keptDb.map((s) => s.dbId!));

      // Add the remaining owned ships (oldest first), up to MAX_FLEET total.
      const toAdd = owned.filter((o) => !keptDbIds.has(o.id));
      const capacity = Math.max(0, MAX_FLEET - keptDb.length);
      const usedIds = new Set(keptDb.map((s) => s.id));
      let nextId = 1;
      const newShips: Ship[] = [];
      for (let i = 0; i < Math.min(capacity, toAdd.length); i++) {
        const dbShip = toAdd[i];
          const seaOverride = getSeaOverride(dbShip.id);
        const lvl = dbShip.template_id ?? 1;
        while (usedIds.has(nextId)) nextId++;
        usedIds.add(nextId);
        const slotIdx = (keptDb.length + i) % SLOTS.length;
        const slot = SLOTS[slotIdx];
        const shipDef = dbShip.catalog_code ? getShipByCode(dbShip.catalog_code) : getShipByMarketLevel(lvl);
        const resolvedLevel = shipDef.marketLevel;
        const maxProg = catchAmountForShip({ level: resolvedLevel, catalogCode: dbShip.catalog_code, maxHp: dbShip.max_hp ?? undefined, hp: dbShip.hp ?? undefined });
        const duration = shipDef.fishingSeconds;
        const onSteal = !!dbShip.stealing_target_user_id;
        const destroyed = isShipBlocked(dbShip.destroyed_at, dbShip.repair_ends_at, dbShip.hp, dbShip.max_hp);
        let isFishing = !destroyed && !onSteal && !!dbShip.at_sea && !!dbShip.fishing_started_at;
        let startedAt = isFishing ? new Date(dbShip.fishing_started_at!).getTime() : undefined;
        if (!destroyed && !onSteal && seaOverride) {
          isFishing = seaOverride.atSea;
          startedAt = seaOverride.atSea ? (seaOverride.startedAt ?? startedAt ?? serverNowMs()) : undefined;
        }
        const isUpSub = dbShip.catalog_code === "upgrade-sub";
        const subStars = dbShip.stars ?? 1;
        // Preserve `sailorAtStart` across re-syncs of the same active trip.
        // If we don't know (fresh row), default to whether sailor is currently
        // assigned — matches server-side bonus behavior on collect.
        const prevSameTrip = curr.find(
          (c) => c.dbId === dbShip.id && c.fishing && c.startedAt === startedAt,
        );
        const hasSailorNow = crewRowsRef.current.some(
          (r) => r.item_id === "sailor" && r.meta?.assigned_ship_id === dbShip.id,
        );
        const sailorAtStart = prevSameTrip
          ? !!prevSameTrip.sailorAtStart
          : (isFishing ? hasSailorNow : false);
        newShips.push({
          id: nextId,
          dbId: dbShip.id,
          catalogCode: dbShip.catalog_code,
          level: resolvedLevel,
          img: isUpSub ? getUpgradeSubImage(subStars) : shipDef.image,
          progress: 0,
          max: maxProg,
          timeLeft: duration,
          duration,
          scale: slot.scale,
          top: slot.top,
          dockLeft: slot.dockLeft,
          fishing: isFishing,
          sail: isFishing || onSteal ? 1 : 0,
          startedAt,
          hp: dbShip.hp ?? undefined,
          maxHp: dbShip.max_hp ?? undefined,
          destroyedAt: dbShip.destroyed_at,
          repairEndsAt: dbShip.repair_ends_at,
          stealingEndsAt: dbShip.stealing_ends_at,
          stealingTargetUserId: dbShip.stealing_target_user_id,
          stealingStartedAt: dbShip.stealing_started_at,
          stars: dbShip.stars ?? 1,
          maxStars: dbShip.max_stars ?? 1,
          sailorAtStart,
        });
      }

      const next = [...keptDb, ...newShips];
      // Bail only when nothing meaningful changed — including stealing state,
      // otherwise ships on steal missions won't disappear from the harbor.
      const sameLen = next.length === curr.length;
      const sameAll = sameLen && next.every((s, i) => {
        const c = curr[i];
        return s.dbId === c.dbId
          && (s.catalogCode ?? null) === (c.catalogCode ?? null)
          && s.level === c.level
          && s.max === c.max
          && (s.stars ?? null) === (c.stars ?? null)
          && (s.hp ?? null) === (c.hp ?? null)
          && (s.maxHp ?? null) === (c.maxHp ?? null)
          && (s.stealingTargetUserId ?? null) === (c.stealingTargetUserId ?? null)
          && (s.stealingEndsAt ?? null) === (c.stealingEndsAt ?? null)
          && (s.stealingStartedAt ?? null) === (c.stealingStartedAt ?? null)
          && !!s.fishing === !!c.fishing
          && (s.startedAt ?? null) === (c.startedAt ?? null)
          && !!s.sailorAtStart === !!c.sailorAtStart
          && (s.destroyedAt ?? null) === (c.destroyedAt ?? null)
          && (s.repairEndsAt ?? null) === (c.repairEndsAt ?? null);
      });
      return sameAll ? curr : next;

    });
  };
  useEffect(() => {
    // INSTANT first paint: pull fleet immediately so ships show their true
    // state (fishing / docked / damaged) without waiting for the server-time
    // round-trip. Then refresh the clock in the background and re-sync.
    syncFleetFromDb();
    (async () => {
      await syncServerTime(true);
      syncFleetFromDb();
    })();
    const onFocus = () => {
      syncServerTime(true).then(() => syncFleetFromDb());
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        syncServerTime(true).then(() => syncFleetFromDb());
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    // Live updates: any change to my own ships triggers an instant re-sync
    let ch: ReturnType<typeof supabase.channel> | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const kick = () => {
      if (debounce) clearTimeout(debounce);
      syncFleetFromDb();
    };
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid || cancelled) return;
      const created = supabase
        .channel(`my-ships-${uid}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "ships_owned", filter: `user_id=eq.${uid}` }, kick)
        .on("postgres_changes", { event: "*", schema: "public", table: "fish_stock", filter: `user_id=eq.${uid}` }, kick)
        .subscribe();
      if (cancelled) { supabase.removeChannel(created); return; }
      ch = created;
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      if (debounce) clearTimeout(debounce);
      if (ch) supabase.removeChannel(ch);
    };
  }, []);

  useEffect(() => {
    const activeRepairEnds = ships
      .map((s) => (s.repairEndsAt ? new Date(s.repairEndsAt).getTime() : 0))
      .filter((t) => Number.isFinite(t) && t > serverNowMs())
      .sort((a, b) => a - b);
    const nextRepairEnd = activeRepairEnds[0];
    if (!nextRepairEnd) return;
    const syncRepairs = async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        // Force: this path only runs when a repair timer is actually due, so
        // the throttle in maybeFinalizeShipRepairs must not skip it. Await the
        // RPC so the subsequent fleet sync sees repair_ends_at cleared.
        if (uid) await maybeFinalizeShipRepairs(uid, true);
      } catch { /* best-effort repair tick */ }
      syncFleetFromDb();
    };
    const delay = Math.min(Math.max(500, nextRepairEnd - serverNowMs() + 500), 60_000);
    const timer = window.setTimeout(syncRepairs, delay);
    const interval = window.setInterval(syncRepairs, 60_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [ships.map((s) => s.repairEndsAt ?? "").join("|")]);
  const { user } = useAuth();
  const { profile } = useProfile();
  const coins = profile?.coins ?? 0;
  const gems = profile?.gems ?? 0;
  const [dailyOpen, setDailyOpen] = useState(false);
  // Cached badges — show last value instantly when returning to home, refetch in background.
  const { data: dmUnread = 0, refetch: refetchDm } = useSwrCache<number>(
    user ? `home:dm:${user.id}` : null,
    async () => {
      const { loadDmUnreadMap } = await import("@/lib/dm-unread");
      const { total } = await loadDmUnreadMap(user!.id);
      return total;
    },
  );
  const { data: friendsUnread = 0, refetch: refetchFriends } = useSwrCache<number>(
    user ? `home:friendsPending:${user.id}` : null,
    async () => {
      const { count } = await supabase.from("friends")
        .select("id", { count: "exact", head: true })
        .eq("addressee_id", user!.id)
        .eq("status", "pending");
      return count ?? 0;
    },
  );

  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel(`home-badges:${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${user.id}` }, () => { refetchDm(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "friends", filter: `addressee_id=eq.${user.id}` }, () => { refetchFriends(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "user_blocks" }, () => { refetchDm(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, refetchDm, refetchFriends]);

  // Instant push: spectators viewing my harbor get a broadcast on every state change
  const myHarborChanRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [incomingFx, setIncomingFx] = useState<{ id: number; emoji: string; fromX: number; fromY: number; toX: number; toY: number; phase: "fly" | "boom"; friendly?: boolean; weaponId?: string } | null>(null);
  const [screenShake, setScreenShake] = useState<"" | "shake-sm" | "shake-md" | "shake-lg">("");

  // Play incoming attack/support FX on the owner side, anchored to the targeted ship.
  const playIncomingFx = useCallback((targetDbId: string, emoji: string, friendly: boolean, weaponId?: string) => {
    const el = typeof document !== "undefined" ? document.querySelector(`[data-ship-dbid="${targetDbId}"]`) as HTMLElement | null : null;
    let toX: number; let toY: number;
    if (el) {
      const r = el.getBoundingClientRect();
      toX = r.left + r.width / 2;
      toY = r.top + r.height / 2;
    } else {
      toX = window.innerWidth / 2;
      toY = window.innerHeight / 2;
    }
    const fromX = window.innerWidth - 40;
    const fromY = 60;
    const id = serverNowMs();
    setIncomingFx({ id, emoji, fromX, fromY, toX, toY, phase: "fly", friendly, weaponId });
    if (!friendly) sound.play("whoosh");
    const flyMs = weaponId === "nuke" ? 1100 : 850;
    window.setTimeout(() => {
      setIncomingFx((f) => (f && f.id === id ? { ...f, phase: "boom" } : f));
      if (!friendly) {
        sound.play(weaponId === "nuke" ? "nuke" : "explosion");
        const intensity =
          weaponId === "nuke" ? "shake-lg" :
          weaponId === "rocket_large" ? "shake-md" :
          weaponId === "rocket_medium" ? "shake-md" :
          "shake-sm";
        setScreenShake(intensity);
        if (weaponId === "nuke") {
          window.setTimeout(() => sound.play("explosion"), 600);
          window.setTimeout(() => sound.play("explosion"), 1200);
          window.setTimeout(() => setScreenShake(""), 1800);
        } else {
          window.setTimeout(() => setScreenShake(""), 900);
        }
      } else {
        sound.play("splash");
      }
    }, flyMs);
    const totalMs = weaponId === "nuke" ? 2300 : 1700;
    window.setTimeout(() => { setIncomingFx((f) => (f && f.id === id ? null : f)); }, totalMs);
  }, []);

  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel(`harbor:${user.id}`, { config: { broadcast: { self: false } } });
    // Listen for attack / support FX broadcast by visitors in my harbor.
    ch.on("broadcast", { event: "fx" }, ({ payload }) => {
      const d = payload as { targetId?: string; emoji?: string; friendly?: boolean; weaponId?: string; toast?: string };
      if (!d?.targetId || !d?.emoji) return;
      playIncomingFx(d.targetId, d.emoji, !!d.friendly, d.weaponId);
      if (d.toast) { setToast(d.toast); setTimeout(() => setToast(null), 1800); }
    });
    ch.subscribe();
    myHarborChanRef.current = ch;
    return () => { supabase.removeChannel(ch); myHarborChanRef.current = null; };
  }, [user?.id, playIncomingFx]);
  const pushHarborState = useCallback(() => {
    const ch = myHarborChanRef.current;
    if (!ch) return;
    try { ch.send({ type: "broadcast", event: "state", payload: { t: serverNowMs() } }); } catch {}
  }, []);

  // Auto-open the daily login once per day per device
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      await syncServerTime(true);
      if (cancelled) return;
      const key = `daily-login-shown:${user.id}`;
      const today = serverTodayKey();
      if (localStorage.getItem(key) !== today) {
        t = setTimeout(() => {
          if (cancelled) return;
        setDailyOpen(true);
        localStorage.setItem(key, today);
      }, 800);
      }
    })();
    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
    };
  }, [user]);

  const [fish, setFish] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const v = Number(window.localStorage.getItem("ocean.fishCount") || "0");
    return Number.isFinite(v) ? v : 0;
  });
  // Discovered fish species count (union of fish_caught history + current ship stock)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      const [{ data: caught }, { data: summary }] = await Promise.all([
        supabase.from("fish_caught").select("fish_id,total_caught").eq("user_id", user.id),
        supabase.rpc("get_fish_stock_summary" as never),
      ]);
      if (cancelled) return;
      const ids = new Set<string>();
      ((caught ?? []) as Array<{ fish_id: string; total_caught: number | null }>).forEach((r) => {
        if ((r.total_caught ?? 0) > 0) ids.add(r.fish_id);
      });
      ((summary ?? []) as Array<{ fish_id: string; qty: number | string }>).forEach((r) => {
        const q = typeof r.qty === "string" ? parseInt(r.qty, 10) : r.qty;
        if (q && q > 0) ids.add(r.fish_id);
      });
      setFish(ids.size);
      try { window.localStorage.setItem("ocean.fishCount", String(ids.size)); } catch {}
    };
    load();
    const onChanged = () => load();
    window.addEventListener("fish-stock-changed", onChanged);
    return () => { cancelled = true; window.removeEventListener("fish-stock-changed", onChanged); };
  }, [user]);
  const [pop, setPop] = useState<{ id: number; x: number; y: number; v: string } | null>(null);
  const [repairBtnOpen, setRepairBtnOpen] = useState(true);
  const [catchResult, setCatchResult] = useState<{ img?: string; emoji: string; name: string; count: number; shipId: number; shipLevel: number; luckBonus?: number; baseCount?: number } | null>(null);
  const [stealResult, setStealResult] = useState<{ count: number; value: number; items: { id: string; name: string; emoji: string; img?: string; qty: number }[]; cancelled?: boolean } | null>(null);
  const presentStealResult = (data: unknown, cancelled = false) => {
    const row = Array.isArray(data) && (data as unknown[])[0] ? (data as { stolen_count?: number; total_value?: number; fish_summary?: { fish_id: string; value: number; qty?: number }[] }[])[0] : null;
    const n = row?.stolen_count ?? 0;
    const v = row?.total_value ?? 0;
    const groups: Record<string, { id: string; name: string; emoji: string; img?: string; qty: number }> = {};
    (row?.fish_summary ?? []).forEach((it) => {
      const f = FISH[it.fish_id];
      const id = it.fish_id;
      if (!groups[id]) groups[id] = { id, name: f?.name ?? "سمكة", emoji: f?.emoji ?? "🐟", img: f?.img, qty: 0 };
      groups[id].qty += Math.max(1, Number(it.qty ?? 1));
    });
    setStealResult({ count: n, value: v, items: Object.values(groups), cancelled });
    sound.play(n > 0 ? "catch" : "click");
  };
  const [menuShipId, setMenuShipId] = useState<number | null>(null);
  const [modal, setModal] = useState<null | { kind: "sell" | "crew"; shipId: number }>(null);
  const [fishPickerShipId, setFishPickerShipId] = useState<number | null>(null);
  // When true, the picker only updates the guide's preferred fish without launching/collecting.
  const [fishPickerChangeOnly, setFishPickerChangeOnly] = useState(false);
  const [upgradeSubShipId, setUpgradeSubShipId] = useState<number | null>(null);
  const [upgradeSubBusy, setUpgradeSubBusy] = useState(false);
  const [upgradeSubResult, setUpgradeSubResult] = useState<{ success: boolean; stars: number; chance: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [boostOpen, setBoostOpen] = useState(false);
  const [leaderboardRestore, setLeaderboardRestore] = useState<LeaderboardRestore | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const source = consumePlayerReturnSource();
    if (source?.kind === "leaderboard" && isLeaderboardTab(source.tab)) {
      setLeaderboardRestore({ tab: source.tab, q: source.q ?? "", tribeQ: source.tribeQ ?? "" });
      setBoostOpen(true);
    }
  }, []);

  // Start ambient music on first user gesture (autoplay policy)
  useEffect(() => {
    const start = () => {
      sound.resume();
      if (sound.getMusic()) sound.startMusic();
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1600);
  };

  const now = useServerTick();
  type CrewRow = { id: string; item_id: string; quantity: number; meta: { assigned_ship_id?: number | string; assigned_at?: string; expires_at?: string } | null };
  const [crewRows, setCrewRows] = useState<CrewRow[]>([]);
  const crewBusyRef = useRef(false);
  const [crewBusy, setCrewBusy] = useState(false);
  const [buyingCrewId, setBuyingCrewId] = useState<string | null>(null);
  const buyingCrewRef = useRef<string | null>(null);
  const [crewBuyQty, setCrewBuyQty] = useState<Record<string, number>>({});
  const crewRowsRef = useRef<CrewRow[]>([]);
  const crewLoadedRef = useRef(false);
  useEffect(() => { crewRowsRef.current = crewRows; }, [crewRows]);
  // Track golden_fisher_until from profile so the per-frame ship loop can detect
  // GF activation even when no inventory crew row exists (activate consumes it).
  const goldenFisherUntilRef = useRef<number>(0);
  useEffect(() => {
    const t = (profile as any)?.golden_fisher_until;
    goldenFisherUntilRef.current = t ? new Date(t).getTime() : 0;
  }, [profile]);
  const lastGfTickRef = useRef<number>(0);
  const gfTickInFlightRef = useRef(false);
  // Timestamp of the most recent tick that actually advanced fishing_started_at.
  // Used to release the ratio clamp when the tick stalls (RPC failure, permission
  // denied, throttle) so ships don't freeze at 99% forever.
  const lastGfAdvanceAtRef = useRef<number>(0);
  // Safety: reset any stuck busy flag whenever the crew modal opens/closes
  useEffect(() => {
    crewBusyRef.current = false;
    setCrewBusy(false);
  }, [modal?.kind, modal?.shipId]);

  // Match crew row to a ship by either local numeric id OR ship UUID (dbId).
  // Support sent from other players uses the UUID (ship_id) since they don't
  // know our local fleet numbering.
  const isCrewAssignedToShip = (
    meta: { assigned_ship_id?: number | string } | null | undefined,
    ship: { id: number; dbId?: string },
  ) => {
    const a = meta?.assigned_ship_id;
    if (a == null) return false;
    if (typeof a === "number") return a === ship.id;
    return a === ship.dbId || a === String(ship.id);
  };

  // Same as above, but ALSO requires the assignment to still be active
  // (expires_at in the future). Use this for any display surface — expired
  // crews should not appear on the ship UI even if the row hasn't been
  // deleted yet by the periodic sweep.
  const isCrewActiveOnShip = (
    meta: { assigned_ship_id?: number | string; expires_at?: string } | null | undefined,
    ship: { id: number; dbId?: string },
    nowMs: number,
  ) => {
    if (!isCrewAssignedToShip(meta, ship)) return false;
    const exp = meta?.expires_at ? new Date(meta.expires_at).getTime() : Infinity;
    return exp > nowMs;
  };

  // Active crew bonuses for a given ship (luck doubles fish, sailor -50% time, guide reveals fish)
  const getCrewBonuses = (ship: Ship) => {
    const assigned = crewRowsRef.current.filter((r) => isCrewAssignedToShip(r.meta, ship));
    const ids = new Set(assigned.map((r) => r.item_id));
    return {
      sailorMult: ids.has("sailor") ? (1 / 0.5) : 1, // 50% time reduction
      hasSailor: ids.has("sailor"),
      guide: ids.has("guide"),
      hasLuck: ids.has("luck"),
    };
  };

  const getEffectiveFishingElapsed = (ship: Ship, nowMs: number) => {
    if (!ship.startedAt) return { elapsed: 0, activeMult: 1 };
    const wallElapsed = Math.max(0, (nowMs - ship.startedAt) / 1000);
    let bonusElapsed = 0;
    let activeMult = 1;
    let sawSailorRow = false;
    for (const row of crewRowsRef.current) {
      if (row.item_id !== "sailor" || !isCrewAssignedToShip(row.meta, ship)) continue;
      sawSailorRow = true;
      const assignedAt = row.meta?.assigned_at ? new Date(row.meta.assigned_at).getTime() : ship.startedAt;
      const expiresAt = row.meta?.expires_at ? new Date(row.meta.expires_at).getTime() : Infinity;
      if (expiresAt <= ship.startedAt || assignedAt > nowMs) continue;
      const boostStart = Math.max(ship.startedAt, assignedAt || ship.startedAt);
      const boostEnd = Math.min(nowMs, expiresAt);
      if (boostEnd > boostStart) bonusElapsed += (boostEnd - boostStart) / 1000;
      if (expiresAt > nowMs) activeMult = 2;
    }
    // Fallback: crew inventory hasn't loaded from the server yet (right after
    // refresh). If this trip was started with a sailor assigned, optimistically
    // apply the 2x boost so the timer doesn't visually jump from 10m → 20m
    // and then back to 10m once crew rows arrive.
    if (!sawSailorRow && !crewLoadedRef.current && ship.sailorAtStart) {
      bonusElapsed = wallElapsed;
      activeMult = 2;
    }
    return { elapsed: wallElapsed + bonusElapsed, activeMult };
  };

  // Deterministic per-trip fish pick so the Guide crew's preview matches the actual catch.
  const predictTripFish = (pool: string[], shipId: number, startedAt?: number): string | null => {
    if (pool.length === 0) return null;
    const seed = (((startedAt ?? 0) >>> 0) ^ ((shipId * 2654435761) >>> 0)) >>> 0;
    return pool[seed % pool.length];
  };

  const fishPoolForShip = (ship: Ship) => {
    const def = ship.catalogCode ? getShipByCode(ship.catalogCode) : getShipByMarketLevel(ship.level);
    const shipPool = def.fishPool.filter((fishId) => !!FISH[fishId]);
    return shipPool.length > 0 ? shipPool : fishForShip(ship.level, ship.id);
  };

  // (1-second tick is provided by the shared `useServerTick()` hook above.)

  // Load crew inventory rows + auto-purge expired
  const reloadCrews = async () => {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) { setCrewRows([]); return; }
    const { data } = await supabase
      .from("inventory")
      .select("id,item_id,quantity,meta")
      .eq("user_id", uid)
      .eq("item_type", "crew");
    const rows = (data ?? []) as CrewRow[];
    // Auto-purge expired crew rows so they free up the ship's slot.
    // EXCEPTION: keep expired *sailor* rows still attached to a ship currently
    // at sea — the sailor's -50% time bonus is baked into the trip duration
    // and removing it mid-trip would corrupt the catch math (completed 13k
    // trips would collect as ~6k). Other expired crews (luck/guide/police/
    // thief/trader/fixer) are safe to delete the moment they expire.
    const nowMs = serverNowMs();
    const activeShipIds = new Set(shipsRef.current.filter((s) => s.fishing && s.dbId).map((s) => s.dbId!));
    const expired = rows.filter((r) => r.meta?.expires_at && new Date(r.meta.expires_at).getTime() <= nowMs);
    const keepForTrip = (r: CrewRow) => {
      if (r.item_id !== "sailor") return false;
      const sid = r.meta?.assigned_ship_id;
      return typeof sid === "string" && activeShipIds.has(sid);
    };
    const toDelete = expired.filter((r) => !keepForTrip(r));
    if (toDelete.length) {
      // Fire-and-forget; realtime subscription will refresh us after delete.
      deleteInventoryRows(toDelete.map((r) => r.id)).catch(() => {});
    }
    setCrewRows(rows.filter((r) => !expired.includes(r) || keepForTrip(r)));
    crewLoadedRef.current = true;
  };
  useEffect(() => {
    reloadCrews();
    const onFocus = () => reloadCrews();
    window.addEventListener("focus", onFocus);
    let ch: any;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid || cancelled) return;
      const created = supabase
        .channel(`my-inv-${uid}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "inventory", filter: `user_id=eq.${uid}` }, () => reloadCrews())
        .subscribe();
      if (cancelled) { supabase.removeChannel(created); return; }
      ch = created;
    })();
    // Periodic sweep so expired crews free up their slot without waiting for
    // a focus event or another inventory change (covers the case where a user
    // sits on the harbor screen and a crew's timer ticks to 0).
    const sweep = window.setInterval(() => {
      const nowMs2 = serverNowMs();
      const hasPurgeable = crewRowsRef.current.some((r) => {
        if (!r.meta?.expires_at) return false;
        if (new Date(r.meta.expires_at).getTime() > nowMs2) return false;
        // Skip sailor still tied to an at-sea ship (preserved for trip math).
        if (r.item_id === "sailor") {
          const sid = r.meta?.assigned_ship_id;
          const stillAtSea = shipsRef.current.some((s) => s.fishing && s.dbId === sid);
          if (stillAtSea) return false;
        }
        return true;
      });
      if (hasPurgeable) reloadCrews();
    }, 15000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(sweep);
      if (ch) supabase.removeChannel(ch);
    };
  }, [modal, crewTick]);

  const [marketLevel, setMarketLevel] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const v = Number(window.localStorage.getItem("ocean.marketLevel"));
    return Number.isFinite(v) && v >= 1 ? Math.min(30, v) : 1;
  });
  const [fishMarketLevel, setFishMarketLevel] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const v = Number(window.localStorage.getItem("ocean.fishMarketLevel"));
    return Number.isFinite(v) && v >= 1 ? Math.min(30, v) : 1;
  });
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      // Finalize any completed upgrades so the level reflects instantly
      await supabase.rpc("finalize_market_upgrades");
      await supabase.rpc("finalize_fish_market_upgrades" as never);
      const [{ data: shipRow }, { data: fishRow }] = await Promise.all([
        supabase.from("user_market").select("level").eq("user_id", user.id).maybeSingle(),
        supabase.from("user_fish_market" as never).select("level").eq("user_id", user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      const sLvl = Math.max(1, Math.min(30, (shipRow as any)?.level ?? 1));
      const fLvl = Math.max(1, Math.min(30, (fishRow as any)?.level ?? 1));
      setMarketLevel(sLvl);
      setFishMarketLevel(fLvl);
      try {
        window.localStorage.setItem("ocean.marketLevel", String(sLvl));
        window.localStorage.setItem("ocean.fishMarketLevel", String(fLvl));
      } catch {}
    };
    load();
    const ch = supabase
      .channel(`my-market-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_market", filter: `user_id=eq.${user.id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_fish_market", filter: `user_id=eq.${user.id}` }, load)
      .subscribe();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    // Realtime channel + focus reload cover updates. Slow poll (30s) as a safety net.
    const poll = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      clearInterval(poll);
      supabase.removeChannel(ch);
    };
  }, [user]);



  const [bgId, setBgId] = useState<string>(() => getSelectedBgId());
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) return;
      const { data: prof } = await supabase
        .from("profiles").select("selected_bg_id").eq("id", uid).maybeSingle();
      const dbId = (prof as any)?.selected_bg_id as string | null | undefined;
      const local = getSelectedBgId();
      if (dbId) {
        if (dbId !== local) {
          if (typeof window !== "undefined") window.localStorage.setItem("ocean.bg.selected", dbId);
          setBgId(dbId);
        }
      } else if (local) {
        await supabase.from("profiles").update({ selected_bg_id: local }).eq("id", uid);
      }
    })();
    const onFocus = () => setBgId(getSelectedBgId());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  const scene = getSceneVisual(bgId, (profile as any)?.bg_burned_until);
  const slotOverrides = useShipSlotOverrides(scene.id);
  const shipSlotLayoutReady = useShipSlotLayoutReady();
  const editor = useShipSlotEditor();

  // Incoming raids: ships from other players currently stealing from me
  type Raid = { ship_id: string; attacker_id: string; attacker_name: string; attacker_emoji: string; ends_at: string; template_id: number; target_ship_id: string | null };
  const [raids, setRaids] = useState<Raid[]>([]);
  const reloadRaids = async () => {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) { setRaids([]); return; }
    const { data: ships } = await supabase
      .from("ships_owned")
      .select("id,user_id,stealing_ends_at,template_id,stealing_target_ship_id")
      .eq("stealing_target_user_id", uid)
      .neq("user_id", uid)
      .not("stealing_target_user_id", "is", null);
    const list = (ships ?? []).filter((s: any) => s.user_id !== uid) as { id: string; user_id: string; stealing_ends_at: string | null; template_id: number | null; stealing_target_ship_id: string | null }[];
    if (list.length === 0) { setRaids([]); return; }
    const ids = Array.from(new Set(list.map((s) => s.user_id)));
    const { data: profs } = await supabase
      .from("profiles").select("id,display_name,avatar_emoji").in("id", ids);
    const pmap = new Map((profs ?? []).map((p: any) => [p.id, p]));
    const nextRaids = list.map((s) => ({
      ship_id: s.id,
      attacker_id: s.user_id,
      attacker_name: pmap.get(s.user_id)?.display_name || "لاعب",
      attacker_emoji: pmap.get(s.user_id)?.avatar_emoji || "🧑‍✈️",
      ends_at: s.stealing_ends_at || serverNow().toISOString(),
      template_id: s.template_id ?? 1,
      target_ship_id: s.stealing_target_ship_id,
    }));
    setRaids(nextRaids);
    const targetedShipIds = new Set(nextRaids.map((r) => r.target_ship_id).filter(Boolean) as string[]);
    if (targetedShipIds.size > 0) {
      setShips((curr) => curr.map((s) => {
        if (!s.dbId || !targetedShipIds.has(s.dbId)) return s;
        delete seaStateOverrideRef.current[s.dbId];
        return { ...s, fishing: false, startedAt: undefined, progress: 0, sail: 0 };
      }));
    }
  };
  useEffect(() => {
    reloadRaids();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? null;
      if (!uid || cancelled) return;
      const ch = supabase
        .channel(`raids-${uid}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "ships_owned", filter: `stealing_target_user_id=eq.${uid}` }, () => reloadRaids())
        .subscribe();
      if (cancelled) { supabase.removeChannel(ch); return; }
      channel = ch;
    })();
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, []);
  const catchThief = async (shipId: string) => {
    const { error } = await (supabase as any).rpc("catch_thief", { _attacker_ship_id: shipId });
    if (error) { showToast("تعذّر القبض"); return; }
    sound.play("success");
    showToast("🚔 قبضت على اللص! ممنوع من السرقة ساعة");
    reloadRaids();
  };

  // Auto-catch: if police is assigned to the ship being raided, instantly catch the thief.
  useEffect(() => {
    if (raids.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid || cancelled) return;
      const { data: police } = await supabase
        .from("inventory")
        .select("meta")
        .eq("user_id", uid)
        .eq("item_type", "crew")
        .eq("item_id", "police")
        .gt("quantity", 0);
      const guardedShips = new Set<string>();
      for (const row of (police ?? []) as Array<{ meta: any }>) {
        const sid = row.meta?.assigned_ship_id;
        const exp = row.meta?.expires_at ? new Date(row.meta.expires_at).getTime() : Infinity;
        if (sid && exp > Date.now()) guardedShips.add(String(sid));
      }
      if (guardedShips.size === 0) return;
      for (const r of raids) {
        if (cancelled) break;
        if (r.target_ship_id && guardedShips.has(r.target_ship_id)) {
          await (supabase as any).rpc("catch_thief", { _attacker_ship_id: r.ship_id });
        }
      }
      if (!cancelled) { sound.play("success"); reloadRaids(); }
    })();
    return () => { cancelled = true; };
  }, [raids.map((r) => r.ship_id).join(",")]);

  // Outgoing steal missions — my ships currently raiding others. Banner lets the
  // user jump straight back to the target harbor to watch or cancel the raid.
  const [stealTargetNames, setStealTargetNames] = useState<Record<string, { name: string; emoji: string }>>({});
  const outgoingSteals = ships.filter((s) => s.stealingTargetUserId && s.stealingEndsAt);
  useEffect(() => {
    const missing = Array.from(new Set(outgoingSteals.map((s) => s.stealingTargetUserId!).filter((id) => !stealTargetNames[id])));
    if (missing.length === 0) return;
    (async () => {
      const { data } = await supabase.from("profiles").select("id,display_name,avatar_emoji").in("id", missing);
      if (data && data.length) {
        setStealTargetNames((prev) => {
          const next = { ...prev };
          for (const p of data as any[]) next[p.id] = { name: p.display_name || "لاعب", emoji: p.avatar_emoji || "🧑‍✈️" };
          return next;
        });
      }
    })();
  }, [outgoingSteals.map((s) => s.stealingTargetUserId).join(",")]);

  // Auto-claim expired steal missions — loot arrives automatically.
  // Use a ref for ships so the interval is created once, not on every state tick.
  const shipsForClaimRef = useRef(ships);
  shipsForClaimRef.current = ships;
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.hidden) return;
      const cur = shipsForClaimRef.current;
      const expired = cur.filter((s) => s.stealingTargetUserId && s.stealingEndsAt && new Date(s.stealingEndsAt).getTime() <= serverNowMs() && s.dbId);
      for (const s of expired) {
        const { data, error } = await (supabase as any).rpc("claim_steal_mission", { _attacker_ship_id: s.dbId, _force: false });
        if (!error) {
          presentStealResult(data, false);
          syncFleetFromDb();
        }
      }
    }, 20000);
    return () => clearInterval(id);
  }, []);



  // Progress + sail animation ticker — strictly time-proportional.
  // Performance: rAF-driven, throttled to ~30fps, paused when tab is hidden,
  // and short-circuited when there is no animation work to do (saves CPU/GPU
  // when all ships are idle in the harbor → reduces device heat).
  useEffect(() => {
    let raf = 0;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let last = 0;
    // Ship travel is now CSS-transition driven: React only flips the target
    // endpoint (dock/sea), avoiding many tiny state updates that looked choppy
    // on phones. Progress still ticks, but at a calm UI cadence.
    const MOVE_FRAME_MS = 100;
    const PROGRESS_FRAME_MS = isHeavyFxDisabled ? 750 : 500;
    const IDLE_MS = isHeavyFxDisabled ? 250 : 500;
    const EPS = 0.001;

    function schedule(nextDelay: number) {
      if (nextDelay <= MOVE_FRAME_MS + 1) {
        raf = requestAnimationFrame(tick);
      } else {
        timeout = setTimeout(() => { raf = requestAnimationFrame(tick); }, nextDelay);
      }
    }

    function tick(ts: number) {
      if (document.hidden) { schedule(IDLE_MS); return; }
      if (ts - last < MOVE_FRAME_MS) { raf = requestAnimationFrame(tick); return; }
      const dt = last === 0 ? MOVE_FRAME_MS : ts - last;
      last = ts;

      const now = serverNowMs();
      let dirty = false;
      let sailBusy = false;
      let progressBusy = false;
      setShips((curr) => {
        const next = curr.map((s) => {
          const target = s.fishing ? 1 : 0;
          const sailMoving = Math.abs(target - s.sail) > EPS;
          if (sailMoving) sailBusy = true;
          const sail = sailMoving ? target : s.sail;


          if (!s.fishing || !s.startedAt) {
            if (!sailMoving) return s; // no change → skip re-render
            dirty = true;
            return { ...s, sail };
          }
          progressBusy = true; // fishing ship → keep ticking, but slowly in Lite Mode
          if (s.dbId && !isServerClockSynced()) {
            if (!sailMoving && s.progress === 0 && s.timeLeft === s.duration) return s;
            dirty = true;
            return { ...s, sail, progress: 0, timeLeft: s.duration };
          }
          const { elapsed, activeMult } = getEffectiveFishingElapsed(s, now);
          let ratio = Math.min(1, elapsed / Math.max(1, s.duration));
          if (ratio > 0.99) {
            const gfActive =
              goldenFisherUntilRef.current > now ||
              crewRowsRef.current.some(
                (r) => r.item_id === "golden_fisher" && r.meta?.expires_at && new Date(r.meta.expires_at).getTime() > now,
              );
            // Only clamp ratio to hide a one-frame flash to 100% before the
            // server tick re-ages the timer. When the market is full the tick
            // can never advance the timer, so DON'T clamp — let the ship show
            // as "✅ ready" so the player can sell + collect manually.
            // Also release the clamp if the tick hasn't successfully advanced
            // in the last 5 seconds (RPC failure / permission denied / stalled
            // network) — otherwise the ship freezes at 188,100/190,000 forever.
            const tickIsFresh = (now - lastGfAdvanceAtRef.current) < 5000;
            if (gfActive && !gfMarketFullRef.current && tickIsFresh) {
              ratio = 0.99;
            }
            if (gfActive && !gfMarketFullRef.current) {
              // Throttle to ~once per 1.5s. The old 200ms cadence made every
              // ready-ship frame fire an RPC + full fleet re-sync, which
              // stacked into a heavy loop that visibly slowed the game.
              if (!gfTickInFlightRef.current && now - lastGfTickRef.current > 1500) {
                lastGfTickRef.current = now;
                gfTickInFlightRef.current = true;
                tickGoldenFisher({ data: {} })
                  .then((res: any) => {
                    const wasFull = gfMarketFullRef.current;
                    const isFull = !!res?.market_full;
                    gfMarketFullRef.current = isFull;
                    if (res && res.ok === true && !isFull) {
                      lastGfAdvanceAtRef.current = Date.now();
                    }
                    if (isFull && !wasFull) {
                      setToast("📦 سوق السمك ممتلئ! الصياد الذهبي توقف — فرّغ السوق ليبدأ الصيد من جديد");
                      setTimeout(() => setToast(null), 3500);
                      try { sound.play("error"); } catch {}
                    }
                    // Only re-sync from DB when the server actually advanced
                    // fishing timers or launched ships — otherwise this fires
                    // several times per second for nothing and lags the UI.
                    const shipsTouched = Number(res?.ships ?? 0) > 0 || Number(res?.launched ?? 0) > 0 || Number(res?.cycles ?? 0) > 0;
                    if (shipsTouched) syncFleetFromDb();
                  })
                  .catch(() => {})
                  .finally(() => { gfTickInFlightRef.current = false; });

              }
            }

          }
          // Same fishing trip should never visually go backwards. On reopen the
          // fleet snapshot may show 13,000 before crew history finishes loading;
          // keep that full value instead of dropping to the unboosted ~6,000.
          const progress = Math.max(s.progress, Math.round(s.max * ratio));
          // Don't divide by activeMult here — `elapsed` already includes the
          // sailor bonus accumulated since assignment. Dividing again would
          // halve the remaining time instantly when sailor is assigned mid-trip.
          const timeLeft = Math.max(0, s.duration - elapsed);
          if (!sailMoving && progress === s.progress && Math.abs(timeLeft - s.timeLeft) < 0.25) {
            return s;
          }

          dirty = true;
          return { ...s, sail, progress, timeLeft };
        });
        return dirty ? next : curr;
      });

      // If only timers are running, sleep longer; if a ship is physically
      // sailing, keep enough frames for smooth motion.
      schedule(sailBusy ? MOVE_FRAME_MS : progressBusy ? PROGRESS_FRAME_MS : IDLE_MS);
    }
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (timeout) clearTimeout(timeout);
    };
  }, []);


  const isDestroyed = (x: Ship) => isShipBlocked(x.destroyedAt, x.repairEndsAt, x.hp, x.maxHp);

  const toggleFishing = (shipId: number) => {
    const target = ships.find((x) => x.id === shipId);
    if (!target) return;

    // Guard double-tap
    if (target.dbId && collectingRef.current[target.dbId]) return;

    // Destroyed-ship guard (sync, no awaits)
    if (isDestroyed(target) && !target.fishing) {
      showToast("السفينة مدمّرة — انتظر حتى يكتمل الإصلاح");
      sound.play("error");
      return;
    }

    const dbIdToSync = target.dbId;
    const nextAtSea = !target.fishing;

    // ── onMutate: Snapshot previous state for rollback ──────────────
    const prevShipSnapshot: Ship = { ...target };
    const prevSeaOverride = dbIdToSync ? seaStateOverrideRef.current[dbIdToSync] : undefined;

    if (dbIdToSync) collectingRef.current[dbIdToSync] = true;

    // ── Optimistic update: instant UI change, ZERO awaits ──────────
    const startNow = serverNowMs();
    const nextStartedAt = nextAtSea ? startNow : undefined;

    if (dbIdToSync) setSeaOverride(dbIdToSync, nextAtSea, nextStartedAt);
    const sailorOnStart = getCrewBonuses(target).hasSailor;
    setShips((curr) =>
      curr.map((x) => {
        if (x.id !== shipId) return x;
        if (x.fishing) {
          return { ...x, fishing: false, startedAt: undefined, progress: 0, timeLeft: x.duration, sailorAtStart: false };
        }
        return { ...x, fishing: true, startedAt: nextStartedAt, sailorAtStart: sailorOnStart };
      })
    );
    sound.play("whoosh");
    pushHarborState();


    // ── Background mutation (fire-and-forget with rollback) ─────────
    if (!dbIdToSync) return;

    // Fire RPC immediately — clock sync runs in parallel, never blocks the request.
    if (!nextAtSea && !isServerClockSynced()) {
      syncServerTime(true).catch(() => {});
    }

    setShipAtSea(dbIdToSync, nextAtSea)
      .then(({ error }) => {
        if (error) throw error;
        // onSuccess
        clearSeaOverrideSoon(dbIdToSync);
      })
      .catch(() => {
        // ── onError: Rollback to snapshot ─────────────────────────────
        if (prevSeaOverride) {
          seaStateOverrideRef.current[dbIdToSync] = prevSeaOverride;
        } else {
          delete seaStateOverrideRef.current[dbIdToSync];
        }
        setShips((curr) => curr.map((x) => (x.id === shipId ? prevShipSnapshot : x)));
        showToast(nextAtSea ? "تعذّر إرسال السفينة للصيد" : "تعذّر إيقاف الصيد");
        sound.play("error");
      })
      .finally(() => {
        // ── onSettled: release lock + reconcile with server ──────────
        delete collectingRef.current[dbIdToSync];
        syncFleetFromDb();
      });
  };

  const collect = async (shipId: number, e: React.MouseEvent) => {
    const targetEl = e.currentTarget as HTMLElement | null;
    const popAnchor = targetEl
      ? targetEl.getBoundingClientRect()
      : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0 };
    const s = ships.find((x) => x.id === shipId);
    if (!s) return;
    // Docked & empty → start fishing (sail out)
    if (s.progress <= 0 && !s.fishing) {
      await toggleFishing(shipId);
      return;
    }
    // Always forward the user's chosen fish (if any) — the server validates
    // that the guide crew is actually assigned and the fish is in the pool.
    // Don't gate on the local `guide` bool: crew rows may not have refreshed
    // yet after a fresh assignment, which would silently drop the request.
    const storedGuide = getShipGuide(s.id);
    const requestedFishId = storedGuide || null;
    // Destroyed ships cannot fish at all until fully repaired.
    if (isDestroyed(s)) {
      showToast("السفينة مدمّرة — انتظر حتى يكتمل الإصلاح");
      setShips((curr) =>
        curr.map((x) => x.id === shipId ? { ...x, progress: 0, timeLeft: x.duration, fishing: false, startedAt: undefined } : x)
      );
      if (s.dbId) {
        setShipAtSea(s.dbId!, false).catch(() => {});
      }
      return;
    }

    if (!s.dbId) {
      showToast("حدّث الأسطول أولاً");
      syncFleetFromDb();
      return;
    }

    // Note: server-side collect_fishing_reward already caps by user_market_remaining,
    // so no pre-check is needed — drops a network roundtrip for instant response.

    // Guard against double-tap that would race the RPC and produce "not_fishing".
    if (collectingRef.current[s.dbId]) return;
    collectingRef.current[s.dbId] = true;
    // Safety net: never let the lock stick — force-release after 15s so the
    // ship never becomes permanently un-tappable if the RPC or a rejection
    // escapes the try/finally below (e.g. unhandled navigation).
    const _lockKey = s.dbId;
    const _lockTimeout = window.setTimeout(() => {
      delete collectingRef.current[_lockKey];
    }, 15000);

    try {

    // Optimistic: dock the ship instantly so stopping/collecting feels immediate.
    setSeaOverride(s.dbId, false);
    setShips((curr) => curr.map((x) => x.id === shipId ? { ...x, progress: 0, timeLeft: x.duration, fishing: false, startedAt: undefined } : x));
    sound.play("whoosh");

    // Instant predictive popup — always shown, before the server responds, so
    // the player never waits. Count is computed with the same formula the
    // server uses (min(client_progress, capacity) * luck), so under normal
    // conditions the server will return the exact same number.
    const _crewNow = getCrewBonuses(s);
    const _luckMult = _crewNow.hasLuck ? 2 : 1;
    const _predFishId = (_crewNow.guide && requestedFishId) ? requestedFishId : null;
    const _predFish = _predFishId ? FISH[_predFishId] : null;
    // Use actual rounded progress — don't force-min to 1, otherwise stopping a
    // ship that barely sailed shows "1 fish" while the server returns 0.
    const _predBase = Math.max(0, Math.min(s.max, Math.round(s.progress)));
    const _predCount = _predBase * _luckMult;
    if (_predCount > 0) {
      setCatchResult({
        img: _predFish?.img,
        emoji: _predFish?.emoji ?? "🎣",
        name: _predFish?.name ?? "سمكة",
        count: _predCount,
        shipId: s.id,
        shipLevel: s.level,
        baseCount: _predBase,
        luckBonus: _predCount - _predBase,
      });
    }


    // Fire clock sync in background (do not block the reward RPC).
    if (!isServerClockSynced()) {
      syncServerTime(true).catch(() => {});
    }



    // Show the result as soon as the server responds — no artificial delay.
    // Cap server reward by what the player actually saw on the progress bar
    // at the moment of tap (the optimistic dock above zero'd `progress`, so
    // use the snapshot captured before the reset). Server still applies its
    // own cap; this only ever LOWERS the value — never raises it — so the
    // player can never receive more fish than the bar displayed.
    const _clientProgress = Math.max(0, Math.min(s.max, Math.round(s.progress)));
    const { data, error } = await (supabase as any).rpc("collect_fishing_reward", {
      _ship_id: s.dbId,
      _requested_fish_id: requestedFishId,
      _client_progress: _clientProgress,
    });
    if (error) {
      delete collectingRef.current[s.dbId];
      // Do NOT clear catchResult here — keep the optimistic popup visible
      // so the player always sees a result. Specific branches below replace it.


      const msg = String(error.message || "");

      // Special case: market full. The DB rolled back, the ship is STILL
      // fishing — do NOT dock locally and do NOT touch at_sea on the server.
      // Just revert the optimistic dock by re-syncing from DB.
      if (msg.includes("market_full")) {
        // Revert optimistic dock: put the ship back at sea with its original
        // fishing_started_at so the timer keeps running, then re-sync from DB.
        const startedAtMs = s.startedAt ?? (serverNowMs() - (s.duration - s.timeLeft) * 1000);
        setSeaOverride(s.dbId, true, startedAtMs);
        setShips((curr) => curr.map((x) => x.id === shipId ? { ...x, fishing: true, startedAt: startedAtMs } : x));
        showToast("📦 المخزن ممتلئ! بِع السمك أولاً، السفينة لا تزال تصيد");
        sound.play("error");
        syncFleetFromDb();
        return;
      }

      // Rollback: dock locally + force-stop on server so UI stays in sync.
      setSeaOverride(s.dbId, false);
      setShips((curr) => curr.map((x) => x.id === shipId ? { ...x, progress: 0, timeLeft: x.duration, fishing: false, startedAt: undefined } : x));
      if (s.dbId) {
        setShipAtSea(s.dbId!, false).catch(() => {});
      }
      // Keep the optimistic predictive popup — the RPC frequently commits
      // server-side even when the response never reaches us (network drop,
      // timeout, tab throttle) OR the cycle was already collected by the
      // golden fisher tick which also inserts into fish_stock. Replacing the
      // popup with "no fish added" would lie in those common cases. Fleet
      // sync + realtime on fish_stock reveal the truth within ~1s.

      if (msg.includes("ship_destroyed")) showToast("السفينة مدمّرة — انتظر الإصلاح");
      else if (msg.includes("not_fishing")) {
        // Server already considers the ship docked (stale local state — another
        // tab/device collected, realtime lag, or a golden-fisher tick consumed
        // the cycle). Without feedback the player thinks the ship returned empty.
        // Show a clear toast, refresh fleet, and auto-relaunch when possible so
        // they don't lose time.
        showToast("🔄 تم تحديث حالة السفينة — أعد المحاولة");
        sound.play("error");
      } else if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("network")) {
        showToast("⚠️ انقطع الاتصال — حاول مرة ثانية");
        sound.play("error");
      } else {
        showToast(`تعذّر استلام الصيد: ${msg || "خطأ غير معروف"}`);
        sound.play("error");
      }

      syncFleetFromDb();
      return;
    }
    delete collectingRef.current[s.dbId];
    // Lock UI to "docked" so realtime echoes can't briefly flip it back to fishing.
    setSeaOverride(s.dbId, false);
    // Force-dock on server so any stale at_sea=true row can't bounce the ship
    // back into fishing right after collect (this was causing the "stops then
    // suddenly re-starts" hang). Fire-and-forget; override already locks UI.
    setShipAtSea(s.dbId, false).catch(() => {});

    const row = Array.isArray(data) ? data[0] : data;
    const caughtId = row?.fish_id as string | undefined;
    const caught = caughtId ? FISH[caughtId] : null;
    const fishGained = Number(row?.fish_qty ?? 0);
    const baseFish = Number(row?.base_qty ?? fishGained);
    const luckBonus = Number(row?.luck_bonus ?? 0);
    if (fishGained <= 0) {
      // No fish (likely market full). Dock + show popup so user gets a clear result.
      setShips((curr) =>
        curr.map((x) =>
          x.id === shipId
            ? { ...x, progress: 0, timeLeft: x.duration, fishing: false, startedAt: undefined }
            : x
        )
      );
      setCatchResult({
        emoji: "📦",
        name: "سوق السمك ممتلئ — بيع قبل ما تصيد",
        count: 0,
        shipId: s.id,
        shipLevel: s.level,
      });
      window.setTimeout(() => { try { syncFleetFromDb(); } catch {} }, 600);
      return;
    }
    setFish((f) => f + fishGained);

    sound.play("splash");
    setTimeout(() => sound.play("coin"), 180);
    setTimeout(() => sound.play("catch"), 320);
    setShips((curr) =>
      curr.map((x) =>
        x.id === shipId
          ? { ...x, progress: 0, timeLeft: x.duration, fishing: false, startedAt: undefined }
          : x
      )
    );
    // Delay fleet sync slightly so the server-side dock + collect commit are
    // visible before we re-read at_sea (prevents UI flicker back to fishing).
    window.setTimeout(() => { try { syncFleetFromDb(); } catch {} }, 600);
    // Instant push to spectators
    pushHarborState();
    // Optimistically bump the fish-market stock cache so the count shows
    // instantly the moment the user opens /fish-market (no realtime wait).
    if (caughtId && profile?.id) {
      try {
        const key = `fish-market:stock:${profile.id}`;
        const prev = getCached<{ qty: Record<string, number>; ages: Record<string, string> }>(key) ?? { qty: {}, ages: {} };
        const nextQty = { ...prev.qty, [caughtId]: (prev.qty[caughtId] ?? 0) + fishGained };
        const nextAges = { ...prev.ages };
        if (!nextAges[caughtId]) nextAges[caughtId] = new Date().toISOString();
        setCached(key, { qty: nextQty, ages: nextAges });
      } catch {}
      // Invalidate any list caches that depend on stock.
      try { invalidateCache(`fish-market:list:`); } catch {}
    }
    // Tell any open fish-market / inventory tab to reload right now (don't wait for realtime).
    try { window.dispatchEvent(new CustomEvent("fish-stock-changed")); } catch {}
    // Cross-tab signal — other tabs (e.g. fish-market open in a second tab) reload immediately.
    try { localStorage.setItem("fish-stock-ping", String(Date.now())); } catch {}
    setPop({
      id: serverNowMs(),
      x: popAnchor.left + popAnchor.width / 2,
      y: popAnchor.top,
      v: caught
        ? `${caught.name} ×${fishGained}`
        : `سمكة ×${fishGained}`,
    });
    // Honesty: display the ACTUAL server-returned amount (fishGained). Previously
    // we preserved the predictive count, which caused "popup shows X fish but
    // storage is empty" — if the server capped by market_remaining or a race
    // reduced the amount, the player never saw the true number.
    setCatchResult({
      img: caught?.img,
      emoji: caught?.emoji ?? "🐟",
      name: caught?.name ?? "سمكة",
      count: fishGained,
      shipId: s.id,
      shipLevel: s.level,
      baseCount: baseFish,
      luckBonus: luckBonus,
    });



    setTimeout(() => setPop(null), 1400);
    } finally {
      window.clearTimeout(_lockTimeout);
      delete collectingRef.current[_lockKey];
    }
  };

  return (
    <div
      className={`fixed inset-x-0 top-0 overflow-hidden bg-[#0d2236] ${screenShake}`}
      style={{
        height: "var(--app-height, 100dvh)",
        backgroundImage: scene.displayImage ? `url(${scene.displayImage})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: scene.objectPosition ?? "center center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {scene.displayVideo && !isLowPerfMode && !bgPaused ? (
          <SeamlessVideo
            key={`vid-${scene.id}`}
            src={scene.displayVideo}
            poster={scene.displayImage}
            className={`absolute inset-0 h-full w-full object-cover select-none ${scene.burned ? "animate-bg-burned-pulse" : ""}`}
            style={{ objectPosition: scene.objectPosition ?? "center center" }}
            playbackRate={0.7}
          />
        ) : (
          <img
            key={`${scene.id}-${scene.burned ? "burned" : "clean"}`}
            src={scene.displayImage}
            alt={scene.displayName}
            className={`absolute inset-0 h-full w-full object-cover select-none ${isHeavyFxDisabled || bgPaused ? "" : "animate-bg-drift"} ${scene.burned ? "animate-bg-burned-pulse" : ""}`}
            style={{
              objectPosition: scene.objectPosition ?? "center center",
              ["--bg-scale" as never]: String(scene.motion?.scale ?? 1.06),
              ["--bg-shift-x" as never]: scene.motion?.x ?? "-1%",
              ["--bg-shift-y" as never]: scene.motion?.y ?? "-0.8%",
              ["--bg-dur" as never]: scene.motion?.duration ?? "18s",
            }}
            draggable={false}
          />
        )}
        <div
          className={`absolute pointer-events-none ${bgPaused ? "" : "animate-sea-flow"}`}
          style={{
            top: `${Math.max(0, scene.waterTop - 2)}%`,
            left: `${Math.max(0, scene.waterLeft - 8)}%`,
            width: `${Math.min(100, scene.waterRight + 8) - Math.max(0, scene.waterLeft - 8)}%`,
            height: `${Math.max(18, 96 - scene.waterTop)}%`,
          }}
        />
        {scene.burned && <div className="absolute inset-0 pointer-events-none animate-burned-glow" />}
      </div>

      <div className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-20"
        style={{
          background:
            "radial-gradient(ellipse at 70% 60%, rgba(255,255,255,0.4) 0%, transparent 50%)",
        }}
      />

      {/* Animated shore dragon — sits where the old fountain was, on every background */}
      <DragonShoreCreature />

      {/* Only show ad-bombs that target the current player's own ocean.
          Previously we passed `global`, which caused an attacker to see the
          bomb they placed on someone else replay on their own home page. */}
      {profile?.id && <AdBombOverlay targetUserId={profile.id} isOwner onFlash={showToast} />}

      {/* Wooden sign of destroyer taunts — owner sees the same sign visitors see. */}
      {profile?.id && (
        <DestroyerSign
          playerId={profile.id}
          bgId={scene.id}
          destroyerEmoji={(profile as { avatar_emoji?: string } | null)?.avatar_emoji ?? null}
        />
      )}

      {scene.burned && (
        <DraggableRepairBgButton
          storageKey="repairBgBtnPos:self"
          label="إصلاح الخلفية"
          onRepair={async () => {
            const showToast = (v: string) => {
              setPop({ id: serverNowMs(), x: window.innerWidth / 2, y: 120, v });
              setTimeout(() => setPop(null), 1800);
            };
            if ((profile?.gems ?? 0) < 100) { showToast("💎 تحتاج 100 جوهرة للإصلاح"); return; }
            if (!confirm("إصلاح الخلفية المحترقة مقابل 100 جوهرة؟")) return;
            const { error } = await repairBurnedBg();
            if (error) { showToast("تعذّر الإصلاح"); return; }
            sound.play("success");
            showToast("✨ رجعت الخلفية سليمة!");
          }}
        />
      )}

      {/* Quests & achievements floating button */}
      <Link
        to="/quests"
        aria-label="المهام والإنجازات"
        className="fixed z-30 flex flex-col items-center justify-center active:scale-95 transition rounded-xl"
        style={{
          left: "calc(env(safe-area-inset-left, 0px) + 8px)",
          top: "calc(env(safe-area-inset-top, 0px) + 250px)",
          width: 44,
          height: 50,
          background: "radial-gradient(circle at 30% 30%, #fbbf24, #b45309 70%, #4a1d04)",
          border: "2px solid #fde68a",
          boxShadow: "0 3px 10px rgba(0,0,0,.7), 0 0 12px rgba(251,191,36,.4)",
          color: "#1a0f04",
        }}
      >
        <span style={{ fontSize: 20, lineHeight: 1 }}>🏆</span>
        <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: ".2px", marginTop: 1 }}>مهام</span>
      </Link>



      {/* Incoming raids — pirates stealing from me (compact, see-through) */}
      {raids.filter((r) => !!r.attacker_name).length > 0 && (
        <div className="absolute top-24 left-2 right-2 z-30 flex flex-col gap-1 pointer-events-none items-center">
          {raids.filter((r) => !!r.attacker_name).map((r) => {
            const secsLeft = Math.max(0, Math.ceil((new Date(r.ends_at).getTime() - now) / 1000));
            return (
              <div key={r.ship_id}
                className="pointer-events-auto inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-rose-950/55 backdrop-blur-sm border border-rose-400/40 shadow max-w-[92%]">
                <span className="text-sm leading-none">🏴‍☠️</span>
                <div className="text-rose-100 text-[10px] font-bold truncate leading-tight">
                  {r.attacker_emoji} {r.attacker_name} يسرق منك · {Math.floor(secsLeft / 60)}:{String(secsLeft % 60).padStart(2, "0")}
                </div>
                <button
                  onClick={() => catchThief(r.ship_id)}
                  className="px-1.5 py-0.5 rounded-md bg-gradient-to-b from-amber-400 to-amber-600 text-stone-900 text-[10px] font-extrabold active:scale-95 leading-none"
                >🚔</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Outgoing steals — compact see-through pill so it doesn't block the view. */}
      {outgoingSteals.filter((s) => !!s.stealingTargetUserId).length > 0 && (
        <div className="absolute top-24 left-2 right-2 z-40 flex flex-col gap-1 pointer-events-none items-center">
          {outgoingSteals.filter((s) => !!s.stealingTargetUserId).map((s) => {
            const tgt = stealTargetNames[s.stealingTargetUserId!] || { name: "لاعب", emoji: "🧑‍✈️" };
            const secsLeft = Math.max(0, Math.ceil((new Date(s.stealingEndsAt!).getTime() - now) / 1000));
            const ready = secsLeft <= 0;
            return (
              <Link
                key={`out-${s.id}`}
                to="/p/$id"
                params={{ id: s.stealingTargetUserId! }}
                onClick={() => sound.play("click")}
                className={`pointer-events-auto inline-flex items-center gap-1.5 px-2 py-1 rounded-full backdrop-blur-sm border shadow active:scale-95 max-w-[92%] ${
                  ready
                    ? "bg-emerald-900/55 border-emerald-300/50 animate-pulse"
                    : "bg-amber-900/45 border-amber-300/45"
                }`}
              >
                <span className="text-sm leading-none">🏴‍☠️</span>
                <div className="text-amber-50 text-[10px] font-bold truncate leading-tight">
                  {ready ? "🎉 رجعت الغنيمة — استلم" : `تسرق من ${tgt.emoji} ${tgt.name} · ${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, "0")}`}
                </div>
                <span className="text-amber-100 text-xs font-black leading-none">‹</span>
              </Link>
            );
          })}
        </div>
      )}




      {/* Fish market — takes the old ship market spot on the left beach */}
      <Placeable
        id="fish-market"
        defaultStyle={{ left: "37.9%", top: "38.7%", width: "20%", height: "16%" }}
      >
        {(style) => (
          <FishMarketBuilding
            level={fishMarketLevel}
            burnedUntil={(profile as any)?.bg_burned_until}
            style={style}
          />
        )}
      </Placeable>
      {/* Ship Market — floating on the sea at the marked spot */}
      <Placeable
        id="ship-market"
        defaultStyle={{ left: "80.9%", top: "33%", width: "20%", height: "16%" }}
      >
        {(style) => (
          <ShipMarketBuilding
            level={marketLevel}
            burnedUntil={(profile as any)?.bg_burned_until}
            style={style}
          />
        )}
      </Placeable>




      {/* Realistic drifting clouds — disabled on iOS / low-perf to reduce GPU heat */}
      {!isHeavyFxDisabled && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-[5]">
          <img src={cloudImg} alt="" loading="lazy" className="absolute animate-cloud-drift select-none" style={{ top: "6%", left: "-20%", width: "26%", opacity: 0.85, animationDuration: "90s", filter: "drop-shadow(0 4px 10px rgba(255,255,255,0.15))" }} draggable={false} />
          <img src={cloudImg} alt="" loading="lazy" className="absolute animate-cloud-drift select-none" style={{ top: "16%", left: "-30%", width: "18%", opacity: 0.7, animationDuration: "120s", animationDelay: "-30s", transform: "scaleX(-1)" }} draggable={false} />
          <img src={cloudImg} alt="" loading="lazy" className="absolute animate-cloud-drift select-none" style={{ top: "2%", left: "-45%", width: "32%", opacity: 0.9, animationDuration: "150s", animationDelay: "-70s" }} draggable={false} />
        </div>
      )}

      {/* Realistic flying seagulls — disabled on iOS / low-perf */}
      {!isHeavyFxDisabled && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-[6]">
          <img src={birdImg} alt="" loading="lazy" className="absolute animate-bird-fly select-none" style={{ top: "12%", left: "-10%", width: "5%", animationDuration: "28s", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.25))" }} draggable={false} />
          <img src={birdImg} alt="" loading="lazy" className="absolute animate-bird-fly select-none" style={{ top: "20%", left: "-15%", width: "3.5%", animationDuration: "36s", animationDelay: "-10s" }} draggable={false} />
          <img src={birdImg} alt="" loading="lazy" className="absolute animate-bird-fly select-none" style={{ top: "6%", left: "-20%", width: "4%", animationDuration: "44s", animationDelay: "-22s" }} draggable={false} />
        </div>
      )}





      {/* TOP HUD — pirate luxury */}
      <div className="absolute top-0 left-0 right-0 px-2.5 pb-2.5 z-20 flex flex-col gap-2" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}>
        <div className="flex items-start gap-2">
          {/* Avatar + name + treasury stacked */}
          <div className="flex flex-col items-center gap-1.5 shrink-0">
            <Link to="/profile" className="relative active:scale-95 flex flex-col items-center gap-1">
              <div className="relative w-20 h-20 flex items-center justify-center">
                <div className="w-[60px] h-[60px] rounded-full overflow-hidden ring-2 ring-amber-300/60 shadow-[0_0_14px_rgba(252,191,73,0.7)] bg-gradient-to-b from-amber-900 to-amber-950">
                  {(profile as any)?.avatar_url ? (
                    <img src={(profile as any).avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-3xl">{profile?.avatar_emoji || "🧑‍✈️"}</div>
                  )}
                </div>
                {frameById((profile as any)?.avatar_frame)?.imageUrl && (
                  <img src={frameById((profile as any)?.avatar_frame)?.imageUrl} alt="" className={`absolute inset-0 w-full h-full object-contain pointer-events-none ${frameById((profile as any)?.avatar_frame)?.animClass ?? ""}`} style={{ filter: "drop-shadow(0 0 10px rgba(252,191,73,0.8)) saturate(1.4) contrast(1.15)" }} />
                )}
              </div>
              <div className={`inline-flex max-w-[120px] px-2 py-0.5 rounded-md text-[12px] font-black truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] ${frameById((profile as any)?.name_frame)?.kind === "name" ? `${frameById((profile as any)?.name_frame)?.nameClass} ${frameById((profile as any)?.name_frame)?.animClass ?? ""}` : "text-amber-100"}`}>
                {profile?.display_name || "قبطان"}
              </div>
            </Link>

            {/* Treasury — two separate luxurious bars, auto-sized to value */}
            <div className="flex flex-col items-stretch gap-1.5 min-w-[120px]">
              {/* Coins */}
              <div
                className="relative rounded-full pl-2 pr-2.5 py-1 inline-flex items-center justify-between gap-2 overflow-hidden"
                style={{
                  background: "linear-gradient(180deg, #2a1808 0%, #140903 55%, #060201 100%)",
                  border: "2px solid #d9b35a",
                  boxShadow: "inset 0 1px 0 rgba(255,232,170,0.55), inset 0 -3px 6px rgba(0,0,0,0.7), 0 3px 0 #140903, 0 5px 14px rgba(0,0,0,0.55), 0 0 16px rgba(241,190,82,0.35)",
                }}
              >
                <span className="pointer-events-none absolute inset-x-1 top-0.5 h-1/2 rounded-full opacity-55" style={{ background: "linear-gradient(180deg, rgba(255,243,200,0.45) 0%, transparent 100%)" }} />
                <span className="pointer-events-none absolute inset-y-0 -inset-x-4" style={{ background: "linear-gradient(110deg, transparent 35%, rgba(255,240,200,0.18) 50%, transparent 65%)", animation: "treasury-shimmer 4.5s linear infinite" }} />
                <CoinIcon size={18} />
                <span className="relative text-[13px] font-black tabular-nums whitespace-nowrap" style={{ color: "#ffe9a8", textShadow: "0 1px 0 #3a1f0a, 0 2px 5px rgba(0,0,0,0.85)" }}>{coins.toLocaleString("en-US")}</span>
              </div>

              {/* Gems */}
              <div
                className="relative rounded-full pl-2 pr-1 py-1 inline-flex items-center justify-between gap-2 overflow-hidden"
                style={{
                  background: "linear-gradient(180deg, #0d2a4a 0%, #051324 55%, #02080f 100%)",
                  border: "2px solid #4ac9e0",
                  boxShadow: "inset 0 1px 0 rgba(180,240,255,0.5), inset 0 -3px 6px rgba(0,0,0,0.7), 0 3px 0 #051324, 0 5px 14px rgba(0,0,0,0.55), 0 0 16px rgba(74,201,224,0.3)",
                }}
              >
                <span className="pointer-events-none absolute inset-x-1 top-0.5 h-1/2 rounded-full opacity-55" style={{ background: "linear-gradient(180deg, rgba(200,240,255,0.45) 0%, transparent 100%)" }} />
                <span className="pointer-events-none absolute inset-y-0 -inset-x-4" style={{ background: "linear-gradient(110deg, transparent 35%, rgba(200,240,255,0.18) 50%, transparent 65%)", animation: "treasury-shimmer 5.5s linear infinite" }} />
                <GemIcon size={18} />
                <span className="relative flex-1 text-center text-[13px] font-black tabular-nums whitespace-nowrap" style={{ color: "#bff3ff", textShadow: "0 1px 0 #051324, 0 2px 5px rgba(0,0,0,0.85)" }}>{gems.toLocaleString("en-US")}</span>
                <Link
                  to="/recharge"
                  className="relative w-6 h-6 rounded-full text-xs font-black flex items-center justify-center active:scale-90 shrink-0"
                  style={{
                    background: "radial-gradient(ellipse at 50% 25%, #d6f4ff 0%, #4ac9e0 55%, #1a7da0 100%)",
                    color: "#04242e",
                    border: "2px solid #bff3ff",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.75), 0 2px 0 #051324, 0 3px 6px rgba(0,0,0,0.55), 0 0 8px rgba(74,201,224,0.55)",
                    textShadow: "0 1px 0 rgba(255,255,255,0.5)",
                  }}
                  aria-label="شحن"
                >+</Link>
              </div>
            </div>
          </div>

          {/* Action column — luxury stack opposite the avatar */}
          <div className="ms-auto flex flex-col items-end gap-1.5 shrink-0">
            {/* Fish discovery + Golden Fisher active indicator */}
            <div className="flex items-center gap-1.5">
              {(() => {
                const gfUntilProf = (profile as any)?.golden_fisher_until ? new Date((profile as any).golden_fisher_until).getTime() : 0;
                const gfUntilCrew = crewRows.find(
                  (r) => r.item_id === "golden_fisher" && r.meta?.expires_at && new Date(r.meta.expires_at).getTime() > now,
                )?.meta?.expires_at;
                const gfUntilCrewMs = gfUntilCrew ? new Date(gfUntilCrew).getTime() : 0;
                const gfUntilMs = Math.max(gfUntilProf, gfUntilCrewMs);
                if (gfUntilMs <= now) return null;
                const remain = Math.max(0, gfUntilMs - now);
                const h = Math.floor(remain / 3600000);
                const m = Math.floor((remain % 3600000) / 60000);
                const s = Math.floor((remain % 60000) / 1000);
                const timeText = h > 0
                  ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
                  : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
                return (
                  <div
                    className="relative rounded-full ps-2 pe-1 py-0.5 inline-flex items-center gap-1 shrink-0"
                    title={(profile as any)?.golden_fisher_paused ? "⏸️ الصياد الذهبي متوقف مؤقتاً — العدّاد يستمر" : "🏅 الصياد الذهبي مفعّل على محيطك"}
                    style={{
                      background: (profile as any)?.golden_fisher_paused
                        ? "linear-gradient(180deg, #e6e6e6 0%, #a3a3a3 55%, #4a4a4a 100%)"
                        : "linear-gradient(180deg, #fff4c2 0%, #f1be52 55%, #8a5a14 100%)",
                      border: (profile as any)?.golden_fisher_paused ? "2px solid #d4d4d4" : "2px solid #ffe6a1",
                      boxShadow: (profile as any)?.golden_fisher_paused
                        ? "inset 0 1px 0 rgba(255,255,255,0.6), 0 0 8px rgba(120,120,120,0.6), 0 2px 4px rgba(0,0,0,0.5)"
                        : "inset 0 1px 0 rgba(255,255,255,0.7), 0 0 12px rgba(241,190,82,0.75), 0 2px 4px rgba(0,0,0,0.5)",
                    }}
                  >
                    <span className="text-sm leading-none" style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.5))" }}>
                      {(profile as any)?.golden_fisher_paused ? "⏸️" : "🎣"}
                    </span>
                    <span className="text-[11px] font-black tabular-nums leading-none" style={{ color: "#3a1f0a", textShadow: "0 1px 0 rgba(255,255,255,0.5)" }}>
                      {timeText}
                    </span>
                    <button
                      type="button"
                      aria-label={(profile as any)?.golden_fisher_paused ? "استئناف الصياد الذهبي" : "إيقاف مؤقت للصياد الذهبي"}
                      title={(profile as any)?.golden_fisher_paused ? "استئناف الصيد" : "إيقاف مؤقت (لتبديل السفن) — العدّاد يستمر"}
                      onClick={async () => {
                        try {
                          if ((profile as any)?.golden_fisher_paused) {
                            await resumeGoldenFisher({ data: {} });
                            setToast("▶️ تم استئناف الصياد الذهبي");
                          } else {
                            await pauseGoldenFisher({ data: {} });
                            setToast("⏸️ تم إيقاف الصياد مؤقتاً — يمكنك الآن تبديل السفن. العدّاد يستمر");
                          }
                          await refreshProfile?.();
                        } catch {
                          setToast("تعذّر تغيير حالة الصياد الذهبي");
                        }
                      }}
                      className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black leading-none active:scale-90"
                      style={{
                        background: "#0a2a3a",
                        color: "#bff3ff",
                        border: "1px solid #bff3ff",
                      }}
                    >{(profile as any)?.golden_fisher_paused ? "▶" : "⏸"}</button>
                    <button
                      type="button"
                      aria-label="إزالة الصياد الذهبي"
                      title="إزالة الصياد الذهبي"
                      onClick={async () => {
                        if (!window.confirm("هل تريد إزالة الصياد الذهبي؟ سيتم إيقافه فوراً.")) return;
                        try {
                          await removeGoldenFisher({ data: {} });
                          // Reload both profile (golden_fisher_until) AND crews (inventory row)
                          // so the badge disappears immediately without a manual refresh.
                          await Promise.all([refreshProfile?.(), reloadCrews()]);
                          setToast("🗑️ تم إزالة الصياد الذهبي");
                        } catch {
                          setToast("تعذر إزالة الصياد الذهبي");
                        }
                      }}
                      className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-black leading-none active:scale-90"
                      style={{
                        background: "#3a1f0a",
                        color: "#ffe6a1",
                        border: "1px solid #ffe6a1",
                      }}
                    >×</button>
                  </div>
                );
              })()}
              <Link
                to="/inventory"
                className="relative rounded-full px-3 py-1 inline-flex items-center gap-1.5 active:scale-95 overflow-hidden"
                title="الأسماك المكتشفة"
                style={{
                  background: "linear-gradient(180deg, #2a1808 0%, #140903 55%, #060201 100%)",
                  border: "2px solid #d9b35a",
                  boxShadow: "inset 0 1px 0 rgba(255,232,170,0.55), inset 0 -3px 6px rgba(0,0,0,0.7), 0 3px 0 #140903, 0 5px 12px rgba(0,0,0,0.55), 0 0 14px rgba(241,190,82,0.3)",
                }}
              >
                <span className="pointer-events-none absolute inset-x-1 top-0.5 h-1/2 rounded-full opacity-55" style={{ background: "linear-gradient(180deg, rgba(255,243,200,0.45) 0%, transparent 100%)" }} />
                <span className="pointer-events-none absolute inset-y-0 -inset-x-4" style={{ background: "linear-gradient(110deg, transparent 35%, rgba(255,240,200,0.18) 50%, transparent 65%)", animation: "treasury-shimmer 5s linear infinite" }} />
                <span className="relative text-base leading-none">🐟</span>
                <span className="relative text-[12px] font-black tabular-nums whitespace-nowrap" style={{ color: "#ffe9a8", textShadow: "0 1px 0 #3a1f0a, 0 2px 4px rgba(0,0,0,0.85)" }}>{fish}<span style={{ color: "rgba(255,233,168,0.6)" }} className="font-bold">/{FISH_TOTAL}</span></span>
              </Link>
            </div>

            {/* Notifications + Shield row */}
            <div className="flex items-center gap-1.5">
              <ShieldBadge />
              <NotificationsBell />
            </div>

            {/* Admin */}
            {isAdmin && (
              <Link
                to="/admin"
                className="relative rounded-full px-3 py-1 text-[12px] font-black active:scale-95 overflow-hidden"
                title="لوحة الإدارة"
                style={{
                  color: "#fff5e0",
                  background: "linear-gradient(180deg, #ff8a6a 0%, #e53935 55%, #8f1212 100%)",
                  border: "2px solid #ffd2c0",
                  boxShadow: "inset 0 1px 0 rgba(255,220,200,0.65), inset 0 -3px 6px rgba(60,5,5,0.65), 0 3px 0 #3a0a0a, 0 5px 12px rgba(229,57,53,0.45), 0 0 14px rgba(255,138,106,0.35)",
                  textShadow: "0 1px 2px rgba(0,0,0,0.85)",
                }}
              >
                <span className="pointer-events-none absolute inset-x-1 top-0.5 h-1/2 rounded-full opacity-55" style={{ background: "linear-gradient(180deg, rgba(255,220,200,0.5) 0%, transparent 100%)" }} />
                <span className="pointer-events-none absolute inset-y-0 -inset-x-4" style={{ background: "linear-gradient(110deg, transparent 35%, rgba(255,220,200,0.22) 50%, transparent 65%)", animation: "treasury-shimmer 5s linear infinite" }} />
                <span className="relative">👑 إدارة</span>
              </Link>
            )}
          </div>
        </div>
        <style>{`@keyframes treasury-shimmer{0%{transform:translateX(-60%)}100%{transform:translateX(60%)}}`}</style>
      </div>

      {/* Daily-login chest button (replaces the old جائزة + ✨ buttons) */}
      <button
        onClick={() => { sound.play("coin"); setDailyOpen(true); }}
        className="fixed z-30 rounded-2xl flex flex-col items-center justify-center active:scale-95"
        style={{
          left: "calc(env(safe-area-inset-left, 0px) + 8px)",
          top: "calc(env(safe-area-inset-top, 0px) + 190px)",
          width: 44,
          height: 50,
          color: "#2a1605",
          background: "radial-gradient(ellipse at 50% 0%, #ffe9a8 0%, #f1be52 35%, #c98a2a 70%, #7a4a14 100%)",
          border: "2px solid #ffe9a8",
          boxShadow: "inset 0 2px 0 rgba(255,243,200,0.85), inset 0 -3px 6px rgba(80,40,10,0.65), 0 4px 0 #3a1f0a, 0 6px 16px rgba(0,0,0,0.6), 0 0 22px rgba(252,191,73,0.55)",
        }}
      >
        <span className="pointer-events-none absolute inset-x-2 top-1 h-1/2 rounded-xl opacity-60" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.6) 0%, transparent 100%)" }} />
        <span className="relative text-3xl" style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.4))" }}>🗝️</span>
        <span className="relative text-[10px] font-black mt-0.5" style={{ textShadow: "0 1px 0 rgba(255,243,200,0.6)" }}>يومي</span>
        <span className="absolute -top-1 -right-1 text-white text-[10px] font-black rounded-full px-1.5 h-5 min-w-[20px] flex items-center justify-center" style={{ background: "radial-gradient(ellipse at 50% 30%, #ff6a6a 0%, #c41818 70%, #6a0808 100%)", border: "2px solid #ffe9a8", boxShadow: "0 2px 4px rgba(0,0,0,0.5)" }}>!</span>
      </button>

      <DailyLoginModal open={dailyOpen} onClose={() => setDailyOpen(false)} />

      {marketLevel >= 6 && <LuckyBoxButton onChanged={() => refreshProfile()} />}




      {/* SHIPS — auto-placed inside the current background's open-water region.
          Each scene declares waterTop / waterLeft / waterRight so ships always
          sit on water and never overlap shore, docks, rocks or buildings. */}
      {shipSlotLayoutReady && ships.filter((s) => !s.stealingTargetUserId).map((s, i) => {
        const fixedSlot = scene.shipSlots?.[i % (scene.shipSlots?.length || 1)];
        const wTop = scene.waterTop ?? 45;
        const wLeft = scene.waterLeft ?? 30;
        const wRight = scene.waterRight ?? 75;
        const wWidth = Math.max(15, wRight - wLeft);
        // Keep ships sitting low on the water surface (not floating high above it).
        const ts = [0.55, 0.75, 0.4];
        const vRange = Math.max(10, 60 - (wTop + 10));
        const defaultTop = fixedSlot?.top ?? wTop + 10 + ts[i] * vRange;
        const defaultScale = fixedSlot?.scale ?? 0.95 + ts[i] * 0.42;
        const hOffsets = [0.05, 0.3, 0.6];
        const defaultLeft = fixedSlot?.left ?? wLeft + hOffsets[i % hOffsets.length] * wWidth;

        // Admin overrides (per background + slot + mode).
        const ov = slotOverrides[i] || {};
        const dockPos = ov.dock;
        const seaPos = ov.sea;
        const topNum = dockPos?.top ?? defaultTop;
        const scale = dockPos?.scale ?? defaultScale;
        const dockLeft = dockPos?.left ?? defaultLeft;

        // Editor preview: force sail=0 in dock mode, sail=1 in sea mode so the
        // admin sees exactly where the ship will sit before publishing.
        let previewSail: number | undefined;
        if (editor.isAdmin && editor.enabled) {
          previewSail = editor.mode === "sea" ? 1 : 0;
        }

        const shipCrews = crewRows
          .filter((r) => isCrewActiveOnShip(r.meta, s, now))
          .map((r) => CREWS.find((c) => c.id === r.item_id))
          .filter((c): c is (typeof CREWS)[number] => !!c && c.id !== "trader" && c.id !== "guide");

        return (
          <ShipSlot
            key={s.id}
            ship={{
              ...s,
              top: `${topNum}%`,
              scale,
              dockLeft,
              seaSide: scene.seaSide,
              seaLeft: seaPos?.left,
              seaTop: seaPos?.top,
              seaScale: seaPos?.scale,
              sail: previewSail ?? s.sail,
            }}
            crews={shipCrews}
            onTap={() => setMenuShipId(s.id)}
            active={menuShipId === s.id}
          />
        );
      })}

      {/* Admin overlay: draggable pucks for editing per-slot positions */}
      {editor.isAdmin && editor.enabled && (
        <ShipSlotEditorOverlay
          bgId={scene.id}
          slots={[0, 1, 2].map((i) => {
            const fixedSlot = scene.shipSlots?.[i % (scene.shipSlots?.length || 1)];
            const wTop = scene.waterTop ?? 45;
            const wLeft = scene.waterLeft ?? 30;
            const wRight = scene.waterRight ?? 75;
            const wWidth = Math.max(15, wRight - wLeft);
            const ts = [0.55, 0.75, 0.4];
            const vRange = Math.max(10, 60 - (wTop + 10));
            const defTop = fixedSlot?.top ?? wTop + 10 + ts[i] * vRange;
            const defScale = fixedSlot?.scale ?? 0.95 + ts[i] * 0.42;
            const hOffsets = [0.05, 0.3, 0.6];
            const defLeft = fixedSlot?.left ?? wLeft + hOffsets[i % hOffsets.length] * wWidth;
            const ov = slotOverrides[i] || {};
            const cur = editor.mode === "dock"
              ? (ov.dock ?? { top: defTop, left: defLeft, scale: defScale })
              : (ov.sea ?? { top: defTop, left: (scene.seaSide === "right" ? (96 - 22 * defScale) : 2), scale: defScale });
            return { index: i, pos: cur };
          })}
        />
      )}

      {/* Admin floating toolbar to open/close the ship-slot editor */}
      <ShipSlotEditorToolbar />




      {/* Incoming raider ships — render attacker pirate ships sailing in our harbor */}
      {raids.map((r, i) => {
        const wTop = scene.waterTop ?? 45;
        const wLeft = scene.waterLeft ?? 30;
        const wRight = scene.waterRight ?? 75;
        const wWidth = Math.max(15, wRight - wLeft);
        // Try to find the targeted ship in MY fleet and dock the raider beside it.
        const tIdx = ships.findIndex((sh) => sh.dbId === r.target_ship_id);
        const siblings = raids.filter(
          (x) => x.target_ship_id && x.target_ship_id === r.target_ship_id,
        );
        const sibIdx = Math.max(0, siblings.findIndex((x) => x.ship_id === r.ship_id));
        let top: string; let left: string;
        if (tIdx >= 0) {
          const fixedSlot = scene.shipSlots?.[tIdx % (scene.shipSlots?.length || 1)];
          const ts = [0.55, 0.75, 0.4];
          const hOffsets = [0.05, 0.3, 0.6];
          const vRange = Math.max(10, 60 - (wTop + 10));
          const tgtTop = fixedSlot?.top ?? wTop + 10 + ts[tIdx % ts.length] * vRange;
          const tgtLeft = fixedSlot?.left ?? wLeft + hOffsets[tIdx % hOffsets.length] * wWidth;
          const tgtScale = fixedSlot?.scale ?? 0.95 + ts[tIdx % ts.length] * 0.42;
          const tgtShipW = 22 * tgtScale;
          const seaIsRight = (scene.seaSide ?? "right") === "right";
          top = `${Math.max(50, Math.min(74, tgtTop + tgtShipW * 0.22 + sibIdx * 5))}%`;
          left = `${Math.max(
            8,
            Math.min(82, tgtLeft + (seaIsRight ? tgtShipW * 0.58 : -10)),
          )}%`;
        } else {
          const slot = i % 3;
          top = `${wTop + 6 + slot * 8}%`;
          left = `${wLeft + (0.55 + slot * 0.15) * wWidth}%`;
        }
        const img = getShipByMarketLevel(r.template_id || 1).image;
        const nativeRight = shipBowFacesRight(r.template_id || 1);
        // Raider bow faces shore (left)
        const flipX = nativeRight ? -1 : 1;
        const t = serverNowMs() / 1000;
        const bob = Math.sin((t + i) * 1.2) * 1.8;
        return (
          <Link
            key={`raid-${r.ship_id}`}
            to="/p/$id"
            params={{ id: r.attacker_id }}
            className="absolute z-10 active:scale-95"
            style={{ left, top, width: "min(18%, 115px)" }}
          >
            <div
              className="absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-md bg-rose-900/90 border border-rose-400/70 text-rose-100 text-[10px] font-extrabold whitespace-nowrap shadow-lg animate-pulse"
            >
              🏴‍☠️ {r.attacker_emoji} {r.attacker_name}
            </div>
            <div
              className="relative w-full"
              style={{
                transform: `translateY(${bob}px) scaleX(${flipX})`,
                filter: "drop-shadow(0 12px 8px rgba(0,0,0,0.6)) hue-rotate(-15deg) saturate(1.2)",
                transition: "transform 0.2s ease-out",
              }}
            >
              <img src={img} alt="raider" className="w-full block select-none animate-sail-flap" draggable={false} />
              <div
                className="absolute pointer-events-none"
                style={{ left: "50%", top: "-2%", width: "14%", height: "10%" }}
              >
                <div
                  className="w-full h-full animate-flag-wave"
                  style={{
                    background: "linear-gradient(180deg, #1f2937 0%, #1f2937 100%)",
                    clipPath: "polygon(0 0, 100% 0, 90% 50%, 100% 100%, 0 100%)",
                  }}
                />
              </div>
            </div>
          </Link>
        );
      })}




      {/* Ship action menu (3 icons: fish / crew / sell) */}
      {menuShipId !== null && (() => {
        const s = ships.find((x) => x.id === menuShipId);
        if (!s) return null;
        const ready = s.progress >= s.max;
        const onSteal = !!s.stealingTargetUserId;
        const stealEnd = s.stealingEndsAt ? new Date(s.stealingEndsAt).getTime() : 0;
        const stealReady = onSteal && stealEnd > 0 && serverNowMs() >= stealEnd;
        const stealSecsLeft = onSteal ? Math.max(0, Math.ceil((stealEnd - serverNowMs()) / 1000)) : 0;
        return (
          <div
            className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center"
            onClick={() => setMenuShipId(null)}
          >
            <div
              className="glass-hud rounded-2xl border-2 border-accent/60 p-4 flex flex-col gap-3"
              onClick={(e) => e.stopPropagation()}
            >
              {onSteal && (
                <div className="flex flex-col items-center gap-2 px-3 py-2 rounded-xl bg-rose-950/60 border border-rose-500/50">
                  <div className="text-2xl">🏴‍☠️</div>
                  <div className="text-rose-200 font-bold text-sm">السفينة في مهمة سرقة</div>
                  {stealReady ? (
                    <button
                      className="px-4 py-2 rounded-lg bg-gradient-to-b from-amber-400 to-amber-600 text-stone-900 text-xs font-bold active:scale-95"
                      onClick={async () => {
                        setMenuShipId(null);
                        if (!s.dbId) return;
                        const { data, error } = await (supabase as any).rpc("claim_steal_mission", { _attacker_ship_id: s.dbId, _force: false });
                        if (error) { showToast("تعذّر استلام الغنيمة"); return; }
                        presentStealResult(data, false);
                        syncFleetFromDb();
                      }}
                    >🏴‍☠️ استلم الغنيمة</button>
                  ) : (
                    <>
                      <div className="text-rose-300/80 text-xs">ترجع بعد {Math.floor(stealSecsLeft / 60)}:{String(stealSecsLeft % 60).padStart(2, "0")}</div>
                      <button
                        className="mt-1 px-3 py-1.5 rounded-lg bg-gradient-to-b from-rose-500 to-rose-700 text-white text-[11px] font-bold active:scale-95 border border-rose-300/40"
                        onClick={async () => {
                          setMenuShipId(null);
                          if (!s.dbId) return;
                          if (!confirm("إيقاف السرقة الآن؟ ستأخذ الغنيمة الحالية فقط.")) return;
                          const { data, error } = await (supabase as any).rpc("claim_steal_mission", { _attacker_ship_id: s.dbId, _force: true });
                          if (error) { showToast("تعذّر إيقاف السرقة"); return; }
                          presentStealResult(data, true);
                          syncFleetFromDb();
                        }}
                      >🛑 أوقف السرقة الآن</button>
                    </>
                  )}
                </div>
              )}
              {!onSteal && (() => {
                const dead = isShipBlocked(s.destroyedAt, s.repairEndsAt, s.hp, s.maxHp);
                const remSec = repairRemainingSeconds(s.repairEndsAt);
                const remStr = formatRepairTime(remSec);
                if (dead) {
                  return (
                    <div className="flex flex-col items-center gap-2 px-3 py-2 rounded-xl bg-stone-900/70 border border-rose-500/50">
                      <div className="text-3xl">💥</div>
                      <div className="text-rose-200 font-bold text-sm">السفينة مدمّرة</div>
                      <div className="text-rose-300/90 text-xs">
                        {remSec > 0 ? `⏳ الإصلاح ينتهي خلال ${remStr}` : "⚙️ تحتاج إصلاح بالطاقم"}
                      </div>
                      <div className="flex gap-3 mt-1">
                        <ActionBtn
                          emoji="👥"
                          label="طاقم/إصلاح"
                          onClick={() => { setMenuShipId(null); reloadCrews(); refreshProfile(); setModal({ kind: "crew", shipId: s.id }); }}
                        />
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col items-center gap-2">
                    {remSec > 0 && (
                      <div className="px-3 py-1.5 rounded-xl bg-emerald-950/65 border border-emerald-400/50 text-emerald-100 text-[11px] font-bold tabular-nums text-center">
                        🔧 الإصلاح الذاتي ينتهي خلال {remStr}
                      </div>
                    )}
                    <div className="flex gap-3" dir="ltr">
                      <ActionBtn
                        emoji={ready ? "🪣" : s.progress > 0 || s.fishing ? "🪣" : "🎣"}
                        label={ready ? "اجمع" : s.progress > 0 || s.fishing ? "اجمع وارجع" : "صيد"}
                        onClick={(e: React.MouseEvent) => {
                          setMenuShipId(null);
                          if (!ready && s.progress <= 0 && !s.fishing && getCrewBonuses(s).guide) {
                            setFishPickerShipId(s.id);
                            return;
                          }
                          collect(s.id, e);
                        }}
                      />
                      {s.fishing && getCrewBonuses(s).guide && (
                        <ActionBtn
                          emoji="🧭"
                          label="غيّر النوع"
                          onClick={() => {
                            setMenuShipId(null);
                            setFishPickerChangeOnly(true);
                            setFishPickerShipId(s.id);
                          }}
                        />
                      )}
                      <ActionBtn
                        emoji="👥"
                        label="طاقم"
                        onClick={() => { setMenuShipId(null); reloadCrews(); refreshProfile(); setModal({ kind: "crew", shipId: s.id }); }}
                      />
                      {s.catalogCode === "upgrade-sub" && (s.stars ?? 1) < 5 && (
                        <ActionBtn
                          emoji="⭐"
                          label={`ترقية ${"★".repeat(s.stars ?? 1)}`}
                          onClick={() => { setMenuShipId(null); setUpgradeSubShipId(s.id); }}
                        />
                      )}
                      <ActionBtn
                        emoji="💰"
                        label="بيع"
                        onClick={() => {
                          setMenuShipId(null);
                          if (ships.length <= MIN_FLEET) {
                            showToast("لا يمكن بيع آخر سفينة في الأسطول");
                            return;
                          }
                          {
                            const maxHp = s.maxHp ?? 100;
                            if ((s.hp ?? 0) < maxHp || s.destroyedAt || s.repairEndsAt) {
                              showToast("لا يمكن بيع السفينة قبل إصلاحها بالكامل");
                              return;
                            }
                          }
                          setModal({ kind: "sell", shipId: s.id });
                        }}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })()}

      {/* Guide fish picker */}
      {fishPickerShipId !== null && (() => {
        const s = ships.find((x) => x.id === fishPickerShipId);
        if (!s) return null;
        const choices = fishPoolForShip(s);
        const changeOnly = fishPickerChangeOnly;
        const currentGuide = getShipGuide(s.id);
        const close = () => { setFishPickerShipId(null); setFishPickerChangeOnly(false); };
        return (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={close}>
            <div className="glass-hud rounded-2xl border-2 border-accent/60 p-4 max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
              <div className="text-3xl mb-2">🧭</div>
              <div className="text-accent font-black text-base mb-1">
                {changeOnly ? "غيّر نوع الصيد" : "اختر نوع الصيد"}
              </div>
              <div className="text-xs text-accent/80 mb-3">
                {changeOnly
                  ? "السفينة ستكمل الصيد على النوع الجديد تلقائياً"
                  : "الأنواع المتاحة لهذه السفينة فقط"}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {choices.map((fishId) => {
                  const f = FISH[fishId];
                  if (!f) return null;
                  const isCurrent = currentGuide === fishId;
                  return (
                    <button
                      key={fishId}
                      className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-black text-accent active:scale-95 ${
                        isCurrent ? "border-amber-300 bg-amber-500/20" : "border-accent/40 bg-secondary/70"
                      }`}
                      onClick={(e) => {
                        setShipGuide(s.id, fishId);
                        // Persist guide preference server-side so the Golden Fisher
                        // honors it while running offline.
                        if (s.dbId) {
                          void (supabase as any).rpc("set_guide_fish", { _ship_db_id: s.dbId, _fish_id: fishId });
                        }
                        close();
                        if (!changeOnly) {
                          collect(s.id, e);
                        } else {
                          showToast(`🧭 تم تغيير النوع إلى ${f.name}`);
                        }
                      }}
                    >
                      {f.img ? <img src={f.img} alt={f.name} className="h-7 w-7 object-contain" loading="lazy" /> : <span className="text-xl">{f.emoji}</span>}
                      <span>{f.name}</span>
                    </button>
                  );
                })}
              </div>
              <button className="mt-3 w-full rounded-lg bg-secondary/70 py-2 text-xs font-bold text-accent active:scale-95" onClick={close}>إلغاء</button>
            </div>
          </div>
        );
      })()}


      {/* Submarine upgrade dialog */}
      {upgradeSubShipId !== null && (() => {
        const s = ships.find((x) => x.id === upgradeSubShipId);
        if (!s || !s.dbId) return null;
        const curStars = s.stars ?? 1;
        const nextStars = Math.min(5, curStars + 1);
        const chance = UPGRADE_SUB_SUCCESS_PCT[curStars] ?? 0;
        const curCap = UPGRADE_SUB_STAR_CAPACITY[curStars] ?? 350000;
        const nextCap = UPGRADE_SUB_STAR_CAPACITY[nextStars] ?? 350000;
        const isRedNext = nextStars >= 5;
        const closeDlg = () => {
          if (upgradeSubBusy) return;
          setUpgradeSubShipId(null);
          setUpgradeSubResult(null);
        };
        const renderStars = (n: number) => {
          if (n >= 5) return <span className="text-2xl text-rose-400">★</span>;
          return <span className="text-2xl text-amber-300">{"★".repeat(n)}{"☆".repeat(4-n)}</span>;
        };
        return (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={closeDlg}>
            <div className="glass-hud rounded-2xl border-2 border-amber-400/60 p-5 max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
              <div className="text-3xl mb-1">⭐ ترقية الغواصة</div>
              <div className="flex items-center justify-around my-3">
                <div className="flex flex-col items-center gap-1">
                  <div className="text-xs text-cyan-200/80">الحالي</div>
                  {renderStars(curStars)}
                  <div className="text-[10px] text-cyan-100">{curCap.toLocaleString()} سعة</div>
                </div>
                <div className="text-2xl text-amber-300">→</div>
                <div className="flex flex-col items-center gap-1">
                  <div className="text-xs text-cyan-200/80">الهدف</div>
                  {renderStars(nextStars)}
                  <div className="text-[10px] text-cyan-100">{nextCap.toLocaleString()} سعة</div>
                </div>
              </div>
              {upgradeSubResult ? (
                <div className={`rounded-xl p-3 mb-3 ${upgradeSubResult.success ? "bg-emerald-500/20 border border-emerald-400/60" : "bg-rose-500/20 border border-rose-400/60"}`}>
                  <div className={`text-lg font-black ${upgradeSubResult.success ? "text-emerald-200" : "text-rose-200"}`}>
                    {upgradeSubResult.success ? "✅ نجحت الترقية!" : "❌ فشلت الترقية"}
                  </div>
                  <div className="text-xs text-cyan-100 mt-1">
                    {upgradeSubResult.success
                      ? `الغواصة الآن ${upgradeSubResult.stars >= 5 ? "نجمة حمراء ★" : "★".repeat(upgradeSubResult.stars)}`
                      : `الغواصة رجعت إلى ${"★".repeat(upgradeSubResult.stars)}`}
                  </div>
                </div>
              ) : (
                <>
                  <div className={`rounded-lg px-3 py-2 mb-2 text-sm font-bold ${chance >= 95 ? "bg-emerald-500/20 text-emerald-200" : chance >= 80 ? "bg-amber-500/20 text-amber-200" : "bg-rose-500/20 text-rose-200"}`}>
                    نسبة النجاح: {chance}%
                  </div>
                  {chance < 100 && (
                    <div className="text-[11px] text-rose-300/90 mb-2">
                      ⚠️ عند الفشل ترجع الغواصة لنجمة أدنى
                    </div>
                  )}
                  {isRedNext && (
                    <div className="text-[11px] text-rose-300 mb-2 font-bold">
                      🔴 الترقية للنجمة الحمراء — أعلى مستوى
                    </div>
                  )}
                  <div className="text-amber-200 font-extrabold text-base mb-3">
                    💰 التكلفة: {UPGRADE_SUB_COST.toLocaleString()} ذهب
                  </div>
                </>
              )}
              <div className="flex gap-2">
                {upgradeSubResult ? (
                  <button className="flex-1 rounded-xl bg-accent text-accent-foreground py-3 font-extrabold active:scale-95" onClick={closeDlg}>
                    تم
                  </button>
                ) : (
                  <>
                    <button className="flex-1 rounded-xl bg-secondary/70 py-3 font-bold text-accent active:scale-95 disabled:opacity-50" disabled={upgradeSubBusy} onClick={closeDlg}>
                      إلغاء
                    </button>
                    <button
                      className="flex-1 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 py-3 font-extrabold active:scale-95 disabled:opacity-50"
                      disabled={upgradeSubBusy || !!s.destroyedAt}
                      onClick={async () => {
                        if (!s.dbId) return;
                        setUpgradeSubBusy(true);
                        try {
                          const { data, error } = await (supabase as any).rpc("upgrade_submarine", { _ship_id: s.dbId });
                          if (error) {
                            const msg = error.message || "";
                            showToast(
                              /insufficient|coins|currency/i.test(msg) ? "ذهب غير كافٍ (تحتاج مليار)" :
                              /at_sea/i.test(msg) ? "أعد السفينة من البحر أولاً" :
                              /max_rank/i.test(msg) ? "الغواصة في أعلى مستوى" :
                              /not_upgradeable/i.test(msg) ? "هذه السفينة غير قابلة للترقية" :
                              /destroyed/i.test(msg) ? "السفينة مدمّرة" :
                              "تعذّر تنفيذ الترقية"
                            );
                            return;
                          }
                          const res = data as { success: boolean; stars: number; chance: number };
                          setUpgradeSubResult(res);
                          await syncFleetFromDb();
                          refreshProfile?.();
                        } catch (e: any) {
                          showToast("تعذّر الاتصال — حاول مرة أخرى");
                          console.error("upgrade_submarine failed", e);
                        } finally {
                          setUpgradeSubBusy(false);
                        }
                      }}
                    >
                      {upgradeSubBusy ? "..." : "ترقية"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}


      {/* Sell confirmation */}
      {modal?.kind === "sell" && (() => {
        const s = ships.find((x) => x.id === modal.shipId);
        if (!s) return null;
        const price = shipSellPrice(s.level);
        return (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setModal(null)}>
            <div className="glass-hud rounded-2xl border-2 border-accent/60 p-5 max-w-xs w-full text-center" onClick={(e) => e.stopPropagation()}>
              <div className="text-4xl mb-2">⚓</div>
              <div className="text-accent font-bold text-base mb-1">بيع السفينة</div>
              <div className="text-xs text-accent/80 mb-3">هل أنت متأكد من بيع هذه السفينة؟</div>
              <div className="text-amber-300 font-bold text-lg mb-4 inline-flex items-center justify-center gap-1 w-full">+ {price.toLocaleString()} <CoinIcon size={20} /></div>
              <div className="flex gap-2">
                <button
                  className="flex-1 py-2 rounded-lg bg-secondary/70 text-accent text-xs font-bold active:scale-95"
                  onClick={() => setModal(null)}
                >إلغاء</button>
                <button
                  className="flex-1 py-2 rounded-lg bg-gradient-to-b from-red-500 to-red-700 text-white text-xs font-bold active:scale-95"
                  onClick={() => {
                    sound.play("coin");
                    const soldDbId = s.dbId;
                    setShips((curr) => curr.filter((x) => x.id !== s.id));
                    (async () => {
                      if (soldDbId) {
                        const { error } = await sellShip(soldDbId, price);
                        if (error) console.error("[sell ship]", error);
                      }
                      const assignedHere = crewRows.filter((r) => isCrewAssignedToShip(r.meta, s));
                      if (assignedHere.length) {
                        await deleteInventoryRows(assignedHere.map((r) => r.id));
                      }
                    })();
                    setModal(null);
                  }}
                >تأكيد البيع</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Crew customization (multi-slot, 24h activation) */}
      {modal?.kind === "crew" && (() => {
        const s = ships.find((x) => x.id === modal.shipId);
        if (!s) return null;
        const slots = 999; // unlimited crew slots — dedup enforced separately
        const assignedRows = crewRows.filter((r) => isCrewActiveOnShip(r.meta, s, now));
        // available = rows not assigned to any ship (or assigned-but-expired already purged)
        const availableRows = crewRows.filter((r) => r.meta?.assigned_ship_id == null);
        // group available by item_id with total qty
        const availMap = new Map<string, number>();
        availableRows.forEach((r) => availMap.set(r.item_id, (availMap.get(r.item_id) ?? 0) + r.quantity));
        void crewTick;

        const fmtRemaining = (iso?: string) => {
          if (!iso) return "";
          const ms = new Date(iso).getTime() - now;
          if (ms <= 0) return "انتهى";
          const h = Math.floor(ms / 3600000);
          const m = Math.floor((ms % 3600000) / 60000);
          const sec = Math.floor((ms % 60000) / 1000);
          return h > 0 ? `${h}س ${m}د` : m > 0 ? `${m}د ${sec}ث` : `${sec}ث`;
        };

        const assignCrew = async (itemId: string) => {
          if (crewBusyRef.current) return;
          crewBusyRef.current = true;
          setCrewBusy(true);
          try {
          // Golden Fisher: premium recharge crew — activates 24h auto-fishing + full protection on the whole account.
          if (itemId === "golden_fisher") {
            try {
              const res = await activateGoldenFisher({ data: {} });
              sound.play("success");
              setToast(res.already_active ? "🏅 الصياد الذهبي مفعّل عندك بالفعل" : `🏅 تم تفعيل الصياد الذهبي 24 ساعة — صيد تلقائي + حصانة كاملة`);
              setModal(null);
              refreshProfile();
              reloadCrews();
              setCrewTick((t) => t + 1);
              void res;
            } catch (e: any) {
              sound.play("error");
              const msg = e?.message ?? "خطأ";
              setToast(
                /golden_fisher_temporarily_disabled/i.test(msg)
                  ? "⏸️ الصياد الذهبي موقف مؤقتاً — قيد الفحص"
                  : /already_active/i.test(msg)
                    ? "🏅 الصياد الذهبي مفعّل عندك بالفعل"
                    : /daily_limit/i.test(msg)
                      ? "⏳ استعملت الصياد الذهبي اليوم — متاح بعد 24 ساعة من آخر تفعيل"
                      : /no_golden_fisher/i.test(msg)
                        ? "لا تملك طاقم صياد ذهبي — اشترِ من المتجر"
                        : `❌ فشل التفعيل: ${msg}`,
              );
            }
            return;
          }
          // Market Expert: account-wide activation (3h). Not assigned to a ship.
          if (itemId === "market_expert") {
            try {
              const { error } = await (supabase as any).rpc("activate_market_expert");
              if (error) {
                const msg = String((error as any).message || "خطأ");
                sound.play("error");
                if (/crew_requires_market_level_10/i.test(msg)) setToast("🚫 يجب رفع سوق السفن إلى المستوى 10 لاستخدام الطواقم");
                else if (/no_market_expert/i.test(msg)) setToast("ما عندك خبير أسواق في المخزن");
                else if (/market_expert_already_active/i.test(msg)) setToast("📈 خبير الأسواق مفعّل بالفعل — انتظر انتهاء الوقت قبل التفعيل مرة أخرى");
                else setToast(`❌ تعذر تفعيل خبير الأسواق: ${msg}`);
                return;
              }
              sound.play("success");
              setToast("📈 تم تفعيل خبير الأسواق لمدة 3 ساعات");
              setModal(null);
              refreshProfile();
              reloadCrews();
              setCrewTick((t) => t + 1);
              window.dispatchEvent(new Event("inventory-changed"));
            } catch (e: any) {
              sound.play("error");
              setToast(`❌ خطأ: ${e?.message ?? "غير معروف"}`);
            }
            return;
          }
          // Fixer crews: heal a fixed HP amount on ANY ship (capped at maxHp).
          // fixer_1=+1000, fixer_2=+5000, fixer_3=+70000, fixer_4=full repair on all 3 fleet ships.
          if (itemId.startsWith("fixer_")) {
            if (!s.dbId) {
              sound.play("error");
              setToast("⚠️ السفينة غير جاهزة — حدّث الأسطول ثم حاول مرة ثانية");
              return;
            }
            const row = availableRows.find((r) => r.item_id === itemId);
            if (!row) {
              sound.play("error");
              setToast("⚠️ لا تملك هذا الطاقم — اشترِه أولاً");
              await reloadCrews();
              return;
            }

            const repairOnServer = async (ship: typeof s, crewId: string) => {
              const { data, error } = await (supabase as any)
                .rpc("repair_ship_with_crew", { _ship_id: ship.dbId, _crew_id: crewId });
              if (error) {
                const msg = (error as { message?: string }).message ?? "خطأ غير معروف";
                // Translate common server errors to clearer Arabic
                const friendly =
                  /no such crew/i.test(msg) ? "لا تملك هذا الطاقم" :
                  /no ships need repair/i.test(msg) ? "لا توجد سفن تحتاج إصلاحاً" :
                  /ship does not need repair/i.test(msg) ? "السفينة سليمة ولا تحتاج إصلاحاً" :
                  /not your ship/i.test(msg) ? "هذه السفينة ليست ملكك" :
                  /not authenticated/i.test(msg) ? "انتهت الجلسة — سجّل الدخول من جديد" :
                  msg;
                console.error("[repair_ship_with_crew]", error);
                throw new Error(friendly);
              }
              markRepairDone();
              return Array.isArray(data) ? data[0] : data;
            };

            try {
              if (itemId === "fixer_4") {
                const needRepair = ships.filter((x) => x.dbId && ((x.hp ?? 0) < (x.maxHp ?? 100) || x.destroyedAt || x.repairEndsAt));
                if (needRepair.length === 0) {
                  setToast("لا توجد سفن تحتاج إصلاحاً");
                  sound.play("error");
                  return;
                }
                // Optimistic UI: close modal + fill all ships immediately
                setShips((arr) => arr.map((x) => {
                  if (!x.dbId) return x;
                  const wasBlocked = !!(x.destroyedAt || x.repairEndsAt);
                  return wasBlocked
                    ? { ...x, hp: x.maxHp ?? 100, destroyedAt: null, repairEndsAt: null, fishing: false, startedAt: undefined, sail: 0, progress: 0 }
                    : { ...x, hp: x.maxHp ?? 100, destroyedAt: null, repairEndsAt: null };
                }));
                setModal(null);
                try {
                  const result = await repairOnServer(s, itemId);
                  const count = Number(result?.repaired_count ?? needRepair.length);
                  setToast(`🏆 تم إصلاح ${count} سفن بالكامل`);
                  sound.play("success");
                } catch (e: any) {
                  setToast(`❌ فشل الإصلاح: ${e?.message ?? "خطأ"}`);
                  sound.play("error");
                } finally {
                  reloadCrews();
                  syncFleetFromDb();
                  setCrewTick((t) => t + 1);
                }
              } else {
                const amount = FIXER_HEAL[itemId] ?? 0;
                if (amount <= 0) {
                  sound.play("error");
                  setToast("⚠️ هذا الطاقم لا يملك قيمة إصلاح");
                  return;
                }
                const maxHp = s.maxHp ?? 100;
                const curHp = s.hp ?? 0;
                const needs = curHp < maxHp || s.destroyedAt || s.repairEndsAt;
                if (!needs) {
                  setToast("السفينة سليمة ولا تحتاج إصلاحاً");
                  sound.play("error");
                  return;
                }
                // Optimistic update — preserve fishing state unless ship was destroyed/blocked
                const wasBlocked = !!(s.destroyedAt || s.repairEndsAt);
                const optimisticHp = Math.min(maxHp, curHp + amount);
                setShips((arr) => arr.map((x) => x.id === s.id
                  ? (optimisticHp >= maxHp && wasBlocked
                      ? { ...x, hp: optimisticHp, destroyedAt: null, repairEndsAt: null, fishing: false, startedAt: undefined, sail: 0, progress: 0 }
                      : (optimisticHp >= maxHp
                          ? { ...x, hp: optimisticHp, destroyedAt: null, repairEndsAt: null }
                          : { ...x, hp: optimisticHp }))
                  : x));
                setModal(null);
                try {
                  const result = await repairOnServer(s, itemId);
                  const newHp = Number(result?.new_hp ?? optimisticHp);
                  const healed = Math.max(0, newHp - curHp);
                  setShips((arr) => arr.map((x) => x.id === s.id
                    ? (newHp >= maxHp && wasBlocked
                        ? { ...x, hp: newHp, destroyedAt: null, repairEndsAt: null, fishing: false, startedAt: undefined, sail: 0, progress: 0 }
                        : (newHp >= maxHp
                            ? { ...x, hp: newHp, destroyedAt: null, repairEndsAt: null }
                            : { ...x, hp: newHp, repairEndsAt: result?.repair_ends_at ?? null }))
                    : x));
                  setToast(`⚒️ تم إصلاح +${healed.toLocaleString()} دم`);
                  sound.play("success");
                } catch (e: any) {
                  // Rollback optimistic
                  setShips((arr) => arr.map((x) => x.id === s.id ? { ...x, hp: curHp } : x));
                  setToast(`❌ فشل الإصلاح: ${e?.message ?? "خطأ"}`);
                  sound.play("error");
                } finally {
                  reloadCrews();
                  syncFleetFromDb();
                  setCrewTick((t) => t + 1);
                }
              }
            } catch (e: any) {
              setToast(`❌ خطأ: ${e?.message ?? "غير معروف"}`);
              sound.play("error");
            }
            return;
          }
          // Prevent duplicates: max 1 crew per type per ship
          if (assignedRows.some((r) => r.item_id === itemId)) {
            sound.play("error");
            return;
          }
          // find a row with this item_id that's unassigned
          const row = availableRows.find((r) => r.item_id === itemId);
          if (!row) { setToast("لم يعد متاحًا — حدّث الصفحة"); return; }
          if (!s.dbId) { setToast("حدّث الأسطول أولاً"); return; }
          // Optimistic: assign instantly in local state so the UI feels snappy.
          const optimisticExpiresAt = new Date(serverNowMs() + 24 * 3600 * 1000).toISOString();
          const prevRows = crewRowsRef.current;
          setCrewRows((rs) => rs.map((r) => r.id === row.id
            ? { ...r, meta: { ...(r.meta ?? {}), assigned_ship_id: s.dbId, expires_at: optimisticExpiresAt } }
            : r));
          sound.play("success");
          // Free the UI lock immediately — server call continues in background.
          crewBusyRef.current = false;
          setCrewBusy(false);
          (async () => {
            const { error } = await (supabase as any).rpc("assign_crew_to_ship", {
              _ship_id: s.dbId,
              _crew_id: itemId,
            });
            if (error) {
              // Rollback on failure
              setCrewRows(prevRows);
              sound.play("error");
              const msg = String((error as any).message || "خطأ");
              if (/crew_requires_market_level_10/i.test(msg)) {
                setToast("🚫 يجب رفع سوق السفن إلى المستوى 10 لاستخدام الطواقم");
              } else {
                setToast(`تعذّر التفعيل: ${msg}`);
              }
              await reloadCrews();
              return;
            }
            await reloadCrews();
            setCrewTick((t) => t + 1);
          })();
          return;
          } finally {
            crewBusyRef.current = false;
            setCrewBusy(false);
          }
        };


        const removeCrew = async (rowId: string) => {
          if (crewBusyRef.current) return;
          crewBusyRef.current = true;
          setCrewBusy(true);
          try {
            await deleteInventoryRows([rowId]);
            sound.play("error");
            setCrewTick((t) => t + 1);
          } finally {
            crewBusyRef.current = false;
            setCrewBusy(false);
          }
        };

        return (
          <div className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3" onClick={() => setModal(null)}>
            <div
              dir="rtl"
              className="relative w-full max-w-sm max-h-[90vh] overflow-hidden rounded-[2rem] border-2 border-amber-600/40 bg-gradient-to-b from-slate-900/95 via-slate-950/95 to-black/95 shadow-[0_0_60px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,200,100,0.15)]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Decorative ambient glows */}
              <div className="pointer-events-none absolute -top-24 -right-16 w-56 h-56 bg-amber-500/15 blur-[100px] rounded-full" />
              <div className="pointer-events-none absolute -bottom-24 -left-16 w-56 h-56 bg-emerald-500/15 blur-[100px] rounded-full" />

              {/* Close */}
              <button
                type="button"
                onClick={() => setModal(null)}
                aria-label="إغلاق"
                className="absolute top-3 left-3 w-9 h-9 rounded-full bg-gradient-to-b from-red-700 to-red-900 border border-red-300/50 text-red-50 font-black text-base flex items-center justify-center active:scale-95 z-[120] shadow-lg shadow-black/70"
              >✕</button>

              {/* Regal Header */}
              <div className="relative pt-7 pb-4 text-center bg-gradient-to-b from-amber-900/30 via-amber-900/10 to-transparent border-b border-amber-700/30">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-36 h-px bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
                <div className="px-5">
                  <div className="text-xl font-black tracking-wide bg-gradient-to-b from-amber-200 via-amber-400 to-amber-600 bg-clip-text text-transparent drop-shadow-[0_2px_6px_rgba(180,120,40,0.35)]">
                    ⚓ تخصيص الطواقم
                  </div>
                  <div className="mt-1.5 flex items-center justify-center gap-2 text-[10px] tracking-widest text-amber-300/70 font-bold">
                    <span className="h-px w-6 bg-gradient-to-l from-transparent to-amber-500/60" />
                    <span>السفينة {s.level} · {assignedRows.length} مفعّل · 24 ساعة</span>
                    <span className="h-px w-6 bg-gradient-to-r from-transparent to-amber-500/60" />
                  </div>
                </div>
              </div>

              <div className="overflow-y-auto max-h-[calc(90vh-110px)] px-4 pt-4 pb-5 space-y-5 relative">
                {/* Active crews */}
                <section>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_10px_#10b981] animate-pulse" />
                    <h3 className="text-emerald-300 font-black text-xs tracking-widest">الطواقم المفعّلة</h3>
                    <span className="mr-auto text-[10px] font-bold text-emerald-400/70">{assignedRows.length}</span>
                  </div>
                  <div className="space-y-2">
                    {(assignedRows.length === 0 ? [null] : assignedRows).map((r, i) => {
                      if (!r) {
                        return (
                          <div key={`empty-${i}`} className="rounded-2xl border border-dashed border-emerald-500/25 bg-emerald-950/10 p-3 text-center text-[11px] text-emerald-300/50 font-bold">
                            ⚓ لا يوجد طاقم مفعّل على هذه السفينة
                          </div>
                        );
                      }
                      const c = CREWS.find((x) => x.id === r.item_id);
                      if (!c) return null;
                      return (
                        <div key={r.id} className="relative rounded-2xl bg-gradient-to-br from-emerald-950/40 to-emerald-900/10 border border-emerald-500/30 p-3 flex items-center gap-3 shadow-[inset_0_0_20px_rgba(16,185,129,0.08)]">
                          <div className="relative shrink-0">
                            {c.image ? (
                              <img src={c.image} alt={c.name} className="w-12 h-12 object-contain rounded-xl bg-emerald-950/60 border-2 border-emerald-400/50 p-0.5 shadow-[0_0_15px_rgba(16,185,129,0.25)]" />
                            ) : (
                              <span className="grid w-12 h-12 place-items-center text-2xl rounded-xl bg-emerald-950/60 border-2 border-emerald-400/50">{c.emoji}</span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="text-emerald-100 font-extrabold text-sm truncate">{c.name}</h4>
                              <button
                                disabled={crewBusy}
                                className="text-[10px] px-2.5 py-1 rounded-lg bg-rose-950/60 text-rose-200 border border-rose-500/40 font-bold active:scale-95 disabled:opacity-40 shrink-0"
                                onClick={() => removeCrew(r.id)}
                              >إزالة</button>
                            </div>
                            <p className="text-[10px] text-emerald-300/80 mt-0.5 line-clamp-1">{c.bonus}</p>
                            <div className="mt-1.5 text-[10px] text-amber-300 font-mono font-bold flex items-center gap-1">
                              <span>⏳</span><span>{fmtRemaining(r.meta?.expires_at)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Ornamental divider */}
                <div className="flex items-center gap-2 px-2">
                  <span className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-700/40 to-transparent" />
                  <span className="text-[10px] text-amber-500/70 tracking-widest">✦</span>
                  <span className="h-px flex-1 bg-gradient-to-l from-transparent via-amber-700/40 to-transparent" />
                </div>

                {/* All crews */}
                <section>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_10px_#f59e0b]" />
                    <h3 className="text-amber-300 font-black text-xs tracking-widest">جميع الطواقم</h3>
                  </div>
                  <div className="space-y-2">
                    {CREWS.filter((c) => c.id !== "golden_fisher" && c.id !== "market_expert").map((c) => {
                      const cid = c.id;
                      const qty = availMap.get(cid) ?? 0;
                      const owned = qty > 0;
                      const isFixer = cid.startsWith("fixer_");
                      const isGlobalCrew = cid === "trader" || cid === "golden_fisher";
                      const alreadyOnShip = assignedRows.some((r) => r.item_id === cid);
                      const nowMs = serverNowMs();
                      const goldenFisherActive =
                        !!(profile as any)?.golden_fisher_until &&
                        new Date((profile as any).golden_fisher_until).getTime() > nowMs;
                      const globallyActive = isGlobalCrew && (
                        (cid === "golden_fisher" && goldenFisherActive) ||
                        crewRows.some(
                          (r) => r.item_id === cid
                            && r.meta?.assigned_ship_id != null
                            && (!r.meta?.expires_at || new Date(r.meta.expires_at).getTime() > nowMs)
                        )
                      );
                      const fixerCanRepair = isFixer && (
                        cid === "fixer_4"
                          ? ships.some((x) => x.dbId && ((x.hp ?? 0) < (x.maxHp ?? 100) || x.destroyedAt || x.repairEndsAt))
                          : ((s.hp ?? 0) < (s.maxHp ?? 100) || !!s.destroyedAt || !!s.repairEndsAt)
                      );
                      const slotsFull = !isFixer && !isGlobalCrew && !alreadyOnShip && assignedRows.length >= slots;
                      const canAssign = owned && (
                        isFixer
                          ? fixerCanRepair
                          : isGlobalCrew
                            ? !globallyActive
                            : (assignedRows.length < slots && !alreadyOnShip)
                      );
                      const isBuying = buyingCrewId === cid;
                      const wantQty = Math.max(1, Math.min(99, crewBuyQty[cid] ?? 1));
                      const totalCost = c.price * wantQty;
                      const canAffordQty = c.currency === "gems" ? gems >= totalCost : coins >= totalCost;
                      const setQty = (n: number) => setCrewBuyQty((m) => ({ ...m, [cid]: Math.max(1, Math.min(99, n)) }));

                      const buyCrew = () => {
                        if (isBuying || buyingCrewRef.current) return;
                        if (!canAffordQty) {
                          sound.play("error");
                          setToast(c.currency === "gems" ? "جواهر غير كافية" : "ذهب غير كافٍ");
                          return;
                        }
                        const currencyLabel = c.currency === "gems" ? "جوهرة" : "ذهب";
                        if (!window.confirm(`تأكيد شراء ${wantQty}× ${c.name} مقابل ${totalCost.toLocaleString()} ${currencyLabel}؟`)) return;
                        buyingCrewRef.current = cid;
                        setBuyingCrewId(cid);
                        sound.play("coin");
                        setToast(`✓ تم شراء ${wantQty}× ${c.name}`);
                        (async () => {
                          try {
                            const { error } = c.currency === "gems"
                              ? await buyWithGems(cid, "crew", totalCost, undefined, wantQty)
                              : await buyWithCoins(cid, "crew", totalCost, undefined, wantQty);
                            if (error) {
                              sound.play("error");
                              setToast(`فشل الشراء: ${(error as { message?: string }).message ?? "خطأ"}`);
                              return;
                            }
                            refreshProfile();
                            reloadCrews();
                            setCrewTick((t) => t + 1);
                            setCrewBuyQty((m) => ({ ...m, [cid]: 1 }));
                          } finally {
                            buyingCrewRef.current = null;
                            setBuyingCrewId(null);
                          }
                        })();
                      };

                      return (
                        <div
                          key={cid}
                          className={`relative rounded-2xl border p-2.5 transition-all ${
                            owned
                              ? (canAssign
                                  ? (isFixer
                                      ? "border-amber-500/40 bg-gradient-to-br from-amber-950/30 to-amber-900/5 shadow-[inset_0_0_15px_rgba(245,158,11,0.06)]"
                                      : "border-amber-600/30 bg-gradient-to-br from-slate-800/60 to-slate-900/40")
                                  : "border-slate-700/40 bg-slate-900/40 opacity-70")
                              : "border-amber-700/20 bg-slate-900/30"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="relative shrink-0">
                              {c.image ? (
                                <img src={c.image} alt={c.name} className="w-11 h-11 object-contain rounded-xl bg-slate-950/60 border border-amber-600/30 p-0.5" />
                              ) : (
                                <span className="grid w-11 h-11 place-items-center text-xl rounded-xl bg-slate-950/60 border border-amber-600/30">{c.emoji}</span>
                              )}
                              {owned && (
                                <span className="absolute -bottom-1 -left-1 px-1.5 py-px rounded-md bg-gradient-to-b from-amber-300 to-amber-600 text-slate-950 text-[10px] font-black border border-amber-200/60 shadow-md">×{qty}</span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="text-amber-100 font-extrabold text-sm truncate">{c.name}</h4>
                              <p className="text-[10px] text-emerald-300/80 leading-tight line-clamp-1">{c.bonus}</p>
                              {isGlobalCrew && globallyActive && !alreadyOnShip && (
                                <div className="text-[9px] text-amber-400/80 font-bold mt-0.5">🔒 {cid === "golden_fisher" ? "مفعّل بالفعل" : "مفعّل على سفينة أخرى"}</div>
                              )}
                            </div>
                          </div>

                          <div className="mt-2.5 pt-2.5 border-t border-amber-700/15 flex items-center justify-between gap-2">
                            {owned ? (
                              <>
                                <span className="text-[10px] text-amber-300/70 font-bold">جاهز للتفعيل</span>
                                <button
                                  disabled={crewBusy || alreadyOnShip || (isGlobalCrew && globallyActive)}
                                  onClick={() => {
                                    if (alreadyOnShip) return;
                                    if (isGlobalCrew && globallyActive) {
                                      sound.play("error");
                                      setToast(cid === "golden_fisher"
                                        ? "🏅 الصياد الذهبي مفعّل بالفعل على حسابك"
                                        : "⚠️ التاجر مفعّل بالفعل على سفينة أخرى");
                                      return;
                                    }
                                    if (slotsFull) {
                                      sound.play("error");
                                      setToast(`⚠️ خانات الطاقم ممتلئة (${assignedRows.length}/${slots})`);
                                      return;
                                    }
                                    if (isFixer && !fixerCanRepair) {
                                      sound.play("error");
                                      setToast(cid === "fixer_4"
                                        ? "⚠️ جميع سفنك بدمها الكامل — لا حاجة للإصلاح"
                                        : "⚠️ السفينة بدمها الكامل (100%) — لا حاجة للإصلاح");
                                      return;
                                    }
                                    assignCrew(cid);
                                  }}
                                  className={`px-5 py-1.5 rounded-xl text-[11px] font-black active:scale-95 disabled:opacity-50 shadow-lg ${
                                    canAssign && !crewBusy
                                      ? "bg-gradient-to-b from-emerald-400 to-emerald-700 text-white border border-emerald-300/60 shadow-emerald-900/60"
                                      : (slotsFull || (isFixer && !fixerCanRepair) || (isGlobalCrew && globallyActive))
                                        ? "bg-amber-900/40 text-amber-200 border border-amber-700/40"
                                        : "bg-slate-800 text-slate-400 border border-slate-700"
                                  }`}
                                >
                                  {crewBusy
                                    ? "..."
                                    : alreadyOnShip
                                      ? "مفعّل ✓"
                                      : isFixer
                                        ? (fixerCanRepair ? "🛠️ استخدم" : "🔒 ممتلئ 100%")
                                        : (isGlobalCrew && globallyActive)
                                          ? "مقفول 🔒"
                                          : slotsFull
                                            ? "⚠️ ممتلئ"
                                            : "تفعيل"}
                                </button>
                              </>
                            ) : (
                              <>
                                <div className="flex items-center bg-slate-950/70 rounded-lg border border-amber-700/30 p-0.5 shadow-inner">
                                  <button type="button" onClick={() => setQty(wantQty + 1)} disabled={isBuying} className="w-7 h-7 grid place-items-center text-amber-300 text-base font-black active:scale-90 disabled:opacity-40">+</button>
                                  <span className="min-w-[28px] text-center text-[12px] font-black text-amber-200 tabular-nums">{wantQty}</span>
                                  <button type="button" onClick={() => setQty(wantQty - 1)} disabled={isBuying} className="w-7 h-7 grid place-items-center text-amber-300 text-base font-black active:scale-90 disabled:opacity-40">−</button>
                                </div>
                                <button
                                  onClick={buyCrew}
                                  disabled={!canAffordQty || isBuying}
                                  className={`flex-1 px-3 py-1.5 rounded-xl text-[11px] font-black active:scale-95 shadow-lg flex items-center justify-center gap-1.5 ${
                                    canAffordQty && !isBuying
                                      ? "bg-gradient-to-b from-amber-300 to-amber-700 text-slate-950 border border-amber-200/60 shadow-amber-900/60"
                                      : "bg-slate-800 text-slate-400 border border-slate-700"
                                  }`}
                                >
                                  <span>{isBuying ? "..." : "شراء"}</span>
                                  <span className="text-[10px] font-bold">{totalCost.toLocaleString()}{c.currency === "gems" ? " 💎" : " 🪙"}</span>
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <button
                  className="mt-2 w-full py-2.5 rounded-xl bg-gradient-to-b from-slate-700 to-slate-900 text-amber-200 text-xs font-black border border-amber-700/30 active:scale-95 shadow-lg"
                  onClick={() => setModal(null)}
                >إغلاق</button>
              </div>
            </div>
          </div>

        );
      })()}


      {/* Dragon + Totem removed per user request */}

      {/* BOTTOM NAV */}
      <div
        className="fixed inset-x-0 bottom-0 z-[80] pb-2"
        style={{
          paddingBottom: "max(0.55rem, env(safe-area-inset-bottom))",
          paddingLeft: "max(1rem, env(safe-area-inset-left))",
          paddingRight: "max(1rem, env(safe-area-inset-right))",
        }}
      >
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-28"
          style={{
            background:
              "linear-gradient(180deg, rgba(3,7,18,0) 0%, rgba(5,9,20,0.72) 45%, rgba(4,6,14,0.98) 100%)",
          }}
        />
        <div className="relative mx-auto grid w-full max-w-[430px] grid-cols-7 items-end gap-0 overflow-visible">
          {[
            { src: navIconSettings, label: "إعدادات", to: null, action: "settings" as const, badge: 0 },
            { src: navIconChat, label: "شات", to: "/chat" as const, action: null, badge: dmUnread },
            { src: navIconShop, label: "متجر", to: "/shop" as const, action: null, badge: 0 },
            { src: navIconInventory, label: "مخزن", to: "/inventory" as const, action: null, badge: 0 },
            { src: navIconFriends, label: "أصدقاء", to: "/friends" as const, action: null, badge: friendsUnread },
            { src: navIconArena, label: "ترتيب", to: null, action: "boost" as const, badge: 0 },
            { src: navIconTribe, label: "قبيلة", to: "/chat" as const, search: { tab: "tribe", solo: "1" } as const, action: null, badge: 0 },
          ].map((it, i) => {
            const inner = (
              <>
                <div
                    className="relative flex size-[48px] xs:size-[52px] items-center justify-center"
                  style={{ filter: "drop-shadow(0 5px 9px rgba(0,0,0,0.72)) drop-shadow(0 0 8px rgba(241,190,82,0.18))" }}
                >
                  <img
                    src={it.src}
                    alt={it.label}
                    loading="lazy"
                    width={110}
                    height={110}
                    className="size-full object-contain select-none"
                    draggable={false}
                  />
                  {it.badge > 0 && (
                    <span
                      className="absolute -top-1 right-0 z-20 flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-black text-white"
                      style={{
                        height: 18,
                        background: "linear-gradient(180deg, #e53935 0%, #8f1212 100%)",
                        border: "2px solid rgba(255,243,200,0.95)",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
                      }}
                    >
                      {it.badge > 9 ? "9+" : it.badge}
                    </span>
                  )}
                </div>
                <span className="mt-0.5 text-[10px] font-black leading-none text-[#ead087] drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">{it.label}</span>
              </>
            );
            return it.to ? (
              <Link
                key={i}
                to={it.to}
                search={"search" in it ? (it as any).search : undefined}
                onClick={() => sound.play("click")}
                  className="flex min-w-0 flex-col items-center gap-0.5 px-0 py-1 active:scale-95"
              >
                {inner}
              </Link>
            ) : (
              <button
                key={i}
                onClick={() => {
                  sound.play("click");
                  if (it.action === "settings") setSettingsOpen(true);
                  else if (it.action === "boost") { setLeaderboardRestore(null); setBoostOpen(true); }
                }}
                className="flex min-w-0 flex-col items-center gap-0.5 px-0 py-1 active:scale-95"
              >
                {inner}
              </button>
            );
          })}
        </div>
      </div>


      {/* Settings modal */}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      {/* Leaderboard / players modal */}
      {boostOpen && <LeaderboardModal initialRestore={leaderboardRestore} onClose={() => { setBoostOpen(false); setLeaderboardRestore(null); }} />}

      {/* Toast */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[55] glass-hud border-2 border-accent/60 rounded-xl px-4 py-2 text-accent text-sm font-bold shadow-lg animate-float-up">
          {toast}
        </div>
      )}

      {/* Floating popup */}
      {pop && (
        <div
          key={pop.id}
          className="fixed z-50 text-base font-bold text-accent text-glow pointer-events-none animate-float-up"
          style={{ left: pop.x, top: pop.y }}
        >
          {pop.v}
        </div>
      )}

      {/* Catch result modal — requires موافق to dismiss */}
      {catchResult && (
        <div
          dir="rtl"
          onClick={() => setCatchResult(null)}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="mx-4 w-full max-w-xs rounded-2xl border-2 border-cyan-300/60 bg-gradient-to-b from-sky-700 to-sky-950 p-5 shadow-2xl text-center animate-scale-in"
          >
            <div className="text-xs font-black text-cyan-200 mb-2">🎣 نتيجة الصيد</div>
            <div className="mx-auto w-24 h-24 rounded-2xl bg-white/15 border-2 border-cyan-200/40 flex items-center justify-center overflow-hidden shadow-inner">
              {catchResult.img ? (
                <img src={catchResult.img} alt={catchResult.name} className="w-full h-full object-contain p-1 drop-shadow" />
              ) : (
                <span className="text-5xl">{catchResult.emoji}</span>
              )}
            </div>
            <div className="mt-3 text-lg font-black text-white text-glow">{catchResult.name}</div>
            {catchResult.count > 0 ? (
              <div className="mt-1 text-2xl font-black text-amber-300 text-glow">×{catchResult.count.toLocaleString()}</div>
            ) : null}
            {catchResult.luckBonus && catchResult.luckBonus > 0 ? (
              <div className="mt-1 inline-block px-2 py-0.5 rounded-full bg-gradient-to-r from-yellow-400 to-amber-500 border border-yellow-200 text-[10px] font-black text-black shadow">
                🍀 طاقم الحظ دبّل الصيد! ({catchResult.baseCount} ×2 = {catchResult.count})
              </div>
            ) : null}
            <div className="mt-1 text-[11px] font-bold text-cyan-100/80">سفينة #{catchResult.shipId} • مستوى {catchResult.shipLevel}</div>
            <button
              onClick={() => setCatchResult(null)}
              className="mt-4 w-full rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-700 border-2 border-emerald-200 py-2.5 text-sm font-black text-white active:scale-95 shadow-lg"
            >
              موافق
            </button>
          </div>
        </div>
      )}

      {/* Steal result modal — shows what was stolen, or empty result */}
      {stealResult && (
        <div
          dir="rtl"
          onClick={() => setStealResult(null)}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="mx-4 w-full max-w-xs rounded-2xl border-2 border-rose-300/60 bg-gradient-to-b from-rose-800 to-rose-950 p-5 shadow-2xl text-center"
          >
            <div className="text-xs font-black text-rose-200 mb-2">
              {stealResult.cancelled ? "🛑 إيقاف السرقة" : "🏴‍☠️ نتيجة السرقة"}
            </div>
            {stealResult.count > 0 ? (
              <>
                <div className="grid grid-cols-3 gap-2 max-h-44 overflow-y-auto p-1">
                  {stealResult.items.map((it) => (
                    <div key={it.id} className="rounded-xl bg-white/10 border border-rose-200/40 p-2 flex flex-col items-center">
                      <div className="w-12 h-12 flex items-center justify-center">
                        {it.img ? <img src={it.img} alt={it.name} className="w-full h-full object-contain" /> : <span className="text-3xl">{it.emoji}</span>}
                      </div>
                      <div className="text-[10px] text-white font-bold truncate w-full">{it.name}</div>
                      <div className="text-[11px] font-black text-amber-300">×{it.qty}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-2xl font-black text-amber-300 text-glow">{stealResult.count} سمكة</div>
                <div className="text-[12px] font-bold text-rose-100/90">قيمة الغنيمة: {stealResult.value.toLocaleString()} 🪙</div>
              </>
            ) : (
              <>
                <div className="mx-auto w-24 h-24 rounded-2xl bg-white/10 border-2 border-rose-200/40 flex items-center justify-center">
                  <span className="text-5xl">🪶</span>
                </div>
                <div className="mt-3 text-base font-black text-white">السفينة رجعت فاضية</div>
                <div className="mt-1 text-[11px] font-bold text-rose-100/80">ما كان عند الهدف سمك في هذه السفينة</div>
              </>
            )}
            <button
              onClick={() => setStealResult(null)}
              className="mt-4 w-full rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-700 border-2 border-emerald-200 py-2.5 text-sm font-black text-white active:scale-95 shadow-lg"
            >
              موافق
            </button>
          </div>
        </div>
      )}



      {/* Incoming attack / support FX — mirror what spectators see when they attack me */}
      {incomingFx && <ProjectileFx fx={incomingFx} />}
    </div>
  );
}

type LbProfile = {
  id: string; display_name: string; avatar_emoji: string; avatar_url: string | null;
  level: number; xp: number; coins: number; gems: number;
  avatar_frame?: string | null; name_frame?: string | null;
};

type TribeLb = { id: string; name: string; emblem: string; banner?: string; level?: number; members: number; power: number; donation_score?: number; support_score?: number; attack_score?: number };

type CompLb = {
  id: string; title: string; description: string; banner_emoji: string; banner_text: string;
  banner_theme: string; metric: string; target_fish_id: string | null; hide_target: boolean;
  reward_coins: number; reward_gems: number; reward_xp: number; reward_text: string;
  prize_tiers: Array<{ rank: number; coins: number; gems: number; xp: number; text: string }> | null;
  starts_at: string; ends_at: string;
};
type CompLbRow = {
  user_id: string; display_name: string; avatar_emoji: string; avatar_url: string | null;
  level: number; score: number;
};
const COMP_METRIC_LABEL: Record<string, { icon: string; name: string; unit: string }> = {
  explode_count: { icon: "🔥", name: "تفجيرات", unit: "تفجير" },
  explode_damage: { icon: "💥", name: "ضرر", unit: "ضرر" },
  fish_total: { icon: "🎣", name: "صيد", unit: "سمكة" },
  fish_specific: { icon: "🐟", name: "صيد نوع محدد", unit: "سمكة" },
};
const COMP_THEME: Record<string, string> = {
  gold: "from-amber-500 via-yellow-400 to-amber-600",
  royal: "from-purple-600 via-fuchsia-500 to-indigo-600",
  inferno: "from-red-600 via-orange-500 to-yellow-500",
  ocean: "from-cyan-500 via-blue-500 to-indigo-600",
  emerald: "from-emerald-500 via-green-500 to-teal-600",
  diamond: "from-sky-300 via-cyan-200 to-indigo-400",
  obsidian: "from-slate-800 via-zinc-700 to-slate-900",
};
function compTimeLeft(iso: string) {
  const ms = new Date(iso).getTime() - serverNowMs();
  if (ms <= 0) return "انتهت";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}ي ${h}س`;
  if (h > 0) return `${h}س ${m}د`;
  return `${m}د`;
}

function LeaderboardModal({ onClose, initialRestore }: { onClose: () => void; initialRestore?: LeaderboardRestore | null }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<LeaderboardTab>(initialRestore?.tab ?? "comp");
  const [comps, setComps] = useState<CompLb[]>([]);
  const [tribeEvents, setTribeEvents] = useState<Array<{ id: string; title: string; banner_emoji: string; starts_at: string; ends_at: string }>>([]);
  const [compBoards, setCompBoards] = useState<Record<string, CompLbRow[]>>({});
  const [rows, setRows] = useState<LbProfile[]>([]);
  const [fishRows, setFishRows] = useState<Array<LbProfile & { unique_fish: number; total_fish: number }>>([]);
  const [shipRows, setShipRows] = useState<Array<LbProfile & { market_level: number }>>([]);
  const [tribes, setTribes] = useState<TribeLb[]>([]);
  const [q, setQ] = useState(initialRestore?.q ?? "");
  const [tribeQ, setTribeQ] = useState(initialRestore?.tribeQ ?? "");
  const [loading, setLoading] = useState(false);
  const [refreshSeq, setRefreshSeq] = useState(0);
  const [openTribeId, setOpenTribeId] = useState<string | null>(null);
  const [prizesModal, setPrizesModal] = useState<{ title: string; tiers: PrizeTier[] } | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [staffIds, setStaffIds] = useState<Set<string>>(new Set());
  const restoredSearchRef = useRef(false);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null)); }, []);
  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).rpc("get_staff_user_ids");
      const ids = Array.isArray(data)
        ? data.map((r: any) => (typeof r === "string" ? r : r?.get_staff_user_ids ?? r?.user_id)).filter(Boolean)
        : [];
      setStaffIds(new Set(ids as string[]));
    })();
  }, []);

  useEffect(() => {
    if (tab === "search") return;
    const hasCachedData =
      (tab === "comp" && (comps.length > 0 || tribeEvents.length > 0)) ||
      (tab === "tribes" && tribes.length > 0) ||
      (tab === "tribe_donations" && tribes.length > 0) ||
      (tab === "fish" && fishRows.length > 0) ||
      (tab === "ships" && shipRows.length > 0) ||
      (["xp", "gems", "coins"].includes(tab) && rows.length > 0);
    let cancelled = false;
    const showSpinner = !hasCachedData;
    if (showSpinner) setLoading(true);
    if (tab === "comp") {
      (async () => {
        const nowIso = new Date().toISOString();
        const [{ data }, { data: tev }] = await Promise.all([
          (supabase as any).rpc("get_active_competitions"),
          (supabase as any).from("tribe_fish_events").select("id,title,banner_emoji,starts_at,ends_at").eq("active", true).gte("ends_at", nowIso).order("starts_at", { ascending: true }),
        ]);
        if (cancelled) return;
        const list = ((data ?? []) as CompLb[]);
        setComps(list);
        setTribeEvents((tev ?? []) as any);
        const entries = await Promise.all(list.map(async (c) => {
          const { data: lb } = await (supabase as any).rpc("get_competition_leaderboard", { _competition_id: c.id });
          return [c.id, ((lb ?? []) as CompLbRow[])] as const;
        }));
        if (cancelled) return;
        setCompBoards(Object.fromEntries(entries));
        setLoading(false);
      })();
      return () => { cancelled = true; };
    }
    if (tab === "tribes" || tab === "tribe_donations") {
      (async () => {
        const mode = tab === "tribe_donations" ? "donations" : "damage";
        const { data } = await (supabase as any).rpc("get_tribe_effort_leaderboard", { _mode: mode, _limit: 100 });
        if (cancelled) return;
        const list: TribeLb[] = ((data ?? []) as any[]).map((t) => ({
          id: t.tribe_id,
          name: t.name,
          emblem: t.emblem,
          banner: t.banner,
          level: t.level || 1,
          members: t.members || 0,
          donation_score: Number(t.donation_score || 0),
          support_score: Number(t.support_score || 0),
          attack_score: Number(t.attack_score || 0),
          power: Number(t.power || 0),
        }));
        setTribes(list);
        setLoading(false);
      })();
      return () => { cancelled = true; };
    }
    if (tab === "fish") {
      (async () => {
        const { data } = await (supabase as any).rpc("get_fish_leaderboard", { _limit: 200 });
        if (cancelled) return;
        const mapped = ((data as any[]) || []).map((r) => ({
          id: r.user_id, display_name: r.display_name, avatar_emoji: r.avatar_emoji,
          avatar_url: r.avatar_url, level: r.level, xp: 0, coins: 0, gems: 0,
          avatar_frame: r.avatar_frame, name_frame: r.name_frame,
          unique_fish: r.unique_fish, total_fish: Number(r.total_fish) || 0,
        }));
        setFishRows(mapped.filter((p) => !staffIds.has(p.id)).slice(0, 100));
        setLoading(false);
      })();
      return () => { cancelled = true; };
    }
    if (tab === "ships") {
      (async () => {
        const { data } = await (supabase as any).rpc("get_ship_market_leaderboard", { _limit: 200 });
        if (cancelled) return;
        const mapped = ((data as any[]) || []).map((r) => ({
          id: r.user_id, display_name: r.display_name, avatar_emoji: r.avatar_emoji,
          avatar_url: r.avatar_url, level: r.level, xp: 0, coins: 0, gems: 0,
          avatar_frame: r.avatar_frame, name_frame: r.name_frame,
          market_level: r.market_level,
        }));
        setShipRows(mapped.filter((p) => !staffIds.has(p.id)).slice(0, 100));
        setLoading(false);
      })();
      return () => { cancelled = true; };
    }
    const col = tab === "xp" ? "xp" : tab === "gems" ? "gems" : "coins";
    (async () => {
      const { data } = await (supabase as any).rpc("get_currency_leaderboard", { _col: col, _limit: 100 });
      if (cancelled) return;
      const mapped = ((data as any[]) || []).map((r) => ({
        id: r.id, display_name: r.display_name, avatar_emoji: r.avatar_emoji, avatar_url: r.avatar_url,
        level: r.level, xp: r.xp ?? 0, coins: Number(r.coins) || 0, gems: Number(r.gems) || 0,
        avatar_frame: r.avatar_frame, name_frame: r.name_frame,
      })) as LbProfile[];
      setRows(mapped);
      setLoading(false);
    })();
    return () => { cancelled = true; };

  }, [tab, staffIds, refreshSeq]);

  useEffect(() => {
    if (tab === "search") return;
    let debounce: number | null = null;
    const refreshNow = () => {
      if (debounce) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        // Force a fresh fetch even if a previous one is stuck pending
        // (e.g. the user lost connection mid-request).
        setLoading(false);
        setRefreshSeq((n) => n + 1);
      }, 150);
    };
    const onVisible = () => { if (document.visibilityState === "visible") refreshNow(); };
    const onOnline = () => refreshNow();
    window.addEventListener("focus", refreshNow);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    const watchedTables =
      tab === "fish" ? ["fish_caught", "profiles"] :
      tab === "tribes" || tab === "tribe_donations" ? ["tribes", "tribe_donations", "support_gifts", "attacks"] :
      tab === "ships" ? ["ships_owned", "profiles"] :
      tab === "xp" || tab === "gems" || tab === "coins" ? ["profiles"] :
      [];
    // NOTE: "comp" tab intentionally has no realtime subscription. get_active_competitions
    // internally calls finalize_due_competitions() which may UPDATE the competitions row,
    // which would fire postgres_changes and re-trigger this fetch in a tight loop.
    const ch = watchedTables.length > 0
      ? watchedTables.reduce((channel, table) => (
          channel.on("postgres_changes", { event: "*", schema: "public", table }, refreshNow)
        ), supabase.channel(`leaderboard-live-${tab}`)).subscribe()
      : null;
    return () => {
      window.removeEventListener("focus", refreshNow);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      if (debounce) window.clearTimeout(debounce);
      if (ch) supabase.removeChannel(ch);
    };
  }, [tab]);

  // Safety net: if a fetch stalls (e.g. network dropped mid-request and the
  // promise never resolves), give up after 8s, reset the spinner, and retry.
  useEffect(() => {
    if (!loading) return;
    const t = window.setTimeout(() => {
      setLoading(false);
      setRefreshSeq((n) => n + 1);
    }, 8000);
    return () => window.clearTimeout(t);
  }, [loading, refreshSeq]);


  const rememberPlayerSource = () => {
    savePlayerReturnSource({ kind: "leaderboard", tab, q, tribeQ });
  };

  const openPlayerFromLeaderboard = (id: string) => {
    sound.play("click");
    rememberPlayerSource();
    onClose();
    navigate({ to: "/p/$id", params: { id } });
  };

  const beforePlayerLink = () => {
    sound.play("click");
    rememberPlayerSource();
    onClose();
  };

  const runSearch = async (term = q) => {
    const query = term.trim();
    if (!query) return;
    setLoading(true);
    const { data } = await supabase.from("profiles")
      .select("id,display_name,avatar_emoji,avatar_url,level,xp,coins,gems,avatar_frame,name_frame")
      .ilike("display_name", `%${query}%`).limit(200);
    const filtered = ((data as LbProfile[]) || []).filter((p) => !staffIds.has(p.id)).slice(0, 100);
    setRows(filtered);
    setLoading(false);
  };

  useEffect(() => {
    if (restoredSearchRef.current || initialRestore?.tab !== "search" || tab !== "search" || !q.trim()) return;
    restoredSearchRef.current = true;
    void runSearch(q);
  }, [initialRestore?.tab, q, tab, staffIds]);


  const TABS = [
    { id: "comp" as const, e: "🏆", l: "فعاليات" },
    { id: "xp" as const, e: "⭐", l: "XP" },
    { id: "gems" as const, e: "💎", l: "جواهر" },
    { id: "coins" as const, e: <CoinIcon size={18} />, l: "ذهب" },
    { id: "fish" as const, e: "🐟", l: "صيد" },
    { id: "ships" as const, e: "🏪", l: "سوق" },
    { id: "tribes" as const, e: "🏴‍☠️", l: "قبائل" },
    { id: "tribe_donations" as const, e: <CoinIcon size={18} />, l: "تبرع" },
    { id: "search" as const, e: "🔍", l: "بحث" },
  ];

  const valueFor = (p: LbProfile) =>
    tab === "gems" ? p.gems : tab === "coins" ? p.coins : p.xp;
  const valueIcon: React.ReactNode = tab === "gems" ? "💎" : tab === "coins" ? <CoinIcon size={14} /> : "⭐";

  const tribesFiltered = tribeQ.trim()
    ? tribes.filter(t => t.name.toLowerCase().includes(tribeQ.trim().toLowerCase()))
    : tribes;


  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-2"
      style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))", paddingBottom: "calc(0.5rem + var(--keyboard-inset, 0px) + env(safe-area-inset-bottom, 0px))" }}
      onClick={onClose}>
      <div className="w-full max-w-md glass-hud border-2 border-accent/60 rounded-2xl p-3 flex flex-col"
        style={{ maxHeight: "calc(var(--app-height, 100dvh) - var(--keyboard-inset, 0px) - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 1rem)" }}
        onClick={(e) => e.stopPropagation()} dir="rtl">
        <div className="text-center text-accent font-bold text-lg mb-2">🏆 الترتيب</div>

        <div className="grid grid-cols-9 gap-1 mb-3">
          {TABS.map(t => (
            <button key={t.id}
              onClick={() => { sound.play("click"); setTab(t.id); setRows([]); setFishRows([]); setShipRows([]); }}
              className={`py-1.5 rounded-lg text-[9px] font-bold border transition ${
                tab === t.id ? "bg-accent text-secondary border-accent" : "bg-secondary/60 text-accent/80 border-accent/30"
              }`}>
              <div className="text-sm">{t.e}</div>
              <div className="leading-tight">{t.l}</div>
            </button>
          ))}
        </div>


        {tab === "search" && (
          <div className="flex gap-2 mb-2">
            <input value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="اسم القبطان..."
              className="flex-1 px-3 py-2 rounded-lg bg-secondary/80 border border-accent/40 text-sm text-accent" />
            <button onClick={() => runSearch()}
              className="px-4 rounded-lg bg-accent text-secondary font-bold text-sm">بحث</button>
          </div>
        )}

        {(tab === "tribes" || tab === "tribe_donations") && (
          <input value={tribeQ} onChange={(e) => setTribeQ(e.target.value)}
            placeholder="ابحث باسم القبيلة..."
            className="w-full mb-2 px-3 py-2 rounded-lg bg-secondary/80 border border-accent/40 text-sm text-accent" />
        )}

        <div className="flex-1 overflow-y-auto space-y-1">
          {loading ? (
            <div className="text-center text-accent/60 py-6 text-sm">جاري التحميل…</div>
          ) : tab === "comp" ? (
            comps.length === 0 && tribeEvents.length === 0 ? (
              <div className="text-center text-accent/60 py-10 text-sm">
                <div className="text-5xl mb-2">🎪</div>
                لا توجد فعاليات نشطة حالياً
              </div>
            ) : (
              <div className="space-y-3 pb-2">
                {tribeEvents.map(ev => {
                  const now = Date.now();
                  const startsMs = new Date(ev.starts_at).getTime();
                  const endsMs = new Date(ev.ends_at).getTime();
                  const notStarted = now < startsMs;
                  const target = notStarted ? startsMs : endsMs;
                  const diff = Math.max(0, target - now);
                  const d = Math.floor(diff / 86400000);
                  const h = Math.floor((diff % 86400000) / 3600000);
                  const m = Math.floor((diff % 3600000) / 60000);
                  const cd = d > 0 ? `${d}ي ${h}س` : h > 0 ? `${h}س ${m}د` : `${m}د`;
                  return (
                    <button
                      key={ev.id}
                      onClick={() => { sound.play("click"); onClose(); navigate({ to: "/tribe-events" }); }}
                      className="w-full text-right rounded-xl overflow-hidden border-2 border-amber-400/60 bg-gradient-to-br from-amber-600/40 via-orange-700/30 to-amber-900/40 p-3 active:scale-[0.98] transition shadow-[0_2px_8px_rgba(251,191,36,0.35)]"
                    >
                      <div className="flex items-center gap-2">
                        <div className="text-3xl drop-shadow">{ev.banner_emoji || "🐠🏆"}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-black text-amber-50 drop-shadow truncate">{ev.title}</div>
                          <div className="text-[10px] font-bold text-amber-100/90">🏴‍☠️ فعالية القبائل</div>
                        </div>
                        <div className="text-end shrink-0">
                          <div className="text-[9px] text-amber-100/80">{notStarted ? "تبدأ خلال" : "تنتهي خلال"}</div>
                          <div className="text-xs font-black text-amber-50">⏳ {cd}</div>
                        </div>
                      </div>
                      <div className="mt-2 text-center text-[11px] font-bold text-amber-200">اضغط للترتيب والتفاصيل ←</div>
                    </button>
                  );
                })}
                {comps.map(c => {
                  const meta = COMP_METRIC_LABEL[c.metric] ?? { icon: "🏆", name: c.metric, unit: "" };
                  const themeClass = COMP_THEME[c.banner_theme] ?? COMP_THEME.gold;
                  const board = compBoards[c.id] ?? [];
                  const tiers = (Array.isArray(c.prize_tiers) && c.prize_tiers.length > 0)
                    ? c.prize_tiers
                    : (c.reward_coins || c.reward_gems || c.reward_xp || c.reward_text)
                      ? [{ rank: 1, coins: c.reward_coins, gems: c.reward_gems, xp: c.reward_xp, text: c.reward_text }]
                      : [];
                  return (
                    <div key={c.id} className="rounded-xl overflow-hidden border border-accent/40 bg-secondary/40">
                      <div className={`relative bg-gradient-to-br ${themeClass} p-3`}>
                        <div className="flex items-center gap-2">
                          <div className="text-3xl drop-shadow">{c.banner_emoji}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-black text-white drop-shadow truncate">{c.title}</div>
                            <div className="text-[10px] font-bold text-white/90">{meta.icon} {meta.name}</div>
                          </div>
                          <div className="text-end shrink-0">
                            <div className="text-[9px] text-white/80">ينتهي</div>
                            <div className="text-xs font-black text-white">⏳ {compTimeLeft(c.ends_at)}</div>
                          </div>
                        </div>
                      </div>

                      {/* Prizes button */}
                      {tiers.length > 0 && (
                        <div className="px-2 py-2 border-b border-accent/20">
                          <button
                            onClick={() => { sound.play("click"); setPrizesModal({ title: c.title, tiers: tiers as PrizeTier[] }); }}
                            className="w-full py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-700 text-amber-50 text-[12px] font-black active:scale-95 shadow-[0_2px_8px_rgba(251,191,36,0.45)]"
                          >
                            🏆 عرض الجوائز ({tiers.length})
                          </button>
                        </div>
                      )}

                      {/* Leaderboard */}
                      <div className="p-2 space-y-1">
                        <div className="text-[10px] font-black text-accent/70 px-1">🏅 الترتيب</div>
                        {board.length === 0 ? (
                          <div className="text-center text-[11px] text-accent/50 py-3">كن أول من يسجّل! 🚀</div>
                        ) : (() => {
                          const showPodium = board.length >= 3;
                          const podiumItems: PodiumItem[] = showPodium ? board.slice(0, 3).map((r) => ({
                            id: r.user_id,
                            name: r.display_name || "—",
                            avatarUrl: r.avatar_url,
                            avatarEmoji: r.avatar_emoji,
                            value: <>{r.score.toLocaleString()}</>,
                            isMe: r.user_id === meId,
                            onClick: r.user_id === meId ? undefined : () => openPlayerFromLeaderboard(r.user_id),
                          })) : [];
                          const rest = showPodium ? board.slice(3) : board;
                          const startIdx = showPodium ? 3 : 0;
                          return (
                            <>
                              {showPodium && <LeaderboardPodium items={podiumItems} />}
                              {rest.map((r, idx) => {
                                const i = idx + startIdx;
                                const isMe = r.user_id === meId;
                                const medal = `#${i + 1}`;
                                return (
                                  <div key={r.user_id} className={`flex items-center gap-2 p-1.5 rounded ${isMe ? "bg-amber-500/20 border border-amber-400/50" : "bg-secondary/60 border border-accent/20"}`}>
                                    <span className="w-7 text-center text-xs font-black">{medal}</span>
                                    {r.avatar_url ? (
                                      <img src={r.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover"/>
                                    ) : (
                                      <span className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-sm">{r.avatar_emoji || "🧑‍✈️"}</span>
                                    )}
                                    <span className="flex-1 truncate text-[12px] font-bold text-accent">{r.display_name || "—"}{isMe ? " (أنت)" : ""}</span>
                                    <span className="text-[12px] font-black text-amber-300 tabular-nums">{r.score.toLocaleString()}</span>
                                  </div>
                                );
                              })}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : tab === "tribes" || tab === "tribe_donations" ? (
            tribesFiltered.length === 0 ? (
              <div className="text-center text-accent/60 py-6 text-sm">لا توجد قبائل</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {tribesFiltered.map((t, i) => {
                  const tier = getTribeBanner(t.level || 1);
                  const rank = i + 1;
                  // Clash-of-Clans style ranked rows. Top 3 get medal accents.
                  const medal =
                    rank === 1
                      ? { bg: "bg-gradient-to-l from-amber-500/40 via-amber-600/25 to-stone-900/60 border-amber-300/70", num: "text-amber-200", glow: "drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]" }
                      : rank === 2
                      ? { bg: "bg-gradient-to-l from-slate-300/30 via-slate-400/20 to-stone-900/60 border-slate-200/60", num: "text-slate-100", glow: "drop-shadow-[0_0_6px_rgba(226,232,240,0.5)]" }
                      : rank === 3
                      ? { bg: "bg-gradient-to-l from-orange-700/35 via-amber-800/25 to-stone-900/60 border-orange-400/60", num: "text-orange-200", glow: "drop-shadow-[0_0_6px_rgba(251,146,60,0.5)]" }
                      : { bg: "bg-stone-900/70 border-stone-700/70", num: "text-amber-300/90", glow: "" };
                  const isDonationTab = tab === "tribe_donations";
                  const score = (isDonationTab ? Number(t.donation_score) : Number(t.power) || Number(t.attack_score) || 0).toLocaleString();
                  return (
                    <button
                      key={t.id}
                      onClick={() => { sound.play("click"); setOpenTribeId(t.id); }}
                      className={`w-full text-right relative overflow-hidden flex items-center gap-3 px-2 py-2 rounded-xl border-2 ${medal.bg} active:scale-[0.98] transition shadow-[0_2px_0_rgba(0,0,0,0.4)]`}
                    >
                      {/* Banner watermark */}
                      <img src={tier.url} alt="" aria-hidden loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 pointer-events-none" />

                      {/* Rank number */}
                      <div className={`relative w-10 text-center text-2xl font-black tabular-nums ${medal.num} ${medal.glow}`}>
                        {rank}
                      </div>

                      {/* Emblem badge */}
                      <div className="relative w-14 h-14 shrink-0 flex items-center justify-center">
                        <img src={tier.emblemUrl} alt="" loading="lazy" className="absolute inset-[14%] w-[72%] h-[72%] object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]" />
                        <img src={tier.frameUrl} alt="" aria-hidden loading="lazy" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
                      </div>

                      {/* Name + meta */}
                      <div className="relative flex-1 min-w-0">
                        <div className="text-[15px] font-black text-amber-100 truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] flex items-center gap-1.5">
                          <span className="truncate">{t.name}</span>
                          <span className="text-amber-300 text-[11px] shrink-0">⭐{t.level || 1}</span>
                        </div>
                        <div className="text-[10.5px] text-amber-200/85 truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] mt-0.5">
                          الأعضاء: <span className="font-bold text-amber-100">{t.members}</span>
                          <span className="mx-1 opacity-50">·</span>
                          {tier.name}
                        </div>
                      </div>

                      {/* Trophy score */}
                      <div className="relative flex items-center gap-1 shrink-0 pl-1">
                        <span className="text-[15px] font-black text-amber-200 tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">{score}</span>
                        {isDonationTab ? (
                          <span className="text-base drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"><CoinIcon size={18} /></span>
                        ) : (
                          <span className="text-base drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">🏆</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )

          ) : tab === "fish" ? (
            fishRows.length === 0 ? (
              <div className="text-center text-accent/60 py-6 text-sm">لا يوجد صيادون بعد</div>
            ) : (() => {
              const podiumItems: PodiumItem[] = fishRows.slice(0, 3).map((p) => ({
                id: p.id,
                name: p.display_name || "—",
                avatarUrl: p.avatar_url,
                avatarEmoji: p.avatar_emoji,
                subtitle: `إجمالي ${p.total_fish.toLocaleString()}`,
                value: <>🐟 {p.unique_fish} نوع</>,
                isMe: meId === p.id,
                onClick: meId === p.id ? undefined : () => openPlayerFromLeaderboard(p.id),
              }));
              const rest = fishRows.slice(3);
              return (
                <>
                  <LeaderboardPodium items={podiumItems} />
                  {rest.map((p, idx) => {
              const i = idx + 3;
              const isMe = meId === p.id;
              const tier = rankTier(i);
              const hasNameFrame = frameById(p.name_frame)?.kind === "name";
              const hasAvatarFrame = !!frameById(p.avatar_frame)?.imageUrl;
              const Inner = (
                <>
                  <div className={`w-7 text-center text-sm font-extrabold ${tier ? "text-amber-200 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]" : "text-accent"}`}>{tier ? tier.badge : i + 1}</div>
                  <div className="relative w-[60px] h-[60px] shrink-0 flex items-center justify-center">
                    <div className={`w-[44px] h-[44px] rounded-full bg-gradient-to-b from-sky-400 to-sky-700 flex items-center justify-center text-lg overflow-hidden ${hasAvatarFrame ? "ring-2 ring-amber-300/50" : tier ? tier.ringClass : "ring-2 ring-amber-300/50"}`}
                      style={tier && !hasAvatarFrame ? { filter: tier.glowFilter } : undefined}>
                      {p.avatar_url ? <img src={p.avatar_url} alt="" className="w-full h-full object-cover" /> : p.avatar_emoji}
                    </div>
                    {hasAvatarFrame && (
                      <img src={frameById(p.avatar_frame)?.imageUrl} alt="" className={`absolute inset-0 w-full h-full object-contain pointer-events-none ${frameById(p.avatar_frame)?.animClass ?? ""}`} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`inline-flex max-w-full px-2 py-0.5 text-[12px] font-bold truncate ${hasNameFrame ? `${frameById(p.name_frame)?.nameClass} ${frameById(p.name_frame)?.animClass ?? ""}` : tier ? tier.nameClass : "text-accent"}`}>{p.display_name}{isMe ? " (أنت)" : ""}</div>
                    <div className="text-[10px] text-accent/70">إجمالي {p.total_fish.toLocaleString()} سمكة</div>
                  </div>
                  <div className="text-xs font-bold text-cyan-300 tabular-nums">🐟 {p.unique_fish} نوع</div>
                </>
              );
              const baseRow = tier ? `${tier.rowClass} border` : "bg-secondary/60 border border-accent/30";
              const meRow = tier ? `${tier.rowClass} border opacity-90` : "bg-secondary/40 border border-accent/20 opacity-80";
              return isMe ? (
                <div key={p.id} className={`flex items-center gap-2 p-2 rounded-lg ${meRow}`}>{Inner}</div>
              ) : (
                <Link key={p.id} to="/p/$id" params={{ id: p.id }}
                  onClick={beforePlayerLink}
                  className={`flex items-center gap-2 p-2 rounded-lg active:scale-[0.98] ${baseRow}`}>
                  {Inner}
                </Link>
              );
            })}
                </>
              );
            })()
          ) : tab === "ships" ? (
            shipRows.length === 0 ? (
              <div className="text-center text-accent/60 py-6 text-sm">لا يوجد لاعبون بعد</div>
            ) : (() => {
              const podiumItems: PodiumItem[] = shipRows.slice(0, 3).map((p) => ({
                id: p.id,
                name: p.display_name || "—",
                avatarUrl: p.avatar_url,
                avatarEmoji: p.avatar_emoji,
                subtitle: `المستوى ${p.level}`,
                value: <>🏪 مستوى {p.market_level}</>,
                isMe: meId === p.id,
                onClick: meId === p.id ? undefined : () => openPlayerFromLeaderboard(p.id),
              }));
              const rest = shipRows.slice(3);
              return (
                <>
                  <LeaderboardPodium items={podiumItems} />
                  {rest.map((p, idx) => {
              const i = idx + 3;
              const isMe = meId === p.id;
              const tier = rankTier(i);
              const hasNameFrame = frameById(p.name_frame)?.kind === "name";
              const hasAvatarFrame = !!frameById(p.avatar_frame)?.imageUrl;
              const Inner = (
                <>
                  <div className={`w-7 text-center text-sm font-extrabold ${tier ? "text-amber-200 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]" : "text-accent"}`}>{tier ? tier.badge : i + 1}</div>
                  <div className="relative w-[60px] h-[60px] shrink-0 flex items-center justify-center">
                    <div className={`w-[44px] h-[44px] rounded-full bg-gradient-to-b from-sky-400 to-sky-700 flex items-center justify-center text-lg overflow-hidden ${hasAvatarFrame ? "ring-2 ring-amber-300/50" : tier ? tier.ringClass : "ring-2 ring-amber-300/50"}`}
                      style={tier && !hasAvatarFrame ? { filter: tier.glowFilter } : undefined}>
                      {p.avatar_url ? <img src={p.avatar_url} alt="" className="w-full h-full object-cover" /> : p.avatar_emoji}
                    </div>
                    {hasAvatarFrame && (
                      <img src={frameById(p.avatar_frame)?.imageUrl} alt="" className={`absolute inset-0 w-full h-full object-contain pointer-events-none ${frameById(p.avatar_frame)?.animClass ?? ""}`} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`inline-flex max-w-full px-2 py-0.5 text-[12px] font-bold truncate ${hasNameFrame ? `${frameById(p.name_frame)?.nameClass} ${frameById(p.name_frame)?.animClass ?? ""}` : tier ? tier.nameClass : "text-accent"}`}>{p.display_name}{isMe ? " (أنت)" : ""}</div>
                    <div className="text-[10px] text-accent/70">المستوى {p.level}</div>
                  </div>
                  <div className="text-xs font-bold text-amber-300 tabular-nums">🏪 مستوى {p.market_level}</div>
                </>
              );
              const baseRow = tier ? `${tier.rowClass} border` : "bg-secondary/60 border border-accent/30";
              const meRow = tier ? `${tier.rowClass} border opacity-90` : "bg-secondary/40 border border-accent/20 opacity-80";
              return isMe ? (
                <div key={p.id} className={`flex items-center gap-2 p-2 rounded-lg ${meRow}`}>{Inner}</div>
              ) : (
                <Link key={p.id} to="/p/$id" params={{ id: p.id }}
                  onClick={beforePlayerLink}
                  className={`flex items-center gap-2 p-2 rounded-lg active:scale-[0.98] ${baseRow}`}>
                  {Inner}
                </Link>
              );
            })}
                </>
              );
            })()
          ) : rows.length === 0 ? (
            <div className="text-center text-accent/60 py-6 text-sm">
              {tab === "search" ? "ابحث باسم قبطان" : "لا توجد نتائج"}
            </div>
          ) : (() => {
            const showPodium = tab !== "search" && rows.length >= 3;
            const podiumItems: PodiumItem[] = showPodium ? rows.slice(0, 3).map((p) => ({
              id: p.id,
              name: p.display_name || "—",
              avatarUrl: p.avatar_url,
              avatarEmoji: p.avatar_emoji,
              subtitle: `المستوى ${p.level}`,
              value: <>{valueIcon} {valueFor(p).toLocaleString()}</>,
              isMe: meId === p.id,
              onClick: meId === p.id ? undefined : () => openPlayerFromLeaderboard(p.id),
            })) : [];
            const rest = showPodium ? rows.slice(3) : rows;
            const startIdx = showPodium ? 3 : 0;
            return (
              <>
                {tab === "xp" && (
                  <div className="mb-2">
                    <button
                      onClick={() => {
                        sound.play("click");
                        const tiers: PrizeTier[] = [
                          { rank: 1, gems: 3000, coins: 0, xp: 0, text: "" },
                          { rank: 2, gems: 2000, coins: 0, xp: 0, text: "" },
                          { rank: 3, gems: 1000, coins: 0, xp: 0, text: "" },
                          { rank: 4, gems: 500, coins: 0, xp: 0, text: "" },
                          { rank: 5, gems: 500, coins: 0, xp: 0, text: "" },
                          { rank: 6, gems: 500, coins: 0, xp: 0, text: "" },
                          { rank: 7, gems: 500, coins: 0, xp: 0, text: "" },
                          { rank: 8, gems: 500, coins: 0, xp: 0, text: "" },
                          { rank: 9, gems: 500, coins: 0, xp: 0, text: "" },
                          { rank: 10, gems: 500, coins: 0, xp: 0, text: "" },
                        ];
                        setPrizesModal({ title: "جوائز مسابقة XP الأسبوعية", tiers });
                      }}
                      className="w-full py-2 rounded-lg bg-gradient-to-r from-amber-500/30 to-amber-600/30 border border-amber-400/50 text-amber-200 text-sm font-bold active:scale-[0.98]"
                    >
                      🏆 عرض جوائز المسابقة الأسبوعية
                    </button>
                  </div>
                )}
                {showPodium && <LeaderboardPodium items={podiumItems} />}
                {rest.map((p, idx) => {
            const i = idx + startIdx;
            const isMe = meId === p.id;
            const tier = tab !== "search" ? rankTier(i) : null;
            const hasNameFrame = frameById(p.name_frame)?.kind === "name";
            const hasAvatarFrame = !!frameById(p.avatar_frame)?.imageUrl;
            const Inner = (
              <>
              {tab !== "search" && (
                <div className={`w-7 text-center text-sm font-extrabold ${tier ? "text-amber-200 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]" : "text-accent"}`}>{tier ? tier.badge : i + 1}</div>
              )}
              <div className="relative w-[72px] h-[72px] shrink-0 flex items-center justify-center">
                <div className={`w-[50px] h-[50px] rounded-full bg-gradient-to-b from-sky-400 to-sky-700 flex items-center justify-center text-xl overflow-hidden shadow-[0_0_10px_rgba(252,191,73,0.5)] ${hasAvatarFrame ? "ring-2 ring-amber-300/50" : tier ? tier.ringClass : "ring-2 ring-amber-300/50"}`}
                  style={tier && !hasAvatarFrame ? { filter: tier.glowFilter } : undefined}>
                  {p.avatar_url ? <img src={p.avatar_url} alt="" className="w-full h-full object-cover" /> : p.avatar_emoji}
                </div>
                {hasAvatarFrame && (
                  <img src={frameById(p.avatar_frame)?.imageUrl} alt="" className={`absolute inset-0 w-full h-full object-contain pointer-events-none ${frameById(p.avatar_frame)?.animClass ?? ""}`} style={{ filter: "drop-shadow(0 0 8px rgba(252,191,73,0.7)) saturate(1.35) contrast(1.1)" }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`inline-flex max-w-full px-2 py-0.5 text-[12px] font-bold truncate ${hasNameFrame ? `${frameById(p.name_frame)?.nameClass} ${frameById(p.name_frame)?.animClass ?? ""}` : tier ? tier.nameClass : "text-accent"}`}>{p.display_name}{isMe ? " (أنت)" : ""}</div>
                <div className="text-[10px] text-accent/70">المستوى {p.level}{tier ? ` · ${tier.label}` : ""}</div>
              </div>
              <div className="text-xs font-bold text-accent tabular-nums inline-flex items-center gap-1">
                {valueIcon} {valueFor(p).toLocaleString()}
              </div>
              </>
            );
            const baseRow = tier ? `${tier.rowClass} border` : "bg-secondary/60 border border-accent/30";
            const meRow = tier ? `${tier.rowClass} border opacity-90` : "bg-secondary/40 border border-accent/20 opacity-80";
            return isMe ? (
              <div key={p.id} className={`flex items-center gap-2 p-2 rounded-lg ${meRow}`}>{Inner}</div>
            ) : (
              <Link key={p.id} to="/p/$id" params={{ id: p.id }}
                onClick={beforePlayerLink}
                className={`flex items-center gap-2 p-2 rounded-lg active:scale-[0.98] ${baseRow}`}>
                {Inner}
              </Link>
            );
          })}
              </>
            );
          })()}
        </div>

        <button className="mt-2 w-full py-2 rounded-lg bg-secondary/70 text-accent text-xs font-bold active:scale-95"
          onClick={onClose}>إغلاق</button>
      </div>
      {openTribeId && <TribeDetailModal tribeId={openTribeId} onClose={() => setOpenTribeId(null)} onBeforePlayerOpen={beforePlayerLink} />}
      {prizesModal && <PrizesModal title={prizesModal.title} tiers={prizesModal.tiers} onClose={() => setPrizesModal(null)} />}
    </div>
  );
}

function TribeDetailModal({ tribeId, onClose, onBeforePlayerOpen }: { tribeId: string; onClose: () => void; onBeforePlayerOpen?: () => void }) {
  const [info, setInfo] = useState<{ name: string; emblem: string; banner: string; description: string; level: number; treasure_coins: number; total_donations: number; join_mode?: string } | null>(null);
  const [members, setMembers] = useState<Array<{ user_id: string; role: string; display_name: string; avatar_emoji: string; level: number; xp: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [meId, setMeId] = useState<string | null>(null);
  const [myTribeId, setMyTribeId] = useState<string | null>(null);
  const [pendingReq, setPendingReq] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinErr, setJoinErr] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null)); }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data: t } = await supabase.from("tribes").select("name,emblem,banner,description,level,treasure_coins,total_donations,join_mode").eq("id", tribeId).maybeSingle();
    if (t) setInfo(t as any);

    const { data: ms } = await supabase.from("tribe_members").select("user_id,role").eq("tribe_id", tribeId);
    const ids = (ms || []).map((m: any) => m.user_id);
    const { data: ps } = ids.length ? await supabase.from("profiles").select("id,display_name,avatar_emoji,level,xp").in("id", ids) : { data: [] };
    const pmap = new Map((ps || []).map((p: any) => [p.id, p]));
    const merged = (ms || []).map((m: any) => {
      const p: any = pmap.get(m.user_id) || {};
      return { user_id: m.user_id, role: m.role, display_name: p.display_name || "...", avatar_emoji: p.avatar_emoji || "👤", level: p.level || 1, xp: p.xp || 0 };
    }).sort((a, b) => (b.level * 100 + b.xp / 10) - (a.level * 100 + a.xp / 10));
    setMembers(merged);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    if (uid) {
      const { data: prof } = await supabase.from("profiles").select("tribe_id").eq("id", uid).maybeSingle();
      setMyTribeId((prof as any)?.tribe_id ?? null);
      const { data: rq } = await supabase.from("tribe_join_requests").select("id").eq("tribe_id", tribeId).eq("user_id", uid).eq("status", "pending").maybeSingle();
      setPendingReq(!!rq);
    }
    setLoading(false);
  }, [tribeId]);

  useEffect(() => { reload(); }, [reload]);

  const join = async () => {
    setJoining(true); setJoinErr(null);
    try {
      if (info?.join_mode === "open") {
        const { error } = await supabase.rpc("join_tribe_open" as never, { _tribe_id: tribeId } as never);
        if (error) throw error;
        onClose();
        window.location.href = "/chat?tab=tribe";
      } else {
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) throw new Error("سجل الدخول");
        // إلغاء أي طلبات سابقة معلّقة في قبائل أخرى قبل إرسال الطلب الجديد
        await supabase.from("tribe_join_requests").delete().eq("user_id", uid).eq("status", "pending");
        const { error } = await supabase.from("tribe_join_requests").insert({ tribe_id: tribeId, user_id: uid, status: "pending" });
        if (error) throw error;
        setPendingReq(true);
      }
    } catch (e: any) {
      setJoinErr(e?.message || "خطأ");
    }
    setJoining(false);
  };

  const totalPower = members.reduce((s, m) => s + (m.level * 100 + Math.floor(m.xp / 10)), 0) + ((info?.level || 1) - 1) * 500;

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-2"
      style={{ paddingBottom: "calc(0.5rem + var(--keyboard-inset, 0px))" }} onClick={onClose}>
      <div className="w-full max-w-md glass-hud border-2 border-accent/60 rounded-2xl p-3 flex flex-col relative"
        style={{ maxHeight: "calc(var(--app-height, 100dvh) - var(--keyboard-inset, 0px) - 1rem)" }} onClick={(e) => e.stopPropagation()} dir="rtl">
        <button
          onClick={onClose}
          aria-label="إغلاق"
          className="absolute top-2 left-2 z-[80] w-9 h-9 rounded-full bg-red-600 hover:bg-red-500 text-white text-lg font-black flex items-center justify-center shadow-lg border-2 border-white/30 active:scale-90"
        >✕</button>
        {loading || !info ? (
          <div className="text-center text-accent/70 py-10">جاري التحميل…</div>
        ) : (
          <>
            {(() => {
              const tier = getTribeBanner(info.level);
              return (
                <div className="relative w-full h-28 mb-2 rounded-xl overflow-hidden bg-gradient-to-b from-stone-900 to-stone-950 border border-accent/40">
                  <img src={tier.url} alt={`بنر مستوى ${info.level}`} loading="lazy" className="absolute inset-0 w-full h-full object-contain drop-shadow-[0_0_18px_rgba(251,191,36,0.4)]" />
                  <button onClick={onClose} className="absolute top-2 left-2 z-20 px-2 py-0.5 rounded bg-black/70 text-accent text-sm">✕</button>
                  <div className="absolute inset-x-0 bottom-1 z-10 flex flex-col items-center">
                    <div className="relative w-14 h-14 -mb-1">
                      <img src={tier.emblemUrl} alt="" loading="lazy" className="absolute inset-[14%] w-[72%] h-[72%] object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]" />
                      <img src={tier.frameUrl} alt="" aria-hidden loading="lazy" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
                    </div>
                    <div className="text-base font-extrabold text-accent drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)] truncate px-10">{info.name}</div>
                    <div className="text-[10px] text-amber-200 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">⭐ المستوى {info.level} · {tier.name} · ⚡ {totalPower.toLocaleString()}</div>
                  </div>
                </div>
              );
            })()}

            <div className="rounded-xl bg-secondary/50 border border-accent/30 p-2 mb-2">
              <div className="text-xs text-accent/90 whitespace-pre-wrap break-words">
                {info.description || "لا يوجد وصف بعد."}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[10px]">
                <div className="rounded bg-stone-900/60 p-1.5">
                  <div className="text-amber-300 font-bold">{info.treasure_coins.toLocaleString()}</div>
                  <div className="text-accent/60 inline-flex items-center justify-center gap-1 w-full">خزنة <CoinIcon size={10} /></div>
                </div>
                <div className="rounded bg-stone-900/60 p-1.5">
                  <div className="text-amber-300 font-bold">{info.total_donations.toLocaleString()}</div>
                  <div className="text-accent/60 inline-flex items-center justify-center gap-1 w-full">تبرعات <CoinIcon size={10} /></div>
                </div>
                <div className="rounded bg-stone-900/60 p-1.5">
                  <div className="text-amber-300 font-bold">{members.length}</div>
                  <div className="text-accent/60">أعضاء 👥</div>
                </div>
              </div>
              {(() => {
                const myMembership = members.find(m => m.user_id === meId);
                if (myMembership) {
                  const isOfficer = myMembership.role === "owner" || myMembership.role === "moderator";
                  return (
                    <a href={`/chat?manage=${isOfficer ? "1" : "0"}&tab=tribe`}
                       onClick={() => sound.play("click")}
                       className="mt-2 block w-full text-center py-2 rounded-lg bg-amber-600 text-stone-900 font-extrabold text-xs">
                      {isOfficer ? "⚙️ إدارة القبيلة" : "🏴‍☠️ افتح قبيلتي في الشات"}
                    </a>
                  );
                }
                if (!meId) return null;
                if (myTribeId && myTribeId !== tribeId) {
                  return (
                    <div className="mt-2 text-center py-2 rounded-lg bg-stone-800 text-accent/60 text-[11px]">
                      أنت بقبيلة أخرى — اخرج منها أولاً للانضمام
                    </div>
                  );
                }
                const isOpen = info.join_mode === "open";
                return (
                  <div className="mt-2 space-y-1">
                    <button
                      disabled={joining || pendingReq}
                      onClick={() => { sound.play("click"); join(); }}
                      className="block w-full text-center py-2 rounded-lg bg-emerald-600 text-white font-extrabold text-xs disabled:opacity-60">
                      {pendingReq ? "⏳ بانتظار قبول الزعيم" : isOpen ? "🚀 انضمام مباشر" : "📩 طلب انضمام"}
                    </button>
                    {joinErr && <div className="text-[10px] text-red-400 text-center">{joinErr}</div>}
                  </div>
                );
              })()}
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 pb-24">

              <div className="text-xs font-bold text-accent mb-1">👥 الأعضاء</div>
              {members.map((m, i) => {
                const row = (
                  <>
                  <div className="w-6 text-center text-xs font-bold text-accent">{i + 1}</div>
                  <div className="w-8 h-8 rounded-full bg-sky-700 flex items-center justify-center">{m.avatar_emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-accent truncate">{m.display_name} {m.role === "owner" ? "👑" : m.role === "moderator" ? "🛡️" : ""}</div>
                    <div className="text-[10px] text-accent/70">المستوى {m.level}</div>
                  </div>
                  <div className="text-xs font-bold text-accent tabular-nums">⚡ {(m.level * 100 + Math.floor(m.xp / 10)).toLocaleString()}</div>
                  </>
                );
                return m.user_id === meId ? (
                  <div key={m.user_id} className="flex items-center gap-2 p-2 rounded-lg bg-secondary/40 border border-accent/20 opacity-80">{row}</div>
                ) : (
                  <Link key={m.user_id} to="/p/$id" params={{ id: m.user_id }}
                    onClick={onBeforePlayerOpen ?? (() => { sound.play("click"); onClose(); })}
                    className="flex items-center gap-2 p-2 rounded-lg bg-secondary/60 border border-accent/30 active:scale-[0.98]">
                    {row}
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Resource({ icon, value, color }: { icon: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <span className="text-base">{icon}</span>
      <span className={`text-[11px] font-bold ${color} tabular-nums`}>
        {value.toLocaleString()}
      </span>
      <Link
        to="/recharge"
        onClick={() => sound.play("click")}
        className="w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center leading-none active:scale-90"
      >
        +
      </Link>
    </div>
  );
}

function ShipSlot({ ship, onTap, active, crews = [] }: { ship: Ship; onTap: () => void; active?: boolean; crews?: typeof CREWS }) {
  const prevSailRef = useRef(ship.sail);
  const velocityRef = useRef(0);
  // Default idle orientation: bow toward the shore (left).
  const lastDirRef = useRef(-1);

  // Track per-frame sail delta to derive direction & motion intensity
  const delta = ship.sail - prevSailRef.current;
  const prevSail = prevSailRef.current;
  prevSailRef.current = ship.sail;
  velocityRef.current = velocityRef.current * 0.8 + delta * 0.2;
  const v = velocityRef.current;
  const direction = v > 0 ? 1 : v < 0 ? -1 : 0;
  if (direction !== 0) lastDirRef.current = direction;

  const pct = (ship.progress / ship.max) * 100;
  const capacity = catchAmountForLevel(ship.level, ship.maxHp, ship.catalogCode, ship.hp);
  const ratio = Math.min(1, ship.max > 0 ? ship.progress / ship.max : 0);
  const caughtNow = Math.min(capacity, Math.round(capacity * ratio));
  const ready = pct >= 100;
  const tilt = direction * 2.5;

  const shipW = 22 * ship.scale;
  const dockLeft = ship.dockLeft;
  const seaSide = ship.seaSide ?? "right";
  const defaultSeaEdge = seaSide === "right" ? (96 - shipW) : 2;
  const seaLeftTarget = ship.seaLeft ?? defaultSeaEdge;
  const computedLeft = dockLeft + ship.sail * (seaLeftTarget - dockLeft);
  // Interpolate vertical position too when the admin has set a distinct sea top.
  const dockTopNum = parseFloat(String(ship.top).replace("%", "")) || 0;
  const seaTopTarget = ship.seaTop ?? dockTopNum;
  const renderedTop = `${dockTopNum + ship.sail * (seaTopTarget - dockTopNum)}%`;

  const _seaSideForFacing = ship.seaSide ?? "right";
  const facing: 1 | -1 = ship.fishing
    ? (_seaSideForFacing === "right" ? 1 : -1)
    : (_seaSideForFacing === "right" ? -1 : 1);

  // Pivot-in-place: when bow direction changes, hold position while the flip
  // animation plays, then release so the ship slides smoothly to its new spot.
  const TURN_MS = 700;
  const facingRef = useRef(facing);
  const turnEndRef = useRef(0);
  const heldLeftRef = useRef(computedLeft);
  if (facingRef.current !== facing) {
    facingRef.current = facing;
    turnEndRef.current = serverNowMs() + TURN_MS;
    heldLeftRef.current = computedLeft;
  }
  const now = serverNowMs();
  const turning = now < turnEndRef.current;
  const leftOffset = turning ? heldLeftRef.current : computedLeft;

  const destroyed = isShipBlocked(ship.destroyedAt, ship.repairEndsAt, ship.hp, ship.maxHp);
  const docked = ship.sail < 0.05;
  const nativeRight = shipBowFacesRight(ship.level);
  const seaIsRight = seaSide === "right";
  const desiredRight = ship.fishing ? seaIsRight : !seaIsRight;
  const flipX = (desiredRight !== nativeRight) ? -1 : 1;
  const atSea = ship.sail > 0.85 && !destroyed;
  const isFishing = ship.fishing && atSea && !ready && !destroyed;



  // Lifelike travel: long, slow, gentle ease — driven by Web Animations API
  // so React re-renders during the trip cannot restart or stutter the tween.
  const SAIL_TRAVEL_MS = isHeavyFxDisabled ? 1700 : 2100;
  const [animating, setAnimating] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const currentTransformRef = useRef<string>("translate3d(0%, 0, 0)");
  const runningAnimRef = useRef<Animation | null>(null);
  const didInitTransformRef = useRef(false);

  const sailOffsetPct = leftOffset - dockLeft;
  const shipWidthPct = 22 * ship.scale;
  const translateSelfPct = shipWidthPct > 0 ? (sailOffsetPct / shipWidthPct) * 100 : 0;
  const targetTransform = `translate3d(${translateSelfPct}%, 0, 0)`;

  // On first mount, snap to the ship's real position (e.g. already at sea after
  // a refresh). Only animate subsequent transitions so we don't replay the
  // "just departed" trip every time the page reloads.
  if (!didInitTransformRef.current) {
    didInitTransformRef.current = true;
    currentTransformRef.current = targetTransform;
  }

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    if (targetTransform === currentTransformRef.current) return;
    const from = currentTransformRef.current;
    const to = targetTransform;
    currentTransformRef.current = to;

    // If this transition represents a trip that already began before now
    // (e.g. page refresh while ship was already fishing / returning), snap to
    // the final position instead of replaying the departure animation.
    const tripAlreadyInProgress =
      ship.fishing && !!ship.startedAt && (serverNowMs() - ship.startedAt) > SAIL_TRAVEL_MS;

    // Cancel any in-flight trip and start fresh from where we visually are.
    try { runningAnimRef.current?.cancel(); } catch { /* noop */ }

    if (tripAlreadyInProgress) {
      el.style.transform = to;
      setAnimating(false);
      return;
    }

    setAnimating(true);
    const anim = el.animate(
      [{ transform: from }, { transform: to }],
      {
        duration: SAIL_TRAVEL_MS,
        // Sinusoidal ease-in-out — accelerates and decelerates like a real vessel.
        easing: "cubic-bezier(0.45, 0.05, 0.55, 0.95)",
        fill: "forwards",
      },
    );
    runningAnimRef.current = anim;
    anim.onfinish = () => {
      setAnimating(false);
      runningAnimRef.current = null;
    };
    anim.oncancel = () => {
      runningAnimRef.current = null;
    };
    return () => {
      // Do not cancel on unmount-mid-trip; let it settle.
    };
  }, [targetTransform, SAIL_TRAVEL_MS, ship.fishing, ship.startedAt]);



  const moving = animating;

  return (
    <div
      ref={shellRef}
      data-ship-dbid={ship.dbId || undefined}
      className="absolute z-10 pointer-events-none"
      style={{
        left: `${dockLeft}%`,
        top: renderedTop,
        width: `min(${22 * ship.scale}%, ${140 * ship.scale}px)`,
        transform: targetTransform,
        willChange: "transform",
        backfaceVisibility: "hidden",
      }}
    >
      {/* Lightweight per-ship timer (fishing time-left, or repair countdown). */}
      {(() => {
        let label = "";
        const repairRem = repairRemainingSeconds(ship.repairEndsAt);
        if (repairRem > 0) {
          label = `🔧 ${formatRepairTime(repairRem)}`;
        } else if (ship.fishing && !ready) {
          // `timeLeft` is in "effective trip seconds". With a sailor active the
          // trip progresses at 2x, so real wall-clock remaining = timeLeft / 2.
          // Display the wall-clock value so players can see the sailor's effect.
          const sailorActive = crews.some((c) => c.id === "sailor");
          const mult = sailorActive ? 2 : 1;
          const wallRem = Math.max(0, Math.ceil(ship.timeLeft / mult));
          if (wallRem <= 0) {
            label = gfMarketFullRef.current
              ? "🛒 المخزن ممتلئ — بِع السمك"
              : "⏳ جارٍ الجمع...";
          } else {
            const m = Math.floor(wallRem / 60);
            const s = wallRem % 60;
            label = `${sailorActive ? "⚓" : "⏱"} ${m}:${String(s).padStart(2, "0")}`;
          }
        } else if (ship.fishing && ready) {
          label = "✅ جاهز";
        }


        if (!label) return null;
        return (
          <div
            className="absolute left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-md bg-black/65 border border-white/15 text-white text-[10px] font-bold whitespace-nowrap pointer-events-none z-20 tabular-nums"
            style={{ top: "-14px", textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}
          >
            {label}
          </div>
        );
      })()}

      {/* Wake ripples behind — only while actually moving */}
      {moving && (
        <div
          className="absolute left-1/2 -translate-x-1/2 -bottom-3 h-4"
          style={{
            width: `${60 + ship.sail * 40}%`,
            opacity: Math.min(1, Math.abs(v) * 200) * 0.6 + ship.sail * 0.3,
          }}
        >
          <div className="w-full h-full rounded-[50%] border-t-2 border-white/70" />
          <div className="absolute inset-x-2 top-1 h-full rounded-[50%] border-t border-white/40" />
          <div className="absolute inset-x-6 top-2 h-full rounded-[50%] border-t border-white/30" />
        </div>
      )}

      {/* Foamy water trail behind ship when actually moving — skipped on iOS to reduce GPU heat */}
      {moving && !isHeavyFxDisabled && (
        <div
          className="absolute pointer-events-none"
          style={{
            // Trail extends opposite to bow direction (facing)
            [facing === -1 ? "left" : "right"]: "85%",
            bottom: "-2%",
            width: "55%",
            height: "18%",
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="absolute rounded-full bg-white/70 blur-[2px] animate-water-trail"
              style={{
                top: `${20 + (i % 2) * 30}%`,
                [facing === -1 ? "left" : "right"]: `${i * 22}%`,
                width: `${14 - i * 2}px`,
                height: `${10 - i * 1.5}px`,
                animationDelay: `${i * 0.18}s`,
                transform: facing === -1 ? "scaleX(-1)" : undefined,
              }}
            />
          ))}
        </div>
      )}


      {/* Crew characters standing on the ship deck */}
      {crews.length > 0 && (
        <div
          className="absolute left-1/2 -translate-x-1/2 pointer-events-none z-10 flex items-end justify-center gap-0.5"
          style={{ top: "22%", width: "80%", height: "20%" }}
        >
          {crews.map((c, i) => (
            <div
              key={c.id}
              className={`relative ${isHeavyFxDisabled ? "" : "animate-crew-bob"}`}
              style={{
                width: "20%",
                animationDelay: `${i * 0.25}s`,
                filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.6))",
              }}
              title={c.name}
            >
              {c.image ? (
                <img
                  src={c.image}
                  alt={c.name}
                  className="w-full h-auto object-contain"
                  draggable={false}
                />
              ) : (
                <div className="w-full text-center text-2xl">{c.emoji}</div>
              )}
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[8px] font-bold text-amber-100 bg-black/70 px-1 rounded whitespace-nowrap">
                {c.name}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Flip wrapper: animates the bow turning in place (longer transition). */}
      <div
        className="relative w-full"
        style={{
          transform: `scaleX(${flipX})`,
          transformOrigin: "center center",
          transition: "transform 0.7s ease-in-out",
          willChange: isHeavyFxDisabled ? "auto" : "transform",
        }}
      >
      {/* 3D ship body */}
      <div
        className={`relative w-full ${destroyed || docked || isHeavyFxDisabled ? "" : "animate-ship-bob"}`}
        style={{
          transform: destroyed
            ? `translate(0px, 2px) rotateX(2deg) rotateZ(18deg)`
            : `rotateX(2deg) rotateZ(${tilt * 0.6}deg)`,
          transformStyle: "preserve-3d",
          transformOrigin: "center 80%",
          transition: "transform 0.5s ease-out",
          filter: isHeavyFxDisabled
            ? "none"
            : destroyed
              ? "drop-shadow(0 10px 8px rgba(0,0,0,0.6)) grayscale(0.7) brightness(0.55) sepia(0.3) hue-rotate(-20deg)"
              : "drop-shadow(0 14px 10px rgba(0,0,0,0.55)) drop-shadow(0 4px 2px rgba(0,0,0,0.35)) saturate(1.12) contrast(1.08)",
          opacity: destroyed ? 0.8 : 1,
        }}
      >
        <div className="relative w-full">
          {/* Mirror reflection of the ship on the water */}
          {!destroyed && !isHeavyFxDisabled && (
            <img
              src={ship.img}
              alt=""
              aria-hidden
              draggable={false}
              className="absolute left-0 w-full pointer-events-none select-none"
              style={{
                top: "78%",
                transform: "scaleY(-1)",
                opacity: 0.32,
                filter: "blur(2px) saturate(0.8) brightness(0.85) hue-rotate(180deg)",
                maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 35%, rgba(0,0,0,0) 75%)",
                WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 35%, rgba(0,0,0,0) 75%)",
                mixBlendMode: "screen",
              }}
            />
          )}
          {/* Foam ring at waterline */}
          {!isHeavyFxDisabled && <div
            aria-hidden
            className="absolute left-1/2 -translate-x-1/2 pointer-events-none animate-pulse"
            style={{
              bottom: "8%",
              width: "92%",
              height: "14%",
              background:
                "radial-gradient(ellipse at center, rgba(255,255,255,0.85) 0%, rgba(220,240,255,0.5) 25%, rgba(255,255,255,0.18) 55%, rgba(255,255,255,0) 80%)",
              filter: "blur(3px)",
              opacity: 0.85,
            }}
          />}
          {/* Outer water ripple */}
          {!isHeavyFxDisabled && <div
            aria-hidden
            className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
            style={{
              bottom: "2%",
              width: "115%",
              height: "8%",
              background:
                "radial-gradient(ellipse at center, rgba(255,255,255,0) 30%, rgba(180,220,255,0.35) 55%, rgba(255,255,255,0) 80%)",
              filter: "blur(2px)",
              opacity: 0.7,
            }}
          />}
          {/* Soft shadow on water beneath hull */}
          {!isHeavyFxDisabled && <div
            aria-hidden
            className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
            style={{
              bottom: "4%",
              width: "70%",
              height: "8%",
              background:
                "radial-gradient(ellipse at center, rgba(0,20,40,0.55) 0%, rgba(0,20,40,0.2) 50%, rgba(0,0,0,0) 80%)",
              filter: "blur(5px)",
            }}
          />}
          <img
            src={ship.img}
            alt="Ship"
            className={`w-full block select-none pointer-events-none ${destroyed || isHeavyFxDisabled ? "" : "animate-sail-flap"}`}
            draggable={false}
            decoding="async"
            loading="eager"
            style={{
              WebkitBackfaceVisibility: "hidden",
              backfaceVisibility: "hidden",
              imageRendering: "auto",
              willChange: "transform",
              transform: "translateZ(0)",
            }}
          />
          {/* Tight click target over the ship hull only (not the full bounding rect) */}
          <button
            type="button"
            onClick={onTap}
            aria-label="Ship"
            className="absolute cursor-pointer pointer-events-auto active:scale-95 bg-transparent border-0 p-0"
            style={{
              left: "18%",
              top: "38%",
              width: "64%",
              height: "44%",
              transform: `scaleX(${flipX})`,
            }}
          />


          {/* Waving flag on the mast (hidden when destroyed) */}
          {!destroyed && (
            <div
              className="absolute pointer-events-none"
              style={{ left: "50%", top: "-2%", width: "14%", height: "10%" }}
            >
              <div
                className="w-full h-full animate-flag-wave"
                style={{
                  background: "linear-gradient(90deg, #ef4444 0%, #ef4444 55%, #fbbf24 55%, #fbbf24 100%)",
                  clipPath: "polygon(0 0, 100% 0, 90% 50%, 100% 100%, 0 100%)",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
                }}
              />
            </div>
          )}

          {/* Destroyed: dark smoke billows */}
          {destroyed && (
            <>
              <div className="absolute left-[45%] top-[10%] w-4 h-4 rounded-full bg-stone-900/70 blur-[3px] animate-smoke-rise" />
              <div className="absolute left-[45%] top-[10%] w-5 h-5 rounded-full bg-stone-800/60 blur-[3px] animate-smoke-rise" style={{ animationDelay: "0.6s" }} />
              <div className="absolute left-[45%] top-[10%] w-4 h-4 rounded-full bg-stone-900/50 blur-[3px] animate-smoke-rise" style={{ animationDelay: "1.2s" }} />
              <div className="absolute left-1/2 -translate-x-1/2 -top-6 text-3xl pointer-events-none">💥</div>
            </>
          )}

          {/* Chimney smoke when sailing — skipped on iOS (blur particles overheat the GPU) */}
          {moving && !destroyed && !isHeavyFxDisabled && (
            <>
              <div className="absolute left-[42%] top-[18%] w-3 h-3 rounded-full bg-white/60 blur-[2px] animate-smoke-rise" />
              <div className="absolute left-[42%] top-[18%] w-3 h-3 rounded-full bg-white/40 blur-[2px] animate-smoke-rise" style={{ animationDelay: "0.8s" }} />
              <div className="absolute left-[42%] top-[18%] w-3 h-3 rounded-full bg-white/50 blur-[2px] animate-smoke-rise" style={{ animationDelay: "1.6s" }} />
            </>
          )}


          {/* Bow splash spray when moving */}
          {moving && (
            <div
              className="absolute pointer-events-none"
              style={{ left: "85%", bottom: "8%", width: "30%", height: "10%" }}
            >
              <div
                className="w-full h-full animate-bow-splash"
                style={{
                  background: "radial-gradient(ellipse at center, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 70%)",
                  borderRadius: "50%",
                }}
              />
            </div>
          )}
        </div>


        {/* Fishing nets — drop into the sea when at-sea & idle */}
        {isFishing && (
          <>
            {/* Left net */}
            <div
              className="absolute"
              style={{
                left: "8%",
                top: "55%",
                width: "22%",
                height: "55%",
                transformOrigin: "top center",
                animation: "net-drop 2.6s ease-in-out infinite",
              }}
            >
              <NetSvg />
            </div>
            {/* Right net */}
            <div
              className="absolute"
              style={{
                right: "8%",
                top: "55%",
                width: "22%",
                height: "55%",
                transformOrigin: "top center",
                animation: "net-drop 2.6s ease-in-out infinite",
                animationDelay: "-1.3s",
              }}
            >
              <NetSvg />
            </div>
          </>
        )}
      </div>



      {/* Always-visible HUD above each ship: HP + fill counter */}
      {(() => {
        const maxHp = ship.maxHp ?? 100;
        const curHp = ship.hp ?? maxHp;
        const hpPct = Math.max(0, Math.min(100, (curHp / maxHp) * 100));
        const hpColor =
          hpPct > 60
            ? "from-emerald-400 to-emerald-300"
            : hpPct > 30
            ? "from-amber-400 to-amber-300"
            : "from-rose-500 to-rose-400";
        return (
          <div className="absolute top-0 left-1/2 w-[55%] flex flex-col gap-[1px] pointer-events-none z-40" style={{ transform: `translateX(-50%) scaleX(${flipX})` }}>
            {/* HP bar — slim */}
            <div className="relative h-1.5 bg-black/70 rounded-full overflow-hidden border border-white/20 shadow-md">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${hpColor} transition-all duration-300`}
                style={{ width: `${hpPct}%` }}
              />
            </div>
            {/* Fill counter — clear total/current label */}
            <div className="relative h-3.5">
              <div className="absolute inset-0 bg-black/80 rounded-full overflow-hidden border border-accent/60 shadow-[0_1px_4px_rgba(0,0,0,0.75)]">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    ready
                      ? "bg-gradient-to-r from-amber-300 to-yellow-200 animate-shimmer"
                      : ship.fishing
                      ? "bg-gradient-to-r from-emerald-400 to-emerald-300"
                      : "bg-gradient-to-r from-slate-400 to-slate-300"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {/* Label sits OUTSIDE the clipped fill so long numbers are never cut off */}
              <div className="absolute inset-0 flex items-center justify-center text-[9px] leading-none font-black text-white whitespace-nowrap pointer-events-none px-1"
                   style={{ textShadow: "0 1px 2px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.95)" }}>
                <span className="tabular-nums" dir="ltr">{caughtNow.toLocaleString("en-US")}/{capacity.toLocaleString("en-US")}</span>
                {ready && <span className="ml-0.5 animate-pulse">✦</span>}
              </div>
            </div>

            {active && (
              ready ? (
                <div className="text-center text-[9px] text-amber-200 font-bold animate-pulse">
                  ✦ جاهز للجمع ✦
                </div>
              ) : ship.fishing ? (
                <div className="text-center text-[10px] text-emerald-200 font-extrabold tabular-nums flex items-center justify-center gap-1">
                  <span>🎣 يصطاد</span>
                  {ship.sailorAtStart && (
                    <span className="text-cyan-200">⛵×2 سرعة</span>
                  )}
                </div>
              ) : (
                <div className="text-center text-[9px] text-slate-200 font-bold">
                  ⏸ متوقف — اضغط للإبحار
                </div>
              )
            )}
          </div>
        );
      })()}
      </div>
    </div>
  );
}

function Hotspot({
  to,
  label,
  emoji,
  style,
}: {
  to: string;
  label: string;
  emoji: string;
  style: React.CSSProperties;
}) {
  return (
    <Link
      to={to}
      className="absolute z-10 group active:scale-95 transition-transform"
      style={style}
    >
      {/* Hover ring on the building footprint */}
      <div className="w-full h-full rounded-2xl border-2 border-accent/0 group-hover:border-accent/60 group-active:border-accent/80 group-hover:bg-accent/5 transition-colors" />

      {/* Floating signboard — wood plank with gold trim */}
      <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none">
        <div className="w-px h-2 bg-amber-200/60" />
        <div className="relative">
          <div className="absolute inset-0 rounded-xl bg-amber-300/40 blur-md animate-pulse" />
          <div className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                          bg-gradient-to-b from-amber-900/95 via-amber-800/95 to-amber-950/95
                          border-2 border-amber-300
                          shadow-[0_4px_12px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,220,140,0.5)]
                          whitespace-nowrap">
            <span className="text-lg drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">{emoji}</span>
            <span className="text-[13px] font-black text-amber-100 tracking-wide
                             drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
              {label}
            </span>
            <span className="text-xs text-amber-200/90 font-bold">›</span>
          </div>
          <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-2/3 h-0.5 rounded-full bg-amber-300/40 blur-[2px]" />
        </div>
      </div>
    </Link>
  );
}

function NetSvg() {
  return (
    <svg viewBox="0 0 40 100" className="w-full h-full" preserveAspectRatio="none">
      {/* Rope */}
      <line x1="20" y1="0" x2="20" y2="35" stroke="#3a2a1a" strokeWidth="1.2" />
      {/* Net body — diamond mesh */}
      <g stroke="#d8c896" strokeWidth="0.8" fill="none" opacity="0.95">
        <path d="M5 40 L20 35 L35 40 L35 90 Q20 100 5 90 Z" fill="rgba(216,200,150,0.18)" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <line key={`h${i}`} x1="5" y1={45 + i * 9} x2="35" y2={45 + i * 9} />
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={`v${i}`} x1={8 + i * 6} y1="40" x2={8 + i * 6} y2="92" />
        ))}
      </g>
      {/* Catch dots */}
      <circle cx="14" cy="70" r="2" fill="#7cd0ff" opacity="0.8" />
      <circle cx="26" cy="78" r="1.6" fill="#ffd766" opacity="0.9" />
    </svg>
  );
}

function ActionBtn({ emoji, label, onClick }: { emoji: string; label: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl bg-gradient-to-b from-amber-700/80 to-amber-900/80 border border-accent/60 active:scale-95 min-w-[68px]"
      dir="rtl"
    >
      <div className="w-12 h-12 rounded-full glass-hud border border-accent/40 flex items-center justify-center text-2xl">
        {emoji}
      </div>
      <span className="text-[10px] text-accent font-bold">{label}</span>
    </button>
  );
}
