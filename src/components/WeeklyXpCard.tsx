import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CoinIcon } from "@/components/CurrencyIcon";

type Tier = { rank: number; coins: number; gems: number; xp: number; text: string };
type Config = {
  enabled: boolean;
  title: string;
  description: string;
  prize_tiers: Tier[];
  week_started_at: string;
};
type LbRow = {
  user_id: string;
  display_name: string;
  avatar_emoji: string;
  avatar_url: string | null;
  level: number;
  weekly_xp: number;
};

function timeUntilNextMonday() {
  const now = new Date();
  const day = now.getUTCDay();
  const daysToMonday = (8 - day) % 7 || 7;
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysToMonday, 0, 0, 0));
  const ms = next.getTime() - now.getTime();
  if (ms <= 0) return "قريباً";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}ي ${h}س`;
  if (h > 0) return `${h}س ${m}د`;
  return `${m}د`;
}

export function WeeklyXpCard() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [board, setBoard] = useState<LbRow[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("weekly_xp_config" as never).select("*").eq("id", true).maybeSingle();
      if (data) {
        const c = data as unknown as Config;
        setCfg({ ...c, prize_tiers: Array.isArray(c.prize_tiers) ? c.prize_tiers : [] });
      }
      const { data: lb } = await supabase.rpc("get_weekly_xp_leaderboard" as never, { _limit: 20 } as never);
      setBoard((lb ?? []) as LbRow[]);
    })();
    const t = setInterval(() => setTick((x) => x + 1), 60000);
    return () => clearInterval(t);
  }, []);

  if (!cfg || !cfg.enabled) return null;

  const tiers = cfg.prize_tiers;
  const winnerCount = tiers.length;
  const myRank = me ? board.findIndex((r) => r.user_id === me) : -1;

  return (
    <article className="relative rounded-[1.75rem] overflow-hidden shadow-[0_25px_70px_-15px_rgba(0,0,0,0.9),0_0_0_1px_rgba(168,85,247,0.3)] bg-gradient-to-b from-slate-900/95 via-slate-950/95 to-black/95">
      <div className="pointer-events-none absolute inset-0 rounded-[1.75rem] ring-1 ring-purple-400/40" />

      <div className="relative bg-gradient-to-br from-purple-600 via-fuchsia-500 to-indigo-600 p-6 shadow-2xl overflow-hidden">
        <div className="absolute inset-0 opacity-30 mix-blend-overlay animate-pulse" style={{
          backgroundImage: "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.6) 50%, transparent 70%)"
        }} />
        <div className="pointer-events-none absolute inset-2 rounded-2xl border border-white/40" />

        <div className="relative flex items-center gap-4">
          <div className="text-6xl drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)]">⭐</div>
          <div className="flex-1 min-w-0">
            <div className="inline-block text-[10px] font-black tracking-[0.35em] text-white/95 uppercase px-2 py-0.5 rounded bg-black/25 border border-white/30 mb-1">
              WEEKLY · أسبوعية
            </div>
            <div className="text-2xl font-black text-white drop-shadow leading-tight">{cfg.title}</div>
            <div className="text-xs font-bold text-white/95 mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/25 border border-white/25">
              ⏳ التوزيع التلقائي خلال {timeUntilNextMonday()}
            </div>
          </div>
        </div>
        {winnerCount > 0 && (
          <div className="relative mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-black/40 backdrop-blur border border-white/40">
            <span className="text-xs font-black text-white">🏆 جوائز لأفضل {winnerCount} لاعبين</span>
          </div>
        )}
      </div>

      <div className="p-4 md:p-5 space-y-4">
        {cfg.description && <p className="text-sm text-slate-300 whitespace-pre-wrap">{cfg.description}</p>}

        {tiers.length > 0 && (
          <div className="rounded-xl bg-slate-950/60 border border-amber-500/30 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-lg">🏆</span>
              <span className="text-sm font-black text-amber-200 tracking-wider">قائمة الجوائز</span>
            </div>
            <ol className="space-y-1.5 max-h-72 overflow-y-auto">
              {tiers.map((t, i) => {
                const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;
                return (
                  <li key={i} className="flex items-center gap-3 p-2 rounded-lg bg-slate-900/60 border border-slate-800 text-sm">
                    <div className="w-10 text-center font-black">{medal}</div>
                    <div className="flex-1 flex flex-wrap gap-1.5">
                      {t.coins > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-200 border border-amber-500/30 text-xs font-bold inline-flex items-center gap-1"><CoinIcon size={12} /> {t.coins.toLocaleString()}</span>}
                      {t.gems > 0 && <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-200 border border-cyan-500/30 text-xs font-bold">💎 {t.gems}</span>}
                      {t.xp > 0 && <span className="px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-200 border border-violet-500/30 text-xs font-bold">⭐ {t.xp} XP</span>}
                      {t.text && <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-200 border border-emerald-500/30 text-xs font-bold">🎁 {t.text}</span>}
                      {!t.coins && !t.gems && !t.xp && !t.text && <span className="text-xs text-slate-500">—</span>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-black text-amber-200">✦ المتصدّرون هذا الأسبوع ✦</div>
            {myRank >= 0 && <div className="text-xs font-bold text-amber-300 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30">مركزك: #{myRank + 1}</div>}
          </div>
          {board.length === 0 ? (
            <div className="text-center text-sm text-slate-500 py-6 rounded-lg bg-slate-950/40 border border-slate-800">
              كن أول من يجمع XP هذا الأسبوع! 🚀
            </div>
          ) : (
            <ol className="space-y-1.5">
              {board.slice(0, 10).map((r, i) => {
                const isMe = r.user_id === me;
                const isWinner = i < winnerCount;
                const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;
                return (
                  <li key={r.user_id} className={`flex items-center gap-3 p-2 rounded-lg ${
                    isMe ? "bg-amber-500/15 border border-amber-500/40"
                    : isWinner ? "bg-emerald-500/10 border border-emerald-500/30"
                    : "bg-slate-950/40 border border-slate-800"
                  }`}>
                    <div className="w-10 text-center font-black text-sm">{medal}</div>
                    {r.avatar_url
                      ? <img src={r.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border border-slate-700" />
                      : <div className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center text-lg">{r.avatar_emoji || "🧑‍✈️"}</div>}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate">{r.display_name}</div>
                      <div className="text-[10px] text-slate-500">Lv {r.level}</div>
                    </div>
                    <div className="text-end shrink-0">
                      <div className="text-base font-black text-amber-300">{r.weekly_xp.toLocaleString()}</div>
                      <div className="text-[10px] text-slate-500">XP</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </article>
  );
}
