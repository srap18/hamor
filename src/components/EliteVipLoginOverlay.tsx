import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { broadcastEliteVipLogin } from "@/hooks/use-elite-vip";
import { getEliteVipTier } from "@/lib/elite-vip";

type LoginBroadcast = {
  id: string;
  user_id: string;
  display_name: string;
  elite_vip_level: number;
  avatar_emoji: string | null;
  avatar_url: string | null;
  created_at: string;
};

/**
 * Global luxury announcement overlay for VIP 3+ logins.
 * Server enforces level (RPC `post_elite_vip_login_broadcast`).
 */
export function EliteVipLoginOverlay() {
  const { user, loading } = useAuth();
  const [queue, setQueue] = useState<LoginBroadcast[]>([]);
  const [current, setCurrent] = useState<LoginBroadcast | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    void broadcastEliteVipLogin();
  }, [user, loading]);

  useEffect(() => {
    const channel = supabase
      .channel("elite-vip-login-broadcasts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "elite_vip_login_broadcasts" },
        (payload) => {
          const row = payload.new as LoginBroadcast;
          if (user && row.user_id === user.id) return;
          setQueue((q) => [...q, row]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  useEffect(() => {
    if (current || queue.length === 0) return;
    const next = queue[0];
    setCurrent(next);
    setQueue((q) => q.slice(1));
    const t = setTimeout(() => setCurrent(null), 6000);
    return () => clearTimeout(t);
  }, [queue, current]);

  if (!current) return null;
  const tier = getEliteVipTier(current.elite_vip_level);
  if (!tier) return null;

  const isLegendary = current.elite_vip_level >= 5;
  const isRoyal = current.elite_vip_level === 4;

  const themeBg = isLegendary
    ? "from-purple-950 via-fuchsia-900 to-amber-900"
    : isRoyal
      ? "from-slate-950 via-indigo-950 to-amber-950"
      : "from-amber-950 via-yellow-900 to-slate-950";

  const themeBorder = isLegendary
    ? "border-fuchsia-300"
    : isRoyal
      ? "border-amber-200"
      : "border-amber-400";

  const themeGlow = isLegendary
    ? "shadow-[0_0_80px_rgba(232,121,249,0.9),0_0_160px_rgba(251,191,36,0.5)]"
    : isRoyal
      ? "shadow-[0_0_60px_rgba(251,191,36,0.85),0_0_120px_rgba(125,211,252,0.4)]"
      : "shadow-[0_0_50px_rgba(251,191,36,0.8)]";

  return (
    <>
      <style>{`
        @keyframes vip-rays-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes vip-sparkle { 0%,100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }
        @keyframes vip-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes vip-drop { 0% { transform: translateY(-120%) scale(0.7); opacity: 0; } 60% { transform: translateY(8%) scale(1.05); opacity: 1; } 80% { transform: translateY(-2%) scale(0.98); } 100% { transform: translateY(0) scale(1); opacity: 1; } }
        .vip-rays { background: conic-gradient(from 0deg, transparent 0deg, rgba(251,191,36,0.35) 20deg, transparent 40deg, transparent 60deg, rgba(251,191,36,0.35) 80deg, transparent 100deg, transparent 120deg, rgba(251,191,36,0.35) 140deg, transparent 160deg, transparent 180deg, rgba(251,191,36,0.35) 200deg, transparent 220deg, transparent 240deg, rgba(251,191,36,0.35) 260deg, transparent 280deg, transparent 300deg, rgba(251,191,36,0.35) 320deg, transparent 340deg); animation: vip-rays-spin 12s linear infinite; }
        .vip-rays-legend { background: conic-gradient(from 0deg, transparent 0deg, rgba(232,121,249,0.45) 20deg, transparent 40deg, rgba(251,191,36,0.45) 80deg, transparent 100deg, rgba(232,121,249,0.45) 140deg, transparent 160deg, rgba(251,191,36,0.45) 200deg, transparent 220deg, rgba(232,121,249,0.45) 260deg, transparent 280deg, rgba(251,191,36,0.45) 320deg, transparent 340deg); animation: vip-rays-spin 8s linear infinite; }
        .vip-shimmer-text { background: linear-gradient(90deg, #fbbf24 0%, #fef3c7 25%, #fff 50%, #fef3c7 75%, #fbbf24 100%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: vip-shimmer 3s linear infinite; }
        .vip-shimmer-legend { background: linear-gradient(90deg, #f0abfc 0%, #fbbf24 25%, #fff 50%, #fbbf24 75%, #f0abfc 100%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: vip-shimmer 2.5s linear infinite; }
        .vip-drop { animation: vip-drop 700ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
        .vip-sparkle { animation: vip-sparkle 1.8s ease-in-out infinite; }
      `}</style>

      <div
        className="pointer-events-none fixed inset-x-0 top-6 z-[9998] flex justify-center px-3"
        aria-live="polite"
      >
        <div className={`vip-drop relative w-full max-w-xl`}>
          {/* Rotating rays behind card */}
          <div className="absolute inset-0 -m-10 opacity-70 pointer-events-none">
            <div className={`absolute inset-0 rounded-full ${isLegendary ? "vip-rays-legend" : "vip-rays"}`} style={{ filter: "blur(2px)" }} />
          </div>

          {/* Main card */}
          <div
            className={`relative rounded-3xl overflow-hidden border-2 ${themeBorder} ${themeGlow} bg-gradient-to-br ${themeBg}`}
          >
            {/* Inner gold border */}
            <div className="absolute inset-1 rounded-[1.3rem] border border-amber-300/40 pointer-events-none" />

            {/* Sparkles */}
            <span className="absolute top-2 left-3 text-amber-200 text-lg vip-sparkle">✨</span>
            <span className="absolute top-4 right-6 text-amber-200 text-sm vip-sparkle" style={{ animationDelay: "0.4s" }}>✦</span>
            <span className="absolute bottom-3 left-8 text-amber-200 text-sm vip-sparkle" style={{ animationDelay: "0.8s" }}>✧</span>
            <span className="absolute bottom-4 right-4 text-amber-200 text-lg vip-sparkle" style={{ animationDelay: "1.2s" }}>✨</span>

            <div className="relative px-5 py-4 sm:px-6 sm:py-5" dir="rtl">
              {/* Top crown banner */}
              <div className="flex items-center justify-center gap-2 mb-3">
                <span className="text-2xl">{tier.emoji}</span>
                <span className="text-[11px] sm:text-xs tracking-[0.3em] font-black text-amber-300/90 uppercase">
                  {isLegendary ? "أسطورة دخلت اللعبة" : isRoyal ? "قبطان ملكي متصل الآن" : "قبطان مميز متصل الآن"}
                </span>
                <span className="text-2xl">{tier.emoji}</span>
              </div>

              <div className="flex items-center gap-4">
                {/* Big medallion badge */}
                <div className="relative shrink-0">
                  <div className={`absolute inset-0 rounded-full blur-xl ${isLegendary ? "bg-fuchsia-400/60" : "bg-amber-400/60"}`} />
                  <img
                    src={tier.badge}
                    alt={`Elite VIP ${tier.level}`}
                    className="relative w-20 h-20 sm:w-24 sm:h-24 object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.7)]"
                  />
                </div>

                {/* Avatar + name */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <div className={`shrink-0 rounded-full ring-4 ${tier.ringClass} p-0.5 bg-slate-900`}>
                      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-slate-800 flex items-center justify-center text-2xl overflow-hidden">
                        {current.avatar_url ? (
                          <img src={current.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span>{current.avatar_emoji || "🏴‍☠️"}</span>
                        )}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className={`text-xl sm:text-2xl font-black truncate leading-tight ${isLegendary ? "vip-shimmer-legend" : "vip-shimmer-text"}`}>
                        {current.display_name}
                      </div>
                      <div className="text-[11px] sm:text-xs font-bold text-amber-200/90 truncate mt-0.5">
                        {tier.nameAr}
                      </div>
                    </div>
                  </div>

                  {/* Tier ribbon */}
                  <div className="mt-3 flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] sm:text-xs font-black border ${
                      isLegendary
                        ? "bg-fuchsia-500/20 border-fuchsia-300/60 text-fuchsia-100"
                        : "bg-amber-500/20 border-amber-300/60 text-amber-100"
                    }`}>
                      <span>👑</span>
                      Elite VIP {tier.level}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-bold text-emerald-300">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      متصل الآن
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
