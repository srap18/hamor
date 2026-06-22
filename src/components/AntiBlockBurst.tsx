import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sound } from "@/lib/sound";

/**
 * Full-screen shield burst overlay shown on the defender's perimeter when one
 * of their anti-weapon defenses successfully blocks an incoming attack.
 * Listens to `global_banners` realtime stream and only fires for rows
 * targeting the currently viewed defender (`defenderId`).
 */
export function AntiBlockBurst({ defenderId }: { defenderId: string | null | undefined }) {
  const [burst, setBurst] = useState<{ id: string; weapon: string; attacker: string } | null>(null);

  useEffect(() => {
    if (!defenderId) return;
    const seen = new Set<string>();

    const ch = supabase
      .channel(`anti-burst:${defenderId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "global_banners", filter: `target_id=eq.${defenderId}` },
        (payload) => {
          const row = payload.new as {
            id: string; kind: string; target_id: string; attacker_name: string | null; message: string | null; created_at: string;
          };
          if (!row?.id || seen.has(row.id)) return;
          if (row.kind !== "anti_block") return;
          // ignore stale rows on initial subscribe
          if (Date.now() - new Date(row.created_at).getTime() > 30_000) { seen.add(row.id); return; }
          seen.add(row.id);
          setBurst({ id: row.id, weapon: row.message || "هجوم", attacker: row.attacker_name || "لاعب" });
          try { sound.play("click"); } catch { /* noop */ }
          window.setTimeout(() => setBurst((b) => (b && b.id === row.id ? null : b)), 3500);
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(ch); };
  }, [defenderId]);

  if (!burst) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center">
      {/* expanding shield ripple */}
      <div className="absolute h-72 w-72 rounded-full border-4 border-emerald-300/80 animate-[ping_1.2s_ease-out_2]" />
      <div className="absolute h-48 w-48 rounded-full border-2 border-cyan-300/80 animate-[ping_1.5s_ease-out_2]" />
      <div className="absolute h-32 w-32 rounded-full bg-emerald-400/20 blur-2xl animate-pulse" />
      {/* center shield emoji */}
      <div className="relative flex flex-col items-center gap-2 animate-[fadeIn_0.3s_ease-out]">
        <div className="text-7xl drop-shadow-[0_0_18px_rgba(16,185,129,0.9)] animate-bounce">🛡️</div>
        <div className="rounded-xl border-2 border-emerald-400/70 bg-stone-950/85 px-4 py-2 text-center shadow-[0_0_24px_rgba(16,185,129,0.55)]">
          <div className="text-emerald-200 font-extrabold text-sm">صدّ {burst.weapon}!</div>
          <div className="text-emerald-100/80 text-[11px] mt-0.5">من {burst.attacker}</div>
        </div>
      </div>
    </div>
  );
}
