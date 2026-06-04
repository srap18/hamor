import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dragon, DRAGON_STAGES, getStage, dpProgress } from "@/lib/dragon";

export const Route = createFileRoute("/dragon")({
  ssr: false,
  head: () => ({ meta: [{ title: "🐉 تنيني — Ocean Catch" }] }),
  component: DragonPage,
});

function DragonPage() {
  const location = useLocation();
  const [d, setD] = useState<Dragon | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (location.pathname !== "/dragon") return;
    (async () => {
      const { data, error } = await (supabase as never as {
        rpc: (n: string) => Promise<{ data: Dragon | null; error: { message: string } | null }>;
      }).rpc("get_or_init_dragon");
      if (error) console.error(error);
      setD(data);
      setLoading(false);
    })();
  }, [location.pathname]);

  if (location.pathname !== "/dragon") return <Outlet />;

  if (loading) {
    return (
      <div className="fixed inset-0 bg-[#0a0a14] flex items-center justify-center" dir="rtl">
        <div className="text-amber-300 text-lg animate-pulse">جاري استدعاء التنين...</div>
      </div>
    );
  }

  if (!d) {
    return (
      <div className="fixed inset-0 bg-[#0a0a14] flex items-center justify-center" dir="rtl">
        <div className="text-rose-300">تعذّر تحميل التنين</div>
      </div>
    );
  }

  const stage = getStage(d.stage);
  const prog = dpProgress(d);

  return (
    <div
      className="fixed inset-0 overflow-y-auto"
      dir="rtl"
      style={{
        background:
          "radial-gradient(ellipse at top, #1a0a1f 0%, #0a0a14 60%, #000 100%)",
      }}
    >
      {/* Ember particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {Array.from({ length: 30 }).map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 rounded-full bg-amber-400"
            style={{
              left: `${(i * 37) % 100}%`,
              bottom: `-10px`,
              animation: `ember-rise ${8 + (i % 5) * 2}s linear infinite`,
              animationDelay: `${(i * 0.3) % 8}s`,
              opacity: 0.6,
              boxShadow: "0 0 6px rgba(251,191,36,0.8)",
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes ember-rise {
          0% { transform: translateY(0) translateX(0); opacity: 0; }
          10% { opacity: 0.8; }
          90% { opacity: 0.4; }
          100% { transform: translateY(-110vh) translateX(20px); opacity: 0; }
        }
        @keyframes dragon-glow {
          0%, 100% { filter: drop-shadow(0 0 30px rgba(251,146,60,0.6)) drop-shadow(0 0 60px rgba(220,38,38,0.4)); }
          50% { filter: drop-shadow(0 0 50px rgba(251,146,60,0.9)) drop-shadow(0 0 90px rgba(220,38,38,0.7)); }
        }
        @keyframes egg-float {
          0%, 100% { transform: translateY(0) rotate(-1deg); }
          50% { transform: translateY(-12px) rotate(1deg); }
        }
      `}</style>

      <div className="relative z-10 max-w-md mx-auto px-4 pt-4 pb-32">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <Link to="/" className="glass-hud rounded-full px-3 py-1.5 text-amber-200 text-sm font-bold border border-amber-500/40">
            ← رجوع
          </Link>
          <div className="glass-hud rounded-full px-3 py-1.5 text-amber-200 text-sm font-bold border border-amber-500/40">
            🐉 تنيني
          </div>
        </div>

        {/* Stage badge */}
        <div className="text-center mb-2">
          <div className="inline-block px-4 py-1.5 rounded-full bg-gradient-to-r from-amber-600/30 via-rose-600/30 to-amber-600/30 border border-amber-400/50">
            <img src={stage.image} alt={stage.name} className="inline-block w-8 h-8 object-contain me-2 align-middle" loading="lazy" />
            <span className="text-amber-100 font-extrabold text-lg">{stage.name}</span>
            <span className="text-amber-300/70 text-xs ms-2">المرحلة {d.stage}/10</span>
          </div>
        </div>

        {/* Dragon/Egg display */}
        <div className="relative my-6 flex items-center justify-center" style={{ minHeight: "320px" }}>
          <img
            src={stage.image}
            alt={stage.name}
            className="w-full max-w-[320px] h-auto object-contain"
            style={{
              animation: "dragon-glow 3s ease-in-out infinite, egg-float 5s ease-in-out infinite",
            }}
          />
        </div>

        {/* Name */}
        <div className="text-center mb-4">
          <div className="text-2xl font-extrabold text-amber-100 mb-1">{d.name}</div>
          <div className="text-amber-300/60 text-xs">
            {d.element === "fire" ? "🔥 نار" : d.element === "water" ? "💧 ماء" : d.element === "lightning" ? "⚡ رعد" : "🌑 ظل"}
          </div>
        </div>

        {/* DP progress */}
        <div className="bg-stone-900/70 border border-amber-700/40 rounded-2xl p-4 mb-3 backdrop-blur">
          <div className="flex items-center justify-between mb-2">
            <span className="text-amber-200 text-sm font-bold">⚔️ نقاط التنين</span>
            <span className="text-amber-100 font-extrabold tabular-nums">
              {d.dp.toLocaleString()}{prog.next > d.dp && ` / ${prog.next.toLocaleString()}`}
            </span>
          </div>
          <div className="h-3 rounded-full bg-stone-800 overflow-hidden border border-amber-900/50">
            <div
              className="h-full bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 transition-all"
              style={{ width: `${prog.pct}%`, boxShadow: "0 0 12px rgba(251,146,60,0.8)" }}
            />
          </div>
          <div className="text-amber-300/60 text-[11px] mt-2 text-center">
            اكسب نقاط التنين بمهاجمة الوحوش والخصوم
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-stone-900/70 border border-amber-700/40 rounded-xl p-3 backdrop-blur">
            <div className="text-amber-300/70 text-[10px] mb-1">إجمالي الضرر</div>
            <div className="text-amber-100 font-extrabold text-lg tabular-nums">{d.total_boss_damage.toLocaleString()}</div>
          </div>
          <div className="bg-stone-900/70 border border-amber-700/40 rounded-xl p-3 backdrop-blur">
            <div className="text-amber-300/70 text-[10px] mb-1">انتصارات الأرينا</div>
            <div className="text-amber-100 font-extrabold text-lg tabular-nums">{d.pvp_wins} <span className="text-rose-400/60 text-xs">/ {d.pvp_losses}</span></div>
          </div>
        </div>

        {/* Stages roadmap */}
        <div className="bg-stone-900/70 border border-amber-700/40 rounded-2xl p-3 backdrop-blur">
          <div className="text-amber-200 text-sm font-bold mb-2 text-center">🗺️ مراحل التطور</div>
          <div className="space-y-1.5">
            {DRAGON_STAGES.map((s) => {
              const reached = d.stage >= s.level;
              const current = d.stage === s.level;
              return (
                <div
                  key={s.level}
                  className={`flex items-center gap-2 p-2 rounded-lg ${
                    current
                      ? "bg-amber-500/20 border border-amber-400/60"
                      : reached
                      ? "bg-stone-800/60 border border-emerald-700/40"
                      : "bg-stone-900/40 border border-stone-700/40 opacity-60"
                  }`}
                >
                  <span className="text-xl">{s.icon}</span>
                  <div className="flex-1">
                    <div className={`text-sm font-bold ${current ? "text-amber-100" : reached ? "text-emerald-200" : "text-stone-400"}`}>
                      {s.name}
                    </div>
                    <div className="text-[10px] text-stone-400">
                      {s.dpRequired.toLocaleString()} DP
                    </div>
                  </div>
                  {reached && !current && <span className="text-emerald-400 text-xs">✓</span>}
                  {current && <span className="text-amber-300 text-xs font-bold">الآن</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Daily rockets claim */}
        <DailyRocketsCard />

        {/* Action panels */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Link to="/dragon/forge"
            className="bg-gradient-to-br from-amber-600/40 to-rose-900/40 border-2 border-amber-400/60 rounded-xl p-3 text-center backdrop-blur shadow-lg hover:scale-105 transition-transform">
            <div className="text-2xl mb-1">⚒️</div>
            <div className="text-amber-100 text-xs font-extrabold">الفورج</div>
            <div className="text-amber-300/80 text-[9px]">تسليح</div>
          </Link>
          <Link to="/boss"
            className="bg-gradient-to-br from-rose-700/50 to-black border-2 border-rose-400/60 rounded-xl p-3 text-center backdrop-blur shadow-lg hover:scale-105 transition-transform">
            <div className="text-2xl mb-1">🐲</div>
            <div className="text-rose-100 text-xs font-extrabold">الوحش</div>
            <div className="text-rose-300/80 text-[9px]">هاجم</div>
          </Link>
          <Link to="/arena"
            className="bg-gradient-to-br from-cyan-700/50 to-purple-900/50 border-2 border-cyan-400/60 rounded-xl p-3 text-center backdrop-blur shadow-lg hover:scale-105 transition-transform">
            <div className="text-2xl mb-1">🏟️</div>
            <div className="text-cyan-100 text-xs font-extrabold">الأرينا</div>
            <div className="text-cyan-300/80 text-[9px]">ترتيب</div>
          </Link>
        </div>
      </div>
      <Outlet />
    </div>
  );
}

function DailyRocketsCard() {
  const [status, setStatus] = useState<{ available: boolean; count: number; tier: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const { data } = await (supabase as never as { rpc: (n: string) => Promise<{ data: { available: boolean; count: number; tier: number } | null }> }).rpc("daily_rockets_status");
    setStatus(data);
  };
  useEffect(() => { load(); }, []);

  if (!status || status.tier < 3) return null;

  const claim = async () => {
    if (busy) return;
    setBusy(true);
    const { data, error } = await (supabase as never as { rpc: (n: string) => Promise<{ data: { ok: boolean; count?: number; error?: string }; error: { message: string } | null }> }).rpc("claim_daily_dragon_rockets");
    setBusy(false);
    if (error) { setMsg("❌ " + error.message); return; }
    if (!data.ok) { setMsg("❌ " + (data.error ?? "")); return; }
    setMsg(`✅ استلمت ${data.count} صواريخ!`);
    load();
    setTimeout(() => setMsg(null), 2500);
  };

  return (
    <div className="bg-gradient-to-r from-emerald-900/60 to-amber-900/60 border-2 border-emerald-400/60 rounded-2xl p-3 mb-3 backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-emerald-100 font-extrabold text-sm">🚀 صواريخ التنين اليومية</div>
          <div className="text-emerald-300/70 text-[10px]">{status.count} صواريخ بفضل سيفك</div>
        </div>
        <button onClick={claim} disabled={!status.available || busy}
          className={`px-4 py-2 rounded-xl font-extrabold text-sm shadow-lg ${
            status.available
              ? "bg-gradient-to-b from-emerald-400 to-emerald-700 text-stone-900"
              : "bg-stone-800 text-stone-500 border border-stone-700"
          }`}>
          {status.available ? "🎁 استلم" : "✓ تم اليوم"}
        </button>
      </div>
      {msg && <div className="mt-2 text-center text-emerald-200 text-xs font-bold">{msg}</div>}
    </div>
  );
}
