import { createFileRoute, Link } from "@tanstack/react-router";
import { BackButton } from "@/components/BackButton";
import { useEffect, useState } from "react";
import { WeeklyXpCard } from "@/components/WeeklyXpCard";
import { supabase } from "@/integrations/supabase/client";
import { FISH } from "@/lib/fish";
import { CoinIcon } from "@/components/CurrencyIcon";
import { syncServerTime, serverNow } from "@/lib/server-time";


export const Route = createFileRoute("/competitions")({
  component: CompetitionsPage,
  ssr: false,
  head: () => ({ meta: [{ title: "الفعاليات والمسابقات" }] }),
});


type PrizeTier = {
  rank: number;
  coins: number;
  gems: number;
  xp: number;
  text: string;
};

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
  prize_tiers: PrizeTier[] | null;
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
  diamond: "from-sky-300 via-cyan-200 to-indigo-400 shadow-cyan-300/40",
  obsidian: "from-slate-800 via-zinc-700 to-slate-900 shadow-amber-500/30",
};

const RANK_MEDAL = (r: number) => r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : `#${r}`;
const RANK_NAME = (r: number) => r === 1 ? "المركز الأول" : r === 2 ? "المركز الثاني" : r === 3 ? "المركز الثالث" : `المركز ${r}`;

const RANK_TIER_STYLE: Record<number, string> = {
  1: "from-amber-400 via-yellow-300 to-amber-600 text-amber-950 border-amber-300 shadow-amber-400/50",
  2: "from-slate-300 via-zinc-200 to-slate-400 text-slate-900 border-slate-200 shadow-slate-300/50",
  3: "from-orange-500 via-amber-600 to-orange-700 text-orange-50 border-orange-400 shadow-orange-500/50",
};
const DEFAULT_TIER_STYLE = "from-indigo-600 via-purple-600 to-fuchsia-600 text-white border-purple-400 shadow-purple-500/40";

function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - serverNow().getTime();
  if (ms <= 0) return "انتهت";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}ي ${h}س`;
  if (h > 0) return `${h}س ${m}د`;
  return `${m}د`;
}

function tiersOf(c: Comp): PrizeTier[] {
  if (Array.isArray(c.prize_tiers) && c.prize_tiers.length > 0) {
    return c.prize_tiers.map((t, i) => ({ ...t, rank: t.rank ?? i + 1 }));
  }
  if (c.reward_coins || c.reward_gems || c.reward_xp || c.reward_text) {
    return [{ rank: 1, coins: c.reward_coins, gems: c.reward_gems, xp: c.reward_xp, text: c.reward_text }];
  }
  return [];
}

function PrizeBanner({ tiers }: { tiers: PrizeTier[] }) {
  if (tiers.length === 0) return null;
  return (
    <div className="rounded-xl bg-gradient-to-b from-slate-950/80 to-slate-900/80 border border-amber-500/30 p-3 md:p-4 space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="text-lg">🏆</span>
        <span className="text-sm font-black text-amber-200 tracking-wider">قائمة الجوائز</span>
        <span className="text-[10px] text-slate-500 mr-auto">{tiers.length} مرتبة</span>
      </div>
      <ol className="space-y-2">
        {tiers.map((t) => {
          const style = RANK_TIER_STYLE[t.rank] ?? DEFAULT_TIER_STYLE;
          return (
            <li key={t.rank}
                className={`relative overflow-hidden rounded-xl border-2 bg-gradient-to-l ${style} p-3 shadow-xl`}>
              <div className="absolute inset-0 opacity-20" style={{
                backgroundImage: "radial-gradient(circle at 90% 50%, rgba(255,255,255,0.5) 0%, transparent 60%)"
              }}/>
              <div className="relative flex items-center gap-3">
                <div className="text-3xl md:text-4xl drop-shadow font-black shrink-0 w-12 text-center">
                  {RANK_MEDAL(t.rank)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-black uppercase tracking-wider opacity-80">{RANK_NAME(t.rank)}</div>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {t.coins > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-black/25 backdrop-blur text-xs font-black inline-flex items-center gap-1">
                        <CoinIcon size={14} /> {t.coins.toLocaleString()}
                      </span>
                    )}
                    {t.gems > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-black/25 backdrop-blur text-xs font-black">
                        💎 {t.gems}
                      </span>
                    )}
                    {t.xp > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-black/25 backdrop-blur text-xs font-black">
                        ⭐ {t.xp} XP
                      </span>
                    )}
                    {t.text && (
                      <span className="px-2 py-0.5 rounded-full bg-black/25 backdrop-blur text-xs font-black">
                        🎁 {t.text}
                      </span>
                    )}
                    {!t.coins && !t.gems && !t.xp && !t.text && (
                      <span className="text-xs opacity-70">—</span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CompetitionsPage() {
  const [comps, setComps] = useState<Comp[]>([]);
  const [loading, setLoading] = useState(true);
  const [boards, setBoards] = useState<Record<string, LbRow[]>>({});
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

  const loadAll = async () => {
    setLoading(true);
    await syncServerTime(true);
    const { data } = await supabase.rpc("get_active_competitions" as never);
    const list = (data ?? []) as Comp[];
    setComps(list);
    setLoading(false);
    const entries = await Promise.all(list.map(async (c) => {
      const { data: lb } = await supabase.rpc("get_competition_leaderboard" as never, { _competition_id: c.id } as never);
      return [c.id, (lb ?? []) as LbRow[]] as const;
    }));
    setBoards(Object.fromEntries(entries));
  };
  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel("competition-leaderboard-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "competition_catches" },
        () => {
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => { void loadAll(); }, 250);
        },
      )
      .subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, []);


  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 60000);
    return () => clearInterval(t);
  }, []);



  return (
    <div dir="rtl" className="relative min-h-screen text-slate-100 overflow-hidden bg-[radial-gradient(ellipse_at_top,#1a1330_0%,#0a0816_55%,#050309_100%)]">
      {/* Luxury ambient glow */}
      <div className="pointer-events-none absolute inset-0 opacity-60" style={{
        backgroundImage: "radial-gradient(circle at 15% 10%, rgba(212,175,55,0.18) 0%, transparent 45%), radial-gradient(circle at 85% 90%, rgba(168,85,247,0.15) 0%, transparent 50%)"
      }}/>
      <div className="pointer-events-none absolute inset-0 opacity-[0.05]" style={{
        backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><path d='M0 0h40v40H0z' fill='none'/><path d='M20 0l5 15 15 5-15 5-5 15-5-15-15-5 15-5z' fill='%23d4af37'/></svg>\")",
        backgroundSize: "60px 60px"
      }}/>

      <header className="relative sticky top-0 z-20 bg-gradient-to-b from-slate-950/95 to-slate-950/70 backdrop-blur-xl border-b border-amber-500/20 px-4 py-3 flex items-center justify-between shadow-[0_4px_20px_-8px_rgba(212,175,55,0.4)]">
        <BackButton className="text-sm text-amber-200/70 hover:text-amber-200 transition-colors">← رجوع</BackButton>
        <h1 className="text-lg font-black bg-gradient-to-b from-amber-200 via-yellow-100 to-amber-400 bg-clip-text text-transparent tracking-wider drop-shadow-[0_2px_8px_rgba(212,175,55,0.5)]">
          ✦ الفعاليات الفخمة ✦
        </h1>
        <div className="w-12"/>
      </header>

      <main className="relative max-w-3xl mx-auto p-3 md:p-5 space-y-7">
        <WeeklyXpCard />

        <Link
          to="/tribe-events"
          className="block rounded-2xl overflow-hidden border border-cyan-500/40 bg-gradient-to-l from-cyan-700/40 via-blue-700/30 to-indigo-700/40 p-4 hover:from-cyan-600/50 hover:to-indigo-600/50 transition-colors shadow-lg shadow-cyan-500/20"
        >
          <div className="flex items-center gap-3">
            <div className="text-4xl">🎣</div>
            <div className="flex-1">
              <div className="font-black text-cyan-100">فعاليات صيد القبائل</div>
              <div className="text-xs text-cyan-200/80 mt-0.5">تنافسوا مع قبيلتكم على جوائز جواهر تتوزع على الأعضاء</div>
            </div>
            <div className="text-cyan-200 text-xl">‹</div>
          </div>
        </Link>





        {loading && <div className="text-center text-amber-200/60 py-10">جاري التحميل...</div>}
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
          const tiers = tiersOf(c);
          const winnerCount = tiers.length;
          const isEnded = new Date(c.ends_at).getTime() <= serverNow().getTime();
          const isUpcoming = new Date(c.starts_at).getTime() > serverNow().getTime();

          return (
            <article key={c.id} className="group relative rounded-[1.75rem] overflow-hidden shadow-[0_25px_70px_-15px_rgba(0,0,0,0.9),0_0_0_1px_rgba(212,175,55,0.25)] bg-gradient-to-b from-slate-900/95 via-slate-950/95 to-black/95 backdrop-blur-xl">
              {/* Gold double border frame */}
              <div className="pointer-events-none absolute inset-0 rounded-[1.75rem] ring-1 ring-amber-400/40"/>
              <div className="pointer-events-none absolute inset-[3px] rounded-[1.6rem] ring-1 ring-amber-300/15"/>
              {/* Ornate corners */}
              <div className="pointer-events-none absolute top-2 right-2 text-amber-300/70 text-lg drop-shadow-[0_0_6px_rgba(212,175,55,0.8)] z-10">❖</div>
              <div className="pointer-events-none absolute top-2 left-2 text-amber-300/70 text-lg drop-shadow-[0_0_6px_rgba(212,175,55,0.8)] z-10">❖</div>
              <div className="pointer-events-none absolute bottom-2 right-2 text-amber-300/70 text-lg drop-shadow-[0_0_6px_rgba(212,175,55,0.8)] z-10">❖</div>
              <div className="pointer-events-none absolute bottom-2 left-2 text-amber-300/70 text-lg drop-shadow-[0_0_6px_rgba(212,175,55,0.8)] z-10">❖</div>

              {/* Fancy banner */}
              <div className={`relative bg-gradient-to-br ${themeClass} p-6 md:p-8 shadow-2xl overflow-hidden`}>
                <div className="absolute inset-0 opacity-40" style={{
                  backgroundImage: "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.55) 0%, transparent 45%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.35) 0%, transparent 50%)"
                }}/>
                <div className="absolute inset-0 opacity-30 mix-blend-overlay animate-pulse" style={{
                  backgroundImage: "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.6) 50%, transparent 70%)"
                }}/>
                <div className="absolute inset-0 opacity-[0.12]" style={{
                  backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60'><circle cx='30' cy='30' r='1.5' fill='white'/><circle cx='0' cy='0' r='1.5' fill='white'/><circle cx='60' cy='60' r='1.5' fill='white'/><circle cx='60' cy='0' r='1.5' fill='white'/><circle cx='0' cy='60' r='1.5' fill='white'/></svg>\")"
                }}/>
                <div className="pointer-events-none absolute inset-2 rounded-2xl border border-white/40"/>
                <div className="pointer-events-none absolute inset-3 rounded-xl border border-white/15"/>

                <div className="absolute top-3 right-3 text-2xl text-white/50 drop-shadow">✦</div>
                <div className="absolute top-3 left-3 text-2xl text-white/50 drop-shadow">✦</div>
                <div className="absolute bottom-3 right-3 text-2xl text-white/50 drop-shadow">✦</div>
                <div className="absolute bottom-3 left-3 text-2xl text-white/50 drop-shadow">✦</div>

                {isEnded && (
                  <div className="absolute -top-px left-1/2 -translate-x-1/2 px-4 py-1 rounded-b-xl bg-black/70 border-x border-b border-white/30 backdrop-blur text-[10px] font-black tracking-[0.3em] text-white/90 z-10">
                    ENDED
                  </div>
                )}

                <div className="relative flex items-center gap-4">
                  <div className="relative shrink-0">
                    <div className="absolute -inset-2 rounded-full bg-white/20 blur-xl"/>
                    <div className="relative text-6xl md:text-7xl drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)]">{c.banner_emoji}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    {c.banner_text && (
                      <div className="inline-block text-[10px] font-black tracking-[0.35em] text-white/95 uppercase drop-shadow px-2 py-0.5 rounded bg-black/25 border border-white/30 mb-1">
                        {c.banner_text}
                      </div>
                    )}
                    <div className="text-2xl md:text-3xl font-black text-white drop-shadow-[0_3px_8px_rgba(0,0,0,0.6)] leading-tight" style={{ textShadow: "0 0 20px rgba(255,255,255,0.3)" }}>
                      {c.title}
                    </div>
                    <div className="text-xs md:text-sm font-bold text-white/95 mt-1.5 drop-shadow inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/25 border border-white/25">
                      {meta.icon} {meta.name}
                    </div>
                  </div>
                  <div className="text-end shrink-0">
                    {isEnded ? (
                      <>
                        <div className="text-[10px] text-white/80 tracking-widest">الحالة</div>
                        <div className="text-base font-black text-white drop-shadow px-2.5 py-1 rounded-lg bg-black/40 border border-white/40 mt-0.5">⛔ انتهت</div>
                      </>
                    ) : isUpcoming ? (
                      <>
                        <div className="text-[10px] text-white/80 tracking-widest">تبدأ خلال</div>
                        <div className="text-base font-black text-white drop-shadow px-2.5 py-1 rounded-lg bg-black/40 border border-white/40 mt-0.5">🚀 {timeLeft(c.starts_at)}</div>
                      </>
                    ) : (
                      <>
                        <div className="text-[10px] text-white/80 tracking-widest">ينتهي خلال</div>
                        <div className="text-base font-black text-white drop-shadow px-2.5 py-1 rounded-lg bg-black/40 border border-white/40 mt-0.5">⏳ {timeLeft(c.ends_at)}</div>
                      </>
                    )}
                  </div>
                </div>
                {winnerCount > 0 && (
                  <div className="relative mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-black/40 backdrop-blur border border-white/40 shadow-lg">
                    <span className="text-xs font-black text-white drop-shadow tracking-wider">
                      🏆 {winnerCount === 1 ? "جائزة للفائز الأول فقط" : `جوائز لأفضل ${winnerCount} لاعبين`}
                    </span>
                  </div>
                )}
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
                        <img src={fish.img} alt={fish.name} className="w-16 h-16 object-contain drop-shadow-lg"/>
                        <div>
                          <div className="font-bold text-base">{fish.name}</div>
                          <div className="text-xs text-slate-400">اصطدها أكبر عدد ممكن!</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Prize tiers banner */}
                <PrizeBanner tiers={tiers}/>

                {/* Leaderboard */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-black bg-gradient-to-l from-amber-200 to-yellow-400 bg-clip-text text-transparent tracking-wider inline-flex items-center gap-1.5">
                      <span className="text-amber-300">✦</span> لوحة الشرف <span className="text-amber-300">✦</span>
                    </div>
                    {myRank >= 0 && <div className="text-xs font-bold text-amber-300 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30">مركزك: #{myRank + 1}</div>}
                  </div>
                  {board.length === 0 ? (
                    <div className="text-center text-sm text-slate-500 py-6 rounded-lg bg-slate-950/40 border border-slate-800">
                      كن أول من يسجّل نقطة! 🚀
                    </div>
                  ) : (
                    <ol className="space-y-1.5">
                      {board.map((r, i) => {
                        const isMe = r.user_id === me;
                        const isWinner = i < winnerCount;
                        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i+1}`;
                        return (
                          <li key={r.user_id} className={`flex items-center gap-3 p-2 rounded-lg ${
                            isMe ? "bg-amber-500/15 border border-amber-500/40" :
                            isWinner ? "bg-emerald-500/10 border border-emerald-500/30" :
                            "bg-slate-950/40 border border-slate-800"
                          }`}>
                            <div className="w-10 text-center font-black text-sm">{medal}</div>
                            {r.avatar_url ? (
                              <img src={r.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border border-slate-700"/>
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center text-lg">{r.avatar_emoji || "🧑‍✈️"}</div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-bold truncate flex items-center gap-1.5">
                                {r.display_name || "—"}
                                {isWinner && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">فائز 🏆</span>}
                              </div>
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
