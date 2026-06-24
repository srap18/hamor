import { createFileRoute, Link } from "@tanstack/react-router";
import { BackButton } from "@/components/BackButton";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getShipByCode, getShipByMarketLevel } from "@/lib/ships";
import bossImg from "@/assets/world-boss.png";

export const Route = createFileRoute("/boss")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "🐲 وحش العالم — معركة بحرية" },
      { name: "description", content: "تحدّى وحش العالم في معركة جماعية بحرية، أطلق الصواريخ على البوس واحصد المكافآت النادرة مع أقوى لاعبي ملوك القراصنة." },
      { property: "og:title", content: "🐲 وحش العالم — معركة بحرية" },
      { property: "og:description", content: "معركة جماعية ضد وحش العالم — أطلق صواريخك واحصد المكافآت." },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://www.molok-alqarasna.com/boss" },
    ],
    links: [{ rel: "canonical", href: "https://www.molok-alqarasna.com/boss" }],
  }),
  component: BossPage,
});

type Boss = {
  id: string; name: string;
  hp_max: number; hp_current: number;
  spawned_at: string; expires_at: string;
  defeated_at: string | null;
};
type ShipRow = { id: string; template_id: number | null; catalog_code: string | null; hp: number | null; max_hp: number | null; destroyed_at: string | null };
type RocketRow = { id: string; item_id: string; quantity: number };

function isBossReady(value: unknown): value is Boss {
  const boss = value as Partial<Boss> | null;
  return !!boss?.id && typeof boss.hp_max === "number" && typeof boss.hp_current === "number";
}

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
  const [authChecked, setAuthChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [boss, setBoss] = useState<Boss | null>(null);
  const [loadingBoss, setLoadingBoss] = useState(true);
  const [ships, setShips] = useState<ShipRow[]>([]);
  const [selectedShip, setSelectedShip] = useState<ShipRow | null>(null);
  const [shipHp, setShipHp] = useState(0);          // real HP from DB
  const [shipMaxHp, setShipMaxHp] = useState(1);
  const [shipDestroyed, setShipDestroyed] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [rockets, setRockets] = useState<RocketRow[]>([]);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);
  const [splashes, setSplashes] = useState<Splash[]>([]);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState<"none" | "ship" | "boss">("none");
  const [now, setNow] = useState(Date.now());
  const [dragonStage, setDragonStage] = useState(1);
  const [bossDefeats, setBossDefeats] = useState(0);
  const [attacksLeft, setAttacksLeft] = useState<number>(5);
  const [attackResetAt, setAttackResetAt] = useState<number>(0);
  const [refreshAttackCost, setRefreshAttackCost] = useState<number>(200);
  const [refreshingAttacks, setRefreshingAttacks] = useState(false);
  const myIdRef = useRef<string | null>(null);
  const idRef = useRef(0);
  const nextId = () => ++idRef.current;

  // Difficulty multiplier: each defeat + each dragon stage cranks up boss power
  const diffTier = dragonStage + bossDefeats * 2; // grows fast per defeat
  const bossBaseDmg = 5 + diffTier * 3;
  const bossSpread = 10 + diffTier * 2;
  const bossInterval = Math.max(1800, 6500 - diffTier * 350);
  const heavyEvery = Math.max(2, 5 - Math.floor(diffTier / 3)); // every Nth hit = heavy
  const heavyHitsRef = useRef(0);

  // Initial fetch
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      myIdRef.current = user?.id ?? null;
      const ok = !!user?.id;
      setAllowed(ok);
      setAuthChecked(true);
      if (!ok) { setLoadingBoss(false); return; }
      const { data: b } = await rpc("get_active_boss");
      setBoss(isBossReady(b) ? (b as Boss) : null);
      setLoadingBoss(false);
      if (!user?.id) return;
      const [{ data: sh }, { data: inv }, { data: drg }, { count: defeats }] = await Promise.all([
        supabase.from("ships_owned").select("id,template_id,catalog_code,hp,max_hp,destroyed_at")
          .eq("user_id", user.id).eq("in_storage", false).order("acquired_at"),
        supabase.from("inventory").select("id,item_id,quantity")
          .eq("user_id", user.id).in("item_id", ["rocket_small", "rocket_medium", "rocket_large", "nuke"]),
        supabase.from("dragons").select("stage").eq("user_id", user.id).maybeSingle(),
        supabase.from("world_boss").select("id", { count: "exact", head: true }).not("defeated_at", "is", null),
      ]);
      const sList = (sh ?? []) as ShipRow[];
      setShips(sList);
      // Prefer a non-destroyed ship, otherwise highest tier.
      const sorted = [...sList].sort((a, b) => (b.template_id ?? 0) - (a.template_id ?? 0));
      const best = sorted.find((s) => !s.destroyed_at && (s.hp ?? 0) > 0) ?? sorted[0] ?? null;
      setSelectedShip(best ?? null);
      if (best) {
        setShipHp(Math.max(0, best.hp ?? 0));
        setShipMaxHp(Math.max(1, best.max_hp ?? 1));
        setShipDestroyed(!!best.destroyed_at || (best.hp ?? 0) <= 0);
      }
      setRockets((inv ?? []) as RocketRow[]);
      if (drg?.stage) setDragonStage(drg.stage);
      if (typeof defeats === "number") setBossDefeats(defeats);
      const { data: q } = await rpc("boss_attack_status");
      if (q) {
        setAttacksLeft(Number(q.remaining ?? 5));
        setAttackResetAt(new Date(q.reset_at ?? Date.now()).getTime());
        setRefreshAttackCost(Number(q.refresh_gem_cost ?? 200));
      }
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

  // Boss counter-attacks — scales harder with each defeat & dragon stage
  useEffect(() => {
    if (!boss || boss.hp_current <= 0 || !selectedShip || shipHp <= 0) return;
    const t = setInterval(() => {
      const pid = nextId();
      setProjectiles((p) => [...p, { id: pid, kind: "boss", key: nextId() }]);
      setTimeout(() => {
        setProjectiles((p) => p.filter((x) => x.id !== pid));
        heavyHitsRef.current += 1;
        const isHeavy = heavyHitsRef.current % heavyEvery === 0;
        const isCrit = Math.random() < Math.min(0.35, 0.05 + diffTier * 0.025);
        let dmg = bossBaseDmg + Math.floor(Math.random() * bossSpread);
        if (isHeavy) dmg = Math.floor(dmg * 2.2);
        if (isCrit) dmg = Math.floor(dmg * 1.8);
        setSplashes((s) => [...s, { id: nextId(), side: "ship", crit: isCrit || isHeavy, dmg }]);
        setShake("ship");
        setShipHp((hp) => Math.max(0, hp - dmg));
        setTimeout(() => setShake("none"), 220);
      }, 900);
    }, bossInterval + Math.random() * 1500);
    return () => clearInterval(t);
  }, [boss, selectedShip, shipHp, bossInterval, bossBaseDmg, bossSpread, heavyEvery, diffTier]);

  // Cleanup splashes
  useEffect(() => {
    if (!splashes.length) return;
    const t = setTimeout(() => setSplashes((s) => s.slice(1)), 1400);
    return () => clearTimeout(t);
  }, [splashes]);

  const fire = useCallback(async (weaponId: string) => {
    if (busy || !boss || boss.hp_current <= 0 || shipHp <= 0) return;
    if (attacksLeft <= 0) {
      alert(`⛔ انتهت هجماتك اليومية على الوحش (٥ مرات). جددها بـ ${refreshAttackCost} جوهرة أو انتظر التجديد.`);
      return;
    }
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
      if (data?.quota_exceeded) {
        setAttacksLeft(0);
        if (data.reset_at) setAttackResetAt(new Date(data.reset_at).getTime());
      }
      if (error) return alert(error.message);
      if (data?.error) return alert(data.error);
      return;
    }
    // optimistic local rocket count -1
    setRockets((rs) => rs.map((r) => r.item_id === weaponId ? { ...r, quantity: r.quantity - 1 } : r).filter((r) => r.quantity > 0));
    if (typeof data?.attacks_remaining === "number") setAttacksLeft(data.attacks_remaining);
    setTimeout(() => {
      setProjectiles((p) => p.filter((x) => x.id !== pid));
      setSplashes((s) => [...s, { id: nextId(), side: "boss", crit: data.crit, dmg: data.damage }]);
      setShake("boss");
      // optimistic HP decrement — realtime UPDATE will reconcile
      setBoss((b) => b ? { ...b, hp_current: Math.max(0, b.hp_current - (data.damage || 0)) } : b);
      setTimeout(() => setShake("none"), 220);
      setBusy(false);
      if (data.killed) {
        setBossDefeats((n) => n + 1);
        const nextBoss = isBossReady(data.next_boss) ? (data.next_boss as Boss) : null;
        if (nextBoss) {
          setTimeout(() => {
            setBoss(nextBoss);
            setShipHp(100);
          }, 650);
        }
        setTimeout(() => alert("💀 سقط الوحش! ظهر وحش جديد فورًا."), 600);
      }
    }, 850);

  }, [busy, boss, shipHp, rockets, attacksLeft, refreshAttackCost]);

  const refreshAttacks = useCallback(async () => {
    if (refreshingAttacks) return;
    if (!confirm(`استخدام ${refreshAttackCost} جوهرة لتجديد ٥ هجمات على الوحش؟`)) return;
    setRefreshingAttacks(true);
    const { data, error } = await rpc("refresh_boss_attacks");
    setRefreshingAttacks(false);
    if (error) return alert(error.message);
    if (data?.ok === false) return alert(data.error || "فشل التجديد");
    setAttacksLeft(5);
    setAttackResetAt(Date.now() + 24 * 3600 * 1000);
    alert("✅ تم تجديد الهجمات!");
  }, [refreshingAttacks, refreshAttackCost]);

  if (authChecked && !allowed) {
    return (
      <div className="fixed inset-0 overflow-y-auto flex items-center justify-center" dir="rtl"
        style={{ background: "radial-gradient(ellipse at top, #1a1a2e 0%, #0a0a14 60%, #000 100%)" }}>
        <div className="absolute top-4 right-3">
          <BackButton className="glass-hud rounded-full px-3 py-1.5 text-cyan-200 text-sm font-bold border border-cyan-500/40">← رجوع</BackButton>
        </div>
        <div className="max-w-sm mx-auto px-6 text-center">
          <div className="text-7xl mb-4">🔒</div>
          <div className="text-2xl font-black text-amber-200 mb-2">معركة الوحش مقفلة مؤقتاً</div>
          <div className="text-cyan-300/70 text-sm">سنفتحها قريباً بتحديث جديد. ترقّبوا!</div>
        </div>
      </div>
    );
  }

  if (loadingBoss) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center" dir="rtl">
        <div className="text-rose-300 animate-pulse">جاري إيقاظ الوحش...</div>
      </div>
    );
  }


  if (!boss) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center px-4" dir="rtl">
        <div className="max-w-sm rounded-2xl border border-rose-500/50 bg-stone-950/90 p-5 text-center shadow-2xl">
          <div className="mb-2 text-4xl">🐲</div>
          <div className="mb-2 text-lg font-extrabold text-rose-100">ما فيه وحش نشط حالياً</div>
          <div className="mb-4 text-sm text-rose-200/70">ارجع بعد شوي وبيظهر وحش جديد للقتال.</div>
          <Link to="/dragon" className="inline-flex rounded-xl border border-rose-400/60 bg-rose-900/50 px-4 py-2 text-sm font-bold text-rose-100 active:scale-95">
            ← رجوع للتنين
          </Link>
        </div>
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
          <BackButton className="rounded-full px-3 py-1.5 bg-stone-900/70 text-rose-200 text-sm font-bold border border-rose-500/50">← رجوع</BackButton>
          <div className="rounded-full px-3 py-1.5 bg-stone-900/70 text-rose-200 text-sm font-bold border border-rose-500/50">⏰ {expH}س {expM}د</div>
        </div>

        <div className="text-center mb-2">
          <div className="inline-block px-4 py-1 rounded-full bg-gradient-to-r from-rose-800/60 to-amber-800/60 border border-rose-400/60">
            <span className="text-rose-100 font-extrabold">🐲 {boss.name}</span>
          </div>
          <div className="mt-1 inline-flex ms-2 items-center gap-1 px-2 py-0.5 rounded-full bg-rose-950/80 border border-rose-500/60 text-[10px] font-black text-rose-100">
            <span>⚔️ صعوبة {diffTier}</span>
            <span className="text-rose-300/80">·</span>
            <span>💀 {bossDefeats}</span>
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

        {/* Daily attack quota */}
        <div className="bg-stone-900/80 border border-amber-600/50 rounded-xl px-3 py-2 mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold">
            <span className="text-amber-200">🎯 الهجمات:</span>
            <span className="text-amber-100 tabular-nums">{attacksLeft}/5</span>
            {attacksLeft < 5 && attackResetAt > now && (
              <span className="text-amber-300/70 text-[10px]">
                · تجديد {Math.max(0, Math.floor((attackResetAt - now) / 3600000))}س {Math.max(0, Math.floor(((attackResetAt - now) % 3600000) / 60000))}د
              </span>
            )}
          </div>
          <button
            type="button"
            disabled={refreshingAttacks || attacksLeft >= 5}
            onClick={refreshAttacks}
            className="px-3 py-1 rounded-lg text-[11px] font-extrabold bg-gradient-to-b from-purple-500 to-purple-700 text-white shadow-md disabled:opacity-40 active:scale-95"
          >
            💎 {refreshAttackCost} تجديد
          </button>
        </div>

        {/* DP per hit info */}
        <div className="text-center text-[10px] text-emerald-300/70 mb-2">
          🐉 كل هجمة تعطي تنينك +٥,٠٠٠ نقطة تطوّر
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
            <div key={p.key} className="absolute z-30 flex items-center gap-1"
              style={{ right: "40%", bottom: "38%", animation: "rocket-arc-left 0.85s cubic-bezier(.4,.1,.6,1) forwards" }}>
              {/* trail */}
              <div className="h-1.5 w-16 rounded-full origin-right"
                style={{
                  background: "linear-gradient(to left, rgba(255,200,80,1), rgba(255,80,20,0.8), transparent)",
                  filter: "blur(2px)", animation: "trail-pulse 0.2s linear infinite",
                }} />
              <div className="text-4xl drop-shadow-[0_0_14px_rgba(255,180,40,1)]">
                {p.weapon === "nuke" ? "☢️" : p.weapon === "rocket_large" ? "💥" : p.weapon === "rocket_medium" ? "🎯" : "🚀"}
              </div>
            </div>
          ) : (
            <div key={p.key} className="absolute z-30 flex items-center gap-1"
              style={{ left: "40%", top: "35%", animation: "rocket-arc-right 0.9s cubic-bezier(.4,.1,.6,1) forwards" }}>
              <div className="text-4xl drop-shadow-[0_0_14px_rgba(244,63,94,1)]">🔥</div>
              <div className="h-1.5 w-16 rounded-full"
                style={{
                  background: "linear-gradient(to right, rgba(255,80,40,1), rgba(120,20,20,0.8), transparent)",
                  filter: "blur(2px)", animation: "trail-pulse 0.2s linear infinite",
                }} />
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
