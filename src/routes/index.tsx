import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import harborBg from "@/assets/harbor-bg.jpg";
import { getShipByMarketLevel, catchPerTrip } from "@/lib/ships";
import { bgById, getSelectedBgId } from "@/lib/backgrounds";
import { SeamlessVideo } from "@/components/SeamlessVideo";
import { FISH, fishForShip } from "@/lib/fish";
import { CREWS } from "@/lib/crews";
import { supabase } from "@/integrations/supabase/client";
import { incrementFishCaught, sellShip, deleteInventoryRows, splitInventoryAssign, updateInventoryMeta } from "@/lib/economy";
import { useAuth, useProfile } from "@/hooks/use-auth";
import { DailyLoginModal } from "@/components/DailyLoginModal";

import { sound } from "@/lib/sound";
import { SettingsModal } from "@/components/SettingsModal";
import { NotificationsBell } from "@/components/NotificationsBell";
import { ShieldBadge } from "@/components/ShieldBadge";
import { useIsAdmin } from "@/hooks/use-admin";
import { AuthGuard } from "@/components/AuthGuard";
import { Landing } from "@/components/Landing";
import cloudImg from "@/assets/cloud-realistic.png";
import birdImg from "@/assets/bird-realistic.png";





export const Route = createFileRoute("/")({
  component: GuardedIndex,
  ssr: false,
  head: () => ({
    meta: [
      { title: "Ocean Catch — محاكي صيد البحر" },
      { name: "description", content: "محاكي صيد بحري عربي: ابنِ أسطولك، وظّف الطاقم، واصطد أنواع نادرة من الأسماك." },
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
}

// Fixed visual slots — each ship in the fleet gets a distinct (top, dockLeft, scale)
// so they never overlap on screen.
const SLOTS = [
  { scale: 1.12, top: "40%", dockLeft: 18 },
  { scale: 1.28, top: "52%", dockLeft: 52 },
  { scale: 1.08, top: "48%", dockLeft: 30 },
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
      return {
        id: s.id, dbId: s.dbId, level: s.level, max: s.max, timeLeft: s.timeLeft,
        duration: s.duration ?? s.timeLeft ?? Math.round(s.max / 30),
        startedAt: s.startedAt,
        scale: slot.scale, top: slot.top, dockLeft: slot.dockLeft,
        img: getShipByMarketLevel(s.level).image,
        progress: s.progress ?? 0,
        fishing: s.fishing ?? false,
        sail: s.sail ?? 0,
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
function catchAmountForLevel(level: number): number {
  return catchPerTrip(getShipByMarketLevel(level));
}

// Optional fishing guide: when set, ship targets that specific fish id
// Stored in localStorage as: ship_guide_<shipId> = <fishId>
function getShipGuide(shipId: number): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(`ship_guide_${shipId}`);
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
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return;
    const { data } = await supabase
      .from("ships_owned")
      .select("id, template_id, acquired_at, hp, max_hp, destroyed_at, repair_ends_at, at_sea, fishing_started_at, stealing_ends_at, stealing_target_user_id")
      .eq("user_id", uid)
      .order("acquired_at", { ascending: true });
    const owned = (data ?? []) as { id: string; template_id: number | null; hp: number | null; max_hp: number | null; destroyed_at: string | null; repair_ends_at: string | null; at_sea: boolean | null; fishing_started_at: string | null; stealing_ends_at: string | null; stealing_target_user_id: string | null }[];

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
          // Restore fishing trip from DB only when local state agrees, OR
          // when local has no opinion yet (no startedAt and not fishing).
          // If the user just pressed STOP locally (fishing=false), we MUST
          // trust local and force-sync DB → at_sea=false. Otherwise the
          // realtime/poll cycle re-enables fishing automatically.
          let fishing = s.fishing;
          let startedAt = s.startedAt;
          const onSteal = !!row.stealing_target_user_id;
          const destroyed = !!row.destroyed_at && !!row.repair_ends_at && new Date(row.repair_ends_at).getTime() > Date.now();
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
          } else if (row.at_sea && row.fishing_started_at) {
            fishing = true;
            startedAt = new Date(row.fishing_started_at).getTime();
          } else if (s.fishing && s.startedAt) {
            import("@/lib/economy").then(({ setShipAtSea }) => {
              setShipAtSea(s.dbId!, true).catch(() => {});
            });
          }
          return { ...s, hp: row.hp ?? s.hp, maxHp: row.max_hp ?? s.maxHp, destroyedAt: row.destroyed_at, repairEndsAt: row.repair_ends_at, fishing, startedAt, stealingEndsAt: row.stealing_ends_at, stealingTargetUserId: row.stealing_target_user_id };
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
        const lvl = dbShip.template_id ?? 1;
        while (usedIds.has(nextId)) nextId++;
        usedIds.add(nextId);
        const slotIdx = (keptDb.length + i) % SLOTS.length;
        const slot = SLOTS[slotIdx];
        const maxProg = 35000 + (lvl - 1) * 9000;
        const duration = Math.round(maxProg / 30);
        const onSteal = !!dbShip.stealing_target_user_id;
        const destroyed = !!dbShip.destroyed_at && !!dbShip.repair_ends_at && new Date(dbShip.repair_ends_at).getTime() > Date.now();
        const isFishing = !destroyed && !onSteal && !!dbShip.at_sea && !!dbShip.fishing_started_at;
        const startedAt = isFishing ? new Date(dbShip.fishing_started_at!).getTime() : undefined;
        newShips.push({
          id: nextId,
          dbId: dbShip.id,
          level: lvl,
          img: getShipByMarketLevel(lvl).image,
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
    syncFleetFromDb();
    const onFocus = () => syncFleetFromDb();
    window.addEventListener("focus", onFocus);
    // Live updates: any change to my own ships triggers an instant re-sync
    let ch: ReturnType<typeof supabase.channel> | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const kick = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => syncFleetFromDb(), 120);
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
      if (debounce) clearTimeout(debounce);
      if (ch) supabase.removeChannel(ch);
    };
  }, []);
  const { user } = useAuth();
  const { profile } = useProfile();
  const coins = profile?.coins ?? 0;
  const gems = profile?.gems ?? 0;
  const [dailyOpen, setDailyOpen] = useState(false);

  // Auto-open the daily login once per day per device
  useEffect(() => {
    if (!user) return;
    const key = `daily-login-shown:${user.id}`;
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(key) !== today) {
      const t = setTimeout(() => {
        setDailyOpen(true);
        localStorage.setItem(key, today);
      }, 800);
      return () => clearTimeout(t);
    }
  }, [user]);

  const [fish, setFish] = useState(34);
  const [pop, setPop] = useState<{ id: number; x: number; y: number; v: string } | null>(null);
  const [menuShipId, setMenuShipId] = useState<number | null>(null);
  const [modal, setModal] = useState<null | { kind: "sell" | "crew"; shipId: number }>(null);
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

  const [now, setNow] = useState(() => Date.now());
  type CrewRow = { id: string; item_id: string; quantity: number; meta: { assigned_ship_id?: number | string; expires_at?: string } | null };
  const [crewRows, setCrewRows] = useState<CrewRow[]>([]);
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
    const nowMs = Date.now();
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

  // 1-second tick for countdowns / expiry
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
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
    const nowMs = Date.now();
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

  const [bgId, setBgId] = useState<string>("harbor");
  useEffect(() => {
    const current = getSelectedBgId();
    setBgId(current);
    // Sync the locally-stored background to the DB so other players see the real scene when visiting.
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
      if (uid) supabase.from("profiles").update({ selected_bg_id: current }).eq("id", uid).then(() => {});
    });
    const onFocus = () => setBgId(getSelectedBgId());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  const scene = bgById(bgId);

  // Incoming raids: ships from other players currently stealing from me
  type Raid = { ship_id: string; attacker_id: string; attacker_name: string; attacker_emoji: string; ends_at: string };
  const [raids, setRaids] = useState<Raid[]>([]);
  const reloadRaids = async () => {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) { setRaids([]); return; }
    const { data: ships } = await supabase
      .from("ships_owned")
      .select("id,user_id,stealing_ends_at")
      .eq("stealing_target_user_id", uid)
      .not("stealing_target_user_id", "is", null);
    const list = (ships ?? []) as { id: string; user_id: string; stealing_ends_at: string | null }[];
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
      ends_at: s.stealing_ends_at || new Date().toISOString(),
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
      const expired = ships.filter((s) => s.stealingTargetUserId && s.stealingEndsAt && new Date(s.stealingEndsAt).getTime() <= Date.now() && s.dbId);
      for (const s of expired) {
        const { data, error } = await (supabase as any).rpc("claim_steal_mission", { _attacker_ship_id: s.dbId });
        if (!error) {
          const row = Array.isArray(data) && data[0] ? data[0] : null;
          const n = row?.stolen_count ?? 0;
          const v = row?.total_value ?? 0;
          if (n > 0) { sound.play("catch"); showToast(`🏴‍☠️ سرقت ${n} سمكة (قيمتها ${v})`); }
          else { showToast("🪶 سفينتك رجعت فاضية"); }
          syncFleetFromDb();
        }
      }
    }, 4000);
    return () => clearInterval(id);
  }, [ships]);



  // Progress + sail animation ticker — strictly time-proportional.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setShips((curr) =>
        curr.map((s) => {
          // Only stay at sea while actively fishing. Pausing/stopping → sail back to the marina.
          const target = s.fishing ? 1 : 0;
          const sail = s.sail + (target - s.sail) * 0.12;
          if (!s.fishing || !s.startedAt) {
            return { ...s, sail };
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


  const isDestroyed = (x: Ship) => !!x.destroyedAt && !!x.repairEndsAt && new Date(x.repairEndsAt).getTime() > Date.now();

  const toggleFishing = (shipId: number) => {
    let dbIdToSync: string | undefined;
    let nextAtSea = false;
    const target = ships.find((x) => x.id === shipId);
    if (target && isDestroyed(target) && !target.fishing) {
      showToast("السفينة مدمّرة — انتظر حتى يكتمل الإصلاح");
      sound.play("error");
      return;
    }
    setShips((curr) =>
      curr.map((x) => {
        if (x.id !== shipId) return x;
        dbIdToSync = x.dbId;
        if (x.fishing) {
          nextAtSea = false;
          return { ...x, fishing: false, startedAt: undefined };
        }
        nextAtSea = true;
        const ratio = x.max > 0 ? x.progress / x.max : 0;
        const startedAt = Date.now() - Math.round(ratio * x.duration * 1000);
        return { ...x, fishing: true, startedAt };
      })
    );
    sound.play("whoosh");
    // Sync at_sea to DB so other players see live status via realtime
    if (dbIdToSync) {
      import("@/lib/economy").then(({ setShipAtSea }) => {
        setShipAtSea(dbIdToSync!, nextAtSea).catch(() => {});
      });
    }
  };

  const collect = (shipId: number, e: React.MouseEvent) => {
    const s = ships.find((x) => x.id === shipId);
    if (!s) return;
    // Docked & empty → start fishing (sail out)
    if (s.progress <= 0 && !s.fishing) {
      toggleFishing(shipId);
      return;
    }
    // Compute time-based ratio so fishGained is strictly proportional to time at sea.
    const { luckMult, sailorMult, guide } = getCrewBonuses(s);
    void guide;
    const elapsed = (s.startedAt ? (Date.now() - s.startedAt) / 1000 : 0) * sailorMult;
    const timeRatio = Math.min(1, elapsed / Math.max(1, s.duration));
    const ratio = s.fishing ? timeRatio : Math.min(1, s.progress / s.max);
    if (ratio <= 0) {
      // Nothing caught yet but ship is out → just recall
      setShips((curr) =>
        curr.map((x) =>
          x.id === shipId ? { ...x, progress: 0, timeLeft: x.duration, fishing: false, startedAt: undefined } : x
        )
      );
      if (s.dbId) {
        import("@/lib/economy").then(({ setShipAtSea }) => {
          setShipAtSea(s.dbId!, false).catch(() => {});
        });
      }
      sound.play("whoosh");
      return;
    }
    const effRatio = ratio;
    const pool = fishForShip(s.level, s.id);
    const storedGuide = getShipGuide(s.id);
    // Fallback safety: if pool is empty (shouldn't happen) use any fish so the catch is never lost
    const fallbackPool = pool.length > 0 ? pool : Object.keys(FISH);
    const caughtId = storedGuide && fallbackPool.includes(storedGuide)
      ? storedGuide
      : fallbackPool[Math.floor(Math.random() * fallbackPool.length)];
    const caught = caughtId ? FISH[caughtId] : null;
    const fullAmount = catchAmountForLevel(s.level);
    const baseFish = Math.max(1, Math.round(fullAmount * effRatio));
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
    const fishGained = Math.max(1, Math.floor(baseFish * luckMult));
    // Fishing yields only fish — sell them at the fish market to earn gold.
    setFish((f) => f + fishGained);
    if (user && caught) {
      incrementFishCaught(caught.id, fishGained).catch((e) => console.error("[catch]", e));
    }
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
    if (s.dbId) {
      import("@/lib/economy").then(({ setShipAtSea }) => {
        setShipAtSea(s.dbId!, false).catch(() => {});
      });
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPop({
      id: Date.now(),
      x: rect.left + rect.width / 2,
      y: rect.top,
      v: caught
        ? `${caught.emoji} ${caught.name} ×${fishGained}`
        : `🐟 ×${fishGained}`,
    });

    setTimeout(() => setPop(null), 1400);
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0d2236]">
      {/* Selected scene background — all variants share the same shore-left / sea-right composition */}
      {scene.video ? (
        <div className="absolute inset-0 pointer-events-none">
          <SeamlessVideo
            key={scene.id}
            src={scene.video}
            poster={scene.image}
            className="absolute inset-0 w-full h-full object-cover object-center select-none"
          />
        </div>
      ) : (
        <img
          src={scene.image}
          alt={scene.name}
          className="absolute inset-0 w-full h-full object-cover object-center select-none pointer-events-none"
          draggable={false}
        />
      )}

      {/* Soft water shimmer overlay */}
      <div className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-20"
        style={{
          background:
            "radial-gradient(ellipse at 70% 60%, rgba(255,255,255,0.4) 0%, transparent 50%)",
        }}
      />

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

      {/* Outgoing steals — my ships currently raiding other players' harbors */}
      {outgoingSteals.length > 0 && (
        <div className="absolute top-32 left-2 right-2 z-30 flex flex-col gap-2 pointer-events-none">
          {outgoingSteals.map((s) => {
            const tgt = stealTargetNames[s.stealingTargetUserId!] || { name: "لاعب", emoji: "🧑‍✈️" };
            const secsLeft = Math.max(0, Math.ceil((new Date(s.stealingEndsAt!).getTime() - now) / 1000));
            return (
              <Link
                key={`out-${s.id}`}
                to="/players/$playerId"
                params={{ playerId: s.stealingTargetUserId! }}
                onClick={() => sound.play("click")}
                className="pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-950/85 border-2 border-amber-400/70 backdrop-blur-sm shadow-lg active:scale-95"
              >
                <span className="text-2xl animate-pulse">🏴‍☠️</span>
                <div className="flex-1 min-w-0">
                  <div className="text-amber-100 text-xs font-bold truncate">
                    سفينتك تسرق من {tgt.emoji} {tgt.name}
                  </div>
                  <div className="text-amber-300/80 text-[10px]">
                    اضغط للمتابعة · ترجع خلال {Math.floor(secsLeft / 60)}:{String(secsLeft % 60).padStart(2, "0")}
                  </div>
                </div>
                <span className="text-amber-300 text-lg">‹</span>
              </Link>
            );
          })}
        </div>
      )}




      {/* Clickable building hotspots */}
      <Hotspot to="/fish-market" label="سوق السمك" emoji="🐟"
        style={{ left: "0%", top: "18%", width: "26%", height: "22%" }} />
      {/* Ship Market — fixed floating button on the right, high enough to not overlap ships */}
      <Link
        to="/ship-market"
        onClick={() => sound.play("click")}
        className="absolute right-2 top-[22%] z-20 w-14 h-16 rounded-2xl border-2 border-amber-300 bg-gradient-to-b from-[#3a1f0a] via-[#5a2e0e] to-[#1a0d04] shadow-[0_4px_14px_rgba(0,0,0,0.6),0_0_18px_rgba(252,191,73,0.4)] flex flex-col items-center justify-center text-amber-100 active:scale-95"
      >
        <span className="text-2xl drop-shadow">⚓</span>
        <span className="text-[10px] font-black mt-0.5 drop-shadow whitespace-nowrap">سوق السفن</span>
      </Link>

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


      {/* Animated sea waves shimmer */}
      <div className="absolute inset-0 pointer-events-none z-[4]"
        style={{
          background:
            "repeating-linear-gradient(115deg, transparent 0px, transparent 40px, rgba(255,255,255,0.06) 41px, rgba(255,255,255,0.06) 43px)",
          maskImage:
            "linear-gradient(90deg, transparent 0%, transparent 45%, black 60%, black 100%)",
          WebkitMaskImage:
            "linear-gradient(90deg, transparent 0%, transparent 45%, black 60%, black 100%)",
          animation: "wave-slide 8s linear infinite",
        }}
      />


      {/* TOP HUD — pirate luxury */}
      <div className="absolute top-0 left-0 right-0 p-2.5 z-20 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {/* Avatar plaque — real avatar + name + lvl + xp */}
          <Link to="/profile" className="relative active:scale-95 flex items-center gap-2 rounded-2xl pl-2 pr-1 py-1.5 border-2 border-amber-400/80 bg-gradient-to-r from-[#3a1f0a]/95 via-[#2a1606]/95 to-[#1a0d04]/95 shadow-[0_4px_12px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(252,191,73,0.4)]">
            {/* Decorative gold rivets */}
            <span className="absolute -top-0.5 left-2 text-amber-300/80 text-[10px]">⚜</span>
            <span className="absolute -top-0.5 right-2 text-amber-300/80 text-[10px]">⚜</span>
            <div className="flex-1 text-right pr-1 min-w-0">
              <div className="text-[13px] font-black text-amber-100 truncate max-w-[120px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                {profile?.display_name || "قبطان"}
              </div>
              <div className="flex items-center gap-1 justify-end mt-1">
                <span className="text-[10px] font-black text-amber-300 drop-shadow">LVL {profile?.level ?? 1}</span>
                <div className="w-16 h-2 rounded-full bg-black/70 border border-amber-700/70 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-300 via-amber-400 to-amber-200 shadow-[0_0_6px_rgba(252,191,73,0.7)]"
                    style={{ width: `${Math.min(100, ((profile?.xp ?? 0) % 1000) / 10)}%` }}
                  />
                </div>
              </div>
            </div>
            <div className="relative w-14 h-14 rounded-xl border-2 border-amber-300 bg-gradient-to-b from-amber-900 to-amber-950 overflow-hidden shadow-[0_0_14px_rgba(252,191,73,0.6)]">
              {(profile as any)?.avatar_url ? (
                <img src={(profile as any).avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-3xl">{profile?.avatar_emoji || "🧑‍✈️"}</div>
              )}
            </div>
          </Link>

          {/* Treasury — gold + gems */}
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="rounded-xl border-2 border-amber-400/80 bg-gradient-to-r from-[#3a1f0a]/95 to-[#1a0d04]/95 px-2 py-1.5 flex items-center justify-between shadow-[0_2px_8px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(252,191,73,0.3)]">
              <span className="text-lg drop-shadow">🪙</span>
              <span className="text-sm font-black text-amber-200 tabular-nums drop-shadow">{coins.toLocaleString()}</span>
              <button
                onClick={() => sound.play("click")}
                className="w-6 h-6 rounded-full bg-amber-400 text-amber-950 text-xs font-black border border-amber-200 active:scale-90 shadow"
              >+</button>
            </div>
            <div className="rounded-xl border-2 border-cyan-400/70 bg-gradient-to-r from-[#0a1f3a]/95 to-[#04101a]/95 px-2 py-1.5 flex items-center justify-between shadow-[0_2px_8px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(125,211,252,0.3)]">
              <span className="text-lg drop-shadow">💎</span>
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
        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-xl border border-amber-400/50 bg-black/50 backdrop-blur px-2 py-1.5 flex items-center gap-2">
            <div className="text-xs font-black text-amber-300 whitespace-nowrap drop-shadow">⚓ VIP 6</div>
            <div className="flex-1 h-2.5 bg-black/70 rounded-full overflow-hidden border border-amber-700/60">
              <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-200 rounded-full shadow-[0_0_8px_rgba(110,231,183,0.6)]" style={{ width: "62%" }} />
            </div>
          </div>
          <div className="flex gap-1">
            {["🍖", "⚡", "🛡️"].map((e, i) => (
              <div key={i} className="w-10 h-10 rounded-lg border border-amber-400/60 bg-gradient-to-b from-amber-900/90 to-black/90 flex items-center justify-center text-lg shadow">
                {e}
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-amber-400/60 bg-gradient-to-b from-amber-900/90 to-black/90 px-2 py-1.5 flex items-center gap-1 shadow">
            <span className="text-lg">🐟</span>
            <span className="text-sm font-black text-amber-200 tabular-nums">{fish}</span>
          </div>
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
        <div className="flex items-center justify-end px-1">
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
        // Keep the third ship higher so it doesn't stick to the bottom nav on mobile.
        const ts = [0, 0.4, 0.68];
        const vRange = Math.max(14, 74 - (wTop + 4));
        const top = `${fixedSlot?.top ?? wTop + 4 + ts[i] * vRange}%`;

        const scale = fixedSlot?.scale ?? 0.95 + ts[i] * 0.42; // far ship smaller, near ship bigger
        // Dock on the LEFT half of the water band so each ship always has
        // room to sail rightward when fishing (and visibly return to dock when recalled).
        const hOffsets = [0.05, 0.3, 0.55];
        const dockLeft = fixedSlot?.left ?? wLeft + hOffsets[i % hOffsets.length] * wWidth;


        const shipCrews = crewRows
          .filter((r) => isCrewAssignedToShip(r.meta, s))
          .map((r) => CREWS.find((c) => c.id === r.item_id))
          .filter((c): c is (typeof CREWS)[number] => !!c && c.id !== "trader");


        return (
          <ShipSlot
            key={s.id}
            ship={{ ...s, top, scale, dockLeft }}
            crews={shipCrews}
            onTap={() => setMenuShipId(s.id)}
            active={menuShipId === s.id}
          />
        );
      })}



      {/* Ship action menu (3 icons: fish / crew / sell) */}
      {menuShipId !== null && (() => {
        const s = ships.find((x) => x.id === menuShipId);
        if (!s) return null;
        const ready = s.progress >= s.max;
        const onSteal = !!s.stealingTargetUserId;
        const stealEnd = s.stealingEndsAt ? new Date(s.stealingEndsAt).getTime() : 0;
        const stealReady = onSteal && stealEnd > 0 && Date.now() >= stealEnd;
        const stealSecsLeft = onSteal ? Math.max(0, Math.ceil((stealEnd - Date.now()) / 1000)) : 0;
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
                        const { data, error } = await (supabase as any).rpc("claim_steal_mission", { _attacker_ship_id: s.dbId });
                        if (error) { showToast("تعذّر استلام الغنيمة"); return; }
                        const row = Array.isArray(data) && data[0] ? data[0] : null;
                        const n = row?.stolen_count ?? 0;
                        const v = row?.total_value ?? 0;
                        sound.play(n > 0 ? "catch" : "click");
                        showToast(n > 0 ? `🐟 سرقت ${n} سمكة (قيمتها ${v})` : "السفينة رجعت فاضية 🪶");
                        syncFleetFromDb();
                      }}
                    >🏴‍☠️ استلم الغنيمة</button>
                  ) : (
                    <div className="text-rose-300/80 text-xs">ترجع بعد {Math.floor(stealSecsLeft / 60)}:{String(stealSecsLeft % 60).padStart(2, "0")}</div>
                  )}
                </div>
              )}
              {!onSteal && (
                <div className="flex gap-3">
                  <ActionBtn
                    emoji={ready ? "🪣" : s.progress > 0 || s.fishing ? "🪣" : "🎣"}
                    label={ready ? "اجمع" : s.progress > 0 || s.fishing ? "اجمع وارجع" : "صيد"}
                    onClick={(e: React.MouseEvent) => {
                      setMenuShipId(null);
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
              )}
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
              <div className="text-amber-300 font-bold text-lg mb-4">+ {price.toLocaleString()} 🪙</div>
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
          // Fixer crews: consume immediately, repair the ship, do NOT assign as a crew member.
          if (itemId.startsWith("fixer_")) {
            if (!s.dbId) { sound.play("error"); return; }
            const row = availableRows.find((r) => r.item_id === itemId);
            if (!row) return;
            try {
              await (supabase as any)
                .from("ships_owned")
                .update({ hp: s.maxHp ?? 100, destroyed_at: null, repair_ends_at: null })
                .eq("id", s.dbId);
              setShips((arr) => arr.map((x) => x.id === s.id ? { ...x, hp: x.maxHp ?? 100, destroyedAt: null, repairEndsAt: null } : x));
              // consume one unit of the fixer crew (don't keep it assigned)
              if (row.quantity <= 1) {
                await deleteInventoryRows([row.id]);
              } else {
                await (supabase as any).rpc("consume_inventory_item", { _item_id: itemId, _item_type: "crew", _count: 1 });
              }
            } catch {}
            sound.play("success");
            await reloadCrews();
            setCrewTick((t) => t + 1);
            setModal(null);
            return;
          }
          // Prevent duplicates: max 1 crew per type per ship
          if (assignedRows.some((r) => r.item_id === itemId)) {
            sound.play("error");
            return;
          }
          // find a row with this item_id that's unassigned
          const row = availableRows.find((r) => r.item_id === itemId);
          if (!row) return;
          const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
          const newMeta = { assigned_ship_id: s.dbId ?? s.id, expires_at: expiresAt };
          if (row.quantity <= 1) {
            await updateInventoryMeta(row.id, newMeta);
          } else {
            await splitInventoryAssign(row.id, newMeta);
          }
          sound.play("success");
          await reloadCrews();
          setCrewTick((t) => t + 1);
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

              <div className="text-[11px] text-accent/80 font-bold mb-1">طواقمك في المخزن</div>
              {availMap.size === 0 ? (
                <div className="text-xs text-accent/60 text-center py-4">
                  لا توجد طواقم متاحة. اشترِ من <Link to="/shop" className="text-amber-300 underline" onClick={() => setModal(null)}>المتجر</Link>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {Array.from(availMap.entries()).map(([cid, qty]) => {
                    const c = CREWS.find((x) => x.id === cid);
                    if (!c) return null;
                    const alreadyOnShip = assignedRows.some((r) => r.item_id === cid);
                    const canAssign = assignedRows.length < slots && !alreadyOnShip;
                    return (
                      <button
                        key={cid}
                        disabled={!canAssign}
                        onClick={() => assignCrew(cid)}
                        className={`w-full flex items-center gap-2 p-2 rounded-lg border text-right active:scale-[0.98] ${
                          canAssign
                            ? "border-accent/30 bg-black/20 hover:bg-accent/10"
                            : "border-accent/20 bg-black/10 opacity-50"
                        }`}
                      >
                        {c.image ? <img src={c.image} alt={c.name} className="w-8 h-8 object-contain drop-shadow" /> : <span className="text-xl">{c.emoji}</span>}
                        <div className="flex-1">
                          <div className="text-xs font-bold text-accent">{c.name} <span className="text-amber-300">×{qty}</span></div>
                          <div className="text-[10px] text-emerald-300">{c.bonus}</div>
                        </div>
                        <span className="text-[10px] text-accent/60">
                          {alreadyOnShip ? "مفعّل ✓" : canAssign ? "تفعيل 24س" : "ممتلئ"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

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
      <div className="absolute bottom-0 left-0 right-0 z-20 px-1.5 pb-2 pt-1.5 glass-hud border-t-2 border-amber-400/60 shadow-[0_-4px_14px_rgba(0,0,0,0.6)]">
        <div className="flex items-center justify-around">
          {[
            { e: "💀", l: "تحدي", to: null, action: "challenge" as const },
            { e: "🏆", l: "ترتيب", to: null, action: "boost" as const },
            { e: "📦", l: "مخزن", to: "/inventory" as const, action: null },
            { e: "🏛️", l: "متجر", to: "/shop" as const, action: null },
            { e: "💬", l: "شات", to: "/chat" as const, action: null },
            { e: "👥", l: "أصدقاء", to: "/friends" as const, action: null },
            { e: "⚙️", l: "إعدادات", to: null, action: "settings" as const },
          ].map((it, i) => {
            const inner = (
              <>
                <div className="w-11 h-11 rounded-xl bg-gradient-to-b from-amber-700/90 to-amber-950/90 border-2 border-amber-300/70 flex items-center justify-center text-xl shadow-[inset_0_1px_0_rgba(255,220,140,0.4),0_2px_6px_rgba(0,0,0,0.5)]">
                  {it.e}
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
    </div>
  );
}

type LbProfile = {
  id: string; display_name: string; avatar_emoji: string; avatar_url: string | null;
  level: number; xp: number; coins: number; gems: number;
};

type TribeLb = { id: string; name: string; emblem: string; banner?: string; level?: number; members: number; power: number };

function LeaderboardModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"xp" | "gems" | "coins" | "tribes" | "search">("xp");
  const [rows, setRows] = useState<LbProfile[]>([]);
  const [tribes, setTribes] = useState<TribeLb[]>([]);
  const [q, setQ] = useState("");
  const [tribeQ, setTribeQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [openTribeId, setOpenTribeId] = useState<string | null>(null);

  useEffect(() => {
    if (tab === "search") return;
    if (tab === "tribes") {
      setLoading(true);
      (async () => {
        const { data: ts } = await supabase.from("tribes").select("id,name,emblem,banner,level").limit(200);
        if (!ts || ts.length === 0) { setTribes([]); setLoading(false); return; }
        const ids = ts.map((t: any) => t.id);
        const { data: mems } = await supabase.from("tribe_members").select("tribe_id,user_id").in("tribe_id", ids);
        const byTribe = new Map<string, string[]>();
        (mems || []).forEach((m: any) => {
          const arr = byTribe.get(m.tribe_id) || [];
          arr.push(m.user_id);
          byTribe.set(m.tribe_id, arr);
        });
        const allUids = Array.from(new Set((mems || []).map((m: any) => m.user_id)));
        const powerMap = new Map<string, number>();
        if (allUids.length > 0) {
          const { data: ps } = await supabase.from("profiles").select("id,level,xp").in("id", allUids);
          (ps || []).forEach((p: any) => powerMap.set(p.id, (p.level || 1) * 100 + Math.floor((p.xp || 0) / 10)));
        }
        const list: TribeLb[] = (ts as any[]).map(t => {
          const uids = byTribe.get(t.id) || [];
          const memberPower = uids.reduce((s, u) => s + (powerMap.get(u) || 0), 0);
          const lvlBonus = ((t.level || 1) - 1) * 500;
          const power = memberPower + lvlBonus;
          return { id: t.id, name: t.name, emblem: t.emblem, banner: t.banner, level: t.level || 1, members: uids.length, power };
        }).sort((a, b) => (b.power + b.members * 50) - (a.power + a.members * 50));
        setTribes(list);
        setLoading(false);
      })();
      return;
    }
    setLoading(true);
    const col = tab === "xp" ? "xp" : tab === "gems" ? "gems" : "coins";
    supabase.from("profiles")
      .select("id,display_name,avatar_emoji,avatar_url,level,xp,coins,gems")
      .order(col, { ascending: false }).limit(30)
      .then(({ data }) => { setRows((data as LbProfile[]) || []); setLoading(false); });
  }, [tab]);

  const runSearch = async () => {
    if (!q.trim()) return;
    setLoading(true);
    const { data } = await supabase.from("profiles")
      .select("id,display_name,avatar_emoji,avatar_url,level,xp,coins,gems")
      .ilike("display_name", `%${q.trim()}%`).limit(30);
    setRows((data as LbProfile[]) || []);
    setLoading(false);
  };

  const TABS = [
    { id: "xp" as const, e: "⭐", l: "XP" },
    { id: "gems" as const, e: "💎", l: "جواهر" },
    { id: "coins" as const, e: "🪙", l: "عملات" },
    { id: "tribes" as const, e: "🏴‍☠️", l: "قبائل" },
    { id: "search" as const, e: "🔍", l: "بحث" },
  ];

  const valueFor = (p: LbProfile) =>
    tab === "gems" ? p.gems : tab === "coins" ? p.coins : p.xp;
  const valueIcon = tab === "gems" ? "💎" : tab === "coins" ? "🪙" : "⭐";

  const tribesFiltered = tribeQ.trim()
    ? tribes.filter(t => t.name.toLowerCase().includes(tribeQ.trim().toLowerCase()))
    : tribes;

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-2"
      onClick={onClose}>
      <div className="w-full max-w-md glass-hud border-2 border-accent/60 rounded-2xl p-3 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()} dir="rtl">
        <div className="text-center text-accent font-bold text-lg mb-2">🏆 الترتيب</div>

        <div className="grid grid-cols-5 gap-1 mb-3">
          {TABS.map(t => (
            <button key={t.id}
              onClick={() => { sound.play("click"); setTab(t.id); setRows([]); }}
              className={`py-2 rounded-lg text-[10px] font-bold border transition ${
                tab === t.id ? "bg-accent text-secondary border-accent" : "bg-secondary/60 text-accent/80 border-accent/30"
              }`}>
              <div className="text-base">{t.e}</div>
              <div>{t.l}</div>
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
          ) : tab === "tribes" ? (
            tribesFiltered.length === 0 ? (
              <div className="text-center text-accent/60 py-6 text-sm">لا توجد قبائل</div>
            ) : tribesFiltered.map((t, i) => (
              <button key={t.id} onClick={() => { sound.play("click"); setOpenTribeId(t.id); }}
                className="w-full text-right flex items-center gap-2 p-2 rounded-lg bg-secondary/60 border border-accent/30 active:scale-[0.98]">
                <div className="w-6 text-center text-xs font-bold text-accent">{i + 1}</div>
                <div className="w-9 h-9 rounded-full bg-gradient-to-b from-amber-400 to-amber-800 flex items-center justify-center text-lg">{t.banner || t.emblem}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-accent truncate">{t.name} <span className="text-amber-300">⭐{t.level || 1}</span></div>
                  <div className="text-[10px] text-accent/70">👥 {t.members} عضو • انقر للتفاصيل</div>
                </div>
                <div className="text-xs font-bold text-accent tabular-nums">⚡ {t.power.toLocaleString()}</div>
              </button>
            ))
          ) : rows.length === 0 ? (
            <div className="text-center text-accent/60 py-6 text-sm">
              {tab === "search" ? "ابحث باسم قبطان" : "لا توجد نتائج"}
            </div>
          ) : rows.map((p, i) => (
            <Link key={p.id} to="/players/$playerId" params={{ playerId: p.id }}
              onClick={() => { sound.play("click"); onClose(); }}
              className="flex items-center gap-2 p-2 rounded-lg bg-secondary/60 border border-accent/30 active:scale-[0.98]">
              {tab !== "search" && (
                <div className="w-6 text-center text-xs font-bold text-accent">{i + 1}</div>
              )}
              <div className="w-9 h-9 rounded-full bg-gradient-to-b from-sky-400 to-sky-700 flex items-center justify-center text-base overflow-hidden">
                {p.avatar_url ? <img src={p.avatar_url} alt="" className="w-full h-full object-cover" /> : p.avatar_emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-accent truncate">{p.display_name}</div>
                <div className="text-[10px] text-accent/70">المستوى {p.level}</div>
              </div>
              <div className="text-xs font-bold text-accent tabular-nums">
                {valueIcon} {valueFor(p).toLocaleString()}
              </div>
            </Link>
          ))}
        </div>

        <button className="mt-2 w-full py-2 rounded-lg bg-secondary/70 text-accent text-xs font-bold active:scale-95"
          onClick={onClose}>إغلاق</button>
      </div>
      {openTribeId && <TribeDetailModal tribeId={openTribeId} onClose={() => setOpenTribeId(null)} />}
    </div>
  );
}

function TribeDetailModal({ tribeId, onClose }: { tribeId: string; onClose: () => void }) {
  const [info, setInfo] = useState<{ name: string; emblem: string; banner: string; description: string; level: number; treasure_coins: number; total_donations: number } | null>(null);
  const [members, setMembers] = useState<Array<{ user_id: string; role: string; display_name: string; avatar_emoji: string; level: number; xp: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: t } = await supabase.from("tribes").select("name,emblem,banner,description,level,treasure_coins,total_donations").eq("id", tribeId).maybeSingle();
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
      setLoading(false);
    })();
  }, [tribeId]);

  const totalPower = members.reduce((s, m) => s + (m.level * 100 + Math.floor(m.xp / 10)), 0) + ((info?.level || 1) - 1) * 500;

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-2" onClick={onClose}>
      <div className="w-full max-w-md glass-hud border-2 border-accent/60 rounded-2xl p-3 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()} dir="rtl">
        {loading || !info ? (
          <div className="text-center text-accent/70 py-10">جاري التحميل…</div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-2">
              <div className="text-3xl">{info.banner || info.emblem}</div>
              <div className="flex-1 min-w-0">
                <div className="text-lg font-extrabold text-accent truncate">{info.name}</div>
                <div className="text-xs text-amber-300">⭐ المستوى {info.level} • ⚡ {totalPower.toLocaleString()}</div>
              </div>
              <button onClick={onClose} className="px-3 py-1 rounded bg-secondary/70 text-accent">✕</button>
            </div>

            <div className="rounded-xl bg-secondary/50 border border-accent/30 p-2 mb-2">
              <div className="text-xs text-accent/90 whitespace-pre-wrap break-words">
                {info.description || "لا يوجد وصف بعد."}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[10px]">
                <div className="rounded bg-stone-900/60 p-1.5">
                  <div className="text-amber-300 font-bold">{info.treasure_coins.toLocaleString()}</div>
                  <div className="text-accent/60">خزنة 🪙</div>
                </div>
                <div className="rounded bg-stone-900/60 p-1.5">
                  <div className="text-amber-300 font-bold">{info.total_donations.toLocaleString()}</div>
                  <div className="text-accent/60">تبرعات 🪙</div>
                </div>
                <div className="rounded bg-stone-900/60 p-1.5">
                  <div className="text-amber-300 font-bold">{members.length}</div>
                  <div className="text-accent/60">أعضاء 👥</div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1">
              <div className="text-xs font-bold text-accent mb-1">👥 الأعضاء</div>
              {members.map((m, i) => (
                <Link key={m.user_id} to="/players/$playerId" params={{ playerId: m.user_id }}
                  onClick={() => { sound.play("click"); onClose(); }}
                  className="flex items-center gap-2 p-2 rounded-lg bg-secondary/60 border border-accent/30 active:scale-[0.98]">
                  <div className="w-6 text-center text-xs font-bold text-accent">{i + 1}</div>
                  <div className="w-8 h-8 rounded-full bg-sky-700 flex items-center justify-center">{m.avatar_emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-accent truncate">{m.display_name} {m.role === "owner" ? "👑" : m.role === "moderator" ? "🛡️" : ""}</div>
                    <div className="text-[10px] text-accent/70">المستوى {m.level}</div>
                  </div>
                  <div className="text-xs font-bold text-accent tabular-nums">⚡ {(m.level * 100 + Math.floor(m.xp / 10)).toLocaleString()}</div>
                </Link>
              ))}
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
  // Idle ships face the shore (-1); fishing ships face out to sea (+1).
  const facing = ship.fishing ? 1 : -1;


  const pct = (ship.progress / ship.max) * 100;
  const capacity = catchAmountForLevel(ship.level);
  const ratio = Math.min(1, ship.max > 0 ? ship.progress / ship.max : 0);
  const caughtNow = Math.min(capacity, Math.round(capacity * ratio));
  const ready = pct >= 100;
  const mins = Math.floor(ship.timeLeft / 60);
  const secs = Math.floor(ship.timeLeft % 60);
  const timeStr = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  const t = Date.now() / 1000;
  const bobAmp = moving ? 2.5 : 1.2;
  const bob = Math.sin((t + ship.id) * 1.4) * bobAmp;
  const sway = moving ? Math.sin((t + ship.id) * 0.9) * 1.5 : 0;
  const baseTilt = direction * 2.5;
  const rockTilt = Math.sin((t + ship.id) * 1.8) * (moving ? 1.2 : 0.5);
  const tilt = baseTilt + rockTilt;

  const shipW = 22 * ship.scale;
  const dockLeft = ship.dockLeft;
  const maxLeft = 96 - shipW;
  const computedLeft = dockLeft + ship.sail * (maxLeft - dockLeft);

  // Pivot-in-place: when bow direction changes, hold position while the flip
  // animation plays, then release so the ship slides smoothly to its new spot.
  const TURN_MS = 700;
  const facingRef = useRef(facing);
  const turnEndRef = useRef(0);
  const heldLeftRef = useRef(computedLeft);
  if (facingRef.current !== facing) {
    facingRef.current = facing;
    turnEndRef.current = Date.now() + TURN_MS;
    heldLeftRef.current = computedLeft;
  }
  const now = Date.now();
  const turning = now < turnEndRef.current;
  const leftOffset = turning ? heldLeftRef.current : computedLeft;

  const atSea = ship.sail > 0.85;
  const isFishing = ship.fishing && atSea && !moving && !ready;
  const flipX = facing === -1 ? -1 : 1;
  const bankRoll = 0;
  const bankPitch = 0;
  const turnLift = 0;
  const turnSway = 0;

  return (
    <button
      onClick={onTap}
      className="absolute z-10 active:scale-95"
      style={{
        left: `${leftOffset}%`,
        top: ship.top,
        width: `${22 * ship.scale}%`,
        perspective: "800px",
        transformStyle: "preserve-3d",
        transition: "left 0.5s ease-in-out",
      }}
    >
      {/* Wake ripples behind — stronger when moving */}
      <div
        className="absolute left-1/2 -translate-x-1/2 -bottom-3 h-4"
        style={{
          width: `${60 + ship.sail * 40}%`,
          opacity: 0.2 + Math.min(1, Math.abs(v) * 200) * 0.6 + ship.sail * 0.3,
        }}
      >
        <div className="w-full h-full rounded-[50%] border-t-2 border-white/70" />
        <div className="absolute inset-x-2 top-1 h-full rounded-[50%] border-t border-white/40" />
        <div className="absolute inset-x-6 top-2 h-full rounded-[50%] border-t border-white/30" />
      </div>

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
          className="absolute left-1/2 -translate-x-1/2 pointer-events-none z-20 flex items-end justify-center gap-1"
          style={{ top: "-18%", width: "120%", height: "40%" }}
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
          transform: `translate(${sway + turnSway}px, ${bob + turnLift}px) rotateX(${2 + bankPitch * 0.4}deg) rotateZ(${tilt * 0.6 + bankRoll * 0.6}deg)`,
          transformStyle: "preserve-3d",
          transformOrigin: "center 80%",
          transition: "transform 0.2s ease-out",
          filter:
            "drop-shadow(0 14px 10px rgba(0,0,0,0.55)) drop-shadow(0 4px 2px rgba(0,0,0,0.35)) saturate(1.12) contrast(1.08)",
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
            className="w-full block select-none animate-sail-flap"
            draggable={false}
            style={{ WebkitBackfaceVisibility: "hidden", backfaceVisibility: "hidden" }}
          />


          {/* Waving flag on the mast */}
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

          {/* Chimney smoke when sailing */}
          {moving && (
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
            {/* Splash ring */}
            <div
              className="absolute left-1/2 -translate-x-1/2 rounded-full border-2 border-white/70"
              style={{
                bottom: "-18%",
                width: "70%",
                aspectRatio: "3 / 1",
                animation: "splash-ring 2.6s ease-out infinite",
              }}
            />
          </>
        )}
      </div>



      {/* Progress bar — only show when ship is tapped */}
      {active && (
      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-[75%] glass-hud rounded-md px-1 py-0.5 border border-accent/40">
        <div className="relative h-3 bg-black/40 rounded-sm overflow-hidden">
          <div
            className={`h-full rounded-sm transition-all duration-300 ${
              ready
                ? "bg-gradient-to-r from-amber-300 to-yellow-200 animate-shimmer"
                : ship.fishing
                ? "bg-gradient-to-r from-emerald-400 to-emerald-300"
                : "bg-gradient-to-r from-slate-400 to-slate-300"
            }`}
            style={{ width: `${pct}%` }}
          />
          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-extrabold text-white text-glow whitespace-nowrap gap-1">
            <span>🐟</span>
            <span className="tabular-nums">{caughtNow}/{capacity}</span>
          </div>
        </div>
        {ready ? (
          <div className="text-center text-[9px] text-amber-200 font-bold mt-0.5 animate-pulse">
            ✦ جاهز للجمع ✦
          </div>
        ) : ship.fishing ? (
          <div className="text-center text-[9px] text-emerald-200 font-bold tabular-nums mt-0.5">
            🎣 يصطاد · {timeStr}
          </div>
        ) : (
          <div className="text-center text-[9px] text-slate-200 font-bold mt-0.5">
            ⏸ متوقف — اضغط للإبحار
          </div>
        )}
      </div>
      )}
      </div>
    </button>
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
    >
      <div className="w-12 h-12 rounded-full glass-hud border border-accent/40 flex items-center justify-center text-2xl">
        {emoji}
      </div>
      <span className="text-[10px] text-accent font-bold">{label}</span>
    </button>
  );
}
