import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BackButton } from "@/components/BackButton";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/tribe-events")({
  component: TribeEventsPage,
  ssr: false,
  head: () => ({ meta: [{ title: "فعاليات صيد القبائل" }] }),
});

type Event = {
  id: string;
  title: string;
  description: string;
  banner_emoji: string;
  banner_theme: string;
  starts_at: string;
  ends_at: string;
  active: boolean;
  reward_gems: number;
  winner_tribe_id: string | null;
  prizes_distributed_at: string | null;
};

type LbRow = {
  tribe_id: string;
  tribe_name: string;
  tribe_emblem: string;
  tribe_banner: string;
  members_count: number;
  total_fish: number;
};

const THEME_CLASS: Record<string, string> = {
  ocean: "from-cyan-500 via-blue-500 to-indigo-600 shadow-cyan-500/40",
  gold: "from-amber-500 via-yellow-400 to-amber-600 shadow-amber-500/40",
  emerald: "from-emerald-500 via-green-500 to-teal-600 shadow-emerald-500/40",
  royal: "from-purple-600 via-fuchsia-500 to-indigo-600 shadow-fuchsia-500/40",
  inferno: "from-red-600 via-orange-500 to-yellow-500 shadow-red-500/50",
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

function timeUntil(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "بدأت";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (d > 0) return `${d}ي ${h}س`;
  if (h > 0) return `${h}س ${m}د`;
  if (m > 0) return `${m}د ${s}ث`;
  return `${s}ث`;
}

function formatStart(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("ar-SA", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `اليوم الساعة ${time}`;
  return `${d.toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh", month: "short", day: "numeric" })} الساعة ${time}`;
}

function TribeEventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [boards, setBoards] = useState<Record<string, LbRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [myTribeId, setMyTribeId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        const { data: prof } = await supabase
          .from("profiles" as never)
          .select("tribe_id")
          .eq("id", u.user.id)
          .maybeSingle();
        setMyTribeId((prof as { tribe_id?: string } | null)?.tribe_id ?? null);
      }
    })();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("tribe_fish_events" as never)
      .select("*")
      .eq("active", true)
      .order("ends_at", { ascending: true });
    const list = (data ?? []) as Event[];
    setEvents(list);
    setLoading(false);
    const entries = await Promise.all(list.map(async (e) => {
      const { data: lb } = await supabase.rpc("tribe_fish_event_leaderboard" as never, { p_event_id: e.id } as never);
      return [e.id, ((lb ?? []) as LbRow[]).slice(0, 20)] as const;
    }));
    setBoards(Object.fromEntries(entries));
  };
  useEffect(() => { load(); }, []);

  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div dir="rtl" className="min-h-screen text-slate-100 bg-[radial-gradient(ellipse_at_top,#0c1a30_0%,#070d1a_55%,#03060d_100%)]">
      <div className="max-w-3xl mx-auto p-3 md:p-5 space-y-5">
        <div className="flex items-center gap-2">
          <BackButton className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm border border-slate-700">← رجوع</BackButton>
          <h1 className="text-xl md:text-2xl font-black text-cyan-200">🎣 فعاليات صيد القبائل</h1>
        </div>

        <div className="rounded-xl border border-cyan-500/30 bg-slate-900/60 p-3 text-sm text-slate-300 leading-relaxed">
          كل سمكة يصطادها أعضاء قبيلتك خلال مدة الفعالية تُحسب لرصيد القبيلة.
          القبيلة الأولى تربح <span className="text-emerald-300 font-bold">💎 جواهر</span> تتوزع بالتساوي على جميع أعضائها.
        </div>

        {loading && <div className="text-slate-400 text-sm">جاري التحميل…</div>}
        {!loading && events.length === 0 && (
          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 text-center space-y-2">
            <div className="text-4xl">🎣</div>
            <div className="text-slate-300">لا توجد فعالية نشطة حالياً.</div>
            <div className="text-xs text-slate-500">تابعنا — قد تُطلق فعالية جديدة قريباً.</div>
            <Link to="/competitions" className="inline-block mt-2 px-4 py-2 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-sm font-bold">
              🏆 شاهد المسابقات الأخرى
            </Link>
          </div>
        )}

        {events.map(ev => {
          const lb = boards[ev.id] ?? [];
          const myRank = myTribeId ? lb.findIndex(t => t.tribe_id === myTribeId) : -1;
          const themeCls = THEME_CLASS[ev.banner_theme] ?? THEME_CLASS.ocean;
          return (
            <div key={ev.id} className="rounded-2xl overflow-hidden border-2 border-slate-700 bg-slate-900/70 shadow-2xl">
              {/* Banner */}
              <div className={`bg-gradient-to-l ${themeCls} p-4 shadow-xl relative overflow-hidden`}>
                <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 90% 10%, rgba(255,255,255,0.6) 0%, transparent 50%)" }}/>
                <div className="relative">
                  <div className="flex items-center gap-3">
                    <div className="text-4xl drop-shadow">{ev.banner_emoji}</div>
                    <div className="flex-1">
                      <div className="text-lg md:text-xl font-black text-white drop-shadow">{ev.title}</div>
                      <div className="text-xs text-white/80 mt-0.5">⏳ يتبقى {timeLeft(ev.ends_at)}</div>
                    </div>
                    <div className="text-end">
                      <div className="text-[10px] uppercase tracking-wider text-white/70 font-bold">جائزة القبيلة</div>
                      <div className="text-xl font-black text-white drop-shadow">💎 {ev.reward_gems.toLocaleString()}</div>
                    </div>
                  </div>
                  {ev.description && (
                    <div className="mt-2 text-sm text-white/90 leading-relaxed whitespace-pre-line">{ev.description}</div>
                  )}
                </div>
              </div>

              {/* My tribe status */}
              {myTribeId && (
                <div className="px-3 py-2 border-b border-slate-800 bg-slate-950/60 text-xs flex items-center justify-between">
                  <span className="text-slate-400">قبيلتك:</span>
                  {myRank >= 0 ? (
                    <span className="text-cyan-300 font-bold">
                      {myRank === 0 ? "🥇 في المركز الأول" : myRank === 1 ? "🥈 في المركز الثاني" : myRank === 2 ? "🥉 في المركز الثالث" : `في المركز #${myRank+1}`}
                      {" · "}
                      <span className="text-emerald-300">{Number(lb[myRank].total_fish).toLocaleString()} 🐟</span>
                    </span>
                  ) : (
                    <span className="text-slate-500">لم تصطد قبيلتك أي سمكة بعد</span>
                  )}
                </div>
              )}

              {/* Leaderboard */}
              <div className="p-3 space-y-1.5">
                <div className="text-xs font-black text-slate-300 mb-1">🏆 ترتيب القبائل</div>
                {lb.length === 0 ? (
                  <div className="text-sm text-slate-500 py-4 text-center">لا يوجد مشاركون بعد — كن أول قبيلة تتصدر!</div>
                ) : (
                  <ol className="space-y-1">
                    {lb.map((t, i) => {
                      const mine = t.tribe_id === myTribeId;
                      return (
                        <li key={t.tribe_id}
                            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg ${
                              i === 0
                                ? "bg-gradient-to-l from-amber-500/20 via-yellow-500/10 to-transparent border border-amber-500/40"
                                : mine
                                ? "bg-cyan-500/15 border border-cyan-500/40"
                                : "bg-slate-950/50 border border-slate-800"
                            }`}>
                          <span className="w-7 text-center text-lg font-black text-amber-300 shrink-0">
                            {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i+1}`}
                          </span>
                          <span className="text-xl shrink-0">{t.tribe_banner}</span>
                          <span className="flex-1 min-w-0 font-bold truncate">
                            {t.tribe_emblem} {t.tribe_name}
                            {mine && <span className="ms-1 text-[10px] text-cyan-300">(قبيلتك)</span>}
                          </span>
                          <span className="text-[11px] text-slate-400 shrink-0">{t.members_count} عضو</span>
                          <span className="font-black text-cyan-300 shrink-0">{Number(t.total_fish).toLocaleString()} 🐟</span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
