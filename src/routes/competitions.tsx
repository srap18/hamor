import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FISH } from "@/lib/fish";

export const Route = createFileRoute("/competitions")({
  component: CompetitionsPage,
  ssr: false,
  head: () => ({ meta: [{ title: "الفعاليات والمسابقات" }] }),
});

type Comp = {
  id: string;
  title: string;
  description: string;
  banner_emoji: string;
  banner_text: string;
  banner_theme: string;
  metric: string;
  target_fish_id: string | null;
  hide_target: boolean;
  reward_coins: number;
  reward_gems: number;
  reward_xp: number;
  reward_text: string;
  starts_at: string;
  ends_at: string;
};

type LbRow = {
  user_id: string;
  display_name: string;
  avatar_emoji: string;
  avatar_url: string | null;
  level: number;
  score: number;
};

const METRIC_LABEL: Record<string, { icon: string; name: string; unit: string }> = {
  explode_count: { icon: "🔥", name: "أكثر تفجيرات", unit: "تفجير" },
  explode_damage: { icon: "💥", name: "أعلى ضرر", unit: "ضرر" },
  fish_total: { icon: "🎣", name: "أكثر صيد", unit: "سمكة" },
  fish_specific: { icon: "🐟", name: "أكثر صيد لنوع محدد", unit: "سمكة" },
};

const THEME_CLASS: Record<string, string> = {
  gold: "from-amber-500 via-yellow-400 to-amber-600 shadow-amber-500/40",
  royal: "from-purple-600 via-fuchsia-500 to-indigo-600 shadow-fuchsia-500/40",
  inferno: "from-red-600 via-orange-500 to-yellow-500 shadow-red-500/50",
  ocean: "from-cyan-500 via-blue-500 to-indigo-600 shadow-cyan-500/40",
  emerald: "from-emerald-500 via-green-500 to-teal-600 shadow-emerald-500/40",
};

function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "انتهت";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}ي ${h}س`;
  if (h > 0) return `${h}س ${m}د`;
  return `${m}د`;
}

function CompetitionsPage() {
  const [comps, setComps] = useState<Comp[]>([]);
  const [loading, setLoading] = useState(true);
  const [boards, setBoards] = useState<Record<string, LbRow[]>>({});
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase.rpc("get_active_competitions" as never);
      const list = (data ?? []) as Comp[];
      setComps(list);
      setLoading(false);
      // Load leaderboards in parallel
      const entries = await Promise.all(list.map(async (c) => {
        const { data: lb } = await supabase.rpc("get_competition_leaderboard" as never, { _competition_id: c.id } as never);
        return [c.id, (lb ?? []) as LbRow[]] as const;
      }));
      setBoards(Object.fromEntries(entries));
    })();
  }, []);

  // tick every minute for countdown
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 60000);
    return () => clearInterval(t);
  }, []);

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <header className="sticky top-0 z-20 bg-slate-950/80 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <Link to="/" className="text-sm text-slate-400 hover:text-slate-200">← رجوع</Link>
        <h1 className="text-lg font-bold">🏆 الفعاليات</h1>
        <div className="w-12"/>
      </header>

      <main className="max-w-3xl mx-auto p-3 md:p-5 space-y-6">
        {loading && <div className="text-center text-slate-400 py-10">جاري التحميل...</div>}
        {!loading && comps.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <div className="text-6xl mb-3">🎪</div>
            <div>لا توجد فعاليات نشطة حالياً</div>
            <div className="text-xs mt-2">ترقّب البطولات القادمة!</div>
          </div>
        )}

        {comps.map(c => {
          const meta = METRIC_LABEL[c.metric] ?? { icon: "🏆", name: c.metric, unit: "" };
          const themeClass = THEME_CLASS[c.banner_theme] ?? THEME_CLASS.gold;
          const fish = c.target_fish_id ? FISH[c.target_fish_id] : null;
          const board = boards[c.id] ?? [];
          const myRank = me ? board.findIndex(r => r.user_id === me) : -1;

          return (
            <article key={c.id} className="rounded-2xl overflow-hidden border border-slate-700/60 bg-slate-900/80 shadow-2xl">
              {/* Fancy banner */}
              <div className={`relative bg-gradient-to-br ${themeClass} p-5 md:p-7 shadow-2xl overflow-hidden`}>
                <div className="absolute inset-0 opacity-30" style={{
                  backgroundImage: "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.4) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.3) 0%, transparent 50%)"
                }}/>
                <div className="absolute top-2 left-2 text-4xl opacity-20">✨</div>
                <div className="absolute bottom-2 right-2 text-4xl opacity-20">✨</div>
                <div className="relative flex items-center gap-4">
                  <div className="text-6xl md:text-7xl drop-shadow-lg">{c.banner_emoji}</div>
                  <div className="flex-1 min-w-0">
                    {c.banner_text && (
                      <div className="text-xs font-black tracking-widest text-white/90 uppercase drop-shadow">{c.banner_text}</div>
                    )}
                    <div className="text-2xl md:text-3xl font-black text-white drop-shadow-lg leading-tight">{c.title}</div>
                    <div className="text-xs md:text-sm font-bold text-white/90 mt-1 drop-shadow">
                      {meta.icon} {meta.name}
                    </div>
                  </div>
                  <div className="text-end shrink-0">
                    <div className="text-[10px] text-white/80">ينتهي خلال</div>
                    <div className="text-lg font-black text-white drop-shadow">⏳ {timeLeft(c.ends_at)}</div>
                  </div>
                </div>
              </div>

              <div className="p-4 md:p-5 space-y-4">
                {c.description && <p className="text-sm text-slate-300 whitespace-pre-wrap">{c.description}</p>}

                {/* Target reveal */}
                {c.metric === "fish_specific" && (
                  <div className="rounded-xl bg-slate-950/60 border border-slate-700/50 p-3">
                    <div className="text-xs text-slate-400 mb-2">🎯 الهدف</div>
                    {c.hide_target || !fish ? (
                      <div className="flex items-center gap-3">
                        <div className="w-14 h-14 rounded-lg bg-slate-800 flex items-center justify-center text-3xl">❓</div>
                        <div>
                          <div className="font-bold text-slate-300">نوع سمك سري 🤫</div>
                          <div className="text-xs text-slate-500">سيُكشف عند انتهاء الفعالية</div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <img src={fish.img} alt={fish.name} className="w-14 h-14 object-contain"/>
                        <div>
                          <div className="font-bold">{fish.emoji} {fish.name}</div>
                          <div className="text-xs text-slate-400">اصطدها أكبر عدد ممكن!</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Rewards */}
                {(c.reward_coins > 0 || c.reward_gems > 0 || c.reward_xp > 0 || c.reward_text) && (
                  <div className="flex flex-wrap gap-2">
                    {c.reward_coins > 0 && <span className="px-3 py-1.5 rounded-full bg-yellow-500/15 border border-yellow-500/30 text-yellow-200 text-sm font-bold">🪙 {c.reward_coins.toLocaleString()}</span>}
                    {c.reward_gems > 0 && <span className="px-3 py-1.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-200 text-sm font-bold">💎 {c.reward_gems}</span>}
                    {c.reward_xp > 0 && <span className="px-3 py-1.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-200 text-sm font-bold">⭐ {c.reward_xp} XP</span>}
                    {c.reward_text && <span className="px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-200 text-sm font-bold">🎁 {c.reward_text}</span>}
                  </div>
                )}

                {/* Leaderboard */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-bold text-slate-300">🏅 الترتيب</div>
                    {myRank >= 0 && <div className="text-xs text-amber-300">مركزك: #{myRank + 1}</div>}
                  </div>
                  {board.length === 0 ? (
                    <div className="text-center text-sm text-slate-500 py-6 rounded-lg bg-slate-950/40 border border-slate-800">
                      كن أول من يسجّل نقطة! 🚀
                    </div>
                  ) : (
                    <ol className="space-y-1.5">
                      {board.map((r, i) => {
                        const isMe = r.user_id === me;
                        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i+1}`;
                        return (
                          <li key={r.user_id} className={`flex items-center gap-3 p-2 rounded-lg ${isMe ? "bg-amber-500/15 border border-amber-500/40" : "bg-slate-950/40 border border-slate-800"}`}>
                            <div className="w-10 text-center font-black text-sm">{medal}</div>
                            {r.avatar_url ? (
                              <img src={r.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border border-slate-700"/>
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center text-lg">{r.avatar_emoji || "🧑‍✈️"}</div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-bold truncate">{r.display_name || "—"}</div>
                              <div className="text-[10px] text-slate-500">Lv {r.level}</div>
                            </div>
                            <div className="text-end shrink-0">
                              <div className="text-base font-black text-amber-300">{r.score.toLocaleString()}</div>
                              <div className="text-[10px] text-slate-500">{meta.unit}</div>
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
        })}
      </main>
    </div>
  );
}
