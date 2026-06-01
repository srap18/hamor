// Top-3 luxury styling for leaderboard rankings.
// Returns null for ranks 4+. Indexes are 0-based (i=0 → 1st place).
export type RankTier = {
  rank: 1 | 2 | 3;
  label: string;
  badge: string;
  rowClass: string;       // applied to the row wrapper (gradient + border)
  nameClass: string;      // applied to the name pill (gradient text + bg)
  ringClass: string;      // ring around avatar (only when no purchased avatar frame)
  glowFilter: string;     // drop-shadow filter for avatar
};

export function rankTier(i: number): RankTier | null {
  if (i === 0) return {
    rank: 1, label: "البطل", badge: "👑",
    rowClass:
      "bg-gradient-to-l from-amber-400/30 via-yellow-300/15 to-amber-500/30 border-amber-300/80 shadow-[0_0_18px_rgba(251,191,36,0.45)]",
    nameClass:
      "bg-gradient-to-r from-amber-200 via-yellow-100 to-amber-300 text-amber-950 border border-amber-500/80 rounded-md shadow-[0_0_10px_rgba(251,191,36,0.55)]",
    ringClass: "ring-2 ring-amber-300",
    glowFilter: "drop-shadow(0 0 8px rgba(251,191,36,0.85))",
  };
  if (i === 1) return {
    rank: 2, label: "الوصيف", badge: "🥈",
    rowClass:
      "bg-gradient-to-l from-slate-300/25 via-slate-200/10 to-slate-400/25 border-slate-200/70 shadow-[0_0_14px_rgba(203,213,225,0.4)]",
    nameClass:
      "bg-gradient-to-r from-slate-100 via-white to-slate-200 text-slate-900 border border-slate-300 rounded-md shadow-[0_0_8px_rgba(203,213,225,0.5)]",
    ringClass: "ring-2 ring-slate-200",
    glowFilter: "drop-shadow(0 0 7px rgba(226,232,240,0.8))",
  };
  if (i === 2) return {
    rank: 3, label: "البرونزي", badge: "🥉",
    rowClass:
      "bg-gradient-to-l from-orange-500/25 via-amber-700/10 to-orange-600/25 border-orange-400/70 shadow-[0_0_14px_rgba(249,115,22,0.4)]",
    nameClass:
      "bg-gradient-to-r from-orange-300 via-amber-200 to-orange-400 text-amber-950 border border-orange-500/80 rounded-md shadow-[0_0_8px_rgba(249,115,22,0.5)]",
    ringClass: "ring-2 ring-orange-300",
    glowFilter: "drop-shadow(0 0 7px rgba(249,115,22,0.8))",
  };
  return null;
}
