import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type MyRankKind =
  | "competition"
  | "weekly_xp"
  | "coins"
  | "gems"
  | "xp"
  | "ships"
  | "fish"
  | "arena"
  | "tribe_donations"
  | "tribe_damage"
  | "tribe_event";

type Stat = { rank: number; score: number; extra: number; total: number };

const RANK_CACHE_MS = 30_000;
const rankCache = new Map<string, { value: Stat; expiresAt: number }>();
const rankRequests = new Map<string, Promise<Stat>>();

async function fetchMyRank(kind: MyRankKind, refId?: string | null): Promise<Stat> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return { rank: 0, score: 0, extra: 0, total: 0 };

  const key = `${userId}:${kind}:${refId ?? ""}`;
  const cached = rankCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pending = rankRequests.get(key);
  if (pending) return pending;

  const request = (async () => {
    const { data } = await (supabase as never as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }>;
    }).rpc("my_leaderboard_rank", { _kind: kind, _ref: refId ?? null });
    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    const value = {
      rank: Number(row?.rank ?? 0),
      score: Number(row?.score ?? 0),
      extra: Number(row?.extra ?? 0),
      total: Number(row?.total ?? 0),
    };
    rankCache.set(key, { value, expiresAt: Date.now() + RANK_CACHE_MS });
    return value;
  })().finally(() => rankRequests.delete(key));

  rankRequests.set(key, request);
  return request;
}

export function useMyRank(kind: MyRankKind, refId?: string | null, deps: unknown[] = []) {
  const [stat, setStat] = useState<Stat | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const value = await fetchMyRank(kind, refId);
        if (!cancelled) setStat(value);
      } catch {
        if (!cancelled) setStat(null);
      }
    };
    void load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, refId, ...deps]);

  return stat;
}

export function MyRankBar({
  kind,
  refId,
  unit,
  label = "ترتيبك",
  emptyText = "ما عندك نقاط بعد — ابدأ الآن!",
  extraUnit,
  deps = [],
  className = "",
}: {
  kind: MyRankKind;
  refId?: string | null;
  unit: string;
  label?: string;
  emptyText?: string;
  extraUnit?: string;
  deps?: unknown[];
  className?: string;
}) {
  const stat = useMyRank(kind, refId, deps);
  if (!stat) return null;

  const has = stat.rank > 0;
  const medal = stat.rank === 1 ? "🥇" : stat.rank === 2 ? "🥈" : stat.rank === 3 ? "🥉" : `#${stat.rank}`;

  return (
    <div
      dir="rtl"
      className={`mt-2 rounded-xl border border-amber-400/50 bg-gradient-to-l from-amber-500/20 via-amber-500/10 to-transparent p-2.5 flex items-center gap-3 ${className}`}
    >
      <div className="shrink-0 w-12 text-center">
        <div className="text-lg font-black text-amber-200 leading-none">{has ? medal : "—"}</div>
        <div className="text-[9px] text-amber-200/60 mt-0.5">{label}</div>
      </div>
      <div className="flex-1 min-w-0 text-xs text-amber-100/90 font-bold truncate">
        {has ? (
          <>
            أنت في المركز <span className="text-amber-300">#{stat.rank}</span>
            {label !== "ترتيبك" ? <span className="text-amber-200/70"> — {label}</span> : null}
          </>

        ) : (
          <span className="text-amber-200/70">{emptyText}</span>
        )}
      </div>
      <div className="text-end shrink-0">
        <div className="text-base font-black text-amber-300 tabular-nums">{stat.score.toLocaleString()}</div>
        <div className="text-[9px] text-amber-200/60">
          {unit}
          {extraUnit ? ` · ${stat.extra.toLocaleString()} ${extraUnit}` : ""}
        </div>
      </div>
    </div>
  );
}
