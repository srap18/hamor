import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { WEAPONS } from "@/lib/weapons";
import { CREWS } from "@/lib/crews";
import { supabase } from "@/integrations/supabase/client";
import { bgById } from "@/lib/backgrounds";
import { SeamlessVideo } from "@/components/SeamlessVideo";
import { getShipByCode, getShipByMarketLevel } from "@/lib/ships";
import { sound } from "@/lib/sound";
import { buyWithCoins, buyWithGems } from "@/lib/economy";

export const Route = createFileRoute("/players/$playerId")({
  ssr: false,
  head: () => ({ meta: [{ title: "زيارة لاعب — Ocean Catch" }] }),
  component: PlayerPage,
});

type Profile = {
  id: string; display_name: string; avatar_emoji: string; avatar_url: string | null;
  level: number; xp: number; coins: number; gems: number; online_at: string;
  selected_bg_id?: string | null;
};
type Ship = { id: string; template_id: number; catalog_code: string | null; at_sea: boolean; acquired_at: string; hp?: number; max_hp?: number; destroyed_at?: string | null; repair_ends_at?: string | null };


function PlayerPage() {
  const { playerId } = useParams({ from: "/players/$playerId" });
  const [me, setMe] = useState<string | null>(null);
  const [myName, setMyName] = useState<string>("");
  const [p, setP] = useState<Profile | null>(null);
  const [ships, setShips] = useState<Ship[]>([]);
  const [friendStatus, setFriendStatus] = useState<"none" | "pending" | "accepted" | "self">("none");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedShip, setSelectedShip] = useState<Ship | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"menu" | "weapon" | "myship" | "support" | null>(null);
  const [myShips, setMyShips] = useState<Ship[]>([]);
  const [inv, setInv] = useState<{ item_id: string; item_type: string; quantity: number }[]>([]);
  const shipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [fx, setFx] = useState<{ id: number; emoji: string; fromX: number; fromY: number; toX: number; toY: number; phase: "fly" | "boom"; friendly?: boolean; weaponId?: string } | null>(null);
  const [shake, setShake] = useState<"" | "shake-sm" | "shake-md" | "shake-lg">("");
  const [nukeMsgOpen, setNukeMsgOpen] = useState(false);
  const [nukeMsg, setNukeMsg] = useState("");
  const [nukeSending, setNukeSending] = useState(false);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1800); };

  // Load my own ships + inventory when opening a ship
  const openShip = async (s: Ship) => {
    setSelectedShip(s); setMode("menu");
    if (!me) return;
    const [{ data: ms }, { data: iv }] = await Promise.all([
      supabase.from("ships_owned").select("id,template_id,catalog_code,at_sea,acquired_at,hp,max_hp").eq("user_id", me),
      supabase.from("inventory").select("item_id,item_type,quantity").eq("user_id", me),
    ]);
    setMyShips((ms as Ship[]) || []);
    setInv((iv as { item_id: string; item_type: string; quantity: number }[]) || []);
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
  const playProjectile = (targetId: string, emoji: string, friendly = false, weaponId?: string) => new Promise<void>((resolve) => {
    const el = shipRefs.current[targetId];
    if (!el) { resolve(); return; }
    const r = el.getBoundingClientRect();
    const toX = r.left + r.width / 2;
    const toY = r.top + r.height / 2;
    const fromX = window.innerWidth - 40;
    const fromY = window.innerHeight - 80;
    const id = Date.now();
    setFx({ id, emoji, fromX, fromY, toX, toY, phase: "fly", friendly, weaponId });
    // whoosh during flight (only for hostile rockets)
    if (!friendly) sound.play("whoosh");
    const flyMs = weaponId === "nuke" ? 1100 : 850;
    setTimeout(() => {
      setFx((f) => f && f.id === id ? { ...f, phase: "boom" } : f);
      if (!friendly) {
        sound.play(weaponId === "nuke" ? "nuke" : "explosion");
        // Screen shake intensity by weapon
        const intensity =
          weaponId === "nuke" ? "shake-lg" :
          weaponId === "rocket_large" ? "shake-md" :
          weaponId === "rocket_medium" ? "shake-md" :
          "shake-sm";
        setShake(intensity);
        // Extra rumble for nuke
        if (weaponId === "nuke") {
          setTimeout(() => sound.play("explosion"), 600);
          setTimeout(() => sound.play("explosion"), 1200);
          setTimeout(() => setShake(""), 1800);
        } else {
          setTimeout(() => setShake(""), 900);
        }
      } else {
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
        const { data: myProf } = await supabase.from("profiles").select("display_name").eq("id", myId).maybeSingle();
        setMyName((myProf as any)?.display_name ?? "");
      }
      const [{ data: prof }, { data: sh }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", playerId).maybeSingle(),
        supabase.from("ships_owned").select("*").eq("user_id", playerId),
      ]);
      setP((prof as Profile) || null);
      setShips((sh as Ship[]) || []);

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

  // Live updates: watch the visited player's ships move in/out of sea, repair, take damage, etc.
  useEffect(() => {
    if (!playerId) return;
    const channel = supabase
      .channel(`ships-watch:${playerId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ships_owned", filter: `user_id=eq.${playerId}` },
        (payload) => {
          setShips((arr) => {
            if (payload.eventType === "INSERT") {
              const r = payload.new as Ship;
              if (arr.some((x) => x.id === r.id)) return arr;
              return [...arr, r];
            }
            if (payload.eventType === "DELETE") {
              const r = payload.old as { id: string };
              return arr.filter((x) => x.id !== r.id);
            }
            const r = payload.new as Ship;
            return arr.map((x) => (x.id === r.id ? { ...x, ...r } : x));
          });
          // keep open modal in sync if it's the same ship
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
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [playerId]);

  const addFriend = async () => {
    if (!me) { flash("سجّل دخول أولاً"); return; }
    sound.play("click");
    const { error } = await supabase.from("friends").insert({
      requester_id: me, addressee_id: playerId, status: "pending",
    });
    if (error) flash("تعذّر الإرسال");
    else { setFriendStatus("pending"); sound.play("success"); flash("تم إرسال طلب الصداقة ✓"); }
  };

  const fireWeapon = async (weaponId: string) => {
    if (!me || !selectedShip) return;
    const w = WEAPONS.find((x) => x.id === weaponId);
    if (!w) return;
    setBusy(true); sound.play("click");
    setMode(null);
    await consumeItem(weaponId, "weapon");
    const targets = w.aoe ? ships : [selectedShip];
    for (const t of targets) {
      await playProjectile(t.id, w.emoji, false, w.id);
      const { data: dmgRes } = await (supabase as any).rpc("apply_ship_damage", { _ship_id: t.id, _damage: w.damage });
      const row = Array.isArray(dmgRes) && dmgRes[0] ? dmgRes[0] : null;
      const newHp = row?.new_hp ?? Math.max(0, (t.hp ?? 100) - w.damage);
      const repEnds = row?.repair_ends_at ?? null;
      await (supabase as any).rpc("record_attack", {
        _defender_id: playerId, _target_ship_id: t.id,
        _damage: w.damage, _damage_dealt: w.damage, _attacker_won: newHp === 0,
      });
      setShips((arr) => arr.map((x) => x.id === t.id ? { ...x, hp: newHp, destroyed_at: newHp === 0 ? new Date().toISOString() : x.destroyed_at, repair_ends_at: newHp === 0 ? (repEnds ?? x.repair_ends_at) : x.repair_ends_at } : x));

    }


    sound.play("success"); flash(`💥 ${w.name} — ${w.damage} ضرر`);
    setBusy(false);
    // After a nuke, prompt the player to broadcast a global message
    if (weaponId === "nuke") {
      setNukeMsg("");
      setNukeMsgOpen(true);
    } else {
      closeMenu();
    }
  };

  const buyAndFire = async (weaponId: string) => {
    if (!me || !selectedShip) return;
    const w = WEAPONS.find((x) => x.id === weaponId);
    if (!w) return;
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
    if (!me || !selectedShip) return;
    setBusy(true); sound.play("click");
    await playProjectile(selectedShip.id, "🏴‍☠️", true);
    // Actually transfer fish from defender to attacker via RPC
    const { data: stealRes, error: stealErr } = await (supabase as any).rpc("steal_fish", {
      _defender_id: playerId, _max_count: 5,
      _attacker_ship_id: myShipId, _target_ship_id: selectedShip.id,
    });
    const row = Array.isArray(stealRes) && stealRes[0] ? stealRes[0] : null;
    const stolenCount = row?.stolen_count ?? 0;
    const totalValue = row?.total_value ?? 0;
    await (supabase as any).rpc("record_attack", {
      _defender_id: playerId, _target_ship_id: selectedShip.id,
      _damage: 0, _damage_dealt: 0, _attacker_won: stolenCount > 0,
    });
    if (stealErr) {
      const msg = stealErr.message || "";
      if (msg.includes("protected")) flash("🛡️ اللاعب محمي بدرع");
      else flash("تعذّرت السرقة");
    }
    else if (stolenCount > 0) { sound.play("success"); flash(`🐟 سرقت ${stolenCount} سمكة (قيمتها ${totalValue})`); }
    else flash("ما عنده سمك تسرقه 🐟");
    setBusy(false); closeMenu();
  };

  const sendSupport = async (kind: "crew" | "repair", itemId: string) => {
    if (!me || !selectedShip) return;
    setBusy(true); sound.play("click");
    if (kind === "crew") await consumeItem(itemId, "crew");
    await playProjectile(selectedShip.id, kind === "crew" ? "👨‍✈️" : "🛠️", true);
    const amount = kind === "repair" ? 200 : 0;
    const { error } = await supabase.from("support_gifts").insert({
      sender_id: me, recipient_id: playerId, ship_id: selectedShip.id,
      kind, amount, message: kind === "crew" ? `طاقم: ${itemId}` : "إصلاح",
    });
    if (!error) { sound.play("success"); flash(kind === "crew" ? "👨‍✈️ تم إرسال طاقم" : "🛠️ تم إرسال إصلاح"); }
    else flash("تعذّر إرسال الدعم");
    setBusy(false); closeMenu();
  };


  if (!loading && !p) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-stone-950 text-amber-300 gap-3">
        <div>لم يتم العثور على اللاعب</div>
        <Link to="/" className="px-4 py-2 rounded-lg bg-amber-600 text-amber-950 font-bold">عودة</Link>
      </div>
    );
  }


  const scene = bgById(p?.selected_bg_id || "harbor");

  // Match index.tsx ship placement so visiting a player feels identical to playing.
  const wTop = scene.waterTop ?? 45;
  const wLeft = scene.waterLeft ?? 30;
  const wRight = scene.waterRight ?? 75;
  const wWidth = Math.max(15, wRight - wLeft);
  const ts = [0, 0.4, 1];
  const vRange = Math.max(14, 74 - (wTop + 4));
  const hOffsets = [0.05, 0.3, 0.55];
  const seaOffsets = [0.7, 0.85, 0.6];

  return (
    <div className={`fixed inset-0 overflow-hidden bg-[#0d2236] ${shake}`} dir="rtl">
      {/* Their actual scene background (animated video if available) */}
      {scene.video ? (
        <SeamlessVideo key={scene.id} src={scene.video} poster={scene.image}
          className="absolute inset-0 w-full h-full object-cover object-center select-none pointer-events-none" />
      ) : (
        <img src={scene.image} alt={scene.name} className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none select-none" draggable={false} />
      )}
      <div className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-20"
        style={{ background: "radial-gradient(ellipse at 70% 60%, rgba(255,255,255,0.4) 0%, transparent 50%)" }} />

      {/* Scene name badge */}
      <div className="absolute top-[5.5rem] left-1/2 -translate-x-1/2 z-30 glass-hud rounded-full px-3 py-1 border border-amber-400/40 text-[10px] text-amber-200 font-bold whitespace-nowrap">
        🌅 {scene.name}
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

      {/* Animated sea waves shimmer */}
      <div className="absolute inset-0 pointer-events-none z-[4]"
        style={{
          background: "repeating-linear-gradient(115deg, transparent 0px, transparent 40px, rgba(255,255,255,0.08) 41px, rgba(255,255,255,0.08) 43px)",
          maskImage: "linear-gradient(90deg, transparent 0%, transparent 45%, black 60%, black 100%)",
          WebkitMaskImage: "linear-gradient(90deg, transparent 0%, transparent 45%, black 60%, black 100%)",
          animation: "wave-slide 8s linear infinite",
        }}
      />

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
        const scale = fixedSlot?.scale ?? 0.85 + ts[i % ts.length] * 0.42;
        const dockLeft = fixedSlot?.left ?? wLeft + hOffsets[i % hOffsets.length] * wWidth;
        const seaLeft = wLeft + seaOffsets[i % seaOffsets.length] * wWidth;
        const destroyed = !!s.destroyed_at || (s.hp ?? 1) <= 0;
        const left = destroyed ? `${dockLeft}%` : (s.at_sea ? `${seaLeft}%` : `${dockLeft}%`);
        return <VisitorShip key={s.id} img={img} top={top} left={`${left}`.includes("%") ? left : `${left}%`} scale={scale} atSea={s.at_sea && !destroyed} idx={i} hp={s.hp ?? 100} maxHp={s.max_hp ?? 100} destroyed={destroyed} repairEndsAt={s.repair_ends_at ?? null} onRepaired={() => setShips((arr) => arr.map((x) => x.id === s.id ? { ...x, hp: x.max_hp ?? 100, destroyed_at: null, repair_ends_at: null } : x))} onTap={() => openShip(s)} buttonRef={(el) => { shipRefs.current[s.id] = el; }} />;
      })}


      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-30 p-2 flex items-center gap-2">
        <Link to="/" onClick={() => sound.play("click")} className="w-10 h-10 rounded-xl bg-amber-700 border-2 border-amber-300 flex items-center justify-center">↩</Link>
        <div className="flex-1 glass-hud rounded-xl px-3 py-2 flex items-center gap-2 border border-amber-400/50">
          <div className="w-10 h-10 rounded-full bg-gradient-to-b from-sky-400 to-sky-700 flex items-center justify-center text-xl overflow-hidden">
            {p?.avatar_url ? <img src={p.avatar_url} alt="" className="w-full h-full object-cover" /> : (p?.avatar_emoji ?? "🧑‍✈️")}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-amber-200 truncate">{p?.display_name ?? "…"}</div>
            <div className="text-[10px] text-amber-300/70">المستوى {p?.level ?? "—"} · ⚓ {ships.length} سفن</div>
          </div>
        </div>
      </div>

      {/* Stats row — only XP shown publicly; coins/gems are private */}
      <div className="absolute top-16 left-2 right-2 z-30 grid grid-cols-2 gap-2">
        <Stat icon="⭐" label="XP" value={p?.xp ?? 0} />
        <Stat icon="⚓" label="السفن" value={ships.length} />
      </div>



      {/* Bottom actions */}
      <div className="absolute bottom-0 left-0 right-0 z-30 p-3 flex gap-2 glass-hud border-t border-amber-400/40">
        {friendStatus === "self" ? (
          <Link to="/profile" className="flex-1 py-3 rounded-xl bg-amber-600 text-amber-950 text-center font-bold active:scale-95">⚙️ هذا أنت — حرّر الملف</Link>
        ) : friendStatus === "accepted" ? (
          <>
            <Link to="/chat" onClick={() => sound.play("click")} className="flex-1 py-3 rounded-xl bg-sky-600 text-white text-center font-bold active:scale-95">💬 مراسلة</Link>
            <button className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold active:scale-95">✓ صديق</button>
          </>
        ) : friendStatus === "pending" ? (
          <button disabled className="flex-1 py-3 rounded-xl bg-stone-600 text-white font-bold opacity-70">⏳ طلب صداقة مُرسل</button>
        ) : (
          <>
            <button onClick={addFriend} className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold active:scale-95">+ إضافة صديق</button>
            <Link to="/chat" onClick={() => sound.play("click")} className="flex-1 py-3 rounded-xl bg-sky-600 text-white text-center font-bold active:scale-95">💬 مراسلة</Link>
          </>
        )}
      </div>

      {/* Ship action menu — multi-step */}
      {selectedShip && (
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

            {mode === "menu" && (
              <>
                <button disabled={busy} onClick={() => setMode("weapon")} className="py-3 rounded-xl bg-gradient-to-b from-red-500 to-red-700 text-white font-bold active:scale-95">⚔️ هجوم</button>
                <button disabled={busy} onClick={() => setMode("myship")} className="py-3 rounded-xl bg-gradient-to-b from-amber-500 to-amber-700 text-amber-50 font-bold active:scale-95">🗡️ سرقة</button>
                <button disabled={busy} onClick={() => setMode("support")} className="py-3 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-700 text-white font-bold active:scale-95">🛠️ دعم / إصلاح</button>
                <button onClick={closeMenu} className="py-2 rounded-xl bg-stone-700 text-stone-200 text-sm">إلغاء</button>
              </>
            )}

            {mode === "weapon" && (
              <>
                <div className="text-amber-200 text-xs font-bold">اختر صاروخ من مخزنك:</div>
                {WEAPONS.map((w) => {
                  const q = inv.find((x) => x.item_id === w.id && x.item_type === "weapon")?.quantity ?? 0;
                  const canFire = q > 0;
                  return (
                    <div key={w.id} className="flex items-stretch gap-2">
                      <button disabled={busy || !canFire} onClick={() => fireWeapon(w.id)}
                        className="flex-1 flex items-center gap-3 p-3 rounded-xl bg-stone-800/80 border border-amber-700/40 active:scale-95 disabled:opacity-40 text-right">
                        {w.image ? <img src={w.image} alt={w.name} className="w-10 h-10 object-contain drop-shadow" /> : <span className="text-3xl">{w.emoji}</span>}
                        <div className="flex-1 min-w-0">
                          <div className="text-amber-200 font-bold text-sm">{w.name}</div>
                          <div className="text-[10px] text-amber-300/70">ضرر {w.damage}{w.aoe ? " · يصيب الكل" : ""}</div>
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

            {mode === "myship" && (
              <>
                <div className="text-amber-200 text-xs font-bold">اختر سفينة للإغارة:</div>
                {myShips.length === 0 && <div className="text-amber-300/60 text-xs text-center py-3">ما عندك سفن</div>}
                {myShips.map((ms) => {
                  const img = ms.catalog_code ? getShipByCode(ms.catalog_code).image : getShipByMarketLevel(ms.template_id || 1).image;
                  return (
                    <button key={ms.id} disabled={busy} onClick={() => stealWithShip(ms.id)}
                      className="flex items-center gap-3 p-2 rounded-xl bg-stone-800/80 border border-amber-700/40 active:scale-95 text-right disabled:opacity-40">
                      <img src={img} alt="" className="w-14 h-14 object-contain" />
                      <div className="flex-1 min-w-0">
                        <div className="text-amber-200 font-bold text-sm">سفينة مستوى {ms.template_id}</div>
                        <div className="text-[10px] text-amber-300/70">❤️ {ms.hp ?? "-"}/{ms.max_hp ?? "-"}</div>
                      </div>
                      <span className="text-2xl">🏴‍☠️</span>
                    </button>
                  );
                })}
                <button onClick={() => setMode("menu")} className="py-2 rounded-xl bg-stone-700 text-stone-200 text-sm">رجوع</button>
              </>
            )}

            {mode === "support" && (
              <>
                <div className="text-amber-200 text-xs font-bold">اختر دعم لإرساله:</div>
                <button disabled={busy} onClick={() => sendSupport("repair", "repair_kit")} className="flex items-center gap-3 p-3 rounded-xl bg-emerald-900/40 border border-emerald-500/40 active:scale-95 text-right">
                  <span className="text-3xl">🛠️</span>
                  <div className="flex-1"><div className="text-emerald-200 font-bold text-sm">طقم إصلاح</div><div className="text-[10px] text-emerald-300/70">+200 HP للسفينة</div></div>
                </button>
                <div className="text-amber-200 text-xs font-bold mt-2">أو طاقم من مخزنك:</div>
                {CREWS.map((c) => {
                  const q = inv.find((x) => x.item_id === c.id && x.item_type === "crew")?.quantity ?? 0;
                  if (q <= 0) return null;
                  return (
                    <button key={c.id} disabled={busy} onClick={() => sendSupport("crew", c.id)}
                      className="flex items-center gap-3 p-3 rounded-xl bg-stone-800/80 border border-amber-700/40 active:scale-95 text-right">
                      {c.image ? <img src={c.image} alt={c.name} className="w-10 h-10 object-contain drop-shadow" /> : <span className="text-3xl">{c.emoji}</span>}
                      <div className="flex-1 min-w-0">
                        <div className="text-amber-200 font-bold text-sm">{c.name}</div>
                        <div className="text-[10px] text-amber-300/70">{c.bonus}</div>
                      </div>
                      <div className="text-xs text-amber-400 font-bold tabular-nums">×{q}</div>
                    </button>
                  );
                })}
                {!CREWS.some((c) => (inv.find((x) => x.item_id === c.id && x.item_type === "crew")?.quantity ?? 0) > 0) && (
                  <div className="text-amber-300/60 text-xs text-center">ما عندك طواقم بالمخزن</div>
                )}
                <button onClick={() => setMode("menu")} className="py-2 rounded-xl bg-stone-700 text-stone-200 text-sm">رجوع</button>
              </>
            )}
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

function VisitorShip({ img, top, left, scale, atSea, idx, hp, maxHp, destroyed, repairEndsAt, onRepaired, onTap, buttonRef }: { img: string; top: string; left: string; scale: number; atSea: boolean; idx: number; hp: number; maxHp: number; destroyed: boolean; repairEndsAt?: string | null; onRepaired?: () => void; onTap: () => void; buttonRef?: (el: HTMLButtonElement | null) => void }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!atSea || destroyed) return;
    const id = setInterval(() => setTick((t) => t + 1), 80);
    return () => clearInterval(id);
  }, [atSea, destroyed]);
  // 1s clock for repair countdown
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!destroyed || !repairEndsAt) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [destroyed, repairEndsAt]);
  useEffect(() => {
    if (!destroyed || !repairEndsAt) return;
    const endMs = new Date(repairEndsAt).getTime();
    if (nowMs >= endMs) onRepaired?.();
  }, [nowMs, destroyed, repairEndsAt, onRepaired]);
  const t = Date.now() / 1000;
  const bob = destroyed ? 0 : Math.sin((t + idx) * 1.4) * 1.5;
  const tilt = destroyed ? 18 : Math.sin((t + idx) * 1.8) * 0.8;
  void tick;
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
        transform: "translate(-50%, -50%)",
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



      {/* Persistent damage level — visible even after refresh, scales with HP loss */}
      {(() => {
        const dmgRatio = Math.max(0, Math.min(1, 1 - hp / Math.max(1, maxHp))); // 0=fine, 1=destroyed
        const damaged = !destroyed && dmgRatio > 0.05;
        return (
      <div
        className="relative w-full"
        style={{
          transform: `translateY(${bob}px) rotateZ(${tilt + (damaged ? dmgRatio * 4 : 0)}deg)`,
          filter: destroyed
            ? "drop-shadow(0 12px 14px rgba(0,0,0,0.45)) grayscale(0.85) brightness(0.55)"
            : damaged
            ? `drop-shadow(0 12px 14px rgba(0,0,0,0.45)) grayscale(${dmgRatio * 0.7}) brightness(${1 - dmgRatio * 0.35}) sepia(${dmgRatio * 0.3})`
            : "drop-shadow(0 12px 14px rgba(0,0,0,0.45))",
          transformOrigin: "center 70%",
          opacity: destroyed ? 0.75 : 1,
        }}
      >
        <img src={img} alt="" className="w-full block select-none" style={{ transform: "scaleX(-1)" }} draggable={false} />
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

function ProjectileFx({ fx }: { fx: { id: number; emoji: string; fromX: number; fromY: number; toX: number; toY: number; phase: "fly" | "boom"; friendly?: boolean; weaponId?: string } }) {
  const [pos, setPos] = useState({ x: fx.fromX, y: fx.fromY });
  useEffect(() => {
    const r = requestAnimationFrame(() => setPos({ x: fx.toX, y: fx.toY }));
    return () => cancelAnimationFrame(r);
  }, [fx.id]);
  const angle = Math.atan2(fx.toY - fx.fromY, fx.toX - fx.fromX) * 180 / Math.PI;

  // Per-weapon styling profile
  const isNuke = fx.weaponId === "nuke";
  const isLarge = fx.weaponId === "rocket_large";
  const isMed = fx.weaponId === "rocket_medium";

  const flightMs = isNuke ? 1100 : 850;
  const rocketSize = isNuke ? 64 : isLarge ? 52 : isMed ? 44 : 36;
  const boomSize = isNuke ? 320 : isLarge ? 220 : isMed ? 170 : 130;

  // Trail color per rocket
  const trailColor = isNuke
    ? "rgba(180,255,120,0.95)"   // toxic green
    : isLarge
    ? "rgba(255,90,30,0.95)"     // hot orange
    : isMed
    ? "rgba(255,180,60,0.9)"     // amber
    : "rgba(255,220,120,0.9)";   // light gold

  // Debris pieces for explosion
  const debris = Array.from({ length: isNuke ? 14 : isLarge ? 10 : 7 }, (_, i) => {
    const ang = (i / (isNuke ? 14 : isLarge ? 10 : 7)) * Math.PI * 2;
    const dist = (isNuke ? 160 : isLarge ? 110 : 75) + Math.random() * 40;
    return { dx: Math.cos(ang) * dist, dy: Math.sin(ang) * dist, key: i };
  });

  return (
    <div className="fixed inset-0 pointer-events-none z-[70]">
      {fx.phase === "fly" && (
        <div
          className="absolute"
          style={{
            left: pos.x - rocketSize / 2,
            top: pos.y - rocketSize / 2,
            width: rocketSize,
            height: rocketSize,
            transition: `left ${flightMs}ms cubic-bezier(.45,.05,.55,1), top ${flightMs}ms cubic-bezier(.45,.05,.55,1)`,
            filter: fx.friendly
              ? "drop-shadow(0 0 12px rgba(120,255,180,0.9))"
              : `drop-shadow(0 0 16px ${trailColor})`,
            transform: fx.friendly ? "none" : `rotate(${angle}deg)`,
          }}
        >
          {/* Flame trail behind rocket */}
          {!fx.friendly && (
            <>
              <div
                className="absolute top-1/2 -translate-y-1/2 rounded-full blur-[6px]"
                style={{
                  right: "100%",
                  width: rocketSize * 1.4,
                  height: rocketSize * 0.55,
                  background: `radial-gradient(ellipse, ${trailColor}, transparent 75%)`,
                  opacity: 0.85,
                }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 rounded-full blur-[3px]"
                style={{
                  right: "92%",
                  width: rocketSize * 0.7,
                  height: rocketSize * 0.35,
                  background: `radial-gradient(ellipse, #fff, ${trailColor} 60%, transparent)`,
                }}
              />
            </>
          )}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              fontSize: rocketSize * 0.85,
              filter: isNuke
                ? "drop-shadow(0 0 14px #65a30d) drop-shadow(0 0 24px #000)"
                : "drop-shadow(0 0 8px rgba(0,0,0,0.6))",
            }}
          >
            {isNuke ? "☠️" : fx.emoji}
          </div>
        </div>
      )}

      {fx.phase === "boom" && !fx.friendly && (
        <div
          className="absolute"
          style={{
            left: fx.toX - boomSize / 2,
            top: fx.toY - boomSize / 2,
            width: boomSize,
            height: boomSize,
          }}
        >
          {/* Bright white flash */}
          <div
            className="absolute inset-0 rounded-full animate-pulse"
            style={{
              background: isNuke
                ? "radial-gradient(circle, #fff 0%, #fef08a 30%, #fb923c 60%, transparent 80%)"
                : "radial-gradient(circle, #fff 0%, #fde047 35%, #f97316 65%, transparent 85%)",
            }}
          />
          {/* Shockwave ring */}
          <div
            className={`absolute inset-0 rounded-full border-white/90 ${isNuke ? "animate-shockwave-nuke" : "animate-shockwave"}`}
          />
          {/* Second ring for big ones */}
          {(isNuke || isLarge) && (
            <div
              className={`absolute inset-0 rounded-full border-orange-300/70 ${isNuke ? "animate-shockwave-nuke" : "animate-shockwave"}`}
              style={{ animationDelay: "0.15s" }}
            />
          )}
          {/* Debris particles */}
          {debris.map((d) => (
            <div
              key={d.key}
              className="absolute left-1/2 top-1/2 w-2 h-2 rounded-full bg-amber-300 animate-debris"
              style={{
                ["--dx" as never]: `${d.dx}px`,
                ["--dy" as never]: `${d.dy}px`,
                boxShadow: "0 0 8px rgba(255,180,80,0.9)",
              }}
            />
          ))}
          {/* Mushroom cloud for nuke */}
          {isNuke && (
            <div
              className="absolute left-1/2 bottom-1/2 text-8xl animate-mushroom"
              style={{ filter: "drop-shadow(0 0 20px rgba(0,0,0,0.6))" }}
            >
              ☁️
            </div>
          )}
          {/* Central impact emoji */}
          <div
            className="absolute inset-0 flex items-center justify-center animate-pulse"
            style={{ fontSize: boomSize * 0.4 }}
          >
            💥
          </div>
        </div>
      )}

      {fx.phase === "boom" && fx.friendly && (
        <div className="absolute" style={{ left: fx.toX - 60, top: fx.toY - 60, width: 120, height: 120 }}>
          <div className="absolute inset-0 rounded-full bg-emerald-300/40 animate-ping" />
          <div className="absolute inset-6 rounded-full bg-emerald-200/60 animate-pulse" />
          <div className="absolute inset-0 flex items-center justify-center text-5xl animate-pulse">✨</div>
        </div>
      )}
    </div>
  );
}
