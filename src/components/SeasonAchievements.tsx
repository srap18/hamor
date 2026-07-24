import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SEASON_FRAMES, SeasonFrameRing } from "@/lib/season-frames";

type ResultRow = {
  season_id: number;
  final_rank: number;
  final_damage: number;
  frame_tier: number;
  reward_gems: number;
};
type Season = { id: number; name: string; starts_at: string; ends_at: string };

function fmt(n: number) { return Number(n || 0).toLocaleString("ar-EG"); }
function shortDate(iso: string) { try { return new Date(iso).toLocaleDateString("ar-EG", { month: "short", year: "numeric" }); } catch { return ""; } }

export function SeasonAchievements({ userId }: { userId: string }) {
  const [rows, setRows] = useState<(ResultRow & { season?: Season })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data: res } = await supabase.from("season_results")
        .select("season_id, final_rank, final_damage, frame_tier, reward_gems")
        .eq("user_id", userId)
        .order("season_id", { ascending: false });
      const results = (res || []) as ResultRow[];
      if (results.length) {
        const { data: sList } = await supabase.from("seasons").select("id,name,starts_at,ends_at").in("id", results.map(r => r.season_id));
        const map: Record<number, Season> = {};
        (sList || []).forEach((x) => { map[(x as Season).id] = x as Season; });
        setRows(results.map((x) => ({ ...x, season: map[x.season_id] })));
      }
      setLoading(false);
    })();
  }, [userId]);

  if (loading || rows.length === 0) return null;

  return (
    <section className="rounded-2xl p-3 bg-gradient-to-br from-amber-500/10 to-purple-500/10 border border-amber-400/40">
      <div className="text-sm font-black text-amber-200 mb-3 flex items-center gap-2">🏆 إنجازات المواسم</div>
      <div className="space-y-2">
        {rows.map((r) => {
          const f = SEASON_FRAMES.find((x) => x.tier === r.frame_tier) || null;
          const medal = r.final_rank === 1 ? "🥇" : r.final_rank === 2 ? "🥈" : r.final_rank === 3 ? "🥉" : "🏅";
          return (
            <div key={r.season_id} className="flex items-center gap-3 rounded-xl p-2 bg-black/30 border border-amber-400/20">
              <SeasonFrameRing frame={f} size={56} showCrown>
                <div className="w-full h-full flex items-center justify-center text-xl bg-slate-800">{f?.crown || medal}</div>
              </SeasonFrameRing>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-black text-amber-100">{r.season?.name || `SEASON ${r.season_id}`}</div>
                <div className="text-[11px] text-amber-200/85">{medal} الترتيب #{r.final_rank} · ⚔️ {fmt(r.final_damage)}</div>
                <div className="text-[10px] text-amber-200/70">🖼️ {f?.name || "بدون إطار"}{r.reward_gems > 0 ? ` · 🎁 ${fmt(r.reward_gems)} 💎` : ""}</div>
                {r.season && <div className="text-[9px] text-amber-200/60">📅 {shortDate(r.season.starts_at)} — {shortDate(r.season.ends_at)}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
