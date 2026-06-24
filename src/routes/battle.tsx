import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getStage } from "@/lib/dragon";

export const Route = createFileRoute("/battle")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    vs: typeof s.vs === "string" ? s.vs : undefined,
  }),
  head: () => ({ meta: [{ title: "⚔️ مبارزة التنانين" }] }),
  component: BattlePage,
});

type DuelResult = {
  won: boolean;
  my_level: number;
  opp_level: number;
  my_stage: number;
  opp_stage: number;
  score: number;
  win_chance: number;
  opp_name: string;
};

type Opponent = {
  user_id: string;
  score: number;
  wins: number;
  display_name: string | null;
  avatar_emoji: string | null;
  level: number | null;
};

function BattlePage() {
  const [loading, setLoading] = useState(true);
  const [meId, setMeId] = useState<string | null>(null);
  const [opps, setOpps] = useState<Opponent[]>([]);
  const [eventMult, setEventMult] = useState<number>(1);
  const [eventTitle, setEventTitle] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [result, setResult] = useState<DuelResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function duel(opp: Opponent) {
    if (busyId) return;
    setBusyId(opp.user_id);
    setErrorMsg(null);
    try {
      const { data, error } = await (supabase as never as {
        rpc: (n: string, p: Record<string, unknown>) => Promise<{ data: DuelResult | null; error: { message: string } | null }>;
      }).rpc("arena_dragon_duel", { _opponent: opp.user_id });
      if (error) {
        const m = (error.message || "").toLowerCase();
        if (m.includes("rate_limited")) setErrorMsg("⏱️ انتظر ١٠ ثوانٍ قبل المبارزة التالية");
        else setErrorMsg("تعذرت المبارزة، حاول مرة ثانية");
        return;
      }
      if (data) {
        setResult({ ...data, opp_name: opp.display_name ?? "خصم" });
        // bump local score row for the active user so the list refreshes feel
        setOpps((prev) => prev.map((p) => (p.user_id === meId ? { ...p, score: p.score + data.score, wins: p.wins + (data.won ? 1 : 0) } : p)));
      }
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      setMeId(u?.user?.id ?? null);

      const { data: s } = await supabase
        .from("arena_settings")
        .select("event_active, event_title, event_multiplier, event_ends_at")
        .maybeSingle();
      if (s?.event_active && (!s.event_ends_at || new Date(s.event_ends_at).getTime() > Date.now())) {
        setEventMult(Number(s.event_multiplier ?? 1));
        setEventTitle(s.event_title ?? null);
      }

      // Build weekly window key like arena page does (UTC Monday).
      const now = new Date();
      const dow = (now.getUTCDay() + 6) % 7;
      const wkStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));
      const weekKey = wkStart.toISOString().slice(0, 10);

      const { data: scores } = await supabase
        .from("arena_scores")
        .select("user_id, score, wins")
        .eq("week_start", weekKey)
        .order("score", { ascending: false })
        .limit(20);

      const ids = (scores ?? []).map((r) => r.user_id);
      let nameMap: Record<string, { display_name: string | null; avatar_emoji: string | null; level: number | null }> = {};
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_emoji, level")
          .in("id", ids);
        nameMap = Object.fromEntries(
          (profs ?? []).map((p) => [p.id, { display_name: p.display_name, avatar_emoji: p.avatar_emoji, level: p.level }]),
        );
      }

      // If we have fewer than 8 active arena players, top off with the strongest live players overall.
      let merged: Opponent[] = (scores ?? []).map((r) => ({
        user_id: r.user_id,
        score: r.score,
        wins: r.wins,
        display_name: nameMap[r.user_id]?.display_name ?? null,
        avatar_emoji: nameMap[r.user_id]?.avatar_emoji ?? null,
        level: nameMap[r.user_id]?.level ?? null,
      }));

      if (merged.length < 8) {
        const { data: extras } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_emoji, level")
          .not("display_name", "is", null)
          .order("level", { ascending: false })
          .limit(20);
        for (const p of extras ?? []) {
          if (merged.find((m) => m.user_id === p.id)) continue;
          merged.push({
            user_id: p.id,
            score: 0,
            wins: 0,
            display_name: p.display_name,
            avatar_emoji: p.avatar_emoji,
            level: p.level,
          });
          if (merged.length >= 12) break;
        }
      }

      setOpps(merged);
      setLoading(false);
    })();
  }, []);

  return (
    <div
      className="fixed inset-0 overflow-y-auto"
      dir="rtl"
      style={{ background: "radial-gradient(ellipse at top, #1a1a2e 0%, #0a0a14 60%, #000 100%)" }}
    >
      <div className="absolute top-4 right-3 z-20">
        <Link
          to="/"
          className="glass-hud rounded-full px-3 py-1.5 text-cyan-200 text-sm font-bold border border-cyan-500/40"
        >
          ← رجوع
        </Link>
      </div>
      <div className="absolute top-4 left-3 z-20">
        <Link
          to="/arena"
          className="glass-hud rounded-full px-3 py-1.5 text-amber-200 text-sm font-bold border border-amber-500/40"
        >
          🏟️ الترتيب
        </Link>
      </div>

      <div className="relative z-10 max-w-md mx-auto px-3 pt-16 pb-24">
        <div className="text-center mb-4">
          <div className="inline-block px-5 py-2 rounded-full bg-gradient-to-r from-rose-700/40 to-amber-700/40 border border-amber-400/60 shadow-lg">
            <div className="text-amber-100 font-extrabold text-xl">🐉 مبارزة التنانين</div>
            <div className="text-amber-300/80 text-[11px]">تنينك ضد تنين خصمك — كل انتصار يرفع نقاط الأرينا</div>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-3 rounded-xl bg-rose-900/40 border border-rose-500/50 text-rose-100 text-center text-sm py-2 font-bold">
            {errorMsg}
          </div>
        )}

        {eventMult > 1 && (
          <div
            className="mb-3 rounded-2xl p-3 text-center border-2 border-pink-400/70 animate-pulse"
            style={{ background: "linear-gradient(180deg,#7c1d6f 0%,#3b0764 100%)" }}
          >
            <div className="text-pink-100 font-black text-base">🎉 {eventTitle || "فعالية الأرينا"}</div>
            <div className="text-amber-200 text-sm font-bold mt-1">نقاط مضاعفة ×{eventMult}</div>
          </div>
        )}

        {loading ? (
          <div className="text-center text-amber-200/70 py-12 animate-pulse">جاري تحميل الخصوم...</div>
        ) : opps.length === 0 ? (
          <div className="rounded-2xl border border-amber-700/40 bg-stone-900/70 p-5 text-center">
            <div className="text-4xl mb-2">🌊</div>
            <div className="text-amber-200 font-bold mb-1">لا يوجد لاعبون متاحون الآن</div>
            <div className="text-amber-100/70 text-sm">ارجع للخريطة وهاجم من ساحل البحر مباشرة.</div>
            <Link
              to="/"
              className="inline-block mt-3 px-4 py-2 rounded-xl bg-amber-600 text-stone-900 font-extrabold active:scale-95"
            >
              للخريطة
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {opps.map((o, i) => {
              const isMe = o.user_id === meId;
              return (
                <div
                  key={o.user_id}
                  className={`flex items-center gap-3 p-3 rounded-2xl border backdrop-blur ${
                    isMe
                      ? "bg-amber-500/15 border-amber-400/50"
                      : i === 0
                        ? "bg-amber-900/40 border-amber-500/50"
                        : i < 3
                          ? "bg-stone-800/70 border-amber-700/40"
                          : "bg-stone-900/70 border-cyan-700/30"
                  }`}
                >
                  <div className="w-7 text-center text-amber-200 font-extrabold">
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                  </div>
                  <div className="text-3xl">{o.avatar_emoji ?? "🧑‍✈️"}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-amber-100 font-bold truncate">{o.display_name ?? "قبطان"}</div>
                    <div className="text-amber-300/70 text-[11px]">
                      {o.score > 0 ? `${o.score.toLocaleString()} نقطة • ${o.wins} انتصار` : "متاح للقتال"}
                      {o.level ? ` • مستوى ${o.level}` : ""}
                    </div>
                  </div>
                  {isMe ? (
                    <span className="text-amber-300/80 text-xs font-bold px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-400/40">
                      أنت
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === o.user_id}
                      onClick={() => duel(o)}
                      className="px-3 py-2 rounded-xl text-stone-900 font-extrabold text-sm shadow-lg active:scale-95 disabled:opacity-60"
                      style={{
                        background: "linear-gradient(180deg,#ff8a00 0%,#ff2d00 100%)",
                        border: "1px solid rgba(255,200,100,0.7)",
                      }}
                    >
                      {busyId === o.user_id ? "..." : "🐉 بارز"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Link
            to="/boss"
            className="block rounded-2xl p-3 text-center border-2 border-rose-400/60 bg-gradient-to-br from-rose-700/50 to-black active:scale-95"
          >
            <div className="text-2xl">🐲</div>
            <div className="text-rose-100 font-extrabold text-sm mt-1">معركة الوحش</div>
          </Link>
          <Link
            to="/dragon"
            className="block rounded-2xl p-3 text-center border-2 border-amber-400/60 bg-gradient-to-br from-amber-700/40 to-rose-900/40 active:scale-95"
          >
            <div className="text-2xl">🐉</div>
            <div className="text-amber-100 font-extrabold text-sm mt-1">تنيني</div>
          </Link>
        </div>
      </div>
    </div>
  );
}
