import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { broadcastEliteVipLogin } from "@/hooks/use-elite-vip";
import { getEliteVipTier } from "@/lib/elite-vip";
import { subscribePrefHidden } from "@/lib/ui-prefs";

type LoginBroadcast = {
  id: string;
  user_id: string;
  display_name: string;
  elite_vip_level: number;
  avatar_emoji: string | null;
  avatar_url: string | null;
  created_at: string;
};

// Remembers which broadcast rows / users we already showed in this session so
// a player who logs in and out repeatedly doesn't spam the same toast.
const SEEN_ROW_IDS = new Set<string>();
const SHOWN_USER_AT = new Map<string, number>();
const USER_REPEAT_MS = 30 * 60_000;

function shouldShow(row: LoginBroadcast): boolean {
  if (SEEN_ROW_IDS.has(row.id)) return false;
  SEEN_ROW_IDS.add(row.id);
  const last = SHOWN_USER_AT.get(row.user_id);
  if (last && Date.now() - last < USER_REPEAT_MS) return false;
  SHOWN_USER_AT.set(row.user_id, Date.now());
  return true;
}

/**
 * Small, dismissible toast for VIP 3+ logins.
 */
export function EliteVipLoginOverlay() {
  const { user, loading } = useAuth();
  const [queue, setQueue] = useState<LoginBroadcast[]>([]);
  const [current, setCurrent] = useState<LoginBroadcast | null>(null);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    return subscribePrefHidden("vip-login-hidden", (hidden) => setEnabled(!hidden));
  }, []);



  useEffect(() => {
    if (loading || !user) return;
    void broadcastEliteVipLogin();
  }, [user, loading]);

  useEffect(() => {
    let cancelled = false;
    // Backfill: show any broadcast from the last 60 seconds that we missed
    // because we weren't subscribed yet (page just loaded / navigated).
    (async () => {
      const { data } = await supabase
        .from("elite_vip_login_broadcasts")
        .select("*")
        .gte("created_at", new Date(Date.now() - 60_000).toISOString())
        .order("created_at", { ascending: true });
      if (cancelled || !data) return;
      const rows = (data as LoginBroadcast[]).filter(
        (r) => (!user || r.user_id !== user.id) && shouldShow(r),
      );
      if (rows.length) setQueue((q) => [...q, ...rows]);
    })();

    const channel = supabase
      .channel("elite-vip-login-broadcasts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "elite_vip_login_broadcasts" },
        (payload) => {
          const row = payload.new as LoginBroadcast;
          if (user && row.user_id === user.id) return;
          if (!shouldShow(row)) return;
          setQueue((q) => (q.some((r) => r.id === row.id) ? q : [...q, row]));
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  useEffect(() => {
    if (current || queue.length === 0) return;
    const next = queue[0];
    setCurrent(next);
    setQueue((q) => q.slice(1));
    const t = setTimeout(() => setCurrent(null), 3000);
    return () => clearTimeout(t);
  }, [queue, current]);

  if (!enabled || !current) return null;
  const tier = getEliteVipTier(current.elite_vip_level);
  if (!tier) return null;

  const isLegendary = current.elite_vip_level >= 5;
  const isRoyal = current.elite_vip_level === 4;

  const themeBg = isLegendary
    ? "from-purple-950/95 via-fuchsia-900/95 to-amber-900/95"
    : isRoyal
      ? "from-slate-950/95 via-indigo-950/95 to-amber-950/95"
      : "from-amber-950/95 via-yellow-900/95 to-slate-950/95";

  const themeBorder = isLegendary
    ? "border-fuchsia-300/70"
    : isRoyal
      ? "border-amber-200/70"
      : "border-amber-400/70";

  return (
    <>
      <style>{`
        @keyframes vip-slide-in-bottom { from { transform: translateY(120%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .vip-slide-in-bottom { animation: vip-slide-in-bottom 400ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
      `}</style>

      <div
        className="pointer-events-none fixed inset-x-0 z-[9998] flex justify-center px-2"
        style={{ bottom: "calc(var(--sa-bottom) + 5.5rem)" }}
        aria-live="polite"
      >
        <div onClick={() => setCurrent(null)} className={`vip-slide-in-bottom pointer-events-auto cursor-pointer relative w-full max-w-[260px] rounded-xl overflow-hidden border ${themeBorder} bg-gradient-to-r ${themeBg} shadow-lg`}>
          <div className="relative flex items-center gap-2 px-2 py-1.5" dir="rtl">
            <img decoding="async"
              src={tier.badge}
              alt=""
              className="w-8 h-8 object-contain shrink-0 drop-shadow"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <span className="text-[9px] font-bold text-amber-300/90 tracking-wider truncate">
                  {tier.emoji} VIP {tier.level} متصل
                </span>
              </div>
              <div className="text-xs font-extrabold text-amber-100 truncate leading-tight">
                {current.display_name}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                try {
                  localStorage.setItem("vip-login-hidden", "1");
                  window.dispatchEvent(new Event("vip-login-pref"));
                } catch { /* noop */ }
                setEnabled(false);
                setCurrent(null);
              }}
              className="shrink-0 px-1.5 h-6 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-[9px] text-amber-200 hover:text-white font-bold transition"
              aria-label="إيقاف إشعارات VIP"
            >
              إيقاف
            </button>
            <button
              onClick={() => setCurrent(null)}
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-amber-200 hover:text-white text-sm font-bold transition"
              aria-label="إغلاق"
            >
              ✕
            </button>

          </div>
        </div>
      </div>
    </>
  );
}
