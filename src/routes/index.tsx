import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { getShipByMarketLevel, getShipByCode, catchPerTrip, shipBowFacesRight } from "@/lib/ships";
import { ProjectileFx } from "@/components/ProjectileFx";
import { getSceneVisual, getSelectedBgId } from "@/lib/backgrounds";
import { FISH, FISH_TOTAL, fishForShip } from "@/lib/fish";
import { CREWS, FIXER_HEAL } from "@/lib/crews";
import { supabase } from "@/integrations/supabase/client";
import {
  sellShip,
  deleteInventoryRows,
  buyWithCoinsGemFallback,
  buyWithGems,
} from "@/lib/economy";
import { useAuth, useProfile, refreshProfile } from "@/hooks/use-auth";
import { DailyLoginModal } from "@/components/DailyLoginModal";

import { sound } from "@/lib/sound";
import { SettingsModal } from "@/components/SettingsModal";

import { SeamlessVideo } from "@/components/SeamlessVideo";
import { NotificationsBell } from "@/components/NotificationsBell";
import { DragonHUD } from "@/components/DragonHUD";
import { DragonShoreCreature } from "@/components/DragonShoreCreature";
import { ShieldBadge } from "@/components/ShieldBadge";
import { useIsAdmin } from "@/hooks/use-admin";
import { AuthGuard } from "@/components/AuthGuard";
import { Landing } from "@/components/Landing";
import cloudImg from "@/assets/cloud-realistic.png";
import { getTribeBanner } from "@/lib/tribe-banners";
import { repairBurnedBg } from "@/components/BurnedBgOverlay";
import { AdBombOverlay } from "@/components/AdBombOverlay";
import { ShipMarketBuilding } from "@/components/ShipMarketBuilding";
import { FishMarketBuilding } from "@/components/FishMarketBuilding";
import birdImg from "@/assets/bird-realistic.png";
import { CoinIcon, GemIcon } from "@/components/CurrencyIcon";
import { syncServerTime, serverTodayKey, serverNowMs, serverNow, isServerClockSynced } from "@/lib/server-time";

import { frameById } from "@/lib/frames";
import { rankTier } from "@/lib/rank-tiers";





export const Route = createFileRoute("/")({
  component: GuardedIndex,
  ssr: false,
  head: () => ({
    meta: [
      { title: "ملوك القراصنة - لعبة المغامرات البحرية العربية | هامور شابك" },
      { name: "description", content: "العب ملوك القراصنة الآن - لعبة قراصنة وصيد بحري عربية. ابنِ أسطولك، اصطد الأسماك النادرة، واغزُ البحار. تُعرف أيضاً بـ هامور شابك و هامور 360." },
      { property: "og:title", content: "ملوك القراصنة - لعبة المغامرات البحرية" },
      { property: "og:description", content: "العب ملوك القراصنة الآن. لعبة قراصنة عربية متعددة اللاعبين." },
      { property: "og:url", content: "https://hamor.lovable.app/" },
    ],
    links: [
      { rel: "canonical", href: "https://hamor.lovable.app/" },
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
  seaSide?: "left" | "right";
}

// Fixed visual slots — each ship in the fleet gets a distinct (top, dockLeft, scale)
// so they never overlap on screen.
const SLOTS = [
  { scale: 1.12, top: "42%", dockLeft: 82 },
  { scale: 1.28, top: "55%", dockLeft: 50 },
  { scale: 1.08, top: "30%", dockLeft: 14 },
];

const INITIAL_SHIPS: Ship[] = [
  { id: 1, img: getShipByMarketLevel(1).image, progress: 0, max: 35000, timeLeft: 1200, duration: 1200, scale: SLOTS[0].scale, top: SLOTS[0].top, dockLeft: SLOTS[0].dockLeft, fishing: false, sail: 0, level: 1 },
];

const FLEET_KEY = "harbor_fleet_v2";
const MAX_FLEET = 3;
const MIN_FLEET = 1;

type FleetSlot = { id: number; dbId?: string; level: number; max: number; timeLeft: number; duration?: number; progress?: number; fishing?: boolean; sail?: number; startedAt?: number };

function loadFleet(): Ship[] {
  if (typeof window === "undefined") return INITIAL_SHIPS;
  try {
    const raw = window.localStorage.getItem(FLEET_KEY);
    if (!raw) return INITIAL_SHIPS;
    const slots = JSON.parse(raw) as FleetSlot[];
    if (!Array.isArray(slots) || slots.length === 0) return INITIAL_SHIPS;
    return slots.slice(0, MAX_FLEET).map((s, i) => {
      const slot = SLOTS[i % SLOTS.length];
      const def = getShipByMarketLevel(s.level);
      const realMax = catchPerTrip(def);
      const realDuration = def.fishingSeconds;
      return {
        id: s.id, dbId: s.dbId, level: s.level,
        max: realMax,
        timeLeft: realDuration,
        duration: realDuration,
        startedAt: s.startedAt,
        scale: slot.scale, top: slot.top, dockLeft: slot.dockLeft,
        img: def.image,
        progress: Math.min(s.progress ?? 0, realMax),
        fishing: s.fishing ?? false,
        sail: s.sail ?? (s.fishing ? 1 : 0),
      };
    });
  } catch {
    return INITIAL_SHIPS;
  }
}

function saveFleet(ships: Ship[]) {
  if (typeof window === "undefined") return;
  const slots: FleetSlot[] = ships.map((s) => ({
    id: s.id, dbId: s.dbId, level: s.level, max: s.max, timeLeft: s.timeLeft,
    duration: s.duration, progress: s.progress, fishing: s.fishing, sail: s.sail,
    startedAt: s.startedAt,
  }));
  window.localStorage.setItem(FLEET_KEY, JSON.stringify(slots));
}

// How many fish a ship hauls per successful catch — based on its storage stat.
// For VIP submarines (level 32) the per-instance storage equals its max_hp,
// which the server scales by the player's VIP level at claim time.
function catchAmountForLevel(level: number, maxHp?: number | null): number {
  if (level === 32 && maxHp && maxHp > 0) return maxHp;
  return catchPerTrip(getShipByMarketLevel(level));
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



function Index() {
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
    const t = setInterval(() => saveFleet(shipsRef.current), 1000);
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
    const { data } = await supabase
      .from("ships_owned")
      .select("id, template_id, catalog_code, acquired_at, hp, max_hp, destroyed_at, repair_ends_at, at_sea, fishing_started_at, stealing_ends_at, stealing_target_user_id")
      .eq("user_id", uid)
      .eq("in_storage", false)
      .order("acquired_at", { ascending: true });
    const owned = (data ?? []) as { id: string; template_id: number | null; catalog_code: string | null; hp: number | null; max_hp: number | null; destroyed_at: string | null; repair_ends_at: string | null; at_sea: boolean | null; fishing_started_at: string | null; stealing_ends_at: string | null; stealing_target_user_id: string | null }[];

    setShips((curr) => {
      // If the user has zero ships in DB, keep whatever is on screen (starter scene).
      if (owned.length === 0) return curr;

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
          const destroyed = !!row.destroyed_at && !!row.repair_ends_at && new Date(row.repair_ends_at).getTime() > serverNowMs();
          if (destroyed) {
            // Destroyed ships can't fish. Force them home and clear at_sea in DB.
            fishing = false;
            startedAt = undefined;
            if (row.at_sea) {
              import("@/lib/economy").then(({ setShipAtSea }) => {
                setShipAtSea(s.dbId!, false).catch(() => {});
              });
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
          } else if (s.fishing === false) {
            // Local says STOPPED — that's the source of truth.
            // If DB still says at_sea, push the stop again to fix the race.
            fishing = false;
            startedAt = undefined;
            if (row.at_sea) {
              import("@/lib/economy").then(({ setShipAtSea }) => {
                setShipAtSea(s.dbId!, false).catch(() => {});
              });
            }
          }
          return { ...s, catalogCode: row.catalog_code ?? s.catalogCode, img: row.catalog_code ? getShipByCode(row.catalog_code).image : s.img, hp: row.hp ?? s.hp, maxHp: row.max_hp ?? s.maxHp, destroyedAt: row.destroyed_at, repairEndsAt: row.repair_ends_at, fishing, startedAt, stealingEndsAt: row.stealing_ends_at, stealingTargetUserId: row.stealing_target_user_id };
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
        const maxProg = catchPerTrip(shipDef);
        const duration = shipDef.fishingSeconds;
        const onSteal = !!dbShip.stealing_target_user_id;
        const destroyed = !!dbShip.destroyed_at && !!dbShip.repair_ends_at && new Date(dbShip.repair_ends_at).getTime() > serverNowMs();
        let isFishing = !destroyed && !onSteal && !!dbShip.at_sea && !!dbShip.fishing_started_at;
        let startedAt = isFishing ? new Date(dbShip.fishing_started_at!).getTime() : undefined;
        if (!destroyed && !onSteal && seaOverride) {
          isFishing = seaOverride.atSea;
          startedAt = seaOverride.atSea ? (seaOverride.startedAt ?? startedAt ?? serverNowMs()) : undefined;
        }
        newShips.push({
          id: nextId,
          dbId: dbShip.id,
          catalogCode: dbShip.catalog_code,
          level: lvl,
          img: shipDef.image,
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
        });
      }
      const next = [...keptDb, ...newShips];
      // Bail only when nothing meaningful changed — including stealing state,
      // otherwise ships on steal missions won't disappear from the harbor.
      const sameLen = next.length === curr.length;
      const sameAll = sameLen && next.every((s, i) => {
        const c = curr[i];
        return s.dbId === c.dbId
          && (s.stealingTargetUserId ?? null) === (c.stealingTargetUserId ?? null)
          && (s.stealingEndsAt ?? null) === (c.stealingEndsAt ?? null)
          && !!s.fishing === !!c.fishing
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
    const kick = () => {
      if (debounce) clearTimeout(debounce);
      // Immediate sync for instant updates across the app
      syncFleetFromDb();
    };
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) return;
      ch = supabase
        .channel(`my-ships-${uid}-${Math.random().toString(36).slice(2, 8)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "ships_owned", filter: `user_id=eq.${uid}` }, kick)
        .on("postgres_changes", { event: "*", schema: "public", table: "fish_stock", filter: `user_id=eq.${uid}` }, kick)
        .subscribe();
    })();
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      if (debounce) clearTimeout(debounce);
      if (ch) supabase.removeChannel(ch);
    };
  }, []);
  const { user } = useAuth();
  const { profile } = useProfile();
  const coins = profile?.coins ?? 0;
  const gems = profile?.gems ?? 0;
  const [dailyOpen, setDailyOpen] = useState(false);
  const [dmUnread, setDmUnread] = useState(0);
  const [friendsUnread, setFriendsUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const loadDm = async () => {
      const { loadDmUnreadMap } = await import("@/lib/dm-unread");
      const { total } = await loadDmUnreadMap(user.id);
      if (!cancelled) setDmUnread(total);
    };
    const loadFriends = async () => {
      const { count } = await supabase.from("friends")
        .select("id", { count: "exact", head: true })
        .eq("addressee_id", user.id)
        .eq("status", "pending");
      if (!cancelled) setFriendsUnread(count ?? 0);
    };
    loadDm(); loadFriends();
    const ch = supabase.channel(`home-badges:${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${user.id}` }, loadDm)
      .on("postgres_changes", { event: "*", schema: "public", table: "friends", filter: `addressee_id=eq.${user.id}` }, loadFriends)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_blocks" }, loadDm)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [user?.id]);

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

  const [fish, setFish] = useState(0);
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
    };
    load();
    const onChanged = () => load();
    window.addEventListener("fish-stock-changed", onChanged);
    return () => { cancelled = true; window.removeEventListener("fish-stock-changed", onChanged); };
  }, [user]);
  const [pop, setPop] = useState<{ id: number; x: number; y: number; v: string } | null>(null);
  const [catchResult, setCatchResult] = useState<{ img?: string; emoji: string; name: string; count: number; shipId: number; shipLevel: number; luckBonus?: number; baseCount?: number } | null>(null);
  const [stealResult, setStealResult] = useState<{ count: number; value: number; items: { id: string; name: string; emoji: string; img?: string; qty: number }[]; cancelled?: boolean } | null>(null);
  const presentStealResult = (data: unknown, cancelled = false) => {
    const row = Array.isArray(data) && (data as unknown[])[0] ? (data as { stolen_count?: number; total_value?: number; fish_summary?: { fish_id: string; value: number }[] }[])[0] : null;
    const n = row?.stolen_count ?? 0;
    const v = row?.total_value ?? 0;
    const groups: Record<string, { id: string; name: string; emoji: string; img?: string; qty: number }> = {};
    (row?.fish_summary ?? []).forEach((it) => {
      const f = FISH[it.fish_id];
      const id = it.fish_id;
      if (!groups[id]) groups[id] = { id, name: f?.name ?? "سمكة", emoji: f?.emoji ?? "🐟", img: f?.img, qty: 0 };
      groups[id].qty += 1;
    });
    setStealResult({ count: n, value: v, items: Object.values(groups), cancelled });
    sound.play(n > 0 ? "catch" : "click");
  };
  const [menuShipId, setMenuShipId] = useState<number | null>(null);
  const [modal, setModal] = useState<null | { kind: "sell" | "crew"; shipId: number }>(null);
  const [fishPickerShipId, setFishPickerShipId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [boostOpen, setBoostOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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

  const [now, setNow] = useState(() => serverNowMs());
  type CrewRow = { id: string; item_id: string; quantity: number; meta: { assigned_ship_id?: number | string; expires_at?: string } | null };
  const [crewRows, setCrewRows] = useState<CrewRow[]>([]);
  const crewBusyRef = useRef(false);
  const [buyingCrewId, setBuyingCrewId] = useState<string | null>(null);
  const crewRowsRef = useRef<CrewRow[]>([]);
  useEffect(() => { crewRowsRef.current = crewRows; }, [crewRows]);

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

  // Active crew bonuses for a given ship (luck doubles fish, sailor +40% speed, guide reveals fish)
  const getCrewBonuses = (ship: { id: number; dbId?: string }) => {
    const nowMs = serverNowMs();
    const active = crewRowsRef.current.filter(
      (r) => isCrewAssignedToShip(r.meta, ship) &&
             (!r.meta?.expires_at || new Date(r.meta.expires_at).getTime() > nowMs)
    );
    const ids = new Set(active.map((r) => r.item_id));
    return {
      luckMult: ids.has("luck") ? 2 : 1,
      sailorMult: ids.has("sailor") ? 1.4 : 1,
      guide: ids.has("guide"),
    };
  };

  // Deterministic per-trip fish pick so the Guide crew's preview matches the actual catch.
  const predictTripFish = (pool: string[], shipId: number, startedAt?: number): string | null => {
    if (pool.length === 0) return null;
    const seed = (((startedAt ?? 0) >>> 0) ^ ((shipId * 2654435761) >>> 0)) >>> 0;
    return pool[seed % pool.length];
  };

  const fishPoolForShip = (ship: Ship) => {
    const shipPool = getShipByMarketLevel(ship.level).fishPool.filter((fishId) => !!FISH[fishId]);
    return shipPool.length > 0 ? shipPool : fishForShip(ship.level, ship.id);
  };

  // 1-second tick for countdowns / expiry
  useEffect(() => {
    const t = setInterval(() => setNow(serverNowMs()), 1000);
    return () => clearInterval(t);
  }, []);

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
    // purge expired
    const nowMs = serverNowMs();
    const expired = rows.filter((r) => r.meta?.expires_at && new Date(r.meta.expires_at).getTime() <= nowMs);
    if (expired.length) {
      await deleteInventoryRows(expired.map((r) => r.id));
    }
    setCrewRows(rows.filter((r) => !expired.includes(r)));
  };
  useEffect(() => {
    reloadCrews();
    const onFocus = () => reloadCrews();
    window.addEventListener("focus", onFocus);
    let ch: any;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) return;
      ch = supabase
        .channel(`my-inv-${uid}-${Math.random().toString(36).slice(2, 8)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "inventory", filter: `user_id=eq.${uid}` }, () => reloadCrews())
        .subscribe();
    })();
    return () => {
      window.removeEventListener("focus", onFocus);
      if (ch) supabase.removeChannel(ch);
    };
  }, [modal, crewTick]);

  const [marketLevel, setMarketLevel] = useState<number>(1);
  const [fishMarketLevel, setFishMarketLevel] = useState<number>(1);
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
      setMarketLevel(Math.max(1, Math.min(30, (shipRow as any)?.level ?? 1)));
      setFishMarketLevel(Math.max(1, Math.min(30, (fishRow as any)?.level ?? 1)));
    };
    load();
    const ch = supabase
      .channel(`my-market-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_market", filter: `user_id=eq.${user.id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_fish_market", filter: `user_id=eq.${user.id}` }, load)
      .subscribe();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    // Poll every 5s so finished upgrades surface without a page revisit
    const poll = setInterval(load, 5000);
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
      .not("stealing_target_user_id", "is", null);
    const list = (ships ?? []) as { id: string; user_id: string; stealing_ends_at: string | null; template_id: number | null; stealing_target_ship_id: string | null }[];
    if (list.length === 0) { setRaids([]); return; }
    const ids = Array.from(new Set(list.map((s) => s.user_id)));
    const { data: profs } = await supabase
      .from("profiles").select("id,display_name,avatar_emoji").in("id", ids);
    const pmap = new Map((profs ?? []).map((p: any) => [p.id, p]));
    setRaids(list.map((s) => ({
      ship_id: s.id,
      attacker_id: s.user_id,
      attacker_name: pmap.get(s.user_id)?.display_name || "لاعب",
      attacker_emoji: pmap.get(s.user_id)?.avatar_emoji || "🧑‍✈️",
      ends_at: s.stealing_ends_at || serverNow().toISOString(),
      template_id: s.template_id ?? 1,
      target_ship_id: s.stealing_target_ship_id,
    })));
  };
  useEffect(() => {
    reloadRaids();
    let uid: string | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data } = await supabase.auth.getUser();
      uid = data.user?.id ?? null;
      if (!uid) return;
      channel = supabase
        .channel(`raids-${uid}-${Math.random().toString(36).slice(2, 8)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "ships_owned" }, () => reloadRaids())
        .subscribe();
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
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

  // Auto-claim expired steal missions — loot arrives automatically
  useEffect(() => {
    const id = setInterval(async () => {
      const expired = ships.filter((s) => s.stealingTargetUserId && s.stealingEndsAt && new Date(s.stealingEndsAt).getTime() <= serverNowMs() && s.dbId);
      for (const s of expired) {
        const { data, error } = await (supabase as any).rpc("claim_steal_mission", { _attacker_ship_id: s.dbId, _force: false });
        if (!error) {
          presentStealResult(data, false);
          syncFleetFromDb();
        }
      }
    }, 4000);
    return () => clearInterval(id);
  }, [ships]);



  // Progress + sail animation ticker — strictly time-proportional.
  useEffect(() => {
    const id = setInterval(() => {
      const now = serverNowMs();
      setShips((curr) =>
        curr.map((s) => {
          // Only stay at sea while actively fishing. Pausing/stopping → sail back to the marina.
          const target = s.fishing ? 1 : 0;
          // Unified speed — same easing coefficient for going out (fishing)
          // and coming back to shore so every ship moves at the exact same pace.
          const smoothing = 0.22;
          const sail = s.sail + (target - s.sail) * smoothing;
          if (!s.fishing || !s.startedAt) {
            return { ...s, sail };
          }
          if (s.dbId && !isServerClockSynced()) {
            return { ...s, sail, progress: 0, timeLeft: s.duration };
          }
          const { sailorMult } = getCrewBonuses(s);
          const elapsed = ((now - s.startedAt) / 1000) * sailorMult; // seconds, sped up by sailor
          const ratio = Math.min(1, elapsed / Math.max(1, s.duration));
          const progress = Math.round(s.max * ratio);
          const timeLeft = Math.max(0, (s.duration - elapsed) / sailorMult);
          return { ...s, sail, progress, timeLeft };
        })
      );
    }, 60);
    return () => clearInterval(id);
  }, []);


  const isDestroyed = (x: Ship) => !!x.destroyedAt && !!x.repairEndsAt && new Date(x.repairEndsAt).getTime() > serverNowMs();

  const toggleFishing = async (shipId: number) => {
    const target = ships.find((x) => x.id === shipId);
    // Guard against double-tap on the start/stop fishing button.
    if (target?.dbId && collectingRef.current[target.dbId]) return;
    if (target?.dbId) collectingRef.current[target.dbId] = true;
    if (target && isDestroyed(target) && !target.fishing) {
      showToast("السفينة مدمّرة — انتظر حتى يكتمل الإصلاح");
      sound.play("error");
      if (target.dbId) delete collectingRef.current[target.dbId];
      return;
    }
    if (!target?.fishing && !isServerClockSynced()) {
      await syncServerTime(true);
    }
    if (!target) return;
    const startNow = serverNowMs();
    const dbIdToSync = target.dbId;
    const nextAtSea = !target.fishing;
    const nextStartedAt = nextAtSea
      ? startNow - Math.round(((target.max > 0 ? target.progress / target.max : 0) * target.duration * 1000))
      : undefined;
    if (dbIdToSync) setSeaOverride(dbIdToSync, nextAtSea, nextStartedAt);
    setShips((curr) =>
      curr.map((x) => {
        if (x.id !== shipId) return x;
        if (x.fishing) {
          return { ...x, fishing: false, startedAt: undefined, progress: 0, timeLeft: x.duration };
        }
        return { ...x, fishing: true, startedAt: nextStartedAt };
      })
    );
    sound.play("whoosh");
    // Sync at_sea to DB so other players see live status via realtime
    if (dbIdToSync) {
      const { setShipAtSea } = await import("@/lib/economy");
      const { error } = await setShipAtSea(dbIdToSync, nextAtSea);
      if (error) {
        delete seaStateOverrideRef.current[dbIdToSync];
        delete collectingRef.current[dbIdToSync];
        showToast(nextAtSea ? "تعذّر إرسال السفينة للصيد" : "تعذّر إيقاف الصيد");
        syncFleetFromDb();
        return;
      }
      clearSeaOverrideSoon(dbIdToSync);
      delete collectingRef.current[dbIdToSync];
    }
    // Instant push to spectators
    pushHarborState();
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
    const { guide } = getCrewBonuses(s);
    const pool = fishPoolForShip(s);
    const storedGuide = getShipGuide(s.id);
    const requestedFishId = guide && storedGuide && pool.includes(storedGuide) ? storedGuide : null;
    // Destroyed ships cannot fish at all until fully repaired.
    if (isDestroyed(s)) {
      showToast("السفينة مدمّرة — انتظر حتى يكتمل الإصلاح");
      setShips((curr) =>
        curr.map((x) => x.id === shipId ? { ...x, progress: 0, timeLeft: x.duration, fishing: false, startedAt: undefined } : x)
      );
      if (s.dbId) {
        import("@/lib/economy").then(({ setShipAtSea }) => {
          setShipAtSea(s.dbId!, false).catch(() => {});
        });
      }
      return;
    }

    if (!s.dbId) {
      showToast("حدّث الأسطول أولاً");
      syncFleetFromDb();
      return;
    }

    // Guard against double-tap that would race the RPC and produce "not_fishing".
    if (collectingRef.current[s.dbId]) return;
    collectingRef.current[s.dbId] = true;

    // Optimistic: dock the ship instantly so stopping/collecting feels immediate.
    setSeaOverride(s.dbId, false);
    setShips((curr) => curr.map((x) => x.id === shipId ? { ...x, progress: 0, timeLeft: x.duration, fishing: false, startedAt: undefined } : x));

    if (!isServerClockSynced()) {
      syncServerTime(true).catch(() => {});
    }


    const { data, error } = await (supabase as any).rpc("collect_fishing_reward", {
      _ship_id: s.dbId,
      _requested_fish_id: requestedFishId,
    });
    if (error) {
      delete collectingRef.current[s.dbId];
      const msg = String(error.message || "");
      // Dock locally + force-stop on server so UI stays in sync.
      setSeaOverride(s.dbId, false);
      setShips((curr) => curr.map((x) => x.id === shipId ? { ...x, progress: 0, timeLeft: x.duration, fishing: false, startedAt: undefined } : x));
      if (s.dbId) {
        import("@/lib/economy").then(({ setShipAtSea }) => {
          setShipAtSea(s.dbId!, false).catch(() => {});
        });
      }
      if (msg.includes("ship_destroyed")) showToast("السفينة مدمّرة — انتظر الإصلاح");
      else if (msg.includes("not_fishing")) {
        // Server already considers the ship docked (a previous collect/stop landed
        // first, or realtime echo raced the tap). Silent dock — no error toast.
      }
      else showToast("تعذّر استلام الصيد");
      syncFleetFromDb();
      return;
    }
    delete collectingRef.current[s.dbId];
    // Lock UI to "docked" so realtime echoes can't briefly flip it back to fishing.
    setSeaOverride(s.dbId, false);

    clearSeaOverrideSoon(s.dbId);

    const row = Array.isArray(data) ? data[0] : data;
    const caughtId = row?.fish_id as string | undefined;
    const caught = caughtId ? FISH[caughtId] : null;
    const fishGained = Number(row?.fish_qty ?? 0);
    const baseFish = Number(row?.base_qty ?? fishGained);
    const luckBonus = Number(row?.luck_bonus ?? 0);
    if (fishGained <= 0) {
      // Nothing caught yet — just dock the ship without rewarding/spamming.
      setShips((curr) =>
        curr.map((x) =>
          x.id === shipId
            ? { ...x, progress: 0, timeLeft: x.duration, fishing: false, startedAt: undefined }
            : x
        )
      );
      syncFleetFromDb();
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
    syncFleetFromDb();
    // Instant push to spectators
    pushHarborState();
    // Tell any open fish-market / inventory tab to reload right now (don't wait for realtime).
    try { window.dispatchEvent(new CustomEvent("fish-stock-changed")); } catch {}
    setPop({
      id: serverNowMs(),
      x: popAnchor.left + popAnchor.width / 2,
      y: popAnchor.top,
      v: caught
        ? `${caught.name} ×${fishGained}`
        : `سمكة ×${fishGained}`,
    });
    setCatchResult({
      img: caught?.img,
      emoji: caught?.emoji ?? "🐟",
      name: caught?.name ?? "سمكة",
      count: fishGained,
      shipId: s.id,
      shipLevel: s.level,
      baseCount: baseFish,
      luckBonus,
    });

    setTimeout(() => setPop(null), 1400);
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
        {scene.displayVideo ? (
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
            className={`absolute inset-0 h-full w-full object-cover select-none animate-bg-drift ${scene.burned ? "animate-bg-burned-pulse" : ""}`}
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
          className="absolute pointer-events-none animate-sea-flow"
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

      {profile?.id && <AdBombOverlay targetUserId={profile.id} isOwner onFlash={showToast} />}

      {scene.burned && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-40 flex items-center gap-1"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 6.5rem)" }}
        >
          {repairBtnOpen ? (
            <>
              <button
                onClick={async () => {
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
                className="px-4 py-2 rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200 text-white text-sm font-extrabold shadow-2xl active:scale-95 flex items-center gap-1.5 animate-pulse"
              >
                🛠️ إصلاح الخلفية <span className="text-cyan-200">💎100</span>
              </button>
              <button
                onClick={() => setRepairBtnOpen(false)}
                aria-label="طي"
                className="w-8 h-8 rounded-full bg-stone-900/90 border border-emerald-300/50 text-emerald-100 text-sm font-black shadow-lg active:scale-95"
              >×</button>
            </>
          ) : (
            <button
              onClick={() => setRepairBtnOpen(true)}
              aria-label="فتح إصلاح الخلفية"
              className="w-11 h-11 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200 text-white text-lg shadow-2xl active:scale-95 flex items-center justify-center animate-pulse"
            >🛠️</button>
          )}
        </div>
      )}

      {/* Incoming raids — pirates stealing from me */}
      {raids.length > 0 && (
        <div className="absolute top-20 left-2 right-2 z-30 flex flex-col gap-2 pointer-events-none">
          {raids.map((r) => {
            const secsLeft = Math.max(0, Math.ceil((new Date(r.ends_at).getTime() - now) / 1000));
            return (
              <div key={r.ship_id}
                className="pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-950/85 border-2 border-rose-500/70 backdrop-blur-sm shadow-lg animate-pulse">
                <span className="text-2xl">🏴‍☠️</span>
                <div className="flex-1 min-w-0">
                  <div className="text-rose-100 text-xs font-bold truncate">
                    {r.attacker_emoji} {r.attacker_name} يسرق منك!
                  </div>
                  <div className="text-rose-300/80 text-[10px]">
                    ينتهي خلال {Math.floor(secsLeft / 60)}:{String(secsLeft % 60).padStart(2, "0")}
                  </div>
                </div>
                <button
                  onClick={() => catchThief(r.ship_id)}
                  className="px-3 py-1.5 rounded-lg bg-gradient-to-b from-amber-400 to-amber-600 text-stone-900 text-xs font-extrabold active:scale-95"
                >🚔 قبض</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Outgoing steals — my ships currently raiding other players' harbors.
          Very prominent banner so the player can jump back to the target harbor easily. */}
      {outgoingSteals.length > 0 && (
        <div className="absolute top-16 left-2 right-2 z-40 flex flex-col gap-2 pointer-events-none">
          {outgoingSteals.map((s) => {
            const tgt = stealTargetNames[s.stealingTargetUserId!] || { name: "لاعب", emoji: "🧑‍✈️" };
            const secsLeft = Math.max(0, Math.ceil((new Date(s.stealingEndsAt!).getTime() - now) / 1000));
            const ready = secsLeft <= 0;
            return (
              <Link
                key={`out-${s.id}`}
                to="/p/$id"
                params={{ id: s.stealingTargetUserId! }}
                onClick={() => sound.play("click")}
                className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl backdrop-blur-md shadow-2xl active:scale-95 border-2 ${
                  ready
                    ? "bg-gradient-to-r from-emerald-700/90 to-emerald-900/90 border-emerald-300 animate-pulse"
                    : "bg-gradient-to-r from-amber-700/90 to-rose-900/90 border-amber-300"
                }`}
                style={{ boxShadow: "0 0 24px rgba(251,191,36,0.45)" }}
              >
                <span className="text-3xl animate-bounce">🏴‍☠️</span>
                <div className="flex-1 min-w-0 text-right">
                  <div className="text-amber-50 text-sm font-extrabold truncate">
                    {ready ? "🎉 سفينتك رجعت بالغنيمة!" : `سفينتك تسرق من ${tgt.emoji} ${tgt.name}`}
                  </div>
                  <div className="text-amber-100/90 text-[11px] font-bold">
                    {ready ? "اضغط لاستلام الغنيمة" : `اضغط للذهاب لمحيطه · ${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, "0")}`}
                  </div>
                </div>
                <span className="text-amber-100 text-2xl font-black">‹</span>
              </Link>
            );
          })}
        </div>
      )}




      {/* Fish market — takes the old ship market spot on the left beach */}
      <FishMarketBuilding
        level={fishMarketLevel}
        burnedUntil={(profile as any)?.bg_burned_until}
        style={{ left: "38%", top: "34%", width: "20%", height: "16%" }}
      />
      {/* Ship Market — floating on the sea at the marked spot */}
      <ShipMarketBuilding
        level={marketLevel}
        burnedUntil={(profile as any)?.bg_burned_until}
        style={{ right: "20%", top: "30%", width: "20%", height: "16%" }}
      />




      {/* Realistic drifting clouds */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-[5]">

        <img src={cloudImg} alt="" loading="lazy" className="absolute animate-cloud-drift select-none" style={{ top: "6%", left: "-20%", width: "26%", opacity: 0.85, animationDuration: "90s", filter: "drop-shadow(0 4px 10px rgba(255,255,255,0.15))" }} draggable={false} />
        <img src={cloudImg} alt="" loading="lazy" className="absolute animate-cloud-drift select-none" style={{ top: "16%", left: "-30%", width: "18%", opacity: 0.7, animationDuration: "120s", animationDelay: "-30s", transform: "scaleX(-1)" }} draggable={false} />
        <img src={cloudImg} alt="" loading="lazy" className="absolute animate-cloud-drift select-none" style={{ top: "2%", left: "-45%", width: "32%", opacity: 0.9, animationDuration: "150s", animationDelay: "-70s" }} draggable={false} />
      </div>

      {/* Realistic flying seagulls */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-[6]">
        <img src={birdImg} alt="" loading="lazy" className="absolute animate-bird-fly select-none" style={{ top: "12%", left: "-10%", width: "5%", animationDuration: "28s", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.25))" }} draggable={false} />
        <img src={birdImg} alt="" loading="lazy" className="absolute animate-bird-fly select-none" style={{ top: "20%", left: "-15%", width: "3.5%", animationDuration: "36s", animationDelay: "-10s" }} draggable={false} />
        <img src={birdImg} alt="" loading="lazy" className="absolute animate-bird-fly select-none" style={{ top: "6%", left: "-20%", width: "4%", animationDuration: "44s", animationDelay: "-22s" }} draggable={false} />
      </div>




      {/* TOP HUD — pirate luxury */}
      <div className="absolute top-0 left-0 right-0 px-2.5 pb-2.5 z-20 flex flex-col gap-2" style={{ paddingTop: "max(2.75rem, calc(env(safe-area-inset-top) + 1rem))" }}>
        <div className="flex items-center gap-2">
          {/* Avatar + name only — no plaque */}
          <Link to="/profile" className="relative active:scale-95 flex flex-col items-center gap-1 shrink-0">
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
            <div className={`inline-flex max-w-[110px] px-2 py-0.5 rounded-md text-[12px] font-black truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] ${frameById((profile as any)?.name_frame)?.kind === "name" ? `${frameById((profile as any)?.name_frame)?.nameClass} ${frameById((profile as any)?.name_frame)?.animClass ?? ""}` : "text-amber-100"}`}>
              {profile?.display_name || "قبطان"}
            </div>
          </Link>

          {/* Treasury — gold + gems */}
          <div className="flex-1 flex flex-col gap-1.5">
          <div className="rounded-xl border-2 border-amber-400/80 bg-gradient-to-r from-[#3a1f0a]/95 to-[#1a0d04]/95 px-2 py-1.5 flex items-center justify-between shadow-[0_2px_8px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(252,191,73,0.3)]">
              <CoinIcon size={22} />
              <span className="text-sm font-black text-amber-200 tabular-nums drop-shadow">{coins.toLocaleString()}</span>
            </div>
            <div className="rounded-xl border-2 border-cyan-400/70 bg-gradient-to-r from-[#0a1f3a]/95 to-[#04101a]/95 px-2 py-1.5 flex items-center justify-between shadow-[0_2px_8px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(125,211,252,0.3)]">
              <GemIcon size={22} />
              <span className="text-sm font-black text-cyan-200 tabular-nums drop-shadow">{gems.toLocaleString()}</span>
              <Link
                to="/recharge"
                className="w-6 h-6 rounded-full bg-cyan-400 text-cyan-950 text-xs font-black border border-cyan-200 active:scale-90 flex items-center justify-center shadow"
              >+</Link>
            </div>

          </div>

          {/* Ship icon removed — now in bottom nav */}
        </div>

        {/* Boost rail */}
        <div className="flex items-center gap-2 pr-20">
          {/* VIP removed */}

          {/* DragonHUD removed — entry is the shore dragon itself */}


          <Link
            to="/inventory"
            className="rounded-lg border border-amber-400/60 bg-gradient-to-b from-amber-900/90 to-black/90 px-2 py-1.5 flex items-center gap-1 shadow active:scale-95"
            title="الأسماك المكتشفة"
          >
            <span className="text-lg">🐟</span>
            <span className="text-sm font-black text-amber-200 tabular-nums">{fish}<span className="text-amber-400/70 font-bold">/{FISH_TOTAL}</span></span>
          </Link>
          <NotificationsBell />
          {isAdmin && (
            <Link
              to="/admin"
              className="rounded-lg border-2 border-red-400 bg-gradient-to-b from-red-600 to-red-900 px-2 py-1.5 text-sm font-black text-white shadow active:scale-95"
              title="لوحة الإدارة"
            >
              👑 إدارة
            </Link>
          )}
        </div>
        <div className="flex items-center justify-between px-1">
          <ShieldBadge />
        </div>
      </div>

      {/* Daily-login chest button (replaces the old جائزة + ✨ buttons) */}
      <button
        onClick={() => { sound.play("coin"); setDailyOpen(true); }}
        className="absolute left-2 top-[22%] z-20 w-14 h-16 rounded-2xl border-2 border-amber-300 bg-gradient-to-b from-amber-400 via-amber-600 to-amber-800 shadow-[0_4px_14px_rgba(0,0,0,0.6),0_0_20px_rgba(252,191,73,0.5)] flex flex-col items-center justify-center text-amber-50 active:scale-95"
      >
        <span className="text-3xl drop-shadow">🗝️</span>
        <span className="text-[10px] font-black mt-0.5 drop-shadow">يومي</span>
        <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-black rounded-full px-1.5 h-5 min-w-[20px] flex items-center justify-center border border-amber-100 shadow">!</span>
      </button>

      <DailyLoginModal open={dailyOpen} onClose={() => setDailyOpen(false)} />


      {/* SHIPS — auto-placed inside the current background's open-water region.
          Each scene declares waterTop / waterLeft / waterRight so ships always
          sit on water and never overlap shore, docks, rocks or buildings. */}
      {ships.filter((s) => !s.stealingTargetUserId).map((s, i) => {
        const fixedSlot = scene.shipSlots?.[i % (scene.shipSlots?.length || 1)];
        const wTop = scene.waterTop ?? 45;
        const wLeft = scene.waterLeft ?? 30;
        const wRight = scene.waterRight ?? 75;
        const wWidth = Math.max(15, wRight - wLeft);
        // Keep ships sitting low on the water surface (not floating high above it).
        const ts = [0.55, 0.75, 0.4];
        const vRange = Math.max(10, 60 - (wTop + 10));
        const top = `${fixedSlot?.top ?? wTop + 10 + ts[i] * vRange}%`;

        const scale = fixedSlot?.scale ?? 0.95 + ts[i] * 0.42; // far ship smaller, near ship bigger
        // Dock on the LEFT half of the water band so each ship always has
        // room to sail rightward when fishing (and visibly return to dock when recalled).
        const hOffsets = [0.05, 0.3, 0.6];
        const dockLeft = fixedSlot?.left ?? wLeft + hOffsets[i % hOffsets.length] * wWidth;


        const shipCrews = crewRows
          .filter((r) => isCrewAssignedToShip(r.meta, s))
          .map((r) => CREWS.find((c) => c.id === r.item_id))
          .filter((c): c is (typeof CREWS)[number] => !!c && c.id !== "trader" && c.id !== "guide");

        return (
          <ShipSlot
            key={s.id}
            ship={{ ...s, top, scale, dockLeft, seaSide: scene.seaSide }}
            crews={shipCrews}
            onTap={() => setMenuShipId(s.id)}
            active={menuShipId === s.id}
          />
        );
      })}

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
            style={{ left, top, width: "18%" }}
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
                const dead = !!s.destroyedAt && !!s.repairEndsAt && new Date(s.repairEndsAt).getTime() > serverNowMs();
                const remSec = dead ? Math.max(0, Math.ceil((new Date(s.repairEndsAt!).getTime() - serverNowMs()) / 1000)) : 0;
                const h = Math.floor(remSec / 3600);
                const m = Math.floor((remSec % 3600) / 60);
                const sec = remSec % 60;
                const remStr = h > 0 ? `${h}س ${m}د` : m > 0 ? `${m}د ${sec}ث` : `${sec}ث`;
                if (dead) {
                  return (
                    <div className="flex flex-col items-center gap-2 px-3 py-2 rounded-xl bg-stone-900/70 border border-rose-500/50">
                      <div className="text-3xl">💥</div>
                      <div className="text-rose-200 font-bold text-sm">السفينة مدمّرة</div>
                      <div className="text-rose-300/90 text-xs">⏳ الإصلاح ينتهي خلال {remStr}</div>
                      <div className="flex gap-3 mt-1">
                        <ActionBtn
                          emoji="👥"
                          label="طاقم/إصلاح"
                          onClick={() => { setMenuShipId(null); setModal({ kind: "crew", shipId: s.id }); }}
                        />
                      </div>
                    </div>
                  );
                }
                return (
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
                    <ActionBtn
                      emoji="👥"
                      label="طاقم"
                      onClick={() => { setMenuShipId(null); setModal({ kind: "crew", shipId: s.id }); }}
                    />
                    <ActionBtn
                      emoji="💰"
                      label="بيع"
                      onClick={() => {
                        setMenuShipId(null);
                        if (ships.length <= MIN_FLEET) {
                          showToast("لا يمكن بيع آخر سفينة في الأسطول");
                          return;
                        }
                        setModal({ kind: "sell", shipId: s.id });
                      }}
                    />
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
        return (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setFishPickerShipId(null)}>
            <div className="glass-hud rounded-2xl border-2 border-accent/60 p-4 max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
              <div className="text-3xl mb-2">🧭</div>
              <div className="text-accent font-black text-base mb-1">اختر نوع الصيد</div>
              <div className="text-xs text-accent/80 mb-3">الأنواع المتاحة لهذه السفينة فقط</div>
              <div className="grid grid-cols-2 gap-2">
                {choices.map((fishId) => {
                  const f = FISH[fishId];
                  if (!f) return null;
                  return (
                    <button
                      key={fishId}
                      className="flex items-center justify-center gap-2 rounded-xl border border-accent/40 bg-secondary/70 px-3 py-2 text-xs font-black text-accent active:scale-95"
                      onClick={(e) => {
                        setShipGuide(s.id, fishId);
                        setFishPickerShipId(null);
                        collect(s.id, e);
                      }}
                    >
                      {f.img ? <img src={f.img} alt={f.name} className="h-7 w-7 object-contain" loading="lazy" /> : <span className="text-xl">{f.emoji}</span>}
                      <span>{f.name}</span>
                    </button>
                  );
                })}
              </div>
              <button className="mt-3 w-full rounded-lg bg-secondary/70 py-2 text-xs font-bold text-accent active:scale-95" onClick={() => setFishPickerShipId(null)}>إلغاء</button>
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
        const slots = Math.min(3, Math.floor(s.level / 5) + 1); // lvl1-4:1, 5-9:2, 10+:3
        const assignedRows = crewRows.filter((r) => isCrewAssignedToShip(r.meta, s));
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
          try {
          // Fixer crews: heal a fixed HP amount on ANY ship (capped at maxHp).
          // fixer_1=+1000, fixer_2=+5000, fixer_3=+70000, fixer_4=full repair on all 3 fleet ships.
          if (itemId.startsWith("fixer_")) {
            if (!s.dbId) { sound.play("error"); return; }
            const row = availableRows.find((r) => r.item_id === itemId);
            if (!row) return;

            const repairBy = async (ship: typeof s, crewId: string, amount: number) => {
              if (!ship.dbId) return 0;
              const maxHp = ship.maxHp ?? 100;
              const curHp = ship.hp ?? 0;
              const optimisticHp = Math.min(maxHp, curHp + amount);
              const { data, error } = await (supabase as any)
                .rpc("repair_ship_with_crew", { _ship_id: ship.dbId, _crew_id: crewId });
              if (error) {
                setToast(`فشل الإصلاح: ${error.message ?? "خطأ"}`);
                sound.play("error");
                return 0;
              }
              const result = Array.isArray(data) ? data[0] : data;
              const newHp = Number(result?.new_hp ?? optimisticHp);
              const newRepairEnds = result?.repair_ends_at ?? null;
              setShips((arr) => arr.map((x) => x.id === ship.id
                ? (newHp >= maxHp
                    ? { ...x, hp: newHp, destroyedAt: null, repairEndsAt: null, fishing: false, startedAt: undefined, sail: 0, progress: 0 }
                    : { ...x, hp: newHp, repairEndsAt: newRepairEnds })
                : x));
              return newHp - curHp;
            };




            try {
              if (itemId === "fixer_4") {
                const needRepair = ships.filter((x) => x.dbId && ((x.hp ?? 0) < (x.maxHp ?? 100) || x.destroyedAt || x.repairEndsAt));
                if (needRepair.length === 0) {
                  setToast("لا توجد سفن تحتاج إصلاحاً");
                  sound.play("error");
                  return;
                }
                setToast(`🏆 تم تعبئة ${needRepair.length} سفن فلل فوراً`);
                sound.play("success");
                setModal(null);
                // Fire repairs + consume in background
                (async () => {
                  await repairBy(needRepair[0], itemId, Infinity);
                  reloadCrews();
                  syncFleetFromDb();
                  setCrewTick((t) => t + 1);
                })();
              } else {
                const amount = FIXER_HEAL[itemId] ?? 0;
                if (amount <= 0) { sound.play("error"); return; }
                const needs = (s.hp ?? 0) < (s.maxHp ?? 100) || s.destroyedAt || s.repairEndsAt;
                if (!needs) {
                  setToast("السفينة لا تحتاج إصلاحاً");
                  sound.play("error");
                  return;
                }
                setToast(`⚒️ جاري إصلاح +${amount.toLocaleString()} دم`);
                sound.play("success");
                setModal(null);
                (async () => {
                  const healed = await repairBy(s, itemId, amount);
                  setToast(`⚒️ تم إصلاح +${(healed || amount).toLocaleString()} دم`);
                  reloadCrews();
                  syncFleetFromDb();
                  setCrewTick((t) => t + 1);
                })();
              }
            } catch {}
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
          const { error } = await (supabase as any).rpc("assign_crew_to_ship", {
            _ship_id: s.dbId,
            _crew_id: itemId,
          });
          if (error) {
            sound.play("error");
            setToast(`تعذّر التفعيل: ${(error as any).message || "خطأ"}`);
            await reloadCrews();
            return;
          }
          sound.play("success");
          await reloadCrews();
          setCrewTick((t) => t + 1);
          } finally {
            crewBusyRef.current = false;
          }
        };


        const removeCrew = async (rowId: string) => {
          await deleteInventoryRows([rowId]);
          sound.play("error");
          setCrewTick((t) => t + 1);
        };

        return (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setModal(null)}>
            <div className="glass-hud rounded-2xl border-2 border-accent/60 p-4 max-w-sm w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="text-accent font-bold text-base mb-1 text-center">تخصيص طاقم السفينة</div>
              <div className="text-[10px] text-accent/60 text-center mb-3">
                المستوى {s.level} — {assignedRows.length}/{slots} طاقم مفعّل · مدة التفعيل 24 ساعة
              </div>

              <div className="text-[11px] text-accent/80 font-bold mb-1">الطواقم المفعّلة</div>
              <div className="space-y-1.5 mb-3">
                {Array.from({ length: slots }).map((_, i) => {
                  const r = assignedRows[i];
                  if (!r) {
                    return (
                      <div key={`empty-${i}`} className="rounded-lg border border-dashed border-accent/30 bg-black/20 p-2 text-center text-[11px] text-accent/40">
                        خانة فارغة
                      </div>
                    );
                  }
                  const c = CREWS.find((x) => x.id === r.item_id);
                  if (!c) return null;
                  return (
                    <div key={r.id} className="rounded-lg bg-emerald-900/20 border border-emerald-400/40 p-2 flex items-center gap-2">
                      {c.image ? <img src={c.image} alt={c.name} className="w-9 h-9 object-contain drop-shadow" /> : <span className="text-2xl">{c.emoji}</span>}
                      <div className="flex-1">
                        <div className="text-xs font-bold text-accent">{c.name}</div>
                        <div className="text-[10px] text-emerald-300">{c.bonus}</div>
                        <div className="text-[10px] text-amber-300">⏳ {fmtRemaining(r.meta?.expires_at)}</div>
                      </div>
                      <button
                        className="text-[10px] text-red-300 px-2 py-1 rounded bg-red-900/40 active:scale-95"
                        onClick={() => removeCrew(r.id)}
                      >إزالة</button>
                    </div>
                  );
                })}
              </div>

              <div className="text-[11px] text-accent/80 font-bold mb-1">جميع الطواقم</div>
              <div className="space-y-1.5">
                {CREWS.map((c) => {
                  const cid = c.id;
                  const qty = availMap.get(cid) ?? 0;
                  const owned = qty > 0;
                  const isFixer = cid.startsWith("fixer_");
                  const isGlobalCrew = cid === "trader"; // only the trader is fleet-exclusive
                  const alreadyOnShip = assignedRows.some((r) => r.item_id === cid);
                  // Global crews (trader): only one active across the whole fleet.
                  const nowMs = serverNowMs();
                  const globallyActive = isGlobalCrew && crewRows.some(
                    (r) => r.item_id === cid
                      && r.meta?.assigned_ship_id != null
                      && (!r.meta?.expires_at || new Date(r.meta.expires_at).getTime() > nowMs)
                  );
                  const canAssign = owned && (
                    isFixer
                      ? true
                      : isGlobalCrew
                        ? !globallyActive
                        : (assignedRows.length < slots && !alreadyOnShip)
                  );
                  const canAfford = c.currency === "gems" ? gems >= c.price : (coins + gems * 1000) >= c.price;
                  const isBuying = buyingCrewId === cid;

                  const buyCrew = () => {
                    if (isBuying) return;
                    if (!canAfford) {
                      sound.play("error");
                      setToast(c.currency === "gems" ? "جواهر غير كافية" : "ذهب غير كافٍ");
                      return;
                    }
                    setBuyingCrewId(cid);
                    sound.play("coin");
                    setToast(`✓ تم شراء ${c.name}`);
                    (async () => {
                      try {
                        const { error } = c.currency === "gems"
                          ? await buyWithGems(cid, "crew", c.price, undefined, 1)
                          : await buyWithCoinsGemFallback(cid, "crew", c.price, undefined, 1);
                        if (error) {
                          sound.play("error");
                          setToast(`فشل الشراء: ${(error as { message?: string }).message ?? "خطأ"}`);
                          return;
                        }
                        refreshProfile();
                        reloadCrews();
                        setCrewTick((t) => t + 1);
                      } finally {
                        setBuyingCrewId(null);
                      }
                    })();
                  };

                  return (
                    <div
                      key={cid}
                      className={`w-full flex items-center gap-2 p-2 rounded-lg border ${
                        owned
                          ? (canAssign
                              ? (isFixer ? "border-amber-400/50 bg-amber-900/20" : "border-accent/40 bg-black/30")
                              : "border-accent/20 bg-black/10 opacity-70")
                          : "border-cyan-400/30 bg-cyan-950/20"
                      }`}
                    >
                      {c.image ? <img src={c.image} alt={c.name} className="w-9 h-9 object-contain drop-shadow" /> : <span className="text-xl">{c.emoji}</span>}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-accent flex items-center gap-1">
                          {c.name}
                          {owned && <span className="text-amber-300">×{qty}</span>}
                        </div>
                        <div className="text-[10px] text-emerald-300 truncate">{c.bonus}</div>
                        {isGlobalCrew && globallyActive && !alreadyOnShip && (
                          <div className="text-[9px] text-amber-300/80">🔒 مفعّل على سفينة أخرى</div>
                        )}
                      </div>
                      {owned ? (
                        <button
                          disabled={!canAssign}
                          onClick={() => assignCrew(cid)}
                          className={`text-[10px] px-2 py-1.5 rounded font-bold active:scale-95 ${
                            canAssign
                              ? "bg-emerald-600/80 text-white"
                              : "bg-secondary/40 text-accent/50"
                          }`}
                        >
                          {isFixer
                            ? "🛠️ استخدام"
                            : alreadyOnShip
                              ? "مفعّل ✓"
                              : (isGlobalCrew && globallyActive)
                                ? "مقفول 🔒"
                                : canAssign ? "تفعيل" : "ممتلئ"}
                        </button>
                      ) : (
                        <button
                          onClick={buyCrew}
                          disabled={!canAfford || isBuying}
                          className={`text-[10px] px-2 py-1.5 rounded font-bold active:scale-95 flex flex-col items-center leading-tight ${
                            canAfford && !isBuying
                              ? "bg-gradient-to-b from-amber-500 to-amber-700 text-white border border-amber-300"
                              : "bg-secondary/40 text-accent/50"
                          }`}
                        >
                          <span>{isBuying ? "..." : "شراء"}</span>
                          <span className="text-[9px]">
                            {c.price.toLocaleString()} {c.currency === "gems" ? "💎" : "🪙"}
                          </span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>


              <button
                className="mt-3 w-full py-2 rounded-lg bg-secondary/70 text-accent text-xs font-bold active:scale-95"
                onClick={() => setModal(null)}
              >إغلاق</button>
            </div>
          </div>
        );
      })()}


      {/* Dragon + Totem removed per user request */}

      {/* BOTTOM NAV */}
      <div className="fixed bottom-0 left-0 right-0 z-[80] px-1.5 pt-1.5 glass-hud border-t-2 border-amber-400/60 shadow-[0_-4px_14px_rgba(0,0,0,0.6)]" style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}>
        <div className="flex items-center justify-around">
          {[
            { e: "⚙️", l: "إعدادات", to: null, action: "settings" as const, badge: 0 },
            { e: "💬", l: "شات", to: "/chat" as const, action: null, badge: dmUnread },
            { e: "🏛️", l: "متجر", to: "/shop" as const, action: null, badge: 0 },
            { e: "📦", l: "مخزن", to: "/inventory" as const, action: null, badge: 0 },
            { e: "👥", l: "أصدقاء", to: "/friends" as const, action: null, badge: friendsUnread },
            { e: "🏆", l: "ترتيب", to: null, action: "boost" as const, badge: 0 },
            { e: "💀", l: "تحدي", to: null, action: "challenge" as const, badge: 0 },
          ].map((it, i) => {
            const inner = (
              <>
                <div className="relative w-11 h-11 rounded-xl bg-gradient-to-b from-amber-700/90 to-amber-950/90 border-2 border-amber-300/70 flex items-center justify-center text-xl shadow-[inset_0_1px_0_rgba(255,220,140,0.4),0_2px_6px_rgba(0,0,0,0.5)]">
                  {it.e}
                  {it.badge > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center border-2 border-amber-200 shadow animate-pulse">
                      {it.badge > 9 ? "9+" : it.badge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-amber-200 font-black drop-shadow mt-0.5">{it.l}</span>
              </>
            );
            return it.to ? (
              <Link
                key={i}
                to={it.to}
                onClick={() => sound.play("click")}
                className="flex flex-col items-center gap-0.5 px-0.5 py-1 rounded-lg active:scale-95"
              >
                {inner}
              </Link>
            ) : (
              <button
                key={i}
                onClick={() => {
                  sound.play("click");
                  if (it.action === "settings") setSettingsOpen(true);
                  else if (it.action === "boost") setBoostOpen(true);
                  else if (it.action === "challenge") showToast("⚔️ نظام التحديات قادم قريباً");
                }}
                className="flex flex-col items-center gap-0.5 px-0.5 py-1 rounded-lg active:scale-95"
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
      {boostOpen && <LeaderboardModal onClose={() => setBoostOpen(false)} />}

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
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="mx-4 w-full max-w-xs rounded-2xl border-2 border-cyan-300/60 bg-gradient-to-b from-sky-700 to-sky-950 p-5 shadow-2xl text-center"
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
            <div className="mt-1 text-2xl font-black text-amber-300 text-glow">×{catchResult.count.toLocaleString()}</div>
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

function LeaderboardModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"comp" | "xp" | "gems" | "coins" | "fish" | "ships" | "tribes" | "search">("comp");
  const [comps, setComps] = useState<CompLb[]>([]);
  const [compBoards, setCompBoards] = useState<Record<string, CompLbRow[]>>({});
  const [rows, setRows] = useState<LbProfile[]>([]);
  const [fishRows, setFishRows] = useState<Array<LbProfile & { unique_fish: number; total_fish: number }>>([]);
  const [shipRows, setShipRows] = useState<Array<LbProfile & { market_level: number }>>([]);
  const [tribes, setTribes] = useState<TribeLb[]>([]);
  const [q, setQ] = useState("");
  const [tribeQ, setTribeQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshSeq, setRefreshSeq] = useState(0);
  const [openTribeId, setOpenTribeId] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [staffIds, setStaffIds] = useState<Set<string>>(new Set());
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
      (tab === "comp" && comps.length > 0) ||
      (tab === "tribes" && tribes.length > 0) ||
      (tab === "fish" && fishRows.length > 0) ||
      (tab === "ships" && shipRows.length > 0) ||
      (["xp", "gems", "coins"].includes(tab) && rows.length > 0);
    let cancelled = false;
    const showSpinner = !hasCachedData;
    if (showSpinner) setLoading(true);
    if (tab === "comp") {
      (async () => {
        const { data } = await (supabase as any).rpc("get_active_competitions");
        if (cancelled) return;
        const list = ((data ?? []) as CompLb[]);
        setComps(list);
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
    if (tab === "tribes") {
      (async () => {
        const { data } = await (supabase as any).rpc("get_tribe_effort_leaderboard", { _limit: 100 });
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
      debounce = window.setTimeout(() => setRefreshSeq((n) => n + 1), 150);
    };
    const onVisible = () => { if (document.visibilityState === "visible") refreshNow(); };
    window.addEventListener("focus", refreshNow);
    document.addEventListener("visibilitychange", onVisible);
    const watchedTables =
      tab === "comp" ? ["competitions", "competition_catches"] :
      tab === "fish" ? ["fish_caught", "profiles"] :
      tab === "tribes" ? ["tribes", "tribe_donations", "support_gifts", "attacks"] :
      tab === "ships" ? ["ships_owned", "profiles"] :
      tab === "xp" || tab === "gems" || tab === "coins" ? ["profiles"] :
      [];
    const ch = watchedTables.length > 0
      ? watchedTables.reduce((channel, table) => (
          channel.on("postgres_changes", { event: "*", schema: "public", table }, refreshNow)
        ), supabase.channel(`leaderboard-live-${tab}`)).subscribe()
      : null;
    return () => {
      window.removeEventListener("focus", refreshNow);
      document.removeEventListener("visibilitychange", onVisible);
      if (debounce) window.clearTimeout(debounce);
      if (ch) supabase.removeChannel(ch);
    };
  }, [tab]);

  const runSearch = async () => {
    if (!q.trim()) return;
    setLoading(true);
    const { data } = await supabase.from("profiles")
      .select("id,display_name,avatar_emoji,avatar_url,level,xp,coins,gems,avatar_frame,name_frame")
      .ilike("display_name", `%${q.trim()}%`).limit(200);
    const filtered = ((data as LbProfile[]) || []).filter((p) => !staffIds.has(p.id)).slice(0, 100);
    setRows(filtered);
    setLoading(false);
  };


  const TABS = [
    { id: "comp" as const, e: "🏆", l: "فعاليات" },
    { id: "xp" as const, e: "⭐", l: "XP" },
    { id: "gems" as const, e: "💎", l: "جواهر" },
    { id: "coins" as const, e: <CoinIcon size={18} />, l: "ذهب" },
    { id: "fish" as const, e: "🐟", l: "صيد" },
    { id: "ships" as const, e: "🏪", l: "سوق" },
    { id: "tribes" as const, e: "🏴‍☠️", l: "قبائل" },
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
      style={{ paddingBottom: "calc(0.5rem + var(--keyboard-inset, 0px))" }}
      onClick={onClose}>
      <div className="w-full max-w-md glass-hud border-2 border-accent/60 rounded-2xl p-3 flex flex-col"
        style={{ maxHeight: "calc(var(--app-height, 100dvh) - var(--keyboard-inset, 0px) - 1rem)" }}
        onClick={(e) => e.stopPropagation()} dir="rtl">
        <div className="text-center text-accent font-bold text-lg mb-2">🏆 الترتيب</div>

        <div className="grid grid-cols-8 gap-1 mb-3">
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
            <button onClick={runSearch}
              className="px-4 rounded-lg bg-accent text-secondary font-bold text-sm">بحث</button>
          </div>
        )}

        {tab === "tribes" && (
          <input value={tribeQ} onChange={(e) => setTribeQ(e.target.value)}
            placeholder="ابحث باسم القبيلة..."
            className="w-full mb-2 px-3 py-2 rounded-lg bg-secondary/80 border border-accent/40 text-sm text-accent" />
        )}

        <div className="flex-1 overflow-y-auto space-y-1">
          {loading ? (
            <div className="text-center text-accent/60 py-6 text-sm">جاري التحميل…</div>
          ) : tab === "comp" ? (
            comps.length === 0 ? (
              <div className="text-center text-accent/60 py-10 text-sm">
                <div className="text-5xl mb-2">🎪</div>
                لا توجد فعاليات نشطة حالياً
              </div>
            ) : (
              <div className="space-y-3 pb-2">
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

                      {/* Prizes */}
                      {tiers.length > 0 && (
                        <div className="p-2 border-b border-accent/20 space-y-1">
                          <div className="text-[10px] font-black text-amber-300 px-1">🏆 الجوائز</div>
                          {tiers.map((t, i) => {
                            const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i+1}`;
                            return (
                              <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-secondary/60 border border-accent/20 text-[11px]">
                                <span className="w-7 text-center font-black">{medal}</span>
                                <div className="flex-1 flex flex-wrap gap-1 text-accent">
                                  {t.coins > 0 && <span className="inline-flex items-center gap-0.5"><CoinIcon size={11}/>{t.coins.toLocaleString()}</span>}
                                  {t.gems > 0 && <span>💎{t.gems}</span>}
                                  {t.xp > 0 && <span>⭐{t.xp}</span>}
                                  {t.text && <span>🎁{t.text}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Leaderboard */}
                      <div className="p-2 space-y-1">
                        <div className="text-[10px] font-black text-accent/70 px-1">🏅 الترتيب</div>
                        {board.length === 0 ? (
                          <div className="text-center text-[11px] text-accent/50 py-3">كن أول من يسجّل! 🚀</div>
                        ) : board.map((r, i) => {
                          const isMe = r.user_id === meId;
                          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i+1}`;
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
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : tab === "tribes" ? (
            tribesFiltered.length === 0 ? (
              <div className="text-center text-accent/60 py-6 text-sm">لا توجد قبائل</div>
            ) : tribesFiltered.map((t, i) => {
              const tier = getTribeBanner(t.level || 1);
              return (
              <button key={t.id} onClick={() => { sound.play("click"); setOpenTribeId(t.id); }}
                className="w-full text-right relative overflow-hidden flex items-center gap-2 p-2 rounded-lg bg-secondary/60 border border-accent/30 active:scale-[0.98]">
                <img src={tier.url} alt="" aria-hidden loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-25 pointer-events-none" />
                <div className="relative w-6 text-center text-xs font-bold text-accent">{i + 1}</div>
                <div className="relative w-11 h-11 shrink-0 flex items-center justify-center">
                  <img src={tier.emblemUrl} alt="" loading="lazy" className="absolute inset-[14%] w-[72%] h-[72%] object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />
                  <img src={tier.frameUrl} alt="" aria-hidden loading="lazy" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
                </div>
                <div className="relative flex-1 min-w-0">
                  <div className="text-sm font-bold text-accent truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">{t.name} <span className="text-amber-300">⭐{t.level || 1}</span></div>
                  <div className="text-[10px] text-accent/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">🏴 {tier.name} · 👥 {t.members} · 🤝 {(t.support_score ?? 0).toLocaleString()} · ⚔️ {(t.attack_score ?? 0).toLocaleString()}</div>
                </div>
                <div className="relative text-xs font-bold text-accent tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">⚡ {t.power.toLocaleString()}</div>
              </button>
              );
            })
          ) : tab === "fish" ? (
            fishRows.length === 0 ? (
              <div className="text-center text-accent/60 py-6 text-sm">لا يوجد صيادون بعد</div>
            ) : fishRows.map((p, i) => {
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
                  onClick={() => { sound.play("click"); onClose(); }}
                  className={`flex items-center gap-2 p-2 rounded-lg active:scale-[0.98] ${baseRow}`}>
                  {Inner}
                </Link>
              );
            })
          ) : tab === "ships" ? (
            shipRows.length === 0 ? (
              <div className="text-center text-accent/60 py-6 text-sm">لا يوجد لاعبون بعد</div>
            ) : shipRows.map((p, i) => {
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
                  onClick={() => { sound.play("click"); onClose(); }}
                  className={`flex items-center gap-2 p-2 rounded-lg active:scale-[0.98] ${baseRow}`}>
                  {Inner}
                </Link>
              );
            })
          ) : rows.length === 0 ? (
            <div className="text-center text-accent/60 py-6 text-sm">
              {tab === "search" ? "ابحث باسم قبطان" : "لا توجد نتائج"}
            </div>
          ) : rows.map((p, i) => {
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
                onClick={() => { sound.play("click"); onClose(); }}
                className={`flex items-center gap-2 p-2 rounded-lg active:scale-[0.98] ${baseRow}`}>
                {Inner}
              </Link>
            );
          })}
        </div>

        <button className="mt-2 w-full py-2 rounded-lg bg-secondary/70 text-accent text-xs font-bold active:scale-95"
          onClick={onClose}>إغلاق</button>
      </div>
      {openTribeId && <TribeDetailModal tribeId={openTribeId} onClose={() => setOpenTribeId(null)} />}
    </div>
  );
}

function TribeDetailModal({ tribeId, onClose }: { tribeId: string; onClose: () => void }) {
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
      <div className="w-full max-w-md glass-hud border-2 border-accent/60 rounded-2xl p-3 flex flex-col"
        style={{ maxHeight: "calc(var(--app-height, 100dvh) - var(--keyboard-inset, 0px) - 1rem)" }} onClick={(e) => e.stopPropagation()} dir="rtl">
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
                    onClick={() => { sound.play("click"); onClose(); }}
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
  prevSailRef.current = ship.sail;
  velocityRef.current = velocityRef.current * 0.8 + delta * 0.2;
  const v = velocityRef.current;
  const moving = Math.abs(v) > 0.0005;
  const direction = v > 0 ? 1 : v < 0 ? -1 : 0;
  if (direction !== 0) lastDirRef.current = direction;
  // Bow facing: +1 = pointing RIGHT, -1 = pointing LEFT (used for wake trail).
  // Fishing → bow points toward the sea edge of the scene; docked → toward shore.
  const _seaSideForFacing = ship.seaSide ?? "right";
  const facing: 1 | -1 = ship.fishing
    ? (_seaSideForFacing === "right" ? 1 : -1)
    : (_seaSideForFacing === "right" ? -1 : 1);


  const pct = (ship.progress / ship.max) * 100;
  const capacity = catchAmountForLevel(ship.level, ship.maxHp);
  const ratio = Math.min(1, ship.max > 0 ? ship.progress / ship.max : 0);
  const caughtNow = Math.min(capacity, Math.round(capacity * ratio));
  const ready = pct >= 100;
  const mins = Math.floor(ship.timeLeft / 60);
  const secs = Math.floor(ship.timeLeft % 60);
  const timeStr = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  const t = serverNowMs() / 1000;
  // Stop all motion when the ship is fully docked (sail ~ 0) and not moving.
  const docked = ship.sail < 0.05 && !moving;
  const bobAmp = docked ? 0 : (moving ? 2.5 : 1.2);
  const bob = docked ? 0 : Math.sin((t + ship.id) * 1.4) * bobAmp;
  const sway = docked ? 0 : (moving ? Math.sin((t + ship.id) * 0.9) * 1.5 : 0);
  const baseTilt = direction * 2.5;
  const rockTilt = docked ? 0 : Math.sin((t + ship.id) * 1.8) * (moving ? 1.2 : 0.5);
  const tilt = baseTilt + rockTilt;

  const shipW = 22 * ship.scale;
  const dockLeft = ship.dockLeft;
  // Sea direction: read from scene. When fishing, ship sails AWAY from shore
  // toward the open sea edge of the viewport.
  const seaSide = ship.seaSide ?? "right";
  const seaEdge = seaSide === "right" ? (96 - shipW) : 2;
  const computedLeft = dockLeft + ship.sail * (seaEdge - dockLeft);

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

  const destroyed = !!ship.destroyedAt && !!ship.repairEndsAt && new Date(ship.repairEndsAt).getTime() > serverNowMs();
  const atSea = ship.sail > 0.85 && !destroyed;
  const isFishing = ship.fishing && atSea && !moving && !ready && !destroyed;
  // Ship art is drawn facing LEFT natively (with per-level overrides for art
  // that ships bow-right). Normalize so every ship shows the same on-screen
  // direction: bow toward SEA when fishing, bow toward SHORE when docked.
  const nativeRight = shipBowFacesRight(ship.level);
  // Desired on-screen bow direction depends on which side is the sea.
  // fishing → bow toward sea; docked → bow toward shore.
  const seaIsRight = seaSide === "right";
  const desiredRight = ship.fishing ? seaIsRight : !seaIsRight;
  const flipX = (desiredRight !== nativeRight) ? -1 : 1;
  const bankRoll = 0;
  const bankPitch = 0;
  const turnLift = 0;
  const turnSway = 0;

  return (
    <div
      data-ship-dbid={ship.dbId || undefined}
      className="absolute z-10 pointer-events-none"
      style={{
        left: `${leftOffset}%`,
        top: ship.top,
        width: `${22 * ship.scale}%`,
        perspective: "800px",
        transformStyle: "preserve-3d",
        transition: "left 0.5s ease-in-out",
      }}
    >
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

      {/* Foamy water trail behind ship when actually moving */}
      {moving && (
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
          className="absolute left-1/2 -translate-x-1/2 pointer-events-none z-10 flex items-end justify-center gap-1"
          style={{ top: "18%", width: "110%", height: "26%" }}
        >
          {crews.map((c, i) => (
            <div
              key={c.id}
              className="relative animate-crew-bob"
              style={{
                width: "28%",
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
        }}
      >
      {/* 3D ship body */}
      <div
        className="relative w-full"
        style={{
          transform: destroyed
            ? `translate(0px, 2px) rotateX(2deg) rotateZ(18deg)`
            : `translate(${sway + turnSway}px, ${bob + turnLift}px) rotateX(${2 + bankPitch * 0.4}deg) rotateZ(${tilt * 0.6 + bankRoll * 0.6}deg)`,
          transformStyle: "preserve-3d",
          transformOrigin: "center 80%",
          transition: "transform 0.2s ease-out",
          filter: destroyed
            ? "drop-shadow(0 10px 8px rgba(0,0,0,0.6)) grayscale(0.7) brightness(0.55) sepia(0.3) hue-rotate(-20deg)"
            : "drop-shadow(0 14px 10px rgba(0,0,0,0.55)) drop-shadow(0 4px 2px rgba(0,0,0,0.35)) saturate(1.12) contrast(1.08)",
          opacity: destroyed ? 0.8 : 1,
        }}
      >
        <div className="relative w-full">
          {/* Soft water reflection beneath the hull */}
          <div
            aria-hidden
            className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
            style={{
              bottom: "-6%",
              width: "78%",
              height: "10%",
              background:
                "radial-gradient(ellipse at center, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.18) 35%, rgba(255,255,255,0) 70%)",
              filter: "blur(4px)",
              opacity: 0.7,
            }}
          />
          <img
            src={ship.img}
            alt="Ship"
            onClick={onTap}
            className={`w-full block select-none cursor-pointer pointer-events-auto active:scale-95 ${destroyed ? "" : "animate-sail-flap"}`}
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

          {/* Chimney smoke when sailing */}
          {moving && !destroyed && (
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
            {/* Fill counter — slim with tiny label */}
            <div className="relative h-2 bg-black/70 rounded-full overflow-hidden border border-accent/40 shadow-md">
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
              <div className="absolute inset-0 flex items-center justify-center text-[7px] leading-none font-extrabold text-white whitespace-nowrap"
                   style={{ textShadow: "0 1px 2px rgba(0,0,0,0.9)" }}>
                <span className="tabular-nums" dir="ltr">{caughtNow}/{capacity}</span>
                {ready && <span className="ml-0.5 animate-pulse">✦</span>}
              </div>
            </div>
            {active && (
              ready ? (
                <div className="text-center text-[9px] text-amber-200 font-bold animate-pulse">
                  ✦ جاهز للجمع ✦
                </div>
              ) : ship.fishing ? (
                <div className="text-center text-[9px] text-emerald-200 font-bold tabular-nums">
                  🎣 يصطاد · {timeStr}
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
