import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { WEAPONS } from "@/lib/weapons";
import { CREWS } from "@/lib/crews";
import { supabase } from "@/integrations/supabase/client";
import { PROFILE_PUBLIC_COLUMNS } from "@/lib/profile-columns";
import { getSceneVisual } from "@/lib/backgrounds";
import { getShipByCode, getShipByMarketLevel } from "@/lib/ships";
import { sound } from "@/lib/sound";
import { buyWithCoins, buyWithGems } from "@/lib/economy";
import { ProjectileFx } from "@/components/ProjectileFx";
import { SeamlessVideo } from "@/components/SeamlessVideo";
import { burnTargetBg } from "@/components/BurnedBgOverlay";
import { DraggableRepairBgButton } from "@/components/DraggableRepairBgButton";
import { frameById } from "@/lib/frames";
import { AdBombOverlay } from "@/components/AdBombOverlay";
import { AntiBlockBurst } from "@/components/AntiBlockBurst";
import { AD_VIDEOS } from "@/lib/ad-videos";
import { serverNow, serverNowMs } from "@/lib/server-time";
import { recordAttackWithRetry } from "@/lib/record-attack";
import { rateLimit } from "@/lib/rate-limit";
import { toast as sonnerToast } from "sonner";


import { DragonShoreCreature } from "@/components/DragonShoreCreature";
import { applyDragonAttack, overallLevel, type Dragon } from "@/lib/dragon";
import woodenSignAsset from "@/assets/wooden-sign-v2.png.asset.json";

export const Route = createFileRoute("/players/$playerId")({
  ssr: false,
  head: ({ params }) => ({
    meta: [
      { title: "زيارة لاعب — ملوك القراصنة" },
      { name: "description", content: "استعرض ملف اللاعب في ملوك القراصنة: سفنه، أسلحته، طاقمه، مستواه، وآخر معاركه — وأهجم عليه لتسرق غنائمه." },
      { property: "og:title", content: "زيارة لاعب — ملوك القراصنة" },
      { property: "og:description", content: "ملف اللاعب: سفن، أسلحة، طاقم، ومعارك أخيرة." },
      { property: "og:type", content: "profile" },
      { property: "og:url", content: `https://www.molok-alqarasna.com/players/${params.playerId}` },
    ],
    links: [{ rel: "canonical", href: `https://www.molok-alqarasna.com/players/${params.playerId}` }],
  }),
  component: PlayerPage,
});

type Profile = {
  id: string; display_name: string; avatar_emoji: string; avatar_url: string | null;
  level: number; xp: number; coins: number; gems: number; online_at: string;
  selected_bg_id?: string | null;
  bg_burned_until?: string | null;
  avatar_frame?: string | null; name_frame?: string | null; profile_frame?: string | null;
  last_destroyer_id?: string | null;
  last_destroyer_name?: string | null;
  last_destroyer_kind?: string | null;
  last_destroyer_at?: string | null;
  last_destroyer_message?: string | null;
};
type Ship = { id: string; template_id: number; catalog_code: string | null; at_sea: boolean; acquired_at: string; in_storage?: boolean; hp?: number; max_hp?: number; destroyed_at?: string | null; repair_ends_at?: string | null; stealing_ends_at?: string | null; stealing_target_user_id?: string | null };

// A ship is "still destroyed" (uncombat-able) only while current HP is below 30% of max.
// Past 30% HP it sails and fishes again on the owner's side, so it must also be attackable/stealable.
const FISH_REPAIR_MIN = 0.30;
function isShipStillDown(
  destroyedAt?: string | null,
  repairEndsAt?: string | null,
  hp?: number | null,
  maxHp?: number | null,
): boolean {
  // HP-based rule when available.
  if (hp != null && maxHp != null && maxHp > 0) {
    return (hp / maxHp) < FISH_REPAIR_MIN;
  }
  if (!destroyedAt) return false;
  if (!repairEndsAt) return true;
  const start = new Date(destroyedAt).getTime();
  const end = new Date(repairEndsAt).getTime();
  const now = serverNowMs();
  if (now >= end) return false;
  const total = Math.max(1, end - start);
  return (now - start) / total < FISH_REPAIR_MIN;
}


function PlayerPage() {
  const { playerId } = useParams({ from: "/players/$playerId" });
  const [me, setMe] = useState<string | null>(null);
  const [myName, setMyName] = useState<string>("");
  const [myProtectionUntil, setMyProtectionUntil] = useState<string | null>(null);
  const [p, setP] = useState<Profile | null>(null);
  const [theirDragonStage, setTheirDragonStage] = useState<number>(1);
  const [ships, setShips] = useState<Ship[]>([]);
  const [friendStatus, setFriendStatus] = useState<"none" | "pending" | "accepted" | "self">("none");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedShip, setSelectedShip] = useState<Ship | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"menu" | "weapon" | "myship" | "support" | "ad_bomb" | null>(null);
  const [myShips, setMyShips] = useState<Ship[]>([]);
  const [raiders, setRaiders] = useState<{ id: string; user_id: string; catalog_code: string | null; template_id: number; stealing_ends_at: string | null; stealing_target_ship_id: string | null; fishing_started_at: string | null; stealing_started_at?: string | null; fishing_power: number; owner_name: string; owner_emoji: string }[]>([]);
  const [nowTs, setNowTs] = useState<number>(serverNowMs());
  const [cancelRaiderId, setCancelRaiderId] = useState<string | null>(null);
  const [inv, setInv] = useState<{ item_id: string; item_type: string; quantity: number }[]>([]);
  const [playerCrews, setPlayerCrews] = useState<{ item_id: string; ship_id: string }[]>([]);
  const shipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [fx, setFx] = useState<{ id: number; emoji: string; fromX: number; fromY: number; toX: number; toY: number; phase: "fly" | "boom"; friendly?: boolean; weaponId?: string } | null>(null);
  const [shake, setShake] = useState<"" | "shake-sm" | "shake-md" | "shake-lg">("");
  const [nukeMsgOpen, setNukeMsgOpen] = useState(false);
  const [nukeMsg, setNukeMsg] = useState("");
  const [nukeSending, setNukeSending] = useState(false);
  const [targetIsStaff, setTargetIsStaff] = useState(false);
  const [targetMarketUnlocked, setTargetMarketUnlocked] = useState<boolean>(true);
  const [destroyerAvatar, setDestroyerAvatar] = useState<string | null>(null);
  const [destroyerEmoji, setDestroyerEmoji] = useState<string | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  type SignMsg = { id: string; attacker_id: string; attacker_name: string | null; kind: string; message: string; created_at: string };
  const [signMessages, setSignMessages] = useState<SignMsg[]>([]);
  const [signIdx, setSignIdx] = useState(0);
  const [deathBannerHidden, setDeathBannerHidden] = useState<boolean>(() => {
    try { return localStorage.getItem("death-banner-hidden") === "1"; } catch { return false; }
  });
  const [deathBannerMin, setDeathBannerMin] = useState<boolean>(() => {
    try { return localStorage.getItem("death-banner-min") === "1"; } catch { return false; }
  });
  const [myDragonLvl, setMyDragonLvl] = useState<number>(1);
  useEffect(() => {
    (async () => {
      const { data } = await (supabase as never as { rpc: (n: string) => Promise<{ data: Dragon | null }> }).rpc("get_or_init_dragon");
      if (data) setMyDragonLvl(overallLevel(data));
    })();
  }, []);
  useEffect(() => {
    const onPref = () => {
      try { setDeathBannerHidden(localStorage.getItem("death-banner-hidden") === "1"); } catch { /* noop */ }
    };
    window.addEventListener("death-banner-pref", onPref);
    return () => window.removeEventListener("death-banner-pref", onPref);
  }, []);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1800); };

  // Load my own ships + inventory when opening a ship
  const openShip = async (s: Ship) => {
    setSelectedShip(s); setMode("menu");
    if (!me) return;
    const [{ data: ms }, { data: iv }] = await Promise.all([
      supabase.from("ships_owned").select("id,template_id,catalog_code,at_sea,acquired_at,hp,max_hp,destroyed_at,repair_ends_at,stealing_ends_at,stealing_target_user_id,in_storage").eq("user_id", me).eq("in_storage", false),
      supabase.from("inventory").select("item_id,item_type,quantity,meta").eq("user_id", me),
    ]);
    setMyShips((ms as Ship[]) || []);
    // Aggregate qty per (item_id,item_type). For crew rows, EXCLUDE rows already
    // assigned to a ship — those can't be re-sent and would otherwise make the UI
    // show "you have X" while the RPC says "no such crew" (e.g. guide bug).
    const agg = new Map<string, { item_id: string; item_type: string; quantity: number }>();
    for (const r of ((iv as Array<{ item_id: string; item_type: string; quantity: number; meta: { assigned_ship_id?: string } | null }> | null) || [])) {
      if (r.item_type === "crew" && r.meta && r.meta.assigned_ship_id) continue;
      const k = `${r.item_type}:${r.item_id}`;
      const cur = agg.get(k);
      if (cur) cur.quantity += r.quantity; else agg.set(k, { item_id: r.item_id, item_type: r.item_type, quantity: r.quantity });
    }
    setInv(Array.from(agg.values()));
  };

  const closeMenu = () => { setSelectedShip(null); setMode(null); };

  // Decrement an inventory item locally + in DB
  const consumeItem = async (item_id: string, item_type: string) => {
    if (!me) return;
    const row = inv.find((x) => x.item_id === item_id && x.item_type === item_type);
    const next = Math.max(0, (row?.quantity ?? 0) - 1);
    setInv((arr) => arr.map((x) => x.item_id === item_id && x.item_type === item_type ? { ...x, quantity: next } : x));
    await supabase.rpc("consume_inventory_item", { _item_id: item_id, _item_type: item_type, _count: 1 });
  };

  // Animate a projectile from a starting screen edge toward the target ship, then explode (or sparkle if friendly)
  const playProjectile = (targetId: string, emoji: string, friendly = false, weaponId?: string, silent = false) => new Promise<void>((resolve) => {
    const el = shipRefs.current[targetId];
    if (!el) { resolve(); return; }
    const r = el.getBoundingClientRect();
    const toX = r.left + r.width / 2;
    const toY = r.top + r.height / 2;
    // Nuke drops straight from the sky; other rockets fly from bottom-right
    const fromX = weaponId === "nuke" ? toX + (Math.random() - 0.5) * 40 : window.innerWidth - 40;
    const fromY = weaponId === "nuke" ? -120 : window.innerHeight - 80;
    const id = serverNowMs() + Math.random();
    setFx({ id, emoji, fromX, fromY, toX, toY, phase: "fly", friendly, weaponId });
    // whoosh during flight (only for hostile rockets, and not when silent)
    if (!friendly && !silent) sound.play("whoosh");
    const flyMs = weaponId === "nuke" ? 1100 : 850;
    setTimeout(() => {
      setFx((f) => f && f.id === id ? { ...f, phase: "boom" } : f);
      if (!friendly && !silent) {
        sound.play(weaponId === "nuke" ? "nuke" : "explosion");
        const intensity =
          weaponId === "nuke" ? "shake-lg" :
          weaponId === "rocket_large" ? "shake-md" :
          weaponId === "rocket_medium" ? "shake-md" :
          "shake-sm";
        setShake(intensity);
        if (weaponId === "nuke") {
          setTimeout(() => sound.play("explosion"), 600);
          setTimeout(() => sound.play("explosion"), 1200);
          setTimeout(() => setShake(""), 1800);
        } else {
          setTimeout(() => setShake(""), 900);
        }
      } else if (friendly) {
        sound.play("splash");
      }
    }, flyMs);
    const totalMs = weaponId === "nuke" ? 2300 : 1700;
    setTimeout(() => { setFx((f) => (f && f.id === id ? null : f)); resolve(); }, totalMs);
  });


  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const myId = u.user?.id ?? null;
      setMe(myId);
      if (myId) {
        const { data: myProf } = await supabase.from("profiles").select("display_name,protection_until").eq("id", myId).maybeSingle();
        setMyName((myProf as any)?.display_name ?? "");
        setMyProtectionUntil((myProf as any)?.protection_until ?? null);
      }
      const [{ data: prof }, { data: sh }, { data: staffRes }, { data: dragonRow }, { data: marketUnlocked }] = await Promise.all([
        supabase.from("profiles").select(PROFILE_PUBLIC_COLUMNS).eq("id", playerId).maybeSingle(),
        supabase.from("ships_owned").select("*").eq("user_id", playerId).eq("in_storage", false).order("acquired_at", { ascending: true }),
        (supabase as any).rpc("is_staff", { _user_id: playerId }),
        supabase.from("dragons").select("stage").eq("user_id", playerId).maybeSingle(),
        (supabase as any).rpc("is_market_pvp_unlocked", { _user_id: playerId }),
      ]);
      setP((prof as Profile) || null);
      setShips((sh as Ship[]) || []);
      setTargetIsStaff(!!staffRes);
      setTargetMarketUnlocked(marketUnlocked !== false);
      setTheirDragonStage(((dragonRow as any)?.stage as number) ?? 1);

      const destId = (prof as any)?.last_destroyer_id as string | null | undefined;
      if (destId) {
        const { data: dp } = await (supabase as any).rpc("get_profiles_public", { _ids: [destId] });
        const row = (dp || [])[0];
        setDestroyerAvatar(row?.avatar_url || null);
        setDestroyerEmoji(row?.avatar_emoji || null);
      } else {
        setDestroyerAvatar(null); setDestroyerEmoji(null);
      }

      // Load 48h sign history
      try {
        const { data: msgs } = await (supabase as any).rpc("get_destroyer_messages", { _defender_id: playerId });
        setSignMessages((msgs || []) as SignMsg[]);
        setSignIdx(0);
      } catch { setSignMessages([]); }


      if (myId === playerId) setFriendStatus("self");
      else if (myId) {
        const { data: f } = await supabase.from("friends").select("status")
          .or(`and(requester_id.eq.${myId},addressee_id.eq.${playerId}),and(requester_id.eq.${playerId},addressee_id.eq.${myId})`)
          .maybeSingle();
        if (f) setFriendStatus(f.status === "accepted" ? "accepted" : "pending");
      }
      setLoading(false);
    })();
  }, [playerId]);

  // Load raiders currently stealing FROM this player (their ships visible in this harbor)
  const loadRaiders = async () => {
    const { data: rs } = await supabase
      .from("ships_owned")
      .select("id,user_id,catalog_code,template_id,stealing_ends_at,stealing_target_ship_id,fishing_started_at,stealing_started_at")
      .eq("stealing_target_user_id", playerId)
      .not("stealing_ends_at", "is", null);
    const list = (rs ?? []) as { id: string; user_id: string; catalog_code: string | null; template_id: number; stealing_ends_at: string | null; stealing_target_ship_id: string | null; fishing_started_at: string | null; stealing_started_at?: string | null }[];
    if (list.length === 0) { setRaiders([]); return; }
    const ids = Array.from(new Set(list.map((r) => r.user_id)));
    const codes = Array.from(new Set(list.map((r) => r.catalog_code).filter(Boolean) as string[]));
    const [{ data: profs }, { data: cats }] = await Promise.all([
      supabase.from("profiles").select("id,display_name,avatar_emoji").in("id", ids),
      codes.length ? supabase.from("ship_catalog").select("code,fishing_power").in("code", codes) : Promise.resolve({ data: [] as any[] }),
    ]);
    const pmap = new Map((profs ?? []).map((p: any) => [p.id, p]));
    const cmap = new Map((cats ?? []).map((c: any) => [c.code, c.fishing_power]));
    setRaiders(list.map((r) => ({
      ...r,
      fishing_power: Math.max(1, (r.catalog_code && cmap.get(r.catalog_code)) || 5),
      owner_name: pmap.get(r.user_id)?.display_name || "قرصان",
      owner_emoji: pmap.get(r.user_id)?.avatar_emoji || "🏴‍☠️",
    })));
  };

  // Load crews currently assigned to this player's ships (visible to all visitors)
  const loadPlayerCrews = async () => {
    const { data } = await (supabase as any).rpc("get_player_crews", { _player_id: playerId });
    setPlayerCrews((data ?? []) as { item_id: string; ship_id: string }[]);
  };
  useEffect(() => {
    if (!playerId) return;
    loadPlayerCrews();
    // The 4s backstop poll below already calls loadPlayerCrews — no extra interval needed.
  }, [playerId]);

  // Live broadcast channel: every spectator in THIS harbor joins, so any action
  // (rocket, support, repair) is mirrored to every spectator in real-time.
  const harborChanRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const clientIdRef = useRef<string>(Math.random().toString(36).slice(2));

  // Refetch visited player's ships from DB (realtime backstop).
  const reloadShipsRef = useRef<() => Promise<void>>(async () => {});
  reloadShipsRef.current = async () => {
    if (!playerId) return;
    const { data } = await supabase
      .from("ships_owned")
      .select("*")
      .eq("user_id", playerId)
      .eq("in_storage", false)
      .order("acquired_at", { ascending: true });
    const fresh = (data as Ship[]) || [];
    setShips(fresh);
    setSelectedShip((cur) => (cur ? (fresh.find((s) => s.id === cur.id) ?? null) : cur));
  };

  // Live updates: watch the visited player's ships AND any raiders attacking them
  useEffect(() => {
    if (!playerId) return;
    loadRaiders();
    const channel = supabase
      .channel(`ships-watch:${playerId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ships_owned", filter: `user_id=eq.${playerId}` },
        (payload) => {
          setShips((arr) => {
            if (payload.eventType === "INSERT") {
              const r = payload.new as Ship;
              if (r.in_storage) return arr;
              if (arr.some((x) => x.id === r.id)) return arr;
              return [...arr, r];
            }
            if (payload.eventType === "DELETE") {
              const r = payload.old as { id: string };
              return arr.filter((x) => x.id !== r.id);
            }
            const r = payload.new as Ship;
            if (r.in_storage) return arr.filter((x) => x.id !== r.id);
            return arr.map((x) => (x.id === r.id ? { ...x, ...r } : x));
          });
          setSelectedShip((cur) => {
            if (!cur) return cur;
            if (payload.eventType === "DELETE") {
              const r = payload.old as { id: string };
              return cur.id === r.id ? null : cur;
            }
            const r = payload.new as Ship;
            return cur.id === r.id ? { ...cur, ...r } : cur;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ships_owned" },
        () => { loadRaiders(); }
      )
      .subscribe();

    // Backstop: realtime + focus already cover most cases — poll slowly to save CPU
    const poll = window.setInterval(() => { reloadShipsRef.current(); loadRaiders(); loadPlayerCrews(); }, 10000);
    const onVis = () => { if (document.visibilityState === "visible") { reloadShipsRef.current(); loadRaiders(); } };
    const onFocus = () => { reloadShipsRef.current(); loadRaiders(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);

    // Shared broadcast channel — every viewer of this harbor sees every action live
    const myCid = clientIdRef.current;
    const harborChan = supabase.channel(`harbor:${playerId}`, { config: { broadcast: { self: false } } });
    harborChan.on("broadcast", { event: "fx" }, ({ payload }) => {
      const d = payload as { cid: string; targetId: string; emoji: string; friendly?: boolean; weaponId?: string; toast?: string };
      if (!d || d.cid === myCid) return;
      playProjectile(d.targetId, d.emoji, !!d.friendly, d.weaponId);
      if (d.toast) flash(d.toast);
    });
    harborChan.on("broadcast", { event: "raid" }, () => { loadRaiders(); });
    // Instant state push from the harbor owner (fishing toggle, collect, etc.)
    harborChan.on("broadcast", { event: "state" }, () => {
      reloadShipsRef.current();
      loadRaiders();
      loadPlayerCrews();
    });
    harborChan.subscribe();
    harborChanRef.current = harborChan;

    // Watch profile updates (death banner, bg burn, etc.) live
    const profCh = supabase
      .channel(`profile-watch:${playerId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${playerId}` },
        (payload) => {
          const r = payload.new as Partial<Profile>;
          setP((cur) => cur ? { ...cur, ...r } : cur);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(harborChan);
      supabase.removeChannel(profCh);
      harborChanRef.current = null;
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
    };
  }, [playerId]);


  // Broadcast helpers — share an action with every spectator in this harbor
  const broadcastFx = (data: { targetId: string; emoji: string; friendly?: boolean; weaponId?: string; toast?: string }) => {
    const ch = harborChanRef.current;
    if (!ch) return;
    try { ch.send({ type: "broadcast", event: "fx", payload: { cid: clientIdRef.current, ...data } }); } catch { /* ignore */ }
  };
  const broadcastRaid = () => {
    const ch = harborChanRef.current;
    if (!ch) return;
    try { ch.send({ type: "broadcast", event: "raid", payload: { cid: clientIdRef.current } }); } catch { /* ignore */ }
  };

  // Live ticker for raider counters (fish stolen so far + countdown)
  useEffect(() => {
    if (raiders.length === 0) return;
    const id = window.setInterval(() => setNowTs(serverNowMs()), 1000);
    return () => window.clearInterval(id);
  }, [raiders.length]);

  const stopRaid = async (shipId: string) => {
    setCancelRaiderId(null);
    sound.play("click");
    const { data, error } = await (supabase as any).rpc("cancel_steal_mission", { _attacker_ship_id: shipId });
    if (error) { flash("تعذّر إيقاف السرقة"); return; }
    sound.play("success");
    const row = Array.isArray(data) && data[0] ? data[0] : null;
    const n = row?.stolen_count ?? 0;
    const v = row?.total_value ?? 0;
    if (n > 0) flash(`🛑 أوقفت السرقة — رجعت سفينة اللص ومعها ${n} سمكة (قيمتها ${v})`);
    else flash("🛑 أوقفت السرقة — ما فيه غنيمة متاحة الآن");
    loadRaiders();
    broadcastRaid();
  };


  const addFriend = async () => {
    if (!me) { flash("سجّل دخول أولاً"); return; }
    sound.play("click");
    const { error } = await supabase.from("friends").insert({
      requester_id: me, addressee_id: playerId, status: "pending",
    });
    if (error) flash("تعذّر الإرسال");
    else { setFriendStatus("pending"); sound.play("success"); flash("تم إرسال طلب الصداقة ✓"); }
  };

  // If my armor is still active, warn before any offensive action.
  // Confirming clears protection_until immediately (server-side).
  const confirmDropArmorIfActive = async (): Promise<boolean> => {
    if (!me) return true;
    const until = myProtectionUntil ? new Date(myProtectionUntil).getTime() : 0;
    if (until <= serverNowMs()) return true;
    const ok = window.confirm(
      "⚠️ تحذير: درعك مفعّل. لو هاجمت أو سرقت الحين، الدرع راح ينفك منك ولازم تشتري درع جديد. هل تكمل؟"
    );
    if (!ok) return false;
    const { error } = await (supabase as any).rpc("drop_my_protection");
    if (error) { flash("تعذّر إزالة الدرع"); return false; }
    setMyProtectionUntil(null);
    return true;
  };

  const fireWeapon = async (weaponId: string) => {
    if (!me || !selectedShip) return;
    const w = WEAPONS.find((x) => x.id === weaponId);
    if (!w) return;
    // Block ALL attacks (every weapon) while any of my ships is on an active steal mission.
    if (myShips.some((s) => s.stealing_ends_at && new Date(s.stealing_ends_at).getTime() > serverNowMs())) {
      sound.play("error");
      flash("🏴‍☠️ ممنوع الهجوم وأنت تسرق — انتظر رجوع سفينة السرقة أو ألغِها");
      return;
    }
    if (!(await confirmDropArmorIfActive())) return;
    // Server-side rate limit (also logs spam to cheat_flags)
    if (!(await rateLimit("attack", 800))) {
      sonnerToast.warning("تمهّل قليلاً قبل المحاولة مجدداً");
      return;
    }
    setBusy(true); sound.play("click");

    // Close the entire ship menu so player sees the ships + projectile + impact.
    setMode(null);
    setSelectedShip(null);

    // ─── NUKE: use server RPC that destroys all target ships in one shot ───
    if (weaponId === "nuke") {
      const { data: nukeRes, error: nukeErr } = await (supabase as any).rpc("launch_nuke", { _target_id: playerId });
      if (nukeErr) {
        const m = String(nukeErr.message || "");
        setBusy(false);
        if (m.includes("attacker market level under 6")) { sound.play("error"); flash("🏪 لازم ترفع سوق سفنك للمستوى 6 قبل الهجوم"); return; }
        if (m.includes("attacker has destroyed ship")) { sound.play("error"); flash("🛠️ عندك سفينة مدمّرة — صلّحها قبل الهجوم"); return; }
        if (m.includes("attacker needs pvp fleet")) { sound.play("error"); flash("🚫 تحتاج 3 سفن من المستوى 6 فأعلى للهجوم"); return; }
        if (m.includes("attacker needs fishing ship")) { sound.play("error"); flash("🎣 لازم سفنك الـ3 كلها تكون في وضع الصيد قبل الهجوم"); return; }
        if (m.includes("no nuke")) { sound.play("error"); flash("☢️ ما عندك قنبلة نووية"); return; }
        if (m.includes("market level under 6")) { sound.play("error"); flash("🛡️ اللاعب محمي — سوقه أقل من المستوى 6"); return; }
        if (m.includes("protected") || m.includes("staff account")) { sound.play("error"); flash("🛡️ الخصم محمي — لا يمكن الهجوم"); return; }
        sound.play("error"); flash(`تعذّر الإطلاق: ${m.slice(0, 60)}`); return;
      }
      // Consume the nuke locally (server already consumed it).
      setInv((arr) => arr
        .map((x) => x.item_id === "nuke" && x.item_type === "weapon" ? { ...x, quantity: x.quantity - 1 } : x)
        .filter((x) => x.quantity > 0));
      // BLOCKED by anti-nuke: server returned NULL. No destruction, no banner, no broadcast.
      if (nukeRes === null || nukeRes === undefined) {
        sound.play("error");
        flash(`🛡️ مضاد ${p?.display_name || "الخصم"} صدّ قنبلتك الذرية!`);
        setBusy(false);
        return;
      }
      sound.play("nuke");
      burnTargetBg(playerId).catch(() => {});
      setP((cur) => cur ? { ...cur, bg_burned_until: new Date(serverNowMs() + 7 * 24 * 3600_000).toISOString() } : cur);
      const nowIso = serverNow().toISOString();
      setShips((arr) => arr.map((s) => ({ ...s, hp: 0, destroyed_at: s.destroyed_at ?? nowIso, repair_ends_at: s.repair_ends_at ?? new Date(serverNowMs() + 4 * 3600_000).toISOString(), at_sea: false })));
      setShake("shake-lg");
      setTimeout(() => sound.play("explosion"), 600);
      setTimeout(() => sound.play("explosion"), 1200);
      setTimeout(() => setShake(""), 1800);
      sound.play("success");
      flash(`☢️ تم تدمير كل سفن ${p?.display_name || "اللاعب"}!`);
      setBusy(false);
      setTimeout(() => { setNukeMsg(""); setNukeMsgOpen(true); }, 2000);
      return;
    }


    // Single-target weapons (non-nuke)
    const aliveShips = ships.filter((s) => (!s.destroyed_at || (s.repair_ends_at && new Date(s.repair_ends_at).getTime() <= serverNowMs())));
    const targets = w.aoe ? (aliveShips.length ? aliveShips : ships) : [selectedShip];

    // Dragon attack bonus
    const boostedDamage = applyDragonAttack(w.damage, myDragonLvl);

    const firstTarget = targets[0];
    const skipFishing = false;
    const { data: firstRes, error: firstErr } = await (supabase as any).rpc("apply_ship_damage_v2", { _ship_id: firstTarget.id, _weapon_id: w.id, _skip_fishing_check: skipFishing });
    if (firstErr) {
      const m = String(firstErr.message || "");
      if (m.includes("attacker market level under 6")) { sound.play("error"); flash("🏪 لازم ترفع سوق سفنك للمستوى 6 قبل الهجوم"); setBusy(false); return; }
      if (m.includes("attacker has destroyed ship")) { sound.play("error"); flash("🛠️ عندك سفينة مدمّرة — صلّحها قبل الهجوم"); setBusy(false); return; }
      if (m.includes("attacker needs pvp fleet")) { sound.play("error"); flash("🚫 تحتاج 3 سفن من المستوى 6 فأعلى للهجوم"); setBusy(false); return; }
      if (m.includes("attacker needs fishing ship")) { sound.play("error"); flash("🎣 لازم سفنك الـ3 كلها تكون في وضع الصيد قبل الهجوم"); setBusy(false); return; }
      if (m.includes("market level under 6")) { sound.play("error"); flash("🛡️ اللاعب محمي — سوق سفنه أقل من المستوى 6"); setBusy(false); return; }
      if (m.includes("protected")) { sound.play("error"); flash("🛡️ الخصم محمي بالدرع — لا يمكن الهجوم"); setBusy(false); return; }
      sound.play("error"); flash(`تعذّر الهجوم: ${m.slice(0, 60)}`); setBusy(false); return;
    }

    // BLOCKED by anti-rocket: server sets blocked=true and applied no damage. Stop here — no FX, no weapon consume.
    const firstRow: any = Array.isArray(firstRes) && firstRes[0] ? firstRes[0] : null;
    if (firstRow?.blocked === true) {
      sound.play("error");
      flash(`🛡️ مضاد ${p?.display_name || "الخصم"} صدّ ${w.name}!`);
      setBusy(false);
      return;
    }

    // Validation passed — now consume the weapon and run FX/damage for all targets.
    await consumeItem(weaponId, "weapon");



    // For nuke (AOE): burn the target's background FIRST so it always lands,
    // even if any per-ship damage call fails. Update local view immediately.
    if (weaponId === "nuke") {
      burnTargetBg(playerId).catch((e) => console.error("burn_target_bg failed", e));
      setP((cur) => cur ? { ...cur, bg_burned_until: new Date(serverNowMs() + 7 * 24 * 3600_000).toISOString() } : cur);
    }

    // For AOE: fire damage RPCs for ALL remaining targets WITHOUT awaiting,
    // so a slow/stuck RPC can never freeze the UI. We use optimistic HP=0
    // for nuke (it always one-shots everything anyway).
    const damageResults: Array<{ new_hp: number; repair_ends_at: string | null } | null> = new Array(targets.length).fill(null);
    if (Array.isArray(firstRes) && firstRes[0]) damageResults[0] = firstRes[0];
    if (w.aoe && targets.length > 1) {
      targets.slice(1).forEach((t) => {
        (supabase as any)
          .rpc("apply_ship_damage_v2", { _ship_id: t.id, _weapon_id: w.id, _skip_fishing_check: skipFishing })
          .then(undefined, (e: any) => { console.error("apply_ship_damage_v2 failed", e); });
      });
    }

    // For AOE (nuke): one explosion + sound for all ships simultaneously.
    if (w.aoe) {
      sound.play("whoosh");
      setTimeout(() => {
        sound.play(w.id === "nuke" ? "nuke" : "explosion");
        setShake(w.id === "nuke" ? "shake-lg" : "shake-md");
        if (w.id === "nuke") {
          setTimeout(() => sound.play("explosion"), 600);
          setTimeout(() => sound.play("explosion"), 1200);
          setTimeout(() => setShake(""), 1800);
        } else {
          setTimeout(() => setShake(""), 900);
        }
      }, w.id === "nuke" ? 1100 : 850);
      // Fire visual FX on all ships in parallel (silent — global sound above).
      // Don't await — let it run; we proceed immediately so UI never blocks.
      targets.forEach((t) => {
        broadcastFx({ targetId: t.id, emoji: w.emoji, friendly: false, weaponId: w.id, toast: `💥 ${myName || "لاعب"} ضرب بـ ${w.name}` });
        playProjectile(t.id, w.emoji, false, w.id, true).catch(() => {});
      });
      // Record results for all targets (fire-and-forget) — nuke one-shots everything
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        const row: any = damageResults[i];
        const newHp = row?.new_hp ?? 0;
        const repEnds = row?.repair_ends_at ?? null;
        const oldHp = t.hp ?? 0;
        const actualDamage = Math.max(0, oldHp - newHp);
        recordAttackWithRetry({
          _defender_id: playerId, _target_ship_id: t.id,
          _damage: boostedDamage, _damage_dealt: actualDamage, _attacker_won: true,
          _xp_gain: w.xp ?? 0,
        }, { onFinalFail: () => flash("⚠️ تعذّر تسجيل الهجوم — قد لا يصل التنبيه للخصم") });
        // PvP لا يمنح نقاط تنين — DP فقط من البوس

        (supabase as any).rpc("award_arena_score", { p_score: actualDamage, p_won: true }).then(undefined, () => {});

        setShips((arr) => arr.map((x) => x.id === t.id ? { ...x, hp: newHp, destroyed_at: serverNow().toISOString(), repair_ends_at: repEnds ?? x.repair_ends_at } : x));
      }
    } else {
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        broadcastFx({ targetId: t.id, emoji: w.emoji, friendly: false, weaponId: w.id, toast: `💥 ${myName || "لاعب"} ضرب بـ ${w.name}` });
        await playProjectile(t.id, w.emoji, false, w.id);
        let row: any = damageResults[i];
        if (!row && i > 0) {
          const { data: dmgRes } = await (supabase as any).rpc("apply_ship_damage_v2", { _ship_id: t.id, _weapon_id: w.id, _skip_fishing_check: skipFishing });
          row = Array.isArray(dmgRes) && dmgRes[0] ? dmgRes[0] : null;
        }
        const newHp = row?.new_hp ?? Math.max(0, (t.hp ?? 100) - boostedDamage);
        const repEnds = row?.repair_ends_at ?? null;
        const oldHp = t.hp ?? 0;
        const actualDamage = Math.max(0, oldHp - newHp);
        await recordAttackWithRetry({
          _defender_id: playerId, _target_ship_id: t.id,
          _damage: boostedDamage, _damage_dealt: actualDamage, _attacker_won: newHp === 0,
          _xp_gain: w.xp ?? 0,
        }, { onFinalFail: () => flash("⚠️ تعذّر تسجيل الهجوم — قد لا يصل التنبيه للخصم") });
        // PvP لا يمنح نقاط تنين — DP فقط من البوس
        (supabase as any).rpc("award_arena_score", { p_score: actualDamage, p_won: newHp === 0 }).then(undefined, () => {});

        setShips((arr) => arr.map((x) => x.id === t.id ? { ...x, hp: newHp, destroyed_at: newHp === 0 ? serverNow().toISOString() : x.destroyed_at, repair_ends_at: newHp === 0 ? (repEnds ?? x.repair_ends_at) : x.repair_ends_at } : x));
      }
    }



    sound.play("success"); flash(`💥 ${w.name} — ${boostedDamage.toLocaleString()} ضرر 🐉`);
    setBusy(false);
    // After a nuke or ad-bomb, wait for the explosion FX to finish before
    // opening the global broadcast message dialog.
    if (weaponId === "nuke" || weaponId === "ad_bomb") {
      setNukeMsg("");
      const fxDelay = weaponId === "nuke" ? 3200 : 2000;
      setTimeout(() => setNukeMsgOpen(true), fxDelay);
    } else {
      closeMenu();
    }
  };

  const buyAndFire = async (weaponId: string) => {
    if (!me || !selectedShip) return;
    const w = WEAPONS.find((x) => x.id === weaponId);
    if (!w) return;
    if (!(await confirmDropArmorIfActive())) return;
    setBusy(true); sound.play("click");
    const { error } = w.currency === "gems"
      ? await buyWithGems(w.id, "weapon", w.price)
      : await buyWithCoins(w.id, "weapon", w.price);
    if (error) {
      setBusy(false);
      const msg = (error as any).message || "";
      if (msg.includes("insufficient") || msg.includes("not enough")) {
        flash(w.currency === "gems" ? "💎 جواهرك ما تكفي" : "💰 عملاتك ما تكفي");
      } else flash("تعذّر الشراء");
      return;
    }
    // Add to local inventory so fireWeapon's consume works visually
    setInv((arr) => {
      const idx = arr.findIndex((x) => x.item_id === w.id && x.item_type === "weapon");
      if (idx >= 0) {
        const next = [...arr];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...arr, { item_id: w.id, item_type: "weapon", quantity: 1 }];
    });
    sound.play("success");
    flash(`🛒 اشتريت ${w.name} — يطلق الآن!`);
    setBusy(false);
    await fireWeapon(weaponId);
  };

  const submitNukeMessage = async () => {
    const msg = nukeMsg.trim();
    if (msg.length < 20) { flash("الرسالة يجب أن تكون ٢٠ حرف على الأقل"); return; }
    setNukeSending(true);
    const { error } = await (supabase as any).rpc("broadcast_nuke", { _target_id: playerId, _message: msg });
    if (error) { setNukeSending(false); flash("تعذّر إرسال الرسالة"); return; }

    // Broadcast real-time alert to all online players via Supabase channel
    try {
      const channel = supabase.channel("global:nuke");
      await channel.subscribe();
      await channel.send({
        type: "broadcast",
        event: "nuke_alert",
        payload: {
          attacker_name: myName || "لاعب",
          target_name: p?.display_name || "لاعب",
          message: msg,
        } as any,
      });
      await supabase.removeChannel(channel);
    } catch { /* ignore broadcast errors */ }

    setNukeSending(false);
    sound.play("success");
    flash("☢️ تم بث رسالتك لجميع اللاعبين");
    setNukeMsgOpen(false);
    closeMenu();
  };

  const stealWithShip = async (myShipId: string) => {
    if (!me) { flash("سجّل دخول أولاً"); return; }
    if (!selectedShip) { flash("اختر سفينة الخصم أولاً"); return; }
    if (!(await confirmDropArmorIfActive())) return;
    const targetShipId = selectedShip.id;
    setBusy(true); sound.play("click");
    console.log("[steal] start", { myShipId, targetUser: playerId, targetShip: targetShipId });
    // Start a timed steal mission — ship sails to enemy waters and returns later
    const { data: missionRes, error: missionErr } = await (supabase as any).rpc("start_steal_mission", {
      _attacker_ship_id: myShipId,
      _target_user_id: playerId,
      _target_ship_id: targetShipId,
    });
    if (missionErr) {
      console.error("[steal] error", missionErr);
      const msg = missionErr.message || "";
      if (msg.includes("attacker market level under 6")) flash("🏪 لازم ترفع سوق سفنك للمستوى 6 قبل السرقة");
      else if (msg.includes("attacker needs pvp fleet")) flash("🚫 تحتاج 3 سفن من المستوى 6 فأعلى للسرقة");
      else if (msg.includes("no pvp fleet") || msg.includes("market level under 6")) flash("🛡️ اللاعب محمي — سوق سفنه أقل من المستوى 6");
      else if (msg.includes("protected")) flash("🛡️ اللاعب محمي بدرع");
      else if (msg.includes("blocked")) {
        const m = msg.match(/until ([\d\-:.+T ]+)/);
        const until = m ? new Date(m[1]) : null;
        const mins = until ? Math.max(1, Math.ceil((until.getTime() - serverNowMs()) / 60000)) : 60;
        flash(`🚫 ممنوع من السرقة (${mins} دقيقة)`);
      }
      else if (msg.includes("protected")) { sound.play("error"); flash("🛡️ الخصم محمي بالدرع — ممنوع السرقة"); }
      else if (msg.includes("not fishing")) flash("🎣 لازم سفينة الخصم تكون تصيد فعلاً");
      else if (msg.includes("caught by police")) { sound.play("explosion"); flash("👮 قبض عليك الشرطي! ممنوع من السرقة ساعة"); }
      else if (msg.includes("busy")) flash("⚓ سفينتك مشغولة — اختر سفينة بالميناء");
      else if (msg.includes("repair")) flash("🛠️ سفينتك تحت الإصلاح");
      else if (msg.includes("destroyed")) flash("💥 السفينة مدمّرة");
      else if (msg.includes("self")) flash("ما تقدر تسرق نفسك");
      else if (msg.includes("attacker ship not found")) flash("ما لقيت سفينتك");
      else if (msg.includes("target ship")) flash("سفينة الخصم غير متاحة");
      else flash(`تعذّر بدء السرقة: ${msg.slice(0, 60)}`);
    } else {
      console.log("[steal] success", missionRes);
      const ends = Array.isArray(missionRes) && missionRes[0]?.ends_at ? new Date(missionRes[0].ends_at) : null;
      const secs = ends ? Math.max(0, Math.round((ends.getTime() - serverNowMs()) / 1000)) : 0;
      sound.play("success");
      flash(`🏴‍☠️ سفينتك وصلت محيطه وبدأت السرقة — ${secs}ث`);
      setShips((arr) => arr.map((s) => s.id === targetShipId ? { ...s, at_sea: false } : s));
      setSelectedShip((cur) => cur && cur.id === targetShipId ? { ...cur, at_sea: false } : cur);
      loadRaiders();
      reloadShipsRef.current();
      broadcastRaid();
    }
    setBusy(false); closeMenu();
  };

  const sendSupport = async (kind: "crew" | "repair", itemId: string) => {
    if (!me) { flash("سجّل دخول أولاً"); return; }
    if (me === playerId) { flash("ما تقدر ترسل لنفسك — هذي ميزة دعم للاعبين الآخرين"); return; }
    if (!selectedShip) { flash("اختر سفينة أولاً من الأعلى"); return; }
    setBusy(true); sound.play("click");
    flash(kind === "crew" ? "⏳ جاري إرسال الطاقم..." : "⏳ جاري إصلاح السفينة...");
    try {
      const fxEmoji = kind === "crew" ? "👨‍✈️" : "🛠️";
      const { error } = await (supabase as any).rpc("send_support", {
        _recipient_id: playerId,
        _ship_id: selectedShip.id,
        _kind: kind,
        _crew_id: kind === "crew" ? itemId : null,
      });
      if (!error) {
        broadcastFx({ targetId: selectedShip.id, emoji: fxEmoji, friendly: true, toast: kind === "crew" ? `👨‍✈️ ${myName || "لاعب"} أرسل طاقم دعم` : `🛠️ ${myName || "لاعب"} يصلح السفينة` });
        await playProjectile(selectedShip.id, fxEmoji, true);
        if (kind === "crew") {
          setInv((arr) => arr.map((x) => x.item_id === itemId && x.item_type === "crew" ? { ...x, quantity: Math.max(0, x.quantity - 1) } : x).filter((x) => x.quantity > 0));
        }
        if (kind === "crew") loadPlayerCrews();
        const isFixerCrew = kind === "crew" && itemId.startsWith("fixer_");
        if (kind === "repair" || isFixerCrew) {
          await reloadShipsRef.current();
        }
        sound.play("success");
        const isTrader = kind === "crew" && itemId === "trader";
        flash(
          kind === "crew"
            ? (isFixerCrew ? "🛠️ تم إرسال المصلّح — وأصلح سفينته"
              : isTrader ? "💰 التاجر فعّل سوق السمك عنده"
              : "👨‍✈️ تم إرسال الطاقم — يعمل على سفينته")
            : "🛠️ تم إصلاح سفينته بالكامل"
        );

      } else {
        const msg = (error as any).message || "";
        if (msg.includes("no such crew") || msg.includes("sender has no such crew")) flash("ما عندك من هذا الطاقم — اضغط شراء وإرسال");
        else if (msg.includes("already has this crew")) flash("سفينته فيها نفس الطاقم بالفعل");
        else if (msg.includes("already has active trader")) flash("💰 عنده تاجر نشط — انتظر ينتهي");
        else if (msg.includes("sender needs pvp fleet")) flash("🚫 تحتاج 3 سفن مستوى 6+ علشان ترسل دعم");
        else if (msg.includes("recipient is a new player")) flash("🛡️ هذا اللاعب جديد — ما يقدر يستقبل دعم");
        else if (msg.includes("same device")) flash("🚫 ما تقدر ترسل دعم لحساب على نفس الجهاز");
        else if (msg.includes("target ship does not belong")) flash("السفينة المختارة مو لهذا اللاعب");
        else if (msg.includes("banned")) flash("🚫 الحساب محظور");
        else if (msg.includes("not authenticated")) flash("سجّل دخول أولاً");
        else flash(`تعذّر إرسال الدعم: ${msg || "خطأ غير معروف"}`);
      }
    } catch (e) {
      flash(`تعذّر إرسال الدعم: ${(e as Error)?.message || "مشكلة اتصال"}`);
    } finally {
      setBusy(false);
      if (kind !== "crew") closeMenu();
    }
  };


  const buyAndSendCrew = async (crewId: string) => {
    if (!me) { flash("سجّل دخول أولاً"); return; }
    if (!selectedShip) { flash("اختر سفينة أولاً من الأعلى"); return; }
    if (me === playerId) { flash("ما تقدر ترسل لنفسك — هذي ميزة دعم للاعبين الآخرين"); return; }
    const c = CREWS.find((x) => x.id === crewId);
    if (!c) return;
    setBusy(true); sound.play("click");
    flash(`⏳ شراء ${c.name} ثم إرساله...`);
    try {
      const { error } = c.currency === "gems"
        ? await buyWithGems(c.id, "crew", c.price)
        : await buyWithCoins(c.id, "crew", c.price);
      if (error) {
        setBusy(false);
        const msg = (error as any).message || "";
        if (msg.includes("insufficient") || msg.includes("not enough")) {
          flash(c.currency === "gems" ? "💎 جواهرك ما تكفي" : "💰 عملاتك ما تكفي");
        } else flash("تعذّر الشراء");
        return;
      }
    } catch (e) {
      setBusy(false);
      flash(`تعذّر الشراء: ${(e as Error)?.message || "مشكلة اتصال"}`);
      return;
    }
    setInv((arr) => {
      const idx = arr.findIndex((x) => x.item_id === c.id && x.item_type === "crew");
      if (idx >= 0) {
        const next = [...arr];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...arr, { item_id: c.id, item_type: "crew", quantity: 1 }];
    });
    sound.play("success");
    flash(`🛒 اشتريت ${c.name} — يُرسل الآن!`);
    setBusy(false);
    await sendSupport("crew", crewId);
  };



  if (!loading && !p) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-stone-950 text-amber-300 gap-3">
        <div>لم يتم العثور على اللاعب</div>
        <Link to="/" className="px-4 py-2 rounded-lg bg-amber-600 text-amber-950 font-bold">عودة</Link>
      </div>
    );
  }

  // Privacy: if the visited player is an admin/moderator, render a minimal page
  // (no level, xp, ships, harbor, attack/steal UI). Only name + add friend / message.
  if (!loading && p && targetIsStaff && friendStatus !== "self") {
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-stone-900 to-stone-950 text-amber-100 flex flex-col" dir="rtl">
        <div className="px-3 pb-3 flex items-center gap-2" style={{ paddingTop: "max(1.75rem, calc(env(safe-area-inset-top) + 1.25rem))" }}>
          <Link to="/" className="w-10 h-10 rounded-xl bg-amber-700 border-2 border-amber-300 flex items-center justify-center">↩</Link>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-4 text-center">
          <div className="w-24 h-24 rounded-full bg-gradient-to-b from-sky-400 to-sky-700 flex items-center justify-center text-5xl overflow-hidden border-4 border-amber-400/60 shadow-2xl">
            {p?.avatar_url ? <img src={p.avatar_url} alt="" className="w-full h-full object-cover" /> : (p?.avatar_emoji ?? "🧑‍✈️")}
          </div>
          <div className="text-2xl font-extrabold text-amber-200">{p?.display_name ?? "—"}</div>
          <div className="text-[11px] text-amber-300/70">حساب خاص</div>
        </div>
        <div className="p-3 flex gap-2 border-t border-amber-400/30 bg-stone-900/70">
          {friendStatus === "accepted" ? (
            <>
              <a href={`/chat?dm=${p?.id ?? ""}`} onClick={() => sound.play("click")} className="flex-1 py-3 rounded-xl bg-sky-600 text-white text-center font-bold active:scale-95">💬 مراسلة</a>
              <button className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold active:scale-95">✓ صديق</button>
            </>
          ) : friendStatus === "pending" ? (
            <button disabled className="flex-1 py-3 rounded-xl bg-stone-600 text-white font-bold opacity-70">⏳ طلب صداقة مُرسل</button>
          ) : (
            <>
              <button onClick={addFriend} className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold active:scale-95">+ إضافة صديق</button>
              <a href={`/chat?dm=${p?.id ?? ""}`} onClick={() => sound.play("click")} className="flex-1 py-3 rounded-xl bg-sky-600 text-white text-center font-bold active:scale-95">💬 مراسلة</a>
            </>
          )}
        </div>
        {toast && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-amber-900/95 border border-amber-400 text-amber-100 text-sm font-bold z-50 shadow-xl">{toast}</div>
        )}
      </div>
    );
  }


  const scene = getSceneVisual(p?.selected_bg_id || "onepiece", p?.bg_burned_until);

  const wTop = scene.waterTop ?? 45;
  const wLeft = scene.waterLeft ?? 30;
  const wRight = scene.waterRight ?? 75;
  const wWidth = Math.max(15, wRight - wLeft);
  // Mirror the owner's harbor layout exactly (src/routes/index.tsx)
  const ts = [0.25, 0.5, 0.15];
  const vRange = Math.max(10, 60 - (wTop + 4));
  const hOffsets = [0.05, 0.3, 0.6];
  const seaSide = scene.seaSide ?? "right";

  return (
    <div className={`fixed inset-0 overflow-hidden bg-[#0d2236] ${shake}`} dir="rtl">
      <h1 className="sr-only">زيارة ميناء اللاعب {p?.display_name ?? ""} — Visit Player Harbor</h1>
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {scene.displayVideo ? (
          <SeamlessVideo
            key={`vid-${scene.id}-${scene.burned ? "b" : "c"}`}
            src={scene.displayVideo}
            poster={scene.displayImage}
            className={`absolute inset-0 h-full w-full object-cover pointer-events-none select-none ${scene.burned ? "animate-bg-burned-pulse" : ""}`}
            style={{ objectPosition: scene.objectPosition ?? "center center" }}
            playbackRate={0.7}
          />
        ) : (
          <img
            key={`${scene.id}-${scene.burned ? "burned" : "clean"}`}
            src={scene.displayImage}
            alt={scene.displayName}
            className={`absolute inset-0 h-full w-full object-cover pointer-events-none select-none animate-bg-drift ${scene.burned ? "animate-bg-burned-pulse" : ""}`}
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
        {scene.burned && <div className="absolute inset-0 pointer-events-none animate-burned-glow" />}
      </div>
      <div className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-20"
        style={{ background: "radial-gradient(ellipse at 70% 60%, rgba(255,255,255,0.4) 0%, transparent 50%)" }} />

      <AdBombOverlay targetUserId={playerId} isOwner={me === playerId} onFlash={flash} />
      <AntiBlockBurst defenderId={playerId} />


      {scene.burned && me && me !== playerId && (
        <DraggableRepairBgButton
          storageKey={`repairBgBtnPos:other`}
          label={`إصلاح خلفية ${p?.display_name ?? "اللاعب"}`}
          onRepair={async () => {
            if (!confirm(`إصلاح خلفية ${p?.display_name ?? "اللاعب"} المحترقة مقابل 100 جوهرة؟`)) return;
            const { error } = await (supabase as any).rpc("repair_target_burned_bg", { _target_id: playerId });
            if (error) {
              const msg = String(error.message ?? "");
              if (msg.includes("not enough gems")) flash("💎 تحتاج 100 جوهرة");
              else if (msg.includes("not burned")) flash("الخلفية ليست محترقة");
              else flash("تعذّر الإصلاح");
              return;
            }
            sound.play("success");
            flash("✨ تم إصلاح الخلفية!");
            setP((cur) => cur ? { ...cur, bg_burned_until: null } : cur);
          }}
        />
      )}

      <div className="absolute top-[5.5rem] left-1/2 -translate-x-1/2 z-30 glass-hud rounded-full px-3 py-1 border border-amber-400/40 text-[10px] text-amber-200 font-bold whitespace-nowrap">
        🌅 {scene.displayName}
      </div>


      {/* Animated clouds */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-[5]">
        <div className="absolute text-white/70 text-5xl animate-cloud-drift" style={{ top: "8%", left: "-15%", animationDuration: "60s" }}>☁️</div>
        <div className="absolute text-white/60 text-4xl animate-cloud-drift" style={{ top: "18%", left: "-25%", animationDuration: "85s", animationDelay: "-20s" }}>☁️</div>
        <div className="absolute text-white/80 text-6xl animate-cloud-drift" style={{ top: "3%", left: "-40%", animationDuration: "110s", animationDelay: "-50s" }}>☁️</div>
      </div>

      {/* Animated birds */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-[6]">
        <div className="absolute text-xl animate-bird-fly" style={{ top: "12%", left: "-10%", animationDuration: "22s" }}>🕊️</div>
        <div className="absolute text-base animate-bird-fly" style={{ top: "20%", left: "-15%", animationDuration: "28s", animationDelay: "-8s" }}>🕊️</div>
      </div>

      {/* Dragon — same position as in the player's own ocean (DragonShoreCreature) */}
      <DragonShoreCreature userId={playerId} interactive={false} />




      {/* Their ships floating */}
      {ships.length === 0 && (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-amber-300/70 text-sm z-10 pointer-events-none">
          لا توجد سفن لهذا اللاعب
        </div>
      )}
      {ships.map((s, i) => {
        const img = s.catalog_code ? getShipByCode(s.catalog_code).image : getShipByMarketLevel(s.template_id || 1).image;
        const fixedSlot = scene.shipSlots?.[i % (scene.shipSlots?.length || 1)];
        const top = `${fixedSlot?.top ?? wTop + 4 + ts[i % ts.length] * vRange}%`;
        const scale = fixedSlot?.scale ?? 0.95 + ts[i % ts.length] * 0.42;
        const dockLeft = fixedSlot?.left ?? wLeft + hOffsets[i % hOffsets.length] * wWidth;
        const shipW = 22 * scale;
        void shipW;
        const destroyed = !!s.destroyed_at || (s.hp ?? 1) <= 0;
        // Always render at the base slot position (same layout as owner's home view)
        // so ships never clip off-screen on mobile when "at sea".
        const left = `${dockLeft}%`;
        void seaSide;
        const shipCrews = playerCrews
          .filter((c) => c.ship_id === s.id)
          .map((c) => CREWS.find((x) => x.id === c.item_id))
          .filter((c): c is (typeof CREWS)[number] => !!c && c.id !== "trader");

        return <VisitorShip key={s.id} img={img} top={top} left={`${left}`.includes("%") ? left : `${left}%`} scale={scale} atSea={s.at_sea && !destroyed} idx={i} hp={s.hp ?? 100} maxHp={s.max_hp ?? 100} destroyed={destroyed} repairEndsAt={s.repair_ends_at ?? null} crews={shipCrews} seaSide={seaSide} onRepaired={() => setShips((arr) => arr.map((x) => x.id === s.id ? { ...x, hp: x.max_hp ?? 100, destroyed_at: null, repair_ends_at: null, at_sea: false } : x))} onTap={() => openShip(s)} buttonRef={(el) => { shipRefs.current[s.id] = el; }} />;
      })}

      {/* Raiding ships — pirates currently stealing from this player. Positioned just right of target ship. */}
      {raiders.map((r, i) => {
        const img = r.catalog_code ? getShipByCode(r.catalog_code).image : getShipByMarketLevel(r.template_id || 1).image;
        const tIdx = ships.findIndex((s) => s.id === r.stealing_target_ship_id);
        // Stack multiple raiders that share the same target ship vertically
        const siblings = raiders.filter(
          (x) => x.stealing_target_ship_id && x.stealing_target_ship_id === r.stealing_target_ship_id,
        );
        const sibIdx = Math.max(0, siblings.findIndex((x) => x.id === r.id));
        let top: string; let left: string;
        let raiderScale = 1;
        if (tIdx >= 0) {
          void ships[tIdx];
          const fixedSlot = scene.shipSlots?.[tIdx % (scene.shipSlots?.length || 1)];
          const tTop = fixedSlot?.top ?? wTop + 4 + ts[tIdx % ts.length] * vRange;
          const dockLeft = fixedSlot?.left ?? wLeft + hOffsets[tIdx % hOffsets.length] * wWidth;
          const targetScale = fixedSlot?.scale ?? 1;
          const tShipW = 22 * targetScale;
          raiderScale = targetScale;
          // Keep the raider attached to the target ship, but clamp it inside the visible water band.
          top = `${Math.max(50, Math.min(74, tTop + tShipW * 0.22 + sibIdx * 5))}%`;
          left = `${Math.max(8, Math.min(98, dockLeft + tShipW * 0.58 + 20))}%`;
        } else {
          top = `${wTop + 8 + ((i % 3) * (vRange / 3.2))}%`;
          left = `${wLeft + ((i % 3) * 0.22) * wWidth + 2}%`;
        }
        const isMine = me === r.user_id;
        const endMs = r.stealing_ends_at ? new Date(r.stealing_ends_at).getTime() : 0;
        const startMs = r.stealing_started_at ? new Date(r.stealing_started_at).getTime() : (r.fishing_started_at ? new Date(r.fishing_started_at).getTime() : 0);
        const total = Math.max(1, endMs - startMs);
        const elapsed = Math.max(0, Math.min(total, nowTs - startMs));
        const ratio = total > 0 ? elapsed / total : 0;
        const stolenSoFar = Math.floor(r.fishing_power * ratio);
        const secsLeft = Math.max(0, Math.ceil((endMs - nowTs) / 1000));
        return (
          <div key={`raider-${r.id}`} className="absolute z-20 -translate-x-1/2 -translate-y-1/2" style={{ top, left }}>
            {/* floating fish trail while raid is active */}
            {isMine && secsLeft > 0 && (
              <>
                {["🐟", "🐠", "🦐"].map((e, k) => (
                  <span
                    key={k}
                    className="absolute text-lg pointer-events-none"
                    style={{
                      right: "100%",
                      top: `${10 + k * 18}px`,
                      animation: `fish-steal 1.6s ${k * 0.4}s linear infinite`,
                    }}
                  >{e}</span>
                ))}
              </>
            )}
            <button
              onClick={() => isMine ? setCancelRaiderId(r.id) : flash(`🏴‍☠️ ${r.owner_name} يسرق من هنا`)}
              className="active:scale-95"
            >
              <div className="relative">
                <img src={img} alt="" className="object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)]" style={{ width: `${88 * raiderScale}px`, height: `${88 * raiderScale}px` }} />
                <div className="absolute -top-1 -right-1 text-2xl drop-shadow">🏴‍☠️</div>
                {isMine && (
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-amber-500/95 border border-amber-200 text-[11px] text-stone-900 font-extrabold whitespace-nowrap shadow">
                    🐟 {stolenSoFar} · ⏱ {Math.floor(secsLeft / 60)}:{String(secsLeft % 60).padStart(2, "0")}
                  </div>
                )}
                <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-rose-950/80 border border-rose-400/60 text-[10px] text-rose-100 font-bold whitespace-nowrap">
                  {r.owner_emoji} {isMine ? "سفينتك" : r.owner_name}
                </div>
              </div>
            </button>
          </div>
        );
      })}

      {/* Cancel raid confirmation */}
      {cancelRaiderId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={() => setCancelRaiderId(null)}>
          <div className="w-full max-w-xs glass-hud rounded-2xl border-2 border-rose-400/60 p-4 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="text-center text-amber-100 font-bold">إيقاف السرقة؟</div>
            <div className="text-center text-amber-300/70 text-xs">سترجع سفينة اللص بالغنيمة الحالية فقط</div>
            <div className="flex gap-2">
              <button onClick={() => setCancelRaiderId(null)} className="flex-1 py-2 rounded-xl bg-stone-700 text-stone-200 text-sm">رجوع</button>
              <button onClick={() => stopRaid(cancelRaiderId)} className="flex-1 py-2 rounded-xl bg-rose-600 text-white font-bold">🛑 أوقف</button>
            </div>
          </div>
        </div>
      )}



      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-30 px-2 pb-2 flex items-center gap-2" style={{ paddingTop: "max(1.75rem, calc(env(safe-area-inset-top) + 1.25rem))" }}>
        <Link to="/" onClick={() => sound.play("click")} className="w-10 h-10 rounded-xl bg-amber-700 border-2 border-amber-300 flex items-center justify-center">↩</Link>
        <div className={`flex-1 glass-hud rounded-xl px-3 py-2 flex items-center gap-2 border border-amber-400/50 ${frameById(p?.profile_frame)?.kind === "profile" ? frameById(p?.profile_frame)?.profileClass : ""} ${frameById(p?.profile_frame)?.animClass ?? ""}`}>
          <div className="relative w-12 h-12 shrink-0 flex items-center justify-center">
            <div className="w-10 h-10 rounded-full bg-gradient-to-b from-sky-400 to-sky-700 flex items-center justify-center text-xl overflow-hidden">
              {p?.avatar_url ? <img src={p.avatar_url} alt="" className="w-full h-full object-cover" /> : (p?.avatar_emoji ?? "🧑‍✈️")}
            </div>
            {frameById(p?.avatar_frame)?.imageUrl && (
              <img src={frameById(p?.avatar_frame)?.imageUrl} alt="" className={`absolute inset-0 w-full h-full object-contain pointer-events-none ${frameById(p?.avatar_frame)?.animClass ?? ""}`} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className={`inline-flex max-w-full px-2 py-0.5 text-sm font-bold truncate ${frameById(p?.name_frame)?.kind === "name" ? frameById(p?.name_frame)?.nameClass : "text-amber-200"} ${frameById(p?.name_frame)?.animClass ?? ""}`}>{p?.display_name ?? "…"}</div>
            <div className="text-[10px] text-amber-300/70">المستوى {p?.level ?? "—"} · ⚓ {ships.length} سفن</div>
          </div>
        </div>
      </div>

      {/* Stats row — only XP shown publicly; coins/gems are private */}
      <div className="absolute left-2 right-2 z-30 grid grid-cols-2 gap-2" style={{ top: "calc(max(1.75rem, env(safe-area-inset-top)) + 4.5rem)" }}>
        <Stat icon="⭐" label="XP" value={p?.xp ?? 0} />
        <Stat icon="⚓" label="السفن" value={ships.length} />
      </div>

      {/* Death banner — elegant transparent, minimizable, hideable from settings */}
      {!deathBannerHidden && p?.last_destroyer_name && (p.last_destroyer_kind === "nuke" || p.last_destroyer_kind === "ad_bomb") && (
        <div className="absolute left-2 right-2 z-30 flex justify-center" style={{ top: "calc(max(1.75rem, env(safe-area-inset-top)) + 7.5rem)" }}>
          {deathBannerMin ? (
            <button
              onClick={() => {
                setDeathBannerMin(false);
                try { localStorage.removeItem("death-banner-min"); } catch { /* noop */ }
                sound.play("click");
              }}
              className="pointer-events-auto px-2 py-1 rounded-full backdrop-blur-md bg-black/25 border border-red-400/40 text-red-100/90 text-[11px] font-bold shadow-[0_2px_10px_rgba(0,0,0,0.35)] active:scale-95"
              title="إظهار لافتة الموت"
            >
              {p.last_destroyer_kind === "nuke" ? "☢️" : "📺"} لافتة
            </button>
          ) : (
            <div className="relative max-w-md w-full rounded-xl backdrop-blur-md bg-gradient-to-r from-black/15 via-red-900/20 to-black/15 border border-red-300/30 shadow-[0_4px_18px_rgba(0,0,0,0.35)] px-3 py-1.5 text-center overflow-hidden">
              {/* subtle inner glow */}
              <div className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-b from-white/5 to-transparent" />
              <div className="relative text-red-50/95 font-bold text-[12px] leading-tight tracking-wide drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)] pe-6">
                <span className="opacity-90 me-1">{p.last_destroyer_kind === "nuke" ? "☢️" : "📺"}</span>
                <span className="text-amber-100/90 me-1">لافتة الموت ·</span>
                {p.last_destroyer_id ? (
                  <Link to="/p/$id" params={{ id: p.last_destroyer_id }} onClick={() => sound.play("click")} className="text-amber-300 font-extrabold underline decoration-amber-300/50 active:scale-95">{p.last_destroyer_name}</Link>
                ) : (
                  <span className="text-amber-300 font-extrabold">{p.last_destroyer_name}</span>
                )}
                <span className="ms-1 text-red-50/85">
                  {p.last_destroyer_kind === "nuke" ? "فجّر هذا اللاعب بالقنبلة الذرية" : "فجّر هذا اللاعب بالقنبلة الإعلانية"}
                </span>
              </div>
              <button
                onClick={() => {
                  setDeathBannerMin(true);
                  try { localStorage.setItem("death-banner-min", "1"); } catch { /* noop */ }
                  sound.play("click");
                }}
                className="absolute top-1/2 -translate-y-1/2 end-1 w-5 h-5 rounded-full bg-black/30 hover:bg-black/50 border border-white/20 text-white/80 text-[10px] leading-none flex items-center justify-center active:scale-90"
                title="تصغير"
              >
                −
              </button>
            </div>
          )}
        </div>
      )}

      {/* Ground sign — visible if there's any non-expired message in history (48h). */}
      {signMessages.length > 0 && (
        <button
          type="button"
          onClick={() => { sound.play("click"); setSignIdx(0); setSignOpen(true); }}
          className="absolute z-30 active:scale-95 transition-transform"
          style={{ top: "62%", left: "30%", width: "9%", filter: "drop-shadow(0 6px 8px rgba(0,0,0,0.7))" }}
          aria-label="رسائل المفجّرين"
        >
          <div className="relative w-full" style={{ aspectRatio: "1024 / 1536" }}>
            <img src={woodenSignAsset.url} alt="" className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none" draggable={false} />
            <div className="absolute" style={{ top: "26%", left: "50%", transform: "translateX(-50%)", width: "46%", aspectRatio: "1 / 1" }}>
              <div className="relative w-full h-full rounded-full overflow-hidden ring-2 ring-amber-950 shadow-md bg-amber-100">
                {destroyerAvatar ? (
                  <img src={destroyerAvatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px]">{destroyerEmoji || "🧙"}</div>
                )}
              </div>
            </div>
            <div className="absolute text-amber-100 font-extrabold text-center bg-red-900/90 rounded-full px-1 border border-amber-300/60 shadow"
              style={{ top: "58%", left: "20%", right: "20%", fontSize: "0.4rem" }}>
              {signMessages.length > 1 ? signMessages.length : "☢️"}
            </div>
          </div>
        </button>
      )}

      {/* Sign message modal — parchment scroll style with prev/next history */}
      {signOpen && signMessages.length > 0 && (() => {
        const cur = signMessages[Math.min(signIdx, signMessages.length - 1)];
        const total = signMessages.length;
        const idx = Math.min(signIdx, total - 1);
        const canPrev = idx < total - 1; // older
        const canNext = idx > 0;          // newer
        return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSignOpen(false)}>
          <div className="relative w-full max-w-sm" onClick={(e) => e.stopPropagation()} dir="rtl">
            <div
              className="relative w-full rounded-[14px] p-5 pb-12"
              style={{
                background: "radial-gradient(ellipse at center, #f5ecd6 0%, #e8d9b3 70%, #c9b78a 100%)",
                boxShadow: "0 0 0 6px #1a0e08, 0 0 0 8px #3a2418, 0 20px 40px rgba(0,0,0,0.7)",
                border: "2px solid #6b4423",
                clipPath: "polygon(0% 4%, 3% 0%, 8% 3%, 14% 1%, 22% 4%, 30% 0%, 38% 3%, 48% 1%, 58% 4%, 68% 0%, 78% 3%, 88% 1%, 96% 4%, 100% 8%, 98% 18%, 100% 30%, 97% 42%, 100% 56%, 98% 70%, 100% 82%, 97% 92%, 92% 100%, 82% 97%, 70% 100%, 56% 97%, 42% 100%, 30% 97%, 18% 100%, 8% 97%, 2% 92%, 0% 80%, 3% 68%, 0% 54%, 2% 40%, 0% 28%, 3% 16%)",
              }}
            >
              <button
                onClick={() => setSignOpen(false)}
                className="absolute -top-2 -left-2 w-10 h-10 rounded-full flex items-center justify-center text-white text-xl font-black shadow-lg active:scale-95 z-10"
                style={{ background: "radial-gradient(circle at 30% 30%, #c97a3a, #6b3a18)", border: "2px solid #2a1408" }}
                aria-label="إغلاق"
              >
                ✕
              </button>

              <div className="text-center text-stone-900 font-extrabold text-lg mb-4 mt-1">
                {cur.attacker_name || "لاعب"}
              </div>

              <div className="flex items-center gap-2 min-h-[140px]">
                <button
                  onClick={() => { if (canPrev) { sound.play("click"); setSignIdx(idx + 1); } }}
                  disabled={!canPrev}
                  className="shrink-0 w-8 h-10 text-stone-800 disabled:opacity-30 active:scale-95 text-2xl"
                  aria-label="السابق"
                >◀</button>
                <div className="flex-1 text-center text-stone-900 font-bold leading-relaxed px-1 whitespace-pre-wrap break-words" style={{ fontSize: "1rem" }}>
                  {cur.message}
                </div>
                <button
                  onClick={() => { if (canNext) { sound.play("click"); setSignIdx(idx - 1); } }}
                  disabled={!canNext}
                  className="shrink-0 w-8 h-10 text-stone-800 disabled:opacity-30 active:scale-95 text-2xl"
                  aria-label="التالي"
                >▶</button>
              </div>

              <div className="absolute bottom-3 left-5 right-5 flex items-center justify-between text-stone-800 text-xs font-bold">
                <span dir="ltr">
                  {new Date(cur.created_at).toLocaleString("ar", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span>{idx + 1}/{total}</span>
                <span className="opacity-0">.</span>
              </div>
            </div>
          </div>
        </div>
        );
      })()}






      <div className="absolute bottom-0 left-0 right-0 z-30 p-3 flex gap-2 glass-hud border-t border-amber-400/40">
        {friendStatus === "self" ? (
          <Link to="/profile" className="flex-1 py-3 rounded-xl bg-amber-600 text-amber-950 text-center font-bold active:scale-95">⚙️ هذا أنت — حرّر الملف</Link>
        ) : friendStatus === "accepted" ? (
          <>
            <a href={`/chat?dm=${p?.id ?? ""}`} onClick={() => sound.play("click")} className="flex-1 py-3 rounded-xl bg-sky-600 text-white text-center font-bold active:scale-95">💬 مراسلة</a>
            <button className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold active:scale-95">✓ صديق</button>
          </>
        ) : friendStatus === "pending" ? (
          <button disabled className="flex-1 py-3 rounded-xl bg-stone-600 text-white font-bold opacity-70">⏳ طلب صداقة مُرسل</button>
        ) : (
          <>
            <button onClick={addFriend} className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold active:scale-95">+ إضافة صديق</button>
            <a href={`/chat?dm=${p?.id ?? ""}`} onClick={() => sound.play("click")} className="flex-1 py-3 rounded-xl bg-sky-600 text-white text-center font-bold active:scale-95">💬 مراسلة</a>
          </>
        )}
      </div>

      {/* Ship action menu — multi-step */}
      {selectedShip && mode !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => !busy && closeMenu()}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm glass-hud rounded-2xl border-2 border-amber-400/60 p-4 flex flex-col gap-3 max-h-[80vh] overflow-y-auto">
            <div className="text-center">
              <div className="text-amber-200 font-bold text-base">سفينة {p?.display_name ?? ""}</div>
              <div className="text-amber-300/70 text-xs mt-0.5">مستوى {selectedShip.template_id} · ❤️ {selectedShip.hp ?? "-"}/{selectedShip.max_hp ?? "-"}</div>
              <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border"
                style={
                  (selectedShip.destroyed_at || (selectedShip.hp ?? 1) <= 0)
                    ? { background: "rgba(127,29,29,0.4)", borderColor: "rgba(248,113,113,0.5)", color: "#fecaca" }
                    : selectedShip.at_sea
                      ? { background: "rgba(6,78,59,0.4)", borderColor: "rgba(52,211,153,0.5)", color: "#a7f3d0" }
                      : { background: "rgba(120,53,15,0.4)", borderColor: "rgba(251,191,36,0.5)", color: "#fde68a" }
                }>
                {(selectedShip.destroyed_at || (selectedShip.hp ?? 1) <= 0)
                  ? "💀 مدمّرة — قيد الإصلاح"
                  : selectedShip.at_sea
                    ? "🎣 تصيد في البحر"
                    : "⚓ راسية في المرسى"}
              </div>
            </div>

            {mode === "menu" && (() => {
              // "dead" = ship still in early repair (<30%) — past 30% it's fishing and attackable
              const targetDead = isShipStillDown(selectedShip.destroyed_at, selectedShip.repair_ends_at, (selectedShip as any).hp, (selectedShip as any).max_hp);
              const targetFishing = selectedShip.at_sea && !targetDead;
              const myPvpCount = myShips.filter((s) => (s.template_id ?? 0) >= 6).length;
              const myPvpReady = myPvpCount >= 3;
              const targetProtected = !targetMarketUnlocked;
              const targetShieldedUntil = (p as any)?.protection_until ? new Date((p as any).protection_until).getTime() : 0;
              const targetShielded = targetShieldedUntil > serverNowMs();
              const blockReason = targetShielded
                ? "🛡️ الخصم محمي بدرع — لا يمكن الهجوم"
                : !myPvpReady
                  ? `🚫 تحتاج 3 سفن مستوى 6+ (${myPvpCount}/3)`
                  : targetProtected
                    ? "🛡️ الخصم محمي — سوقه أقل من المستوى 6"
                    : null;
              const attackDisabled = busy || targetDead || !!blockReason;
              const stealDisabled = busy || !targetFishing || !!blockReason;

              return (
              <>
                {blockReason && (
                  <div className="text-center text-[11px] text-rose-200 bg-rose-900/40 border border-rose-700/40 rounded-lg py-2 px-2">{blockReason}</div>
                )}
                <button aria-label="هجوم على سفينة اللاعب" disabled={attackDisabled} onClick={() => setMode("weapon")} className="py-3 rounded-xl bg-gradient-to-b from-red-500 to-red-700 text-white font-bold active:scale-95 disabled:opacity-40">⚔️ هجوم {targetDead && <span className="text-[10px] opacity-80">(مدمّرة)</span>}</button>
                <button aria-label="سرقة سفينة اللاعب" disabled={stealDisabled} onClick={() => setMode("myship")} className="py-3 rounded-xl bg-gradient-to-b from-amber-500 to-amber-700 text-amber-50 font-bold active:scale-95 disabled:opacity-40">🗡️ سرقة {!targetFishing && !blockReason && <span className="text-[10px] opacity-80">({targetDead ? "مدمّرة" : "لازم تكون تصيد"})</span>}</button>
                <button aria-label="دعم وإصلاح سفينة اللاعب" disabled={busy} onClick={() => setMode("support")} className="py-3 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-700 text-white font-bold active:scale-95">🛠️ دعم / إصلاح</button>
                <button aria-label="إلغاء وإغلاق القائمة" onClick={closeMenu} className="py-2 rounded-xl bg-stone-700 text-stone-200 text-sm">إلغاء</button>
              </>
              );
            })()}

            {mode === "weapon" && (
              <>
                <div className="text-amber-200 text-xs font-bold">اختر صاروخ من مخزنك:</div>
                {WEAPONS.map((w) => {
                  const q = inv.find((x) => x.item_id === w.id && x.item_type === "weapon")?.quantity ?? 0;
                  if (w.id === "ad_bomb") {
                    const canFire = q > 0;
                    return (
                      <div key={w.id} className="flex items-stretch gap-2">
                        <button disabled={busy || !canFire} onClick={() => {
                          // Open the ad video picker (server enforces all rules)
                          setMode("ad_bomb");
                        }}

                          className="flex-1 flex items-center gap-3 p-3 rounded-xl bg-gradient-to-b from-fuchsia-900/80 to-purple-900/80 border border-fuchsia-500/40 active:scale-95 disabled:opacity-40 text-right">
                          <span className="text-3xl">{w.emoji}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-fuchsia-100 font-bold text-sm">{w.name}</div>
                            <div className="text-[10px] text-fuchsia-300/80">
                              {canFire ? w.desc : "🎟️ تتوفر فقط عبر كود شحن من الإدارة"}
                            </div>
                          </div>
                          <div className="text-xs text-fuchsia-200 font-bold tabular-nums">×{q}</div>
                        </button>
                      </div>
                    );
                  }
                  const canFire = q > 0;
                  return (
                    <div key={w.id} className="flex items-stretch gap-2">
                      <button disabled={busy || !canFire} onClick={() => fireWeapon(w.id)}
                        className="flex-1 flex items-center gap-3 p-3 rounded-xl bg-stone-800/80 border border-amber-700/40 active:scale-95 disabled:opacity-40 text-right">
                        {w.image ? <img src={w.image} alt={w.name} className="w-10 h-10 object-contain drop-shadow" /> : <span className="text-3xl">{w.emoji}</span>}
                        <div className="flex-1 min-w-0">
                          <div className="text-amber-200 font-bold text-sm">{w.name}</div>
                          <div className="text-[10px] text-amber-300/70">
                            ضرر {w.damage.toLocaleString()}{w.aoe ? " · يصيب الكل" : ""}
                          </div>
                        </div>
                        <div className="text-xs text-amber-400 font-bold tabular-nums">×{q}</div>
                      </button>
                      {!canFire && (
                        <button disabled={busy} onClick={() => buyAndFire(w.id)}
                          className="px-3 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-700 text-white text-[11px] font-extrabold active:scale-95 disabled:opacity-40 flex flex-col items-center justify-center min-w-[78px] leading-tight">
                          <span>🛒 شراء</span>
                          <span className="text-[10px] opacity-90 mt-0.5">
                            {w.currency === "gems" ? `💎 ${w.price}` : `💰 ${w.price.toLocaleString()}`}
                          </span>
                          <span className="text-[9px] opacity-80">واستخدم</span>
                        </button>
                      )}
                    </div>
                  );
                })}
                <button onClick={() => setMode("menu")} className="py-2 rounded-xl bg-stone-700 text-stone-200 text-sm">رجوع</button>
              </>
            )}

            {mode === "ad_bomb" && (
              <>
                <div className="text-fuchsia-200 text-xs font-bold">اختر الفيديو الإعلاني (يستمر ساعة على محيط الخصم):</div>
                {AD_VIDEOS.map((v) => (
                  <button
                    key={v.key}
                    disabled={busy}
                    onClick={async () => {
                      if (myShips.some((s) => s.stealing_ends_at && new Date(s.stealing_ends_at).getTime() > serverNowMs())) {
                        sound.play("error");
                        flash("🏴‍☠️ ممنوع الهجوم وأنت تسرق — انتظر رجوع سفينة السرقة أو ألغِها");
                        return;
                      }
                      if (!(await confirmDropArmorIfActive())) return;
                      setBusy(true); sound.play("click");
                      // Close the picker so the explosion will be visible — but DO NOT play FX yet.
                      setMode(null);
                      setSelectedShip(null);
                      // ─── Validate FIRST on the server (same rules as other weapons) ───
                      const { data: adRes, error } = await (supabase as never as { rpc: (n: string, p: object) => Promise<{ data: string | null; error: { message: string } | null }> })
                        .rpc("launch_ad_bomb", { _target_id: playerId, _video_key: v.key });
                      if (error) {
                        const m = error.message || "";
                        setBusy(false);
                        if (m.includes("attacker market level under 6")) { sound.play("error"); flash("🏪 لازم ترفع سوق سفنك للمستوى 6 قبل الهجوم"); return; }
                        if (m.includes("attacker has destroyed ship")) { sound.play("error"); flash("🛠️ عندك سفينة مدمّرة — صلّحها قبل الهجوم"); return; }
                        if (m.includes("attacker needs pvp fleet")) { sound.play("error"); flash("🚫 تحتاج 3 سفن من المستوى 6 فأعلى للهجوم"); return; }
                        if (m.includes("attacker needs fishing ship")) { sound.play("error"); flash("🎣 لازم سفنك الـ3 كلها تكون في وضع الصيد قبل الهجوم"); return; }
                        if (m.includes("no ad_bomb")) { sound.play("error"); flash("🎟️ ما عندك قنبلة إعلانية — احصل عليها بكود شحن"); return; }
                        if (m.includes("market level under 6")) { sound.play("error"); flash("🛡️ اللاعب محمي — سوق سفنه أقل من المستوى 6"); return; }
                        if (m.includes("protected")) { sound.play("error"); flash("🛡️ الخصم محمي بالدرع"); return; }
                        if (m.includes("cannot target self")) { sound.play("error"); flash("❌ لا يمكن استهداف نفسك"); return; }
                        sound.play("error"); flash(`تعذّر الإطلاق: ${m.slice(0, 60)}`); return;
                      }
                      // Consume the ad_bomb locally — server already consumed it (even on block).
                      setInv((arr) => arr
                        .map((x) => x.item_id === "ad_bomb" && x.item_type === "weapon" ? { ...x, quantity: x.quantity - 1 } : x)
                        .filter((x) => x.quantity > 0));
                      // BLOCKED by anti-ad-bomb: no ad video, no destruction, no broadcast.
                      if (adRes === null || adRes === undefined) {
                        sound.play("error");
                        flash(`🛡️ مضاد ${p?.display_name || "الخصم"} صدّ قنبلتك الإعلانية!`);
                        setBusy(false);
                        return;
                      }
                      // ─── Success: now play FX + apply local view ───
                      try { window.dispatchEvent(new CustomEvent("ad-bomb:created")); } catch { /* noop */ }

                      sound.play("nuke");
                      const cx = window.innerWidth / 2;
                      const cy = window.innerHeight / 2;
                      setFx({ id: Date.now(), emoji: "📺", fromX: cx, fromY: cy, toX: cx, toY: cy, phase: "boom", weaponId: "ad_bomb" });
                      setTimeout(() => setFx(null), 1600);
                      setShake("shake-lg");
                      setTimeout(() => setShake(""), 1500);
                      // scorch bg + show damage locally (inventory already decremented above)

                      burnTargetBg(playerId).catch((e) => console.error("burn_target_bg failed", e));
                      setP((cur) => cur ? { ...cur, bg_burned_until: new Date(serverNowMs() + 7 * 24 * 3600_000).toISOString() } : cur);
                      const nowIso = serverNow().toISOString();
                      setShips((arr) => arr.map((s) => ({ ...s, hp: 0, destroyed_at: s.destroyed_at ?? nowIso, repair_ends_at: new Date(serverNowMs() + 4 * 3600_000).toISOString() })));
                      sound.play("success");
                      flash(`📺 تم تفجير الإعلان على ${p?.display_name || "اللاعب"}!`);
                      setBusy(false);
                      // After the boom FX, open the broadcast message dialog.
                      setTimeout(() => { setNukeMsg(""); setNukeMsgOpen(true); }, 1600);
                    }}
                    className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-b from-fuchsia-900/70 to-purple-900/70 border border-fuchsia-500/40 active:scale-95 disabled:opacity-40 text-right"
                  >
                    <span className="text-3xl">{v.emoji}</span>
                    <div className="flex-1 text-fuchsia-100 font-bold text-sm">{v.label}</div>
                  </button>
                ))}
                <button onClick={() => setMode("weapon")} className="py-2 rounded-xl bg-stone-700 text-stone-200 text-sm">رجوع</button>
              </>
            )}

            {mode === "myship" && (
              <>
                <div className="text-amber-200 text-xs font-bold">اختر سفينة للإغارة:</div>
                {myShips.length === 0 && <div className="text-amber-300/60 text-xs text-center py-3">ما عندك سفن</div>}
                {myShips.map((ms) => {
                  const img = ms.catalog_code ? getShipByCode(ms.catalog_code).image : getShipByMarketLevel(ms.template_id || 1).image;
                  const isDestroyed = !!ms.destroyed_at;
                  const isRepairing = !!(ms.repair_ends_at && new Date(ms.repair_ends_at).getTime() > serverNowMs());
                  const onMission = !!ms.stealing_target_user_id;
                  const isBusy = ms.at_sea || isDestroyed || isRepairing || onMission;
                  const label = isDestroyed ? "💥 مدمّرة" : isRepairing ? "🛠️ تحت الإصلاح" : onMission ? "🏴‍☠️ تسرق" : ms.at_sea ? "⚓ بالبحر" : null;
                  return (
                    <button key={ms.id} disabled={busy || isBusy} onClick={() => stealWithShip(ms.id)}
                      className="flex items-center gap-3 p-2 rounded-xl bg-stone-800/80 border border-amber-700/40 active:scale-95 text-right disabled:opacity-40">
                      <img src={img} alt="" className="w-14 h-14 object-contain" />
                      <div className="flex-1 min-w-0">
                        <div className="text-amber-200 font-bold text-sm">سفينة مستوى {ms.template_id}</div>
                        <div className="text-[10px] text-amber-300/70">❤️ {ms.hp ?? "-"}/{ms.max_hp ?? "-"} {label && <span className="ms-1 text-rose-300">{label}</span>}</div>
                      </div>
                      <span className="text-2xl">🏴‍☠️</span>
                    </button>
                  );
                })}
                <button onClick={() => setMode("menu")} className="py-2 rounded-xl bg-stone-700 text-stone-200 text-sm">رجوع</button>
              </>
            )}

            {mode === "support" && (() => {
              const shipId = selectedShip?.id;
              const existingIds = new Set(
                playerCrews.filter((c) => c.ship_id === shipId).map((c) => c.item_id),
              );
              const shipIdx = ships.findIndex((s) => s.id === shipId);
              return (
                <>
                  {/* Step 1: Pick a ship */}
                  <div className="rounded-xl bg-stone-900/60 border border-amber-700/40 p-2.5">
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-stone-900 text-[10px] font-extrabold">1</span>
                      <span className="text-amber-200 text-xs font-bold">اختر سفينته</span>
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                      {ships.map((sh, idx) => {
                        const img = sh.catalog_code ? getShipByCode(sh.catalog_code).image : getShipByMarketLevel(sh.template_id || 1).image;
                        const isActive = sh.id === selectedShip?.id;
                        const shCrewCount = playerCrews.filter((c) => c.ship_id === sh.id && c.item_id !== "trader").length;
                        return (
                          <button
                            key={sh.id}
                            onClick={() => setSelectedShip(sh)}
                            className={`relative flex flex-col items-center gap-0.5 min-w-[70px] p-2 rounded-xl border-2 active:scale-95 transition-all ${isActive ? "border-amber-400 bg-amber-500/25 shadow-[0_0_12px_rgba(251,191,36,0.4)]" : "border-stone-700 bg-stone-800/60 opacity-70"}`}
                          >
                            <img src={img} alt="" className="w-12 h-12 object-contain" />
                            <span className={`text-[10px] font-bold ${isActive ? "text-amber-200" : "text-amber-300/60"}`}>سفينة {idx + 1}</span>
                            {shCrewCount > 0 && (
                              <span className="absolute -top-1 -right-1 bg-emerald-600 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 shadow">👥 {shCrewCount}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Step 2: Pick a crew to send */}
                  <div className="flex items-center gap-1.5">
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-stone-900 text-[10px] font-extrabold">2</span>
                    <span className="text-amber-200 text-xs font-bold">أرسل طاقم لسفينة {shipIdx >= 0 ? shipIdx + 1 : ""}</span>
                  </div>

                  {/* Category: Fixers (instant repair) */}
                  <div className="text-[10px] text-amber-300/70 font-bold ps-1">🛠️ مصلّحون — يصلحون سفينته فوراً</div>
                  {CREWS.filter((c) => c.id.startsWith("fixer_")).map((c) => {
                    const q = inv.find((x) => x.item_id === c.id && x.item_type === "crew")?.quantity ?? 0;
                    return (
                      <CrewSendRow key={c.id} crew={c} qty={q} busy={busy}
                        badge={null}
                        onSend={() => sendSupport("crew", c.id)}
                        onBuy={() => buyAndSendCrew(c.id)} />
                    );
                  })}

                  {/* Category: Persistent crews (24h slot on ship) */}
                  <div className="text-[10px] text-amber-300/70 font-bold ps-1 mt-1">👥 طواقم دائمة — تركب سفينته 24 ساعة</div>
                  {CREWS.filter((c) => !c.id.startsWith("fixer_") && c.id !== "trader").map((c) => {
                    const q = inv.find((x) => x.item_id === c.id && x.item_type === "crew")?.quantity ?? 0;
                    const alreadyOnShip = existingIds.has(c.id);
                    return (
                      <CrewSendRow key={c.id} crew={c} qty={q} busy={busy}
                        badge={alreadyOnShip ? { text: "موجود ✓", tone: "rose" } : null}
                        disabled={alreadyOnShip}
                        onBlocked={() => flash("سفينته فيها نفس الطاقم بالفعل")}
                        onSend={() => sendSupport("crew", c.id)}
                        onBuy={() => buyAndSendCrew(c.id)} />
                    );
                  })}

                  {/* Category: Trader (goes to market) */}
                  <div className="text-[10px] text-amber-300/70 font-bold ps-1 mt-1">💰 تاجر — يفعّل سوق السمك عنده</div>
                  {CREWS.filter((c) => c.id === "trader").map((c) => {
                    const q = inv.find((x) => x.item_id === c.id && x.item_type === "crew")?.quantity ?? 0;
                    const traderActive = playerCrews.some((pc) => pc.item_id === "trader");
                    return (
                      <CrewSendRow key={c.id} crew={c} qty={q} busy={busy}
                        badge={traderActive ? { text: "عنده تاجر نشط", tone: "rose" } : { text: "→ سوق السمك", tone: "emerald" }}
                        disabled={traderActive}
                        onBlocked={() => flash("💰 عنده تاجر نشط — انتظر ينتهي")}
                        onSend={() => sendSupport("crew", c.id)}
                        onBuy={() => buyAndSendCrew(c.id)} />
                    );
                  })}

                  <button onClick={() => setMode("menu")} className="py-2 mt-1 rounded-xl bg-stone-700 text-stone-200 text-sm font-bold active:scale-95">← رجوع</button>
                </>
              );
            })()}



          </div>
        </div>
      )}

      {/* Projectile FX overlay */}
      {fx && <ProjectileFx fx={fx} />}



      {/* Post-nuke broadcast message modal */}
      {nukeMsgOpen && (
        <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
          <div className="w-full max-w-sm rounded-2xl bg-gradient-to-b from-stone-900 to-stone-950 border-2 border-red-500/60 shadow-[0_0_40px_rgba(255,80,40,0.4)] p-5 flex flex-col gap-3">
            <div className="text-center">
              <div className="text-5xl mb-1">☢️</div>
              <div className="text-red-300 font-extrabold text-lg">رسالة عالمية</div>
              <div className="text-amber-200/80 text-xs mt-1">اكتب رسالة سترسل لجميع لاعبي اللعبة بعد تفجيرك القنبلة الذرية</div>
            </div>
            <textarea
              value={nukeMsg}
              onChange={(e) => setNukeMsg(e.target.value.slice(0, 200))}
              placeholder="اكتب رسالتك للعالم… (٢٠ حرف على الأقل)"
              className="w-full h-28 resize-none rounded-xl bg-stone-800/80 border border-red-700/50 text-amber-100 placeholder:text-amber-300/40 p-3 text-sm focus:outline-none focus:border-red-400"
              autoFocus
            />
            <div className="flex items-center justify-between text-[11px]">
              <span className={nukeMsg.trim().length < 20 ? "text-red-400" : "text-emerald-400"}>
                {nukeMsg.trim().length}/200 {nukeMsg.trim().length < 20 ? `(باقي ${20 - nukeMsg.trim().length})` : "✓"}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                disabled={nukeSending}
                onClick={() => { setNukeMsgOpen(false); closeMenu(); }}
                className="flex-1 py-2.5 rounded-xl bg-stone-700 text-stone-200 text-sm font-bold disabled:opacity-50"
              >
                تخطي
              </button>
              <button
                disabled={nukeSending || nukeMsg.trim().length < 20}
                onClick={submitNukeMessage}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-b from-red-500 to-red-700 text-white font-extrabold disabled:opacity-40 active:scale-95"
              >
                {nukeSending ? "جارٍ البث…" : "بث للجميع"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-32 left-1/2 -translate-x-1/2 z-[55] glass-hud border-2 border-amber-400/60 rounded-xl px-4 py-2 text-amber-200 text-sm font-bold shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div className="glass-hud rounded-lg px-2 py-1 flex items-center gap-1 border border-amber-400/30">
      <span className="text-base">{icon}</span>
      <div className="min-w-0">
        <div className="text-[9px] text-amber-300/70 leading-none">{label}</div>
        <div className="text-xs font-bold text-amber-200 tabular-nums leading-tight">{value.toLocaleString()}</div>
      </div>
    </div>
  );
}

function CrewSendRow({ crew, qty, busy, badge, disabled, onBlocked, onSend, onBuy }: {
  crew: (typeof CREWS)[number];
  qty: number;
  busy: boolean;
  badge: { text: string; tone: "rose" | "emerald" } | null;
  disabled?: boolean;
  onBlocked?: () => void;
  onSend: () => void;
  onBuy: () => void;
}) {
  const hasCrew = qty > 0;
  const canSend = !disabled;
  const toneCls = badge?.tone === "rose"
    ? "bg-rose-900/60 text-rose-200 border-rose-500/40"
    : "bg-emerald-900/60 text-emerald-200 border-emerald-500/40";
  return (
    <div className="flex items-stretch gap-2">
      <button disabled={busy} onClick={canSend ? (hasCrew ? onSend : onBuy) : onBlocked}
        className={`flex-1 flex items-center gap-3 p-3 rounded-xl border-2 active:scale-95 disabled:opacity-50 text-right transition-all ${canSend ? "bg-stone-800/90 border-amber-600/50 hover:border-amber-400" : "bg-stone-900/60 border-stone-700"}`}>
        {crew.image ? <img src={crew.image} alt={crew.name} className="w-11 h-11 object-contain drop-shadow" /> : <span className="text-3xl">{crew.emoji}</span>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-amber-200 font-bold text-sm truncate">{crew.name}</span>
            {badge && <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${toneCls}`}>{badge.text}</span>}
          </div>
          <div className="text-[10px] text-amber-300/70 leading-tight mt-0.5 line-clamp-2">{crew.bonus}</div>
        </div>
        <div className="flex flex-col items-center justify-center">
          <span className={`text-[9px] font-bold ${qty > 0 ? "text-emerald-300" : "text-amber-300"}`}>{hasCrew ? "عندك" : "شراء"}</span>
          <span className={`text-base font-extrabold tabular-nums ${qty > 0 ? "text-emerald-300" : "text-amber-300"}`}>{hasCrew ? `×${qty}` : crew.currency === "gems" ? `💎${crew.price}` : "💰"}</span>
        </div>
      </button>
      {qty === 0 && !disabled && (
        <button disabled={busy} onClick={onBuy}
          className="px-2.5 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-700 text-white text-[11px] font-extrabold active:scale-95 disabled:opacity-40 flex flex-col items-center justify-center min-w-[76px] leading-tight shadow-lg">
          <span className="text-base">🛒</span>
          <span className="text-[10px] opacity-95 mt-0.5">
            {crew.currency === "gems" ? `💎 ${crew.price}` : `💰 ${crew.price.toLocaleString()}`}
          </span>
          <span className="text-[9px] opacity-90">شراء وإرسال</span>
        </button>
      )}
    </div>
  );
}

function VisitorShip({ img, top, left, scale, atSea, idx, hp, maxHp, destroyed, repairEndsAt, onRepaired, onTap, buttonRef, crews = [], seaSide = "right" }: { img: string; top: string; left: string; scale: number; atSea: boolean; idx: number; hp: number; maxHp: number; destroyed: boolean; repairEndsAt?: string | null; onRepaired?: () => void; onTap: () => void; buttonRef?: (el: HTMLButtonElement | null) => void; crews?: typeof CREWS; seaSide?: "left" | "right" }) {
  // No per-frame React tick — bobbing is now a pure CSS animation (see styles.css .animate-ship-bob)
  // 1s clock only when waiting on a repair countdown
  const [nowMs, setNowMs] = useState(() => serverNowMs());
  useEffect(() => {
    if (!destroyed || !repairEndsAt) return;
    const id = setInterval(() => setNowMs(serverNowMs()), 1000);
    return () => clearInterval(id);
  }, [destroyed, repairEndsAt]);
  useEffect(() => {
    if (!destroyed || !repairEndsAt) return;
    const endMs = new Date(repairEndsAt).getTime();
    if (nowMs >= endMs) onRepaired?.();
  }, [nowMs, destroyed, repairEndsAt, onRepaired]);
  const hpPct = Math.max(0, Math.min(100, Math.round((hp / Math.max(1, maxHp)) * 100)));
  const hpColor = hpPct > 60 ? "bg-emerald-500" : hpPct > 30 ? "bg-amber-500" : "bg-red-600";
  const remainingSec = destroyed && repairEndsAt ? Math.max(0, Math.ceil((new Date(repairEndsAt).getTime() - nowMs) / 1000)) : 0;
  const fmtTime = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return `${h}س ${m}د`;
    if (m > 0) return `${m}:${String(sec).padStart(2, "0")}`;
    return `${sec}ث`;
  };
  return (
    <button
      ref={buttonRef}
      onClick={onTap}
      className="absolute z-10 active:scale-95 cursor-pointer"
      style={{
        top, left, width: `${22 * scale}%`,
        transition: "left 1.2s ease-in-out",
      }}
    >
      {/* HP bar / repair timer above ship */}
      <div className="absolute left-1/2 -translate-x-1/2 -top-7 w-[110%] z-20 pointer-events-none">
        <div className="h-1.5 w-full rounded-full bg-black/60 border border-black/70 overflow-hidden">
          <div className={`h-full ${hpColor} transition-[width] duration-300`} style={{ width: `${hpPct}%` }} />
        </div>
        <div className="text-center text-[9px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)] tabular-nums leading-tight">
          {destroyed
            ? (repairEndsAt ? `🛠️ ${fmtTime(remainingSec)}` : "💀 مدمّرة")
            : `❤️ ${hp}/${maxHp}`}
        </div>
      </div>

      {/* Crew characters standing on the ship deck (visible to all spectators) */}
      {!destroyed && crews.length > 0 && (
        <div
          className="absolute left-1/2 -translate-x-1/2 pointer-events-none z-20 flex items-end justify-center gap-1"
          style={{ top: "-22%", width: "120%", height: "40%" }}
        >
          {crews.map((c, i) => (
            <div
              key={c.id}
              className="relative animate-crew-bob"
              style={{ width: "28%", animationDelay: `${i * 0.25}s`, filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.6))" }}
              title={c.name}
            >
              {c.image ? (
                <img src={c.image} alt={c.name} className="w-full h-auto object-contain" draggable={false} />
              ) : (
                <div className="w-full text-center text-2xl">{c.emoji}</div>
              )}
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[8px] font-bold text-amber-100 bg-black/70 px-1 rounded whitespace-nowrap">{c.name}</div>
            </div>
          ))}
        </div>
      )}





      {/* Persistent damage level — visible even after refresh, scales with HP loss */}
      {(() => {
        const dmgRatio = Math.max(0, Math.min(1, 1 - hp / Math.max(1, maxHp))); // 0=fine, 1=destroyed
        const damaged = !destroyed && dmgRatio > 0.05;
        return (
      <div
        className={`relative w-full ${atSea && !destroyed ? "animate-ship-bob" : ""}`}
        style={{
          transform: destroyed
            ? `rotateZ(18deg)`
            : damaged
            ? `rotateZ(${dmgRatio * 4}deg)`
            : undefined,
          filter: destroyed
            ? "drop-shadow(0 12px 14px rgba(0,0,0,0.45)) grayscale(0.85) brightness(0.55)"
            : damaged
            ? `drop-shadow(0 12px 14px rgba(0,0,0,0.45)) grayscale(${dmgRatio * 0.7}) brightness(${1 - dmgRatio * 0.35}) sepia(${dmgRatio * 0.3})`
            : "drop-shadow(0 12px 14px rgba(0,0,0,0.45))",
          transformOrigin: "center 70%",
          opacity: destroyed ? 0.75 : 1,
        }}
      >
        <img src={img} alt="" className="w-full block select-none" style={{ transform: `scaleX(${(atSea ? (seaSide === "right" ? 1 : -1) : (seaSide === "right" ? -1 : 1)) === 1 ? -1 : 1})` }} draggable={false} />
        {/* Flag (hide when destroyed) */}
        {!destroyed && (
          <div className="absolute pointer-events-none" style={{ left: "50%", top: "-2%", width: "14%", height: "10%" }}>
            <div className="w-full h-full animate-flag-wave" style={{
              background: "linear-gradient(90deg, #ef4444 0%, #ef4444 55%, #fbbf24 55%, #fbbf24 100%)",
              clipPath: "polygon(0 0, 100% 0, 90% 50%, 100% 100%, 0 100%)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
            }} />
          </div>
        )}
        {/* Smoke when destroyed */}
        {destroyed && (
          <>
            <div className="absolute pointer-events-none text-4xl animate-cloud-drift" style={{ left: "30%", top: "-30%", animationDuration: "6s", filter: "grayscale(1) brightness(0.7)" }}>💨</div>
            <div className="absolute pointer-events-none text-5xl animate-cloud-drift" style={{ left: "45%", top: "-50%", animationDuration: "8s", animationDelay: "-2s", filter: "grayscale(1) brightness(0.5)" }}>💨</div>
            <div className="absolute pointer-events-none text-3xl animate-pulse" style={{ left: "40%", top: "10%" }}>🔥</div>
          </>
        )}
        {/* Persistent damage smoke for partially-damaged ships (heavier with more damage) */}
        {damaged && (
          <>
            <div
              className="absolute pointer-events-none animate-cloud-drift"
              style={{
                left: "35%",
                top: "-20%",
                fontSize: `${1.4 + dmgRatio * 1.6}rem`,
                opacity: 0.5 + dmgRatio * 0.4,
                animationDuration: "5s",
                filter: "grayscale(1) brightness(0.7)",
              }}
            >
              💨
            </div>
            {dmgRatio > 0.4 && (
              <div
                className="absolute pointer-events-none animate-pulse"
                style={{ left: "42%", top: "20%", fontSize: `${1 + dmgRatio * 1.2}rem`, opacity: dmgRatio }}
              >
                🔥
              </div>
            )}
          </>
        )}
        {/* Fishing nets when at sea and not destroyed */}
        {atSea && !destroyed && (
          <>
            <div className="absolute z-20" style={{ left: "2%", top: "50%", width: "32%", height: "80%", transformOrigin: "top center", animation: "net-drop 2.6s ease-in-out infinite", filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.5))" }}>
              <VisitorNet />
            </div>
            <div className="absolute z-20" style={{ right: "2%", top: "50%", width: "32%", height: "80%", transformOrigin: "top center", animation: "net-drop 2.6s ease-in-out infinite", animationDelay: "-1.3s", filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.5))" }}>
              <VisitorNet />
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 rounded-full border-2 border-white/80 z-10" style={{ bottom: "-22%", width: "85%", aspectRatio: "3 / 1", animation: "splash-ring 2.6s ease-out infinite" }} />
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-emerald-600/90 border border-emerald-300 text-white text-[10px] font-bold whitespace-nowrap z-30 shadow-lg">🎣 يصيد</div>
          </>
        )}
      </div>
        );
      })()}
      {/* Wake ripples */}
      <div className="absolute left-1/2 -translate-x-1/2 -bottom-3 h-4" style={{ width: "60%", opacity: destroyed ? 0 : (atSea ? 0.5 : 0.25) }}>
        <div className="w-full h-full rounded-[50%] border-t-2 border-white/70" />
      </div>
    </button>
  );
}


function VisitorNet() {
  return (
    <svg viewBox="0 0 40 100" className="w-full h-full" preserveAspectRatio="none">
      <line x1="20" y1="0" x2="20" y2="35" stroke="#3a2a1a" strokeWidth="1.2" />
      <g stroke="#d8c896" strokeWidth="0.8" fill="none" opacity="0.95">
        <path d="M5 40 L20 35 L35 40 L35 90 Q20 100 5 90 Z" fill="rgba(216,200,150,0.18)" />
        {[0,1,2,3,4,5].map((i) => (<line key={`h${i}`} x1="5" y1={45 + i*9} x2="35" y2={45 + i*9} />))}
        {[0,1,2,3,4].map((i) => (<line key={`v${i}`} x1={8 + i*6} y1="40" x2={8 + i*6} y2="92" />))}
      </g>
      <circle cx="14" cy="70" r="2" fill="#7cd0ff" opacity="0.8" />
      <circle cx="26" cy="78" r="1.6" fill="#ffd766" opacity="0.9" />
    </svg>
  );
}

// ProjectileFx moved to src/components/ProjectileFx.tsx and imported above
