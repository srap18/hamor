import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sound } from "@/lib/sound";

type FeedRow = {
  id: string;
  attacker_name: string | null;
  target_name: string | null;
  kind: string | null;
  damage: number | null;
  at: string;
};

const MAX_ITEMS = 5;

function timeAgo(iso: string): string {
  const diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 10) return "الآن";
  if (diff < 60) return `منذ ${Math.floor(diff)} ث`;
  if (diff < 3600) return `منذ ${Math.floor(diff / 60)} د`;
  if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} س`;
  return `منذ ${Math.floor(diff / 86400)} ي`;
}

export function LastAttackTicker() {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [hidden, setHidden] = useState<boolean>(() => {
    try { return localStorage.getItem("death-banner-hidden") === "1"; } catch { return false; }
  });
  const [minimized, setMinimized] = useState<boolean>(() => {
    try { return localStorage.getItem("death-banner-min") === "1"; } catch { return false; }
  });
  const [, force] = useState(0);

  // tick every 15s so timeAgo refreshes
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onPref = () => {
      try { setHidden(localStorage.getItem("death-banner-hidden") === "1"); } catch { /* noop */ }
    };
    window.addEventListener("death-banner-pref", onPref);
    return () => window.removeEventListener("death-banner-pref", onPref);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase as any)
        .from("global_attack_feed")
        .select("id,attacker_name,target_name,kind,damage,at")
        .order("at", { ascending: false })
        .limit(MAX_ITEMS);
      if (error) console.warn("[feed] fetch error", error);
      if (!cancelled && data) setRows(data as FeedRow[]);
    })();

    const ch = supabase
      .channel("global:attack_feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "global_attack_feed" },
        (payload) => {
          const n = payload.new as FeedRow;
          if (!n) return;
          setRows((prev) => [n, ...prev.filter((r) => r.id !== n.id)].slice(0, MAX_ITEMS));
          try { sound.play("click"); } catch { /* noop */ }
        },
      )
      .subscribe();

    return () => { cancelled = true; void supabase.removeChannel(ch); };
  }, []);

  if (hidden || rows.length === 0) return null;

  if (minimized) {
    return (
      <div className="fixed top-0 inset-x-0 z-[90] flex justify-center pointer-events-none"
        style={{ paddingTop: "max(0.25rem, calc(env(safe-area-inset-top) + 0.15rem))" }}>
        <button
          onClick={() => {
            setMinimized(false);
            try { localStorage.removeItem("death-banner-min"); } catch { /* noop */ }
          }}
          className="pointer-events-auto px-2 py-0.5 rounded-full bg-black/70 border border-red-400/40 text-red-100/90 text-[10px] font-bold shadow active:scale-95"
          title="إظهار قائمة الهجمات"
        >
          💥 آخر {rows.length} هجمات
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed top-0 inset-x-0 z-[90] flex justify-center px-2 pointer-events-none"
      style={{ paddingTop: "max(0.25rem, calc(env(safe-area-inset-top) + 0.15rem))" }}
    >
      <div className="pointer-events-auto relative max-w-md w-full rounded-2xl bg-gradient-to-b from-black/80 via-red-950/70 to-black/80 border border-red-400/30 shadow-[0_6px_20px_rgba(0,0,0,0.5)] overflow-hidden backdrop-blur-sm">
        <div className="flex items-center justify-between px-3 py-1 border-b border-red-400/20 bg-gradient-to-r from-red-950/60 via-red-900/40 to-red-950/60">
          <div className="flex items-center gap-1.5 text-red-100 text-[10px] font-extrabold tracking-wider">
            <span>💥</span>
            <span>سجل هجمات القنابل</span>
          </div>
          <button
            onClick={() => {
              setMinimized(true);
              try { localStorage.setItem("death-banner-min", "1"); } catch { /* noop */ }
            }}
            className="w-4 h-4 rounded-full bg-black/40 hover:bg-black/60 border border-white/20 text-white/80 text-[9px] leading-none flex items-center justify-center active:scale-90"
            title="تصغير"
          >
            −
          </button>
        </div>
        <ul className="divide-y divide-red-400/10">
          {rows.map((r, idx) => {
            const isNuke = r.kind === "nuke";
            const emoji = isNuke ? "☢️" : "📺";
            const verb = isNuke ? "فجّر" : "ضرب إعلانية على";
            const dmg = r.damage ?? 70000;
            return (
              <li
                key={r.id}
                className={
                  "flex items-center gap-2 px-3 py-1.5 text-[11px] leading-tight animate-fade-in " +
                  (idx === 0 ? "bg-red-500/10" : "")
                }
              >
                <span className="text-base shrink-0 drop-shadow">{emoji}</span>
                <div className="flex-1 min-w-0 truncate font-bold text-red-50/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                  <span className="text-amber-300">{r.attacker_name ?? "لاعب"}</span>
                  <span className="mx-1 text-red-50/90">{verb}</span>
                  <span className="text-amber-200">{r.target_name ?? "لاعب"}</span>
                </div>
                <span className="shrink-0 text-[9px] font-black text-orange-300 tabular-nums">
                  -{dmg.toLocaleString("en-US")}
                </span>
                <span className="shrink-0 text-[9px] text-red-200/70 tabular-nums w-14 text-end">
                  {timeAgo(r.at)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
