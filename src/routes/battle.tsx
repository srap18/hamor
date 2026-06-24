import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DRAGON_STAGES, getStage } from "@/lib/dragon";
import arenaBg from "@/assets/battle-arena-bg.jpg";

export const Route = createFileRoute("/battle")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    vs: typeof s.vs === "string" ? s.vs : undefined,
  }),
  head: () => ({ meta: [{ title: "⚔️ معركة التنين — ساحة القتال" }] }),
  component: BattlePage,
});

type Fighter = {
  id: string;
  name: string;
  avatar: string | null;
  emoji: string;
  stage: number;
  power: number;
  maxHp: number;
  hp: number;
};

type FloatNum = { id: number; x: number; y: number; v: number; side: "me" | "op" };
type Bolt = { id: number; from: "me" | "op" };

function avatarFallback(emoji: string) {
  return emoji || "🐉";
}

// HP & power scale with dragon stage so stronger dragons feel stronger
function statsForStage(stage: number) {
  const s = Math.max(1, stage);
  return {
    maxHp: 350 + s * 110,
    power: 80 + s * 28,
  };
}

function BattlePage() {
  const { vs } = useSearch({ from: "/battle" });
  const [me, setMe] = useState<Fighter | null>(null);
  const [op, setOp] = useState<Fighter | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"win" | "lose" | null>(null);
  const [floats, setFloats] = useState<FloatNum[]>([]);
  const [bolts, setBolts] = useState<Bolt[]>([]);
  const [shake, setShake] = useState<"me" | "op" | null>(null);
  const [reward, setReward] = useState<number>(0);
  const fidRef = useRef(1);

  // pick a matched opponent: prefer equal stage; otherwise pick the closest stage
  async function pickRandomOpponent(meId: string, myStage: number, excludeId?: string | null): Promise<string | null> {
    type Row = { user_id: string; stage: number };
    const { data: allRows } = await supabase
      .from("dragons")
      .select("user_id,stage")
      .neq("user_id", meId)
      .limit(500);
    const pool: Row[] = (allRows ?? []).filter(r => r.user_id !== excludeId);
    if (!pool.length) return null;
    // prefer exact stage, else find the minimum stage difference
    const exact = pool.filter(r => r.stage === myStage);
    let candidates: Row[] = exact;
    if (!candidates.length) {
      const minDiff = Math.min(...pool.map(r => Math.abs(r.stage - myStage)));
      candidates = pool.filter(r => Math.abs(r.stage - myStage) === minDiff);
    }
    // verify a real profile (display_name set), up to 5 random picks
    for (let tries = 0; tries < 5 && candidates.length; tries++) {
      const idx = Math.floor(Math.random() * candidates.length);
      const candidate = candidates[idx].user_id;
      const { data: prof } = await supabase.from("profiles")
        .select("id,display_name").eq("id", candidate).maybeSingle();
      if (prof?.display_name) return candidate;
      candidates.splice(idx, 1);
    }
    return candidates[0]?.user_id ?? pool[0]?.user_id ?? null;
  }

  async function loadOpponent(meId: string, myStage: number, _myHp: number, forcedId?: string | null, excludeId?: string | null) {
    const oppId = forcedId ?? await pickRandomOpponent(meId, myStage, excludeId);
    if (!oppId) return;
    const [{ data: oProf }, { data: oDragon }] = await Promise.all([
      supabase.from("profiles").select("display_name,avatar_emoji,avatar_url").eq("id", oppId).maybeSingle(),
      supabase.from("dragons").select("stage").eq("user_id", oppId).maybeSingle(),
    ]);
    const oStage = oDragon?.stage ?? myStage;
    const { maxHp, power } = statsForStage(oStage);
    setOp({
      id: oppId,
      name: oProf?.display_name ?? "خصم",
      avatar: oProf?.avatar_url ?? null,
      emoji: oProf?.avatar_emoji ?? "🐲",
      stage: oStage,
      power,
      maxHp,
      hp: maxHp,
    });
  }

  // load fighters
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: myProf }, { data: myDragon }] = await Promise.all([
        supabase.from("profiles").select("display_name,avatar_emoji,avatar_url").eq("id", user.id).maybeSingle(),
        supabase.from("dragons").select("stage").eq("user_id", user.id).maybeSingle(),
      ]);
      const myStage = myDragon?.stage ?? 1;
      const { maxHp: myHp, power: myPower } = statsForStage(myStage);
      setMe({
        id: user.id,
        name: myProf?.display_name ?? "أنا",
        avatar: myProf?.avatar_url ?? null,
        emoji: myProf?.avatar_emoji ?? "🐉",
        stage: myStage,
        power: myPower,
        maxHp: myHp,
        hp: myHp,
      });
      await loadOpponent(user.id, myStage, myHp, vs ?? null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vs]);

  // turn-based — opponent only attacks after my attack lands
  function spawnFloat(side: "me" | "op", v: number) {
    const id = fidRef.current++;
    setFloats(f => [...f, { id, x: 40 + Math.random() * 20, y: 30 + Math.random() * 20, v, side }]);
    setTimeout(() => setFloats(f => f.filter(x => x.id !== id)), 900);
  }
  function spawnBolt(from: "me" | "op") {
    const id = fidRef.current++;
    setBolts(b => [...b, { id, from }]);
    setTimeout(() => setBolts(b => b.filter(x => x.id !== id)), 700);
  }

  function doMyAttack() {
    if (!me || !op || busy || result) return;
    setBusy(true);
    const crit = Math.random() < 0.18;
    const base = me.power;
    const dmg = Math.max(10, Math.round((base + Math.random() * base * 0.4) * (crit ? 2 : 1)));
    spawnBolt("me");
    setTimeout(() => {
      spawnFloat("op", dmg);
      setShake("op");
      setTimeout(() => setShake(null), 200);
      let opDead = false;
      setOp(o => {
        if (!o) return o;
        const hp = Math.max(0, o.hp - dmg);
        if (hp === 0) opDead = true;
        return { ...o, hp };
      });
      if (opDead) {
        finishWin();
        setBusy(false);
        return;
      }
      // opponent's turn (after a short beat)
      setTimeout(() => doOpponentAttack(), 750);
    }, 400);
  }

  function doOpponentAttack() {
    if (!me || !op || result) {
      setBusy(false);
      return;
    }
    const base = Math.round(op.power * 0.75);
    const crit = Math.random() < 0.12;
    const dmg = Math.max(8, Math.round((base + Math.random() * base * 0.4) * (crit ? 2 : 1)));
    spawnBolt("op");
    setTimeout(() => {
      spawnFloat("me", dmg);
      setShake("me");
      setTimeout(() => setShake(null), 200);
      let meDead = false;
      setMe(m => {
        if (!m) return m;
        const hp = Math.max(0, m.hp - dmg);
        if (hp === 0) meDead = true;
        return { ...m, hp };
      });
      if (meDead) finishLose();
      setBusy(false);
    }, 400);
  }

  async function finishWin() {
    if (result) return;
    setResult("win");
    const r = 5 + Math.floor(Math.random() * 6);
    setReward(r);
    // award arena points (best-effort)
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const ws = (() => {
          const d = new Date();
          const day = d.getUTCDay();
          const diff = (day + 6) % 7;
          d.setUTCDate(d.getUTCDate() - diff);
          d.setUTCHours(0, 0, 0, 0);
          return d.toISOString().slice(0, 10);
        })();
        await (supabase as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<unknown> })
          .rpc("award_arena_score", { _score: r, _week_start: ws })
          .catch(() => {});
      }
    } catch { /* ignore */ }
  }
  function finishLose() {
    if (result) return;
    setResult("lose");
  }

  async function rematch() {
    if (!me) return;
    setResult(null);
    setReward(0);
    setMe({ ...me, hp: me.maxHp });
    setOp(null);
    await loadOpponent(me.id, me.stage, me.maxHp, null, op?.id ?? null);
  }

  const myStageImg = useMemo(() => getStage(me?.stage ?? 1).image, [me?.stage]);
  const opStageImg = useMemo(() => getStage(op?.stage ?? 1).image, [op?.stage]);
  const myPct = me ? (me.hp / me.maxHp) * 100 : 100;
  const opPct = op ? (op.hp / op.maxHp) * 100 : 100;

  return (
    <div dir="rtl" className="fixed inset-0 overflow-hidden text-white select-none"
      style={{
        backgroundImage: `url(${arenaBg})`,
        backgroundSize: "cover",
        backgroundPosition: "center bottom",
      }}>
      <style>{`
        @keyframes bolt-mr { 0%{transform:translateX(0) scale(0.6);opacity:0} 15%{opacity:1} 100%{transform:translateX(-58vw) scale(1.1);opacity:0} }
        @keyframes bolt-ml { 0%{transform:translateX(0) scale(0.6);opacity:0} 15%{opacity:1} 100%{transform:translateX(58vw) scale(1.1);opacity:0} }
        @keyframes flt { 0%{transform:translateY(0);opacity:0} 15%{opacity:1} 100%{transform:translateY(-60px);opacity:0} }
        @keyframes shk { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-8px)} 75%{transform:translateX(8px)} }
        @keyframes hov { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
        @keyframes brth { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
        @keyframes glow-blue { 0%,100%{filter:drop-shadow(0 0 12px rgba(34,211,238,0.7))} 50%{filter:drop-shadow(0 0 22px rgba(34,211,238,1))} }
      `}</style>

      {/* close + portals overlay glow */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse at 50% 30%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.25) 70%, rgba(0,0,0,0.5) 100%)"
      }}/>

      {/* Top HUD: 2 fighter cards + VS */}
      <div className="absolute top-0 inset-x-0 z-30 px-2 pt-2">
        <div className="max-w-md mx-auto flex items-center gap-2">
          <Link to="/" className="w-9 h-9 rounded-full bg-black/60 border border-white/30 flex items-center justify-center text-white text-lg shrink-0">✕</Link>
          {/* Me card */}
          <FighterCard f={me} pct={myPct} side="me" />
          <div className="text-white text-2xl font-black drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] px-1">VS</div>
          {/* Op card */}
          <FighterCard f={op} pct={opPct} side="op" />
        </div>
      </div>

      {/* Arena scene: two dragons facing */}
      <div className="absolute inset-x-0 bottom-40 top-24 z-10">
        <div className="relative w-full h-full max-w-md mx-auto">
          {/* My dragon (left) */}
          <div className="absolute" style={{
            left: "4%", top: "40%", width: "38%", aspectRatio: "1/1",
            animation: `hov 2.6s ease-in-out infinite${shake === "me" ? ", shk 0.2s" : ""}`,
          }}>
            {me && (
              <div className="w-full h-full" style={{ transform: "scaleX(-1)" }}>
                <img src={myStageImg} alt="me" draggable={false}
                  className="w-full h-full object-contain"
                  style={{
                    filter: "drop-shadow(0 8px 12px rgba(0,0,0,0.7)) drop-shadow(0 0 14px rgba(255,140,40,0.5))",
                    animation: "brth 3s ease-in-out infinite",
                  }} />
              </div>
            )}
          </div>
          {/* Op dragon (right) */}
          <div className="absolute" style={{
            right: "4%", top: "40%", width: "38%", aspectRatio: "1/1",
            animation: `hov 2.4s ease-in-out infinite${shake === "op" ? ", shk 0.2s" : ""}`,
          }}>
            {op && (
              <img src={opStageImg} alt="op" draggable={false}
                className="w-full h-full object-contain"
                style={{
                  filter: "drop-shadow(0 8px 12px rgba(0,0,0,0.7)) drop-shadow(0 0 14px rgba(34,211,238,0.5))",
                  animation: "brth 2.8s ease-in-out infinite",
                }} />
            )}
          </div>

          {/* Bolts (fire) */}
          {bolts.map(b => (
            <div key={b.id} className="absolute pointer-events-none"
              style={{
                top: "55%",
                [b.from === "me" ? "left" : "right"]: "38%",
                width: 60, height: 28,
                animation: `${b.from === "me" ? "bolt-mr" : "bolt-ml"} 0.55s linear forwards`,
              } as React.CSSProperties}>
              <div className="w-full h-full rounded-full"
                style={{
                  background: "radial-gradient(circle, #fff7c2 0%, #ffb347 30%, #ff4500 65%, transparent 75%)",
                  boxShadow: "0 0 25px #ff7a00, 0 0 60px rgba(255,80,0,0.7)",
                  transform: b.from === "op" ? "scaleX(-1)" : undefined,
                }} />
            </div>
          ))}

          {/* Float damage numbers */}
          {floats.map(fn => (
            <div key={fn.id} className="absolute pointer-events-none font-black text-2xl"
              style={{
                top: `${fn.y}%`,
                [fn.side === "me" ? "left" : "right"]: `${fn.x}%`,
                color: "#ff3b3b",
                textShadow: "0 0 6px #000, 0 2px 4px rgba(0,0,0,0.9)",
                animation: "flt 0.9s ease-out forwards",
              } as React.CSSProperties}>
              -{fn.v}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom attack panel */}
      <div className="absolute bottom-0 inset-x-0 z-30 px-3 pb-4 pt-3 bg-gradient-to-t from-black/85 via-black/55 to-transparent">
        <div className="max-w-md mx-auto flex items-center gap-3">
          <button onClick={doMyAttack} disabled={busy || !!result}
            className="flex-1 py-4 rounded-2xl font-black text-lg shadow-2xl active:scale-95 transition-transform disabled:opacity-50"
            style={{
              background: "linear-gradient(180deg,#ff8a00 0%,#ff2d00 100%)",
              boxShadow: "0 0 30px rgba(255,80,0,0.6), inset 0 -3px 0 rgba(0,0,0,0.3)",
              border: "2px solid rgba(255,200,100,0.7)",
            }}>
            🔥 اضرب
          </button>
          <Link to="/arena" className="px-4 py-4 rounded-2xl bg-black/60 border border-white/30 font-bold text-sm">
            🏟️ الأرينا
          </Link>
        </div>
      </div>

      {/* Win/Lose modal */}
      {result && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/65 p-4">
          <div className="relative max-w-xs w-full rounded-3xl overflow-hidden border-4"
            style={{
              borderColor: result === "win" ? "#fbbf24" : "#6b7280",
              background: "linear-gradient(180deg,#3a2412 0%,#1a0e08 100%)",
              boxShadow: result === "win"
                ? "0 0 60px rgba(251,191,36,0.7)"
                : "0 0 40px rgba(0,0,0,0.7)",
            }}>
            <div className="text-center py-3 text-2xl font-black tracking-widest"
              style={{ background: result === "win" ? "linear-gradient(180deg,#fbbf24,#b45309)" : "linear-gradient(180deg,#475569,#1f2937)" }}>
              {result === "win" ? "🏆 لقد فزت" : "💀 خسرت"}
            </div>
            <div className="p-6 text-center">
              {result === "win" ? (
                <>
                  <div className="text-7xl mb-2">🏆</div>
                  <div className="text-3xl font-black text-amber-200">+{reward}</div>
                  <div className="text-xs text-amber-200/80 mt-1">نقاط أرينا</div>
                </>
              ) : (
                <>
                  <div className="text-7xl mb-2 opacity-70">☠️</div>
                  <div className="text-base text-slate-300">حاول مرة ثانية!</div>
                </>
              )}
              <div className="mt-5 flex gap-2">
                <button onClick={rematch}
                  className="flex-1 py-3 rounded-xl font-black text-base bg-gradient-to-b from-amber-500 to-amber-700 active:scale-95 shadow-lg"
                  style={{ border: "2px solid #fde68a" }}>
                  ⚔️ معركة جديدة
                </button>
                <Link to="/" className="px-4 py-3 rounded-xl font-bold text-sm bg-black/50 border border-white/30">
                  خروج
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick tier hint (debug-ish — shows current stage) */}
      <div className="absolute bottom-24 inset-x-0 z-20 text-center pointer-events-none">
        {me && op && !result && (
          <div className="inline-block px-3 py-1 rounded-full bg-black/55 backdrop-blur text-[10px] font-bold text-cyan-100 border border-white/20">
            تنينك: {DRAGON_STAGES[me.stage - 1]?.name}  •  خصمك: {DRAGON_STAGES[op.stage - 1]?.name}
          </div>
        )}
      </div>
    </div>
  );
}

function FighterCard({ f, pct, side }: { f: Fighter | null; pct: number; side: "me" | "op" }) {
  const align = side === "me" ? "text-right" : "text-left";
  return (
    <div className="flex-1 min-w-0 rounded-xl bg-gradient-to-b from-stone-900/95 to-stone-950/95 border-2 border-amber-700/70 px-2 py-1.5 shadow-lg backdrop-blur"
      style={{ boxShadow: "0 4px 10px rgba(0,0,0,0.6)" }}>
      <div className={`flex items-center gap-2 ${side === "op" ? "flex-row-reverse" : ""}`}>
        <div className="w-10 h-10 rounded-lg overflow-hidden bg-black/60 border-2 border-amber-500/70 flex items-center justify-center text-xl shrink-0"
          style={{ boxShadow: "0 0 8px rgba(251,191,36,0.5)" }}>
          {f?.avatar
            ? <img src={f.avatar} alt={f.name} className="w-full h-full object-cover" />
            : <span>{avatarFallback(f?.emoji ?? "")}</span>}
        </div>
        <div className={`flex-1 min-w-0 ${align}`}>
          <div className={`flex items-center gap-1 ${side === "op" ? "flex-row-reverse" : ""}`}>
            <div className="text-[11px] font-extrabold text-amber-100 truncate">{f?.name ?? "..."}</div>
            {f && (
              <span className="text-[9px] font-black px-1 rounded bg-amber-600/30 border border-amber-500/50 text-amber-200 tabular-nums shrink-0">
                Lv{f.stage}
              </span>
            )}
          </div>
          {/* Power */}
          <div className={`text-[9px] font-bold text-cyan-200 tabular-nums leading-tight ${align}`}>
            ⚔️ القوة: {f ? f.power : "—"}
          </div>
          {/* HP bar */}
          <div className="relative h-3 rounded-full bg-black/70 border border-stone-700 overflow-hidden mt-0.5">
            <div className="absolute inset-y-0 transition-[width] duration-300"
              style={{
                [side === "me" ? "left" : "right"]: 0,
                width: `${pct}%`,
                background: pct > 40
                  ? "linear-gradient(90deg,#22c55e,#16a34a 60%,#14532d)"
                  : "linear-gradient(90deg,#ef4444,#f97316)",
                boxShadow: "inset 0 -2px 0 rgba(0,0,0,0.4)",
              } as React.CSSProperties} />
            <div className={`absolute inset-0 flex items-center justify-${side === "me" ? "start" : "end"} px-1.5`}>
              <span className="text-[9px] font-black text-white drop-shadow tabular-nums">
                {f ? `❤️ ${f.hp}/${f.maxHp}` : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
