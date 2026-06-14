import { createFileRoute, Link } from "@tanstack/react-router";
import { BackButton } from "@/components/BackButton";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/arena")({
  ssr: false,
  head: () => ({ meta: [{ title: "🏟️ الأرينا — ملوك القراصنة" }] }),
  component: ArenaPage,
});

type Row = { user_id: string; score: number; wins: number };

function weekStart() {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // Monday-based like date_trunc('week')
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function ArenaPage() {
  return (
    <div className="fixed inset-0 overflow-y-auto flex items-center justify-center" dir="rtl"
      style={{ background: "radial-gradient(ellipse at top, #1a1a2e 0%, #0a0a14 60%, #000 100%)" }}>
      <div className="absolute top-4 right-3">
        <BackButton className="glass-hud rounded-full px-3 py-1.5 text-cyan-200 text-sm font-bold border border-cyan-500/40">← رجوع</BackButton>
      </div>
      <div className="max-w-sm mx-auto px-6 text-center">
        <div className="text-7xl mb-4">🔒</div>
        <div className="text-2xl font-black text-amber-200 mb-2">الأرينا مقفلة مؤقتاً</div>
        <div className="text-cyan-300/70 text-sm">سنفتحها قريباً بتحديث جديد. ترقّبوا!</div>
      </div>
    </div>
  );
  // eslint-disable-next-line no-unreachable
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, { display_name: string; avatar_emoji: string }>>({});
  const [myId, setMyId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMyId(user?.id ?? null);
      const ws = weekStart().toISOString().slice(0, 10);
      const { data: r } = await supabase.from("arena_scores")
        .select("user_id,score,wins").eq("week_start", ws)
        .order("score", { ascending: false }).limit(50);
      setRows((r ?? []) as Row[]);
      const ids = (r ?? []).map((x) => x.user_id);
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles")
          .select("id,display_name,avatar_emoji").in("id", ids);
        const map: Record<string, { display_name: string; avatar_emoji: string }> = {};
        (profs ?? []).forEach((p: { id: string; display_name: string; avatar_emoji: string }) => {
          map[p.id] = { display_name: p.display_name, avatar_emoji: p.avatar_emoji };
        });
        setNames(map);
      }
    })();
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const wkEnd = weekStart();
  wkEnd.setUTCDate(wkEnd.getUTCDate() + 7);
  const ms = wkEnd.getTime() - now;
  const days = Math.max(0, Math.floor(ms / 86400000));
  const hrs = Math.max(0, Math.floor((ms % 86400000) / 3600000));

  const rewards = [
    { rank: "🥇 #1",    text: "قطعة أسطورية مضمونة + 100,000 🪙" },
    { rank: "🥈 #2-3",  text: "قطعة ملحمية مضمونة + 50,000 🪙" },
    { rank: "🥉 #4-10", text: "قطعة نادرة مضمونة + 20,000 🪙" },
    { rank: "#11-25",   text: "قطعة عادية + 5,000 🪙" },
  ];

  return (
    <div className="fixed inset-0 overflow-y-auto" dir="rtl"
      style={{ background: "radial-gradient(ellipse at top, #1a1a2e 0%, #0a0a14 60%, #000 100%)" }}>
      <div className="relative z-10 max-w-md mx-auto px-3 pt-4 pb-32">
        <div className="flex items-center justify-between mb-3">
          <BackButton className="glass-hud rounded-full px-3 py-1.5 text-cyan-200 text-sm font-bold border border-cyan-500/40">← رجوع</BackButton>
          <div className="glass-hud rounded-full px-3 py-1.5 text-cyan-200 text-sm font-bold border border-cyan-500/40">
            ⏰ {days}ي {hrs}س
          </div>
        </div>

        <div className="text-center mb-3">
          <div className="inline-block px-5 py-2 rounded-full bg-gradient-to-r from-purple-700/40 to-cyan-700/40 border border-cyan-400/50">
            <div className="text-cyan-100 font-extrabold text-xl">🏟️ الأرينا الأسبوعية</div>
            <div className="text-cyan-300/70 text-[10px]">ضرب اللاعبين = نقاط أرينا</div>
          </div>
        </div>

        {/* Enter battle CTA */}
        <Link to="/battle"
          className="block mb-3 py-4 rounded-2xl text-center font-black text-lg text-white shadow-2xl active:scale-95"
          style={{
            background: "linear-gradient(180deg,#ff8a00 0%,#ff2d00 100%)",
            boxShadow: "0 0 30px rgba(255,80,0,0.6)",
            border: "2px solid rgba(255,200,100,0.7)",
          }}>
          🔥 ادخل المعركة
        </Link>

        {/* Rewards */}
        <div className="bg-stone-900/70 border border-amber-600/40 rounded-2xl p-3 mb-3 backdrop-blur">
          <div className="text-amber-200 text-sm font-bold mb-2 text-center">🎁 جوائز نهاية الأسبوع</div>
          <div className="space-y-1">
            {rewards.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-stone-800/40">
                <span className="text-amber-200 font-bold">{r.rank}</span>
                <span className="text-amber-100/80">{r.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Leaderboard */}
        <div className="bg-stone-900/70 border border-cyan-600/40 rounded-2xl p-3 backdrop-blur">
          <div className="text-cyan-200 text-sm font-bold mb-2 text-center">📊 الترتيب</div>
          {rows.length === 0 ? (
            <div className="text-center text-cyan-300/50 text-xs py-6">لا توجد نقاط بعد هذا الأسبوع</div>
          ) : (
            <div className="space-y-1.5">
              {rows.map((r, i) => {
                const p = names[r.user_id];
                const isMe = r.user_id === myId;
                return (
                  <div key={r.user_id} className={`flex items-center gap-2 p-2 rounded-lg ${
                    isMe ? "bg-amber-500/20 border border-amber-400/60"
                      : i === 0 ? "bg-amber-900/40"
                      : i < 3 ? "bg-stone-800/60"
                      : i < 10 ? "bg-cyan-900/30"
                      : "bg-stone-900/40"
                  }`}>
                    <span className={`font-extrabold w-7 text-center ${i === 0 ? "text-amber-300" : "text-cyan-300"}`}>
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                    </span>
                    <span className="text-xl">{p?.avatar_emoji ?? "🧑‍✈️"}</span>
                    <span className="flex-1 text-cyan-100 text-sm truncate">{p?.display_name ?? "..."}</span>
                    <div className="text-end">
                      <div className="text-cyan-100 font-extrabold tabular-nums text-sm">{r.score.toLocaleString()}</div>
                      <div className="text-cyan-300/60 text-[9px]">{r.wins} انتصار</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
