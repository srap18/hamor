import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sound } from "@/lib/sound";

type LastAttack = {
  attacker_name: string | null;
  target_name: string | null;
  kind: string | null;
  at: string | null;
};

export function LastAttackTicker() {
  const [row, setRow] = useState<LastAttack | null>(null);
  const [hidden, setHidden] = useState<boolean>(() => {
    try { return localStorage.getItem("death-banner-hidden") === "1"; } catch { return false; }
  });
  const [minimized, setMinimized] = useState<boolean>(() => {
    try { return localStorage.getItem("death-banner-min") === "1"; } catch { return false; }
  });

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
        .from("global_last_attack")
        .select("attacker_name,target_name,kind,at")
        .eq("id", true)
        .maybeSingle();
      if (error) console.warn("[ticker] fetch error", error);
      if (!cancelled && data) setRow(data as LastAttack);
    })();

    const ch = supabase
      .channel("global:last_attack")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "global_last_attack" },
        (payload) => {
          const n = payload.new as LastAttack | null;
          if (n && n.attacker_name) {
            setRow(n);
            try { sound.play("click"); } catch { /* noop */ }
          }
        },
      )
      .subscribe();

    return () => { cancelled = true; void supabase.removeChannel(ch); };
  }, []);

  if (hidden) return null;
  if (!row?.attacker_name || (row.kind !== "nuke" && row.kind !== "ad_bomb")) return null;

  const emoji = row.kind === "nuke" ? "☢️" : "📺";
  const verb = row.kind === "nuke" ? "فجّر" : "ضرب إعلانية على";

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
          title="إظهار شريط آخر هجوم"
        >
          {emoji} آخر هجوم
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed top-0 inset-x-0 z-[90] flex justify-center px-2 pointer-events-none"
      style={{ paddingTop: "max(0.25rem, calc(env(safe-area-inset-top) + 0.15rem))" }}
    >
      <div className="pointer-events-auto relative max-w-md w-full rounded-full bg-gradient-to-r from-black/70 via-red-900/70 to-black/70 border border-red-300/30 shadow-[0_4px_14px_rgba(0,0,0,0.35)] px-3 py-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/5 to-transparent" />
        <div className="relative text-center text-[11px] font-bold leading-tight tracking-wide text-red-50/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)] pe-5 truncate">
          <span className="opacity-90 me-1">{emoji}</span>
          <span className="text-amber-300 font-extrabold">{row.attacker_name}</span>
          <span className="mx-1 text-red-50/90">{verb}</span>
          <span className="text-amber-200 font-extrabold">{row.target_name ?? "لاعب"}</span>
        </div>
        <button
          onClick={() => {
            setMinimized(true);
            try { localStorage.setItem("death-banner-min", "1"); } catch { /* noop */ }
          }}
          className="absolute top-1/2 -translate-y-1/2 end-1 w-4 h-4 rounded-full bg-black/30 hover:bg-black/50 border border-white/20 text-white/80 text-[9px] leading-none flex items-center justify-center active:scale-90"
          title="تصغير"
        >
          −
        </button>
      </div>
    </div>
  );
}
