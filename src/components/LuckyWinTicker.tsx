import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sound } from "@/lib/sound";

type LuckyWin = {
  id: string;
  player_name: string | null;
  rarity: "rare" | "legendary" | string;
  label: string | null;
  icon: string | null;
  amount: number | null;
  at: string;
};

type Toast = LuckyWin & { visible: boolean };

const RARE_DURATION_MS = 6500;
const LEGENDARY_DURATION_MS = 9000;

export function LuckyWinTicker() {
  const [queue, setQueue] = useState<Toast[]>([]);

  useEffect(() => {
    const ch = supabase
      .channel("global:lucky_wins")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "global_lucky_wins" },
        (payload) => {
          const n = payload.new as LuckyWin;
          if (!n || (n.rarity !== "rare" && n.rarity !== "legendary")) return;
          setQueue((q) => [...q, { ...n, visible: true }]);
          try { sound.play(n.rarity === "legendary" ? "success" : "click"); } catch { /* noop */ }
          const ttl = n.rarity === "legendary" ? LEGENDARY_DURATION_MS : RARE_DURATION_MS;
          setTimeout(() => {
            setQueue((q) => q.filter((t) => t.id !== n.id));
          }, ttl);
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(ch); };
  }, []);

  if (queue.length === 0) return null;

  return (
    <div
      className="fixed inset-x-0 z-[95] flex flex-col items-center gap-2 px-3 pointer-events-none"
      style={{ top: "max(4.75rem, calc(env(safe-area-inset-top) + 4.75rem))" }}
    >
      {queue.slice(-3).map((t) => (
        <LuckyToast key={t.id} toast={t} />
      ))}
    </div>
  );
}

function LuckyToast({ toast }: { toast: Toast }) {
  const isLegendary = toast.rarity === "legendary";

  if (isLegendary) {
    return (
      <div className="pointer-events-auto relative max-w-md w-full animate-scale-in">
        {/* halo */}
        <div className="absolute -inset-2 rounded-3xl bg-gradient-to-r from-fuchsia-500/40 via-amber-400/40 to-fuchsia-500/40 blur-2xl animate-pulse" />
        <div className="relative rounded-2xl overflow-hidden border-2 border-amber-300/70 shadow-[0_0_35px_rgba(251,191,36,0.55)] bg-gradient-to-br from-[#1a0f2e] via-[#3d1663] to-[#1a0f2e]">
          {/* shimmering ribbon */}
          <div className="absolute inset-x-0 top-0 h-6 bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-400 text-black text-center text-[10px] font-black tracking-[0.3em] flex items-center justify-center">
            ⭐ جائزة أسطورية ⭐
          </div>
          <div className="pt-7 pb-3 px-3 flex items-center gap-3">
            <div className="shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br from-amber-300 to-fuchsia-500 flex items-center justify-center text-3xl shadow-inner ring-2 ring-amber-200/70">
              {toast.icon || "🏆"}
            </div>
            <div className="flex-1 min-w-0 text-right">
              <div className="text-[11px] text-amber-200/90 font-bold truncate">
                🎉 {toast.player_name || "لاعب"} حقّق الأسطورة!
              </div>
              <div className="text-sm font-black text-amber-100 truncate drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
                {toast.label || "جائزة أسطورية"}
              </div>
              {toast.amount ? (
                <div className="text-[11px] font-black text-yellow-300 tabular-nums">
                  × {Number(toast.amount).toLocaleString("en-US")}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Rare
  return (
    <div className="pointer-events-auto relative max-w-md w-full animate-fade-in">
      <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-sky-400/30 via-violet-500/30 to-sky-400/30 blur-xl" />
      <div className="relative rounded-xl overflow-hidden border border-violet-300/60 shadow-[0_0_18px_rgba(139,92,246,0.45)] bg-gradient-to-r from-[#0f172a] via-[#3b1f6a] to-[#0f172a]">
        <div className="flex items-center gap-2.5 px-3 py-2">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-violet-400 to-sky-500 flex items-center justify-center text-2xl ring-1 ring-violet-200/60">
            {toast.icon || "💎"}
          </div>
          <div className="flex-1 min-w-0 text-right">
            <div className="text-[10px] font-extrabold tracking-widest text-violet-200/90">
              ✨ جائزة نادرة
            </div>
            <div className="text-[12px] font-black text-violet-50 truncate drop-shadow">
              <span className="text-amber-300">{toast.player_name || "لاعب"}</span>
              <span className="mx-1 opacity-80">حصل على</span>
              <span className="text-white">{toast.label || "جائزة"}</span>
            </div>
          </div>
          {toast.amount ? (
            <span className="shrink-0 text-[10px] font-black text-sky-200 tabular-nums">
              × {Number(toast.amount).toLocaleString("en-US")}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
