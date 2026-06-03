import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import bossImg from "@/assets/world-boss.png";

export const Route = createFileRoute("/boss")({
  ssr: false,
  head: () => ({ meta: [{ title: "🐲 وحش العالم — Ocean Catch" }] }),
  component: BossPage,
});

type Boss = {
  id: string; name: string;
  hp_max: number; hp_current: number;
  spawned_at: string; expires_at: string;
  defeated_at: string | null;
};
type HitRow = { user_id: string; total_damage: number; hit_count: number };
type FreeStatus = { available: boolean; cooldown_until?: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase.rpc.bind(supabase) as unknown as (n: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;

function BossPage() {
  const [boss, setBoss] = useState<Boss | null>(null);
  const [hits, setHits] = useState<HitRow[]>([]);
  const [names, setNames] = useState<Record<string, { display_name: string; avatar_emoji: string }>>({});
  const [free, setFree] = useState<FreeStatus>({ available: false });
  const [busy, setBusy] = useState(false);
  const [floats, setFloats] = useState<{ id: number; dmg: number; crit: boolean; x: number; y: number }[]>([]);
  const [shake, setShake] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [hasContinuous, setHasContinuous] = useState(false);
  const continuousRef = useRef<number | null>(null);
  const myIdRef = useRef<string | null>(null);

  const loadBoss = useCallback(async () => {
    const { data } = await rpc("get_active_boss");
    setBoss(data as Boss);
    if (data?.id) {
      const { data: h } = await supabase.from("boss_hits").select("user_id,total_damage,hit_count")
        .eq("boss_id", data.id).order("total_damage", { ascending: false }).limit(20);
      setHits((h ?? []) as HitRow[]);
      const ids = (h ?? []).map((x) => x.user_id);
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles").select("id,display_name,avatar_emoji").in("id", ids);
        const map: Record<string, { display_name: string; avatar_emoji: string }> = {};
        (profs ?? []).forEach((p: { id: string; display_name: string; avatar_emoji: string }) => {
          map[p.id] = { display_name: p.display_name, avatar_emoji: p.avatar_emoji };
        });
        setNames(map);
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      myIdRef.current = user?.id ?? null;
      await loadBoss();
      const { data: fs } = await rpc("free_strike_status");
      setFree((fs as FreeStatus) ?? { available: false });
      const { data: bonus } = await rpc("player_attack_bonus", { p_user: user?.id });
      if (bonus?.continuous) setHasContinuous(true);
    })();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [loadBoss]);

  // realtime boss updates
  useEffect(() => {
    if (!boss?.id) return;
    const ch = supabase
      .channel(`world_boss_${boss.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "world_boss", filter: `id=eq.${boss.id}` },
        (payload) => {
          setBoss((b) => b ? { ...b, ...(payload.new as Partial<Boss>) } : b);
        })
      .on("postgres_changes", { event: "*", schema: "public", table: "boss_hits", filter: `boss_id=eq.${boss.id}` },
        () => { loadBoss(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [boss?.id, loadBoss]);

  // continuous fire for divine sword
  useEffect(() => {
    if (!hasContinuous || !boss || boss.hp_current <= 0) return;
    if (continuousRef.current) window.clearInterval(continuousRef.current);
    continuousRef.current = window.setInterval(async () => {
      const { data } = await rpc("attack_boss", { p_use_free: false });
      if (data?.ok) addFloat(data.damage, data.crit);
    }, 3000) as unknown as number;
    return () => { if (continuousRef.current) window.clearInterval(continuousRef.current); };
  }, [hasContinuous, boss]);

  const addFloat = (dmg: number, crit: boolean) => {
    const id = Date.now() + Math.random();
    setFloats((f) => [...f, { id, dmg, crit, x: 30 + Math.random() * 40, y: 30 + Math.random() * 30 }]);
    setShake(true);
    setTimeout(() => setShake(false), 200);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1500);
  };

  const attack = async (useFree = false) => {
    if (busy) return;
    setBusy(true);
    const { data, error } = await rpc("attack_boss", { p_use_free: useFree });
    setBusy(false);
    if (error) return alert(error.message);
    if (data?.ok === false) return alert(data.error);
    addFloat(data.damage, data.crit);
    if (useFree) setFree({ available: false, cooldown_until: new Date(Date.now() + 30000).toISOString() });
    if (data.killed) {
      setTimeout(() => alert("💀 سقط الوحش! تحقق من غنائمك"), 500);
      loadBoss();
    }
  };

  // refresh free strike status
  useEffect(() => {
    if (free.cooldown_until) {
      const until = new Date(free.cooldown_until).getTime();
      if (now >= until) {
        rpc("free_strike_status").then(({ data }) => setFree((data as FreeStatus) ?? { available: false }));
      }
    }
  }, [now, free.cooldown_until]);

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
  const freeCooldownSec = free.cooldown_until ? Math.max(0, Math.ceil((new Date(free.cooldown_until).getTime() - now) / 1000)) : 0;

  return (
    <div className="fixed inset-0 overflow-y-auto" dir="rtl"
      style={{ background: "radial-gradient(ellipse at center, #1a0a0a 0%, #050505 70%, #000 100%)" }}>
      {/* Lightning flashes */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="absolute w-px h-32 bg-rose-500/40"
            style={{ left: `${(i*37)%100}%`, top: `${(i*23)%80}%`, animation: `lightning ${3+i%3}s ${i*0.3}s infinite`, opacity: 0 }} />
        ))}
      </div>
      <style>{`
        @keyframes lightning { 0%,90%,100%{opacity:0} 92%,94%{opacity:1; box-shadow:0 0 30px rgba(244,63,94,0.8)} }
        @keyframes float-up { 0%{transform:translateY(0) scale(1);opacity:1} 100%{transform:translateY(-80px) scale(1.4);opacity:0} }
        @keyframes shake-hit { 0%,100%{transform:translate(0,0)} 25%{transform:translate(-6px,2px)} 50%{transform:translate(5px,-3px)} 75%{transform:translate(-3px,4px)} }
        @keyframes boss-breathe { 0%,100%{filter:drop-shadow(0 0 40px rgba(244,63,94,0.6))} 50%{filter:drop-shadow(0 0 70px rgba(244,63,94,1))} }
      `}</style>

      <div className="relative z-10 max-w-md mx-auto px-3 pt-4 pb-32">
        <div className="flex items-center justify-between mb-3">
          <Link to="/" className="glass-hud rounded-full px-3 py-1.5 text-rose-200 text-sm font-bold border border-rose-500/50">← رجوع</Link>
          <div className="glass-hud rounded-full px-3 py-1.5 text-rose-200 text-sm font-bold border border-rose-500/50">
            ⏰ {expH}س {expM}د
          </div>
        </div>

        <div className="text-center mb-2">
          <div className="inline-block px-4 py-1 rounded-full bg-gradient-to-r from-rose-800/60 to-amber-800/60 border border-rose-400/60">
            <span className="text-rose-100 font-extrabold text-lg">🐲 {boss.name}</span>
          </div>
        </div>

        <div className="relative my-4 flex items-center justify-center" style={{ minHeight: 280 }}>
          <img src={bossImg} alt={boss.name} loading="eager" width={1024} height={1024}
            className={`w-full max-w-[340px] h-auto object-contain ${shake ? "" : ""}`}
            style={{
              animation: `boss-breathe 3s ease-in-out infinite${shake ? ", shake-hit 0.2s" : ""}`,
              opacity: dead ? 0.3 : 1, filter: dead ? "grayscale(1)" : undefined,
            }} />
          {floats.map((f) => (
            <div key={f.id} className={`absolute font-extrabold pointer-events-none ${f.crit ? "text-amber-300 text-3xl" : "text-rose-200 text-2xl"}`}
              style={{ left: `${f.x}%`, top: `${f.y}%`, animation: "float-up 1.5s ease-out forwards",
                       textShadow: f.crit ? "0 0 20px rgba(251,191,36,1)" : "0 0 12px rgba(244,63,94,0.9)" }}>
              {f.crit ? "💥 " : ""}-{f.dmg.toLocaleString()}
            </div>
          ))}
          {dead && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-stone-900/90 border-2 border-amber-400 rounded-2xl px-6 py-4 text-center">
                <div className="text-4xl mb-1">💀</div>
                <div className="text-amber-100 font-extrabold">سقط الوحش!</div>
                <div className="text-amber-300/70 text-xs mt-1">سيظهر بوس جديد خلال 48 ساعة</div>
              </div>
            </div>
          )}
        </div>

        {/* HP bar */}
        <div className="bg-stone-900/80 border-2 border-rose-700/50 rounded-2xl p-3 mb-3 backdrop-blur">
          <div className="flex items-center justify-between mb-2">
            <span className="text-rose-200 text-sm font-bold">❤️ HP الوحش</span>
            <span className="text-rose-100 font-extrabold tabular-nums text-sm">
              {boss.hp_current.toLocaleString()} / {boss.hp_max.toLocaleString()}
            </span>
          </div>
          <div className="h-5 rounded-full bg-stone-950 overflow-hidden border border-rose-900">
            <div className="h-full bg-gradient-to-r from-rose-600 via-red-500 to-amber-500 transition-all"
              style={{ width: `${hpPct}%`, boxShadow: "0 0 14px rgba(244,63,94,0.9)" }} />
          </div>
        </div>

        {/* Attack buttons */}
        {!dead && (
          <div className="space-y-2 mb-4">
            <button disabled={busy} onClick={() => attack(false)}
              className="w-full py-4 rounded-2xl bg-gradient-to-b from-rose-500 to-rose-800 text-white font-extrabold text-lg shadow-xl border-2 border-rose-300/40 disabled:opacity-50 active:scale-95 transition-transform">
              🚀 اضرب بصاروخ
            </button>
            {(free.available || freeCooldownSec > 0) && (
              <button disabled={busy || !free.available} onClick={() => attack(true)}
                className={`w-full py-3 rounded-2xl font-extrabold shadow-xl border-2 transition-transform ${
                  free.available
                    ? "bg-gradient-to-b from-amber-400 to-orange-600 text-stone-900 border-amber-200 active:scale-95"
                    : "bg-stone-800 text-stone-500 border-stone-700"
                }`}>
                {free.available ? "🐲 ضربة التنين المجانية!" : `🐲 ضربة التنين — ${freeCooldownSec}ث`}
              </button>
            )}
            {hasContinuous && (
              <div className="text-center text-rose-300/70 text-xs animate-pulse">🔥 إطلاق مستمر فعّال (كل 3ث)</div>
            )}
          </div>
        )}

        {/* Leaderboard */}
        <div className="bg-stone-900/70 border border-rose-700/40 rounded-2xl p-3 backdrop-blur">
          <div className="text-rose-200 text-sm font-bold mb-2 text-center">🏆 أعلى الضرر</div>
          {hits.length === 0 ? (
            <div className="text-center text-rose-300/50 text-xs py-3">كن أول من يضرب الوحش</div>
          ) : (
            <div className="space-y-1.5">
              {hits.map((h, i) => {
                const p = names[h.user_id];
                const isMe = h.user_id === myIdRef.current;
                return (
                  <div key={h.user_id} className={`flex items-center gap-2 p-2 rounded-lg ${
                    isMe ? "bg-amber-500/20 border border-amber-400/60" : i < 3 ? "bg-rose-900/40" : "bg-stone-800/40"
                  }`}>
                    <span className="text-rose-300 font-extrabold w-6 text-center">{i + 1}</span>
                    <span className="text-xl">{p?.avatar_emoji ?? "🧑‍✈️"}</span>
                    <span className="flex-1 text-rose-100 text-sm truncate">{p?.display_name ?? "..."}</span>
                    <span className="text-rose-200 font-extrabold text-sm tabular-nums">{h.total_damage.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-2 text-center text-rose-300/50 text-[10px]">
            🎁 أعلى ضرر = أفضل غنائم (التوب 3 يضمنون نادر+)
          </div>
        </div>
      </div>
    </div>
  );
}
