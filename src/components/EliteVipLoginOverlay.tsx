import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { broadcastEliteVipLogin } from "@/hooks/use-elite-vip";
import { EliteVipBadge, EliteVipFrame } from "@/components/EliteVipBadge";
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
 * Global, app-wide overlay that briefly announces a VIP-3+ player's login
 * to EVERY other player. Subscribes to `elite_vip_login_broadcasts` via
 * Supabase Realtime.
 *
 * Mount once at the root layout. The badge/level itself is server-managed,
 * so this can never be triggered by a non-subscriber.
 */
export function EliteVipLoginOverlay() {
  const { user, loading } = useAuth();
  const [queue, setQueue] = useState<LoginBroadcast[]>([]);
  const [current, setCurrent] = useState<LoginBroadcast | null>(null);

  // Trigger our own login broadcast (server filters out non-VIP-3+).
  useEffect(() => {
    if (loading || !user) return;
    void broadcastEliteVipLogin();
  }, [user, loading]);

  // Subscribe to all login broadcasts globally.
  useEffect(() => {
    const channel = supabase
      .channel("elite-vip-login-broadcasts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "elite_vip_login_broadcasts" },
        (payload) => {
          const row = payload.new as LoginBroadcast;
          // Don't show the overlay to the user about themselves.
          if (user && row.user_id === user.id) return;
          setQueue((q) => [...q, row]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Drain the queue: one at a time, 5 seconds each.
  useEffect(() => {
    if (current || queue.length === 0) return;
    const next = queue[0];
    setCurrent(next);
    setQueue((q) => q.slice(1));
    const t = setTimeout(() => setCurrent(null), 5000);
    return () => clearTimeout(t);
  }, [queue, current]);

  if (!current) return null;
  const tier = getEliteVipTier(current.elite_vip_level);
  if (!tier) return null;

  const isLegendary = current.elite_vip_level >= 5;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-16 z-[9998] flex justify-center px-4 animate-in fade-in slide-in-from-top-4 duration-500"
      aria-live="polite"
    >
      <div
        className={`relative w-full max-w-2xl rounded-2xl px-5 py-3 backdrop-blur-md border-2 ${
          isLegendary
            ? "bg-gradient-to-r from-purple-900/80 via-fuchsia-900/80 to-amber-900/80 border-amber-400/80 shadow-[0_0_60px_rgba(232,121,249,0.7)]"
            : current.elite_vip_level === 4
              ? "bg-gradient-to-r from-slate-900/80 via-indigo-900/80 to-amber-900/70 border-amber-300/70 shadow-[0_0_40px_rgba(251,191,36,0.6)]"
              : "bg-gradient-to-r from-amber-900/70 to-slate-900/80 border-amber-500/70 shadow-[0_0_30px_rgba(251,191,36,0.5)]"
        }`}
      >
        <div className="flex items-center gap-3" dir="rtl">
          <EliteVipFrame level={current.elite_vip_level} className="shrink-0">
            <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center text-2xl overflow-hidden">
              {current.avatar_url ? (
                // eslint-disable-next-line jsx-a11y/img-redundant-alt
                <img src={current.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span>{current.avatar_emoji || "🏴‍☠️"}</span>
              )}
            </div>
          </EliteVipFrame>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <EliteVipBadge level={current.elite_vip_level} size="md" />
              <span className={`text-lg font-extrabold truncate ${tier.nameColorClass || "text-amber-200"}`}>
                {current.display_name}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-200 border border-amber-400/40 font-bold">
                Elite VIP {current.elite_vip_level}
              </span>
            </div>
            <div className="text-xs text-amber-100/90 mt-0.5 truncate">
              {isLegendary ? "🐉 أسطورة من بحار القراصنة دخل اللعبة!" : "⚓ قبطان VIP دخل اللعبة!"}
            </div>
          </div>
          <div className="text-2xl shrink-0">{tier.emoji}</div>
        </div>
      </div>
    </div>
  );
}
