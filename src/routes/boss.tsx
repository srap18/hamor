import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getShipByCode, getShipByMarketLevel } from "@/lib/ships";
import bossImg from "@/assets/world-boss.png";

export const Route = createFileRoute("/boss")({
  ssr: false,
  head: () => ({ meta: [{ title: "🐲 وحش العالم — معركة بحرية" }] }),
  component: BossPage,
});

type Boss = {
  id: string; name: string;
  hp_max: number; hp_current: number;
  spawned_at: string; expires_at: string;
  defeated_at: string | null;
};
type ShipRow = { id: string; template_id: number | null; catalog_code: string | null; hp: number | null; max_hp: number | null };
type RocketRow = { id: string; item_id: string; quantity: number };

const ROCKETS = [
  { id: "rocket_small",  name: "صغير",   dmg: 800,   color: "from-sky-500 to-sky-800",       border: "border-sky-300" },
  { id: "rocket_medium", name: "متوسط",  dmg: 4000,  color: "from-emerald-500 to-emerald-800", border: "border-emerald-300" },
  { id: "rocket_large",  name: "كبير",   dmg: 18000, color: "from-amber-500 to-amber-800",    border: "border-amber-300" },
  { id: "nuke",          name: "ذرية",   dmg: 70000, color: "from-fuchsia-500 to-rose-900",   border: "border-fuchsia-300" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase.rpc.bind(supabase) as unknown as (n: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;

type Projectile = { id: number; kind: "rocket" | "boss"; weapon?: string; key: number };
type Splash = { id: number; side: "ship" | "boss"; crit?: boolean; dmg?: number };

function BossPage() {
  const [boss, setBoss] = useState<Boss | null>(null);
  const [ships, setShips] = useState<ShipRow[]>([]);
  const [selectedShip, setSelectedShip] = useState<ShipRow | null>(null);
  const [shipHp, setShipHp] = useState(100); // local %; cosmetic
  const [rockets, setRockets] = useState<RocketRow[]>([]);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);
  const [splashes, setSplashes] = useState<Splash[]>([]);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState<"none" | "ship" | "boss">("none");
  const [now, setNow] = useState(Date.now());
  const myIdRef = useRef<string | null>(null);
  const idRef = useRef(0);
  const nextId = () => ++idRef.current;

  // Initial fetch
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      myIdRef.current = user?.id ?? null;
      const { data: b } = await rpc("get_active_boss");
      setBoss(b as Boss);
      if (!user?.id) return;
      const [{ data: sh }, { data: inv }] = await Promise.all([
        supabase.from("ships_owned").select("id,template_id,catalog_code,hp,max_hp")
          .eq("user_id", user.id).eq("in_storage", false).order("acquired_at"),
        supabase.from("inventory").select("id,item_id,quantity")
          .eq("user_id", user.id).in("item_id", ["rocket_small", "rocket_medium", "rocket_large", "nuke"]),
      ]);
      const sList = (sh ?? []) as ShipRow[];
      setShips(sList);
      // Pick strongest by template_id
      const best = [...sList].sort((a, b) => (b.template_id ?? 0) - (a.template_id ?? 0))[0];
      setSelectedShip(best ?? null);
      setRockets((inv ?? []) as RocketRow[]);
    })();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // realtime boss
  useEffect(() => {
    if (!boss?.id) return;
    const ch = supabase.channel(`world_boss_${boss.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "world_boss", filter: `id=eq.${boss.id}` },
        (p) => setBoss((b) => b ? { ...b, ...(p.new as Partial<Boss>) } : b))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [boss?.id]);

  // Boss counter-attacks every 6–10s
  useEffect(() => {
    if (!boss || boss.hp_current <= 0 || !selectedShip || shipHp <= 0) return;
    const t = setInterval(() => {
      // boss projectile from boss → ship
      const pid = nextId();
      setProjectiles((p) => [...p, { id: pid, kind: "boss", key: nextId() }]);
      setTimeout(() => {
        setProjectiles((p) => p.filter((x) => x.id !== pid));
        const dmg = 5 + Math.floor(Math.random() * 10);
        setSplashes((s) => [...s, { id: nextId(), side: "ship", dmg }]);
        setShake("ship");
        setShipHp((hp) => Math.max(0, hp - dmg));
        setTimeout(() => setShake("none"), 220);
      }, 900);
    }, 6500 + Math.random() * 3500);
    return () => clearInterval(t);
  }, [boss, selectedShip, shipHp]);

  // Cleanup splashes
  useEffect(() => {
    if (!splashes.length) return;
    const t = setTimeout(() => setSplashes((s) => s.slice(1)), 1400);
    return () => clearTimeout(t);
  }, [splashes]);

  const fire = useCallback(async (weaponId: string) => {
    if (busy || !boss || boss.hp_current <= 0 || shipHp <= 0) return;
    const ammo = rockets.find((r) => r.item_id === weaponId);
    if (!ammo || ammo.quantity < 1) return;
    setBusy(true);
    // optimistic projectile
    const pid = nextId();
    setProjectiles((p) => [...p, { id: pid, kind: "rocket", weapon: weaponId, key: nextId() }]);
    // call RPC (consumes one rocket of cheapest type — we want the chosen type)
    const { data, error } = await rpc("attack_boss_with", { p_weapon: weaponId });
    if (error || (data && data.ok === false)) {
      setProjectiles((p) => p.filter((x) => x.id !== pid));
      setBusy(false);
      if (error) return alert(error.message);
      if (data?.error) return alert(data.error);
      return;
    }
    // optimistic local rocket count -1
    setRockets((rs) => rs.map((r) => r.item_id === weaponId ? { ...r, quantity: r.quantity - 1 } : r).filter((r) => r.quantity > 0));
    setTimeout(() => {
      setProjectiles((p) => p.filter((x) => x.id !== pid));
      setSplashes((s) => [...s, { id: nextId(), side: "boss", crit: data.crit, dmg: data.damage }]);
      setShake("boss");
      setTimeout(() => setShake("none"), 220);
      setBusy(false);
      if (data.killed) setTimeout(() => alert("💀 سقط الوحش! تحقق من غنائمك"), 600);
    }, 850);
  }, [busy, boss, shipHp, rockets]);

  if (!boss) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center" dir="rtl">
        <div className="text-rose-300 animate-pulse">جاري إيقاظ الوحش...</div>
      </div>
    );
  }

  const hpPct = boss.hp_max > 0 ? (boss.hp_current / boss.hp_max) * 100 : 0;
  const dead = boss.hp_current <= 0;
  const expMs = new Date(boss.expires_at).getTime() - now;
  const expH = Math.max(0, Math.floor(expMs / 3600000));
  const expM = Math.max(0, Math.floor((expMs % 3600000) / 60000));

  const shipDef = selectedShip
    ? (selectedShip.catalog_code
        ? getShipByCode(selectedShip.catalog_code)
        : getShipByMarketLevel(selectedShip.template_id ?? 1))
    : null;

  return (
    <div className="fixed inset-0 overflow-y-auto" dir="rtl"
      style={{ background:
        "radial-gradient(ellipse at 50% 0%, #2a0f0f 0%, #0a0608 55%, #000 100%)," +
        "linear-gradient(to bottom, #1a0a14 0%, #050308 60%, #000 100%)" }}>
      <style>{`
        @keyframes float-up { 0%{transform:translateY(0) scale(1);opacity:1} 100%{transform:translateY(-90px) scale(1.5);opacity:0} }
        @keyframes shake-x { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-8px)} 75%{transform:translateX(8px)} }
        @keyframes boss-fly {
          0%   { transform: translate(0,0) rotate(-2deg) scale(1); filter:drop-shadow(0 0 30px rgba(244,63,94,0.7)); }
          25%  { transform: translate(8px,-18px) rotate(3deg) scale(1.04); filter:drop-shadow(0 0 55px rgba(255,80,30,1)); }
          50%  { transform: translate(-4px,-28px) rotate(-3deg) scale(1.06); filter:drop-shadow(0 0 70px rgba(255,120,30,1)); }
          75%  { transform: translate(-10px,-12px) rotate(2deg) scale(1.03); filter:drop-shadow(0 0 50px rgba(244,63,94,0.9)); }
          100% { transform: translate(0,0) rotate(-2deg) scale(1); filter:drop-shadow(0 0 30px rgba(244,63,94,0.7)); }
        }
        @keyframes boss-wing { 0%,100%{transform:scaleX(-1) skewY(-2deg)} 50%{transform:scaleX(-1) skewY(3deg)} }
        @keyframes boss-shadow { 0%,100%{transform:scaleX(1) scaleY(.4);opacity:.55} 50%{transform:scaleX(.7) scaleY(.3);opacity:.3} }
        @keyframes ship-bob { 0%,100%{transform:translateY(0) rotate(-1deg)} 50%{transform:translateY(-6px) rotate(2deg)} }
        @keyframes wave-roll { 0%{transform:translateX(0)} 100%{transform:translateX(-40px)} }
        @keyframes rocket-arc-left {
          0%   { transform: translate(0,0) rotate(180deg); opacity:0; }
          8%   { opacity:1; }
          50%  { transform: translate(-38vw,-50px) rotate(195deg); }
          100% { transform: translate(-72vw,20px) rotate(210deg); opacity:1; }
        }
        @keyframes rocket-arc-right {
          0%   { transform: translate(0,0) rotate(0deg); opacity:0; }
          8%   { opacity:1; }
          50%  { transform: translate(38vw,-40px) rotate(-15deg); }
          100% { transform: translate(72vw,30px) rotate(-30deg); opacity:1; }
        }
        @keyframes trail-pulse { 0%,100%{opacity:.6; transform:scaleX(1)} 50%{opacity:1; transform:scaleX(1.3)} }
        @keyframes splash { 0%{transform:scale(.4);opacity:0} 30%{opacity:1} 100%{transform:scale(2.6);opacity:0} }
        @keyframes lightning { 0%,90%,100%{opacity:0} 92%,94%{opacity:1; box-shadow:0 0 30px rgba(244,63,94,0.8)} }
        @keyframes ember-rise { 0%{transform:translateY(0);opacity:0} 20%{opacity:1} 100%{transform:translateY(-40px);opacity:0} }
      `}</style>

      {/* Lightning */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="absolute w-px h-32 bg-rose-500/40"
            style={{ left: `${(i*37)%100}%`, top: `${(i*23)%70}%`, animation: `lightning ${3+i%3}s ${i*0.3}s infinite`, opacity: 0 }} />
        ))}
      </div>

      <div className="relative z-10 max-w-md mx-auto px-3 pt-3 pb-4 min-h-full flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-2">
          <Link to="/" className="rounded-full px-3 py-1.5 bg-stone-900/70 text-rose-200 text-sm font-bold border border-rose-500/50">← رجوع</Link>
          <div className="rounded-full px-3 py-1.5 bg-stone-900/70 text-rose-200 text-sm font-bold border border-rose-500/50">⏰ {expH}س {expM}د</div>
        </div>

        <div className="text-center mb-2">
          <div className="inline-block px-4 py-1 rounded-full bg-gradient-to-r from-rose-800/60 to-amber-800/60 border border-rose-400/60">
            <span className="text-rose-100 font-extrabold">🐲 {boss.name}</span>
          </div>
        </div>

        {/* Boss HP */}
        <div className="bg-stone-900/80 border border-rose-700/50 rounded-xl px-3 py-2 mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-rose-200 text-xs font-bold">❤️ الوحش</span>
            <span className="text-rose-100 font-extrabold tabular-nums text-xs">{boss.hp_current.toLocaleString()} / {boss.hp_max.toLocaleString()}</span>
          </div>
          <div className="h-3 rounded-full bg-stone-950 overflow-hidden border border-rose-900">
            <div className="h-full bg-gradient-to-r from-rose-600 via-red-500 to-amber-500 transition-all"
              style={{ width: `${hpPct}%`, boxShadow: "0 0 12px rgba(244,63,94,0.9)" }} />
          </div>
        </div>

        {/* BATTLE ARENA */}
        <div className="relative flex-1 min-h-[300px] rounded-2xl overflow-hidden border-2 border-rose-900/50 mb-2"
             style={{ background:
                "linear-gradient(to bottom, #1a1024 0%, #0a1830 50%, #04101e 100%)" }}>
          {/* moving waves */}
          <div className="absolute inset-x-0 bottom-0 h-1/2 overflow-hidden opacity-70">
            {[0,1,2].map((i) => (
              <div key={i} className="absolute inset-x-0"
                style={{
                  bottom: `${i*22}%`,
                  height: 30,
                  background: `repeating-linear-gradient(90deg, rgba(56,189,248,0.${4-i}) 0 12px, transparent 12px 24px)`,
                  animation: `wave-roll ${2.5+i*0.6}s linear infinite`,
                  filter: "blur(1px)",
                }} />
            ))}
          </div>

          {/* BOSS (left side) — flying */}
          <div className={`absolute left-2 top-2 bottom-12 w-[55%] flex items-center justify-center`}
               style={{ animation: shake === "boss" ? "shake-x 0.22s" : undefined }}>
            {/* ground shadow */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full"
              style={{ width: "70%", height: 18, background: "radial-gradient(ellipse, rgba(0,0,0,0.7) 0%, transparent 70%)",
                animation: "boss-shadow 3.2s ease-in-out infinite" }} />
            {/* embers under boss */}
            {[0,1,2,3].map((i) => (
              <span key={i} className="absolute rounded-full"
                style={{ left: `${30+i*12}%`, bottom: 10, width: 4, height: 4,
                  background: "radial-gradient(circle, #ffb84a, transparent)",
                  animation: `ember-rise ${1.6+i*0.3}s ${i*0.4}s ease-out infinite` }} />
            ))}
            <div className="relative w-full h-full" style={{ animation: "boss-fly 3.2s ease-in-out infinite" }}>
              <img src={bossImg} alt={boss.name} draggable={false}
                className="w-full h-full object-contain"
                style={{
                  animation: "boss-wing 2.4s ease-in-out infinite",
                  opacity: dead ? 0.3 : 1, filter: dead ? "grayscale(1)" : undefined,
                }} />
            </div>
            {splashes.filter((s) => s.side === "boss").map((s) => (
              <div key={s.id}>
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{ width: 120, height: 120,
                    background: "radial-gradient(circle, rgba(255,240,120,1) 0%, rgba(255,80,20,0.8) 35%, transparent 70%)",
                    animation: "splash 0.7s ease-out forwards" }} />
                <div className={`absolute left-1/2 top-1/4 -translate-x-1/2 font-extrabold pointer-events-none ${s.crit ? "text-amber-300 text-3xl" : "text-rose-200 text-2xl"}`}
                  style={{ animation: "float-up 1.4s ease-out forwards",
                    textShadow: s.crit ? "0 0 20px rgba(251,191,36,1)" : "0 0 12px rgba(244,63,94,0.9)" }}>
                  {s.crit ? "💥 " : ""}-{(s.dmg ?? 0).toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          {/* SHIP (right side, facing the boss) */}
          {shipDef && (
            <div className={`absolute right-2 bottom-10 w-[42%] aspect-[4/3]`}
                 style={{ animation: shake === "ship" ? "shake-x 0.22s" : undefined }}>
              <div style={{ animation: "ship-bob 2.6s ease-in-out infinite", transformOrigin: "50% 90%" }}>
                <img src={shipDef.image} alt={shipDef.name} draggable={false}
                  className="w-full h-full object-contain"
                  style={{ transform: "scaleX(-1)",
                    filter: shipHp <= 0 ? "grayscale(0.9) brightness(0.5)" : "drop-shadow(0 6px 8px rgba(0,0,0,0.7))" }} />
              </div>
              {splashes.filter((s) => s.side === "ship").map((s) => (
                <div key={s.id}>
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{ width: 70, height: 70,
                      background: "radial-gradient(circle, rgba(80,180,255,1) 0%, rgba(20,80,180,0.7) 40%, transparent 70%)",
                      animation: "splash 0.6s ease-out forwards" }} />
                  <div className="absolute left-1/2 top-0 -translate-x-1/2 font-extrabold text-rose-200 text-lg pointer-events-none"
                    style={{ animation: "float-up 1.3s ease-out forwards", textShadow: "0 0 10px rgba(244,63,94,0.9)" }}>
                    -{s.dmg}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Projectiles */}
          {projectiles.map((p) => p.kind === "rocket" ? (
            <div key={p.key} className="absolute"
              style={{ right: "30%", bottom: "30%", animation: "rocket-fly-left 0.85s linear forwards" }}>
              <div className="text-3xl" style={{ filter: "drop-shadow(0 0 8px rgba(255,180,40,1))" }}>
                {p.weapon === "nuke" ? "☢️" : p.weapon === "rocket_large" ? "💥" : p.weapon === "rocket_medium" ? "🎯" : "🚀"}
              </div>
            </div>
          ) : (
            <div key={p.key} className="absolute"
              style={{ left: "30%", top: "30%", animation: "rocket-fly-right 0.9s linear forwards" }}>
              <div className="text-3xl" style={{ filter: "drop-shadow(0 0 10px rgba(244,63,94,1))" }}>🔥</div>
            </div>
          ))}

          {dead && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="bg-stone-900/95 border-2 border-amber-400 rounded-2xl px-6 py-4 text-center">
                <div className="text-4xl mb-1">💀</div>
                <div className="text-amber-100 font-extrabold">سقط الوحش!</div>
                <div className="text-amber-300/70 text-xs mt-1">سيظهر بوس جديد قريباً</div>
              </div>
            </div>
          )}
        </div>

        {/* Ship HP + selector */}
        {selectedShip && shipDef && (
          <div className="bg-stone-900/80 border border-sky-700/50 rounded-xl px-3 py-2 mb-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sky-200 text-xs font-bold flex-1 truncate">⚓ {shipDef.name}</span>
              <span className="text-sky-100 font-extrabold tabular-nums text-xs">{shipHp}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-stone-950 overflow-hidden border border-sky-900">
              <div className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all"
                style={{ width: `${shipHp}%`, boxShadow: "0 0 8px rgba(56,189,248,0.8)" }} />
            </div>
            {ships.length > 1 && (
              <div className="flex gap-1.5 mt-2 overflow-x-auto">
                {ships.map((s) => {
                  const d = s.catalog_code ? getShipByCode(s.catalog_code) : getShipByMarketLevel(s.template_id ?? 1);
                  const sel = s.id === selectedShip.id;
                  return (
                    <button key={s.id} onClick={() => { setSelectedShip(s); setShipHp(100); }}
                      className={`shrink-0 w-12 h-12 rounded-lg border-2 ${sel ? "border-amber-300 bg-amber-500/20" : "border-stone-700 bg-stone-800/60"} flex items-center justify-center active:scale-95`}>
                      <img src={d.image} alt="" className="w-10 h-10 object-contain" style={{ transform: "scaleX(-1)" }} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Rockets inventory */}
        {!dead && (
          <div className="grid grid-cols-4 gap-2">
            {ROCKETS.map((rk) => {
              const have = rockets.find((r) => r.item_id === rk.id)?.quantity ?? 0;
              const disabled = busy || have <= 0 || shipHp <= 0;
              return (
                <button key={rk.id} disabled={disabled} onClick={() => fire(rk.id)}
                  className={`relative rounded-xl bg-gradient-to-b ${rk.color} border-2 ${rk.border} py-2 active:scale-95 transition-transform shadow-lg ${disabled ? "opacity-40 grayscale" : ""}`}>
                  <div className="text-2xl">{rk.id === "nuke" ? "☢️" : rk.id === "rocket_large" ? "💥" : rk.id === "rocket_medium" ? "🎯" : "🚀"}</div>
                  <div className="text-[10px] font-bold text-white/90">{rk.name}</div>
                  <div className="text-[10px] text-white/80 tabular-nums">-{rk.dmg.toLocaleString()}</div>
                  <div className="absolute -top-1.5 -right-1.5 bg-stone-900 border border-amber-400 rounded-full px-1.5 py-0.5 text-amber-200 text-[10px] font-extrabold tabular-nums">×{have}</div>
                </button>
              );
            })}
          </div>
        )}
        {shipHp <= 0 && !dead && (
          <div className="mt-2 text-center text-rose-300 text-sm font-bold">سفينتك تعطلت! اختر سفينة أخرى</div>
        )}
      </div>
    </div>
  );
}
