import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useProfile } from "@/hooks/use-auth";
import { AuthGuard } from "@/components/AuthGuard";
import { BackButton } from "@/components/BackButton";
import { toast } from "sonner";

export const Route = createFileRoute("/quests")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "المهام والإنجازات — ملوك القراصنة" },
      { name: "description", content: "مهام يومية وإنجازات تعطيك خبرة وذهب وجواهر." },
    ],
  }),
  component: () => (
    <AuthGuard>
      <QuestsPage />
    </AuthGuard>
  ),
});

type Quest = {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  goal_type: string;
  goal_count: number;
  reward_xp: number;
  reward_coins: number;
  reward_gems: number;
};
type Achievement = Quest & { code: string; sort_order: number | null };
type Progress = { progress: number; claimed: boolean };

function rydayKey() {
  // Asia/Riyadh date key matching the server (UTC+3, no DST)
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.max(0, (value / Math.max(1, max)) * 100));
  return (
    <div className="h-2 w-full rounded-full bg-black/40 overflow-hidden border border-amber-900/40">
      <div
        className="h-full transition-all"
        style={{
          width: `${pct}%`,
          background: "linear-gradient(90deg,#f59e0b,#fbbf24,#fde68a)",
        }}
      />
    </div>
  );
}

function RewardChips({ xp, coins, gems }: { xp: number; coins: number; gems: number }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
      {xp > 0 && (
        <span className="px-2 py-0.5 rounded-full bg-blue-900/60 text-blue-100 border border-blue-500/40">
          +{xp.toLocaleString()} XP
        </span>
      )}
      {coins > 0 && (
        <span className="px-2 py-0.5 rounded-full bg-amber-900/60 text-amber-100 border border-amber-500/40">
          +{coins.toLocaleString()} 🪙
        </span>
      )}
      {gems > 0 && (
        <span className="px-2 py-0.5 rounded-full bg-fuchsia-900/60 text-fuchsia-100 border border-fuchsia-500/40">
          +{gems.toLocaleString()} 💎
        </span>
      )}
    </div>
  );
}

function QuestsPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const [tab, setTab] = useState<"daily" | "ach">("daily");
  const [quests, setQuests] = useState<Quest[]>([]);
  const [achs, setAchs] = useState<Achievement[]>([]);
  const [qProg, setQProg] = useState<Record<string, Progress>>({});
  const [aProg, setAProg] = useState<Record<string, Progress>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const day = rydayKey();
    const [dq, ac, qp, ua] = await Promise.all([
      supabase.from("daily_quests").select("*").eq("active", true),
      supabase.from("achievements").select("*").eq("active", true).order("sort_order", { ascending: true }),
      supabase.from("quest_progress").select("quest_id, progress, claimed").eq("user_id", user.id).eq("day_key", day),
      supabase.from("user_achievements").select("achievement_id, progress, claimed").eq("user_id", user.id),
    ]);
    setQuests((dq.data ?? []) as Quest[]);
    setAchs((ac.data ?? []) as Achievement[]);
    const qpMap: Record<string, Progress> = {};
    (qp.data ?? []).forEach((r: any) => {
      qpMap[r.quest_id] = { progress: r.progress ?? 0, claimed: !!r.claimed };
    });
    setQProg(qpMap);
    const aMap: Record<string, Progress> = {};
    (ua.data ?? []).forEach((r: any) => {
      aMap[r.achievement_id] = { progress: r.progress ?? 0, claimed: !!r.claimed };
    });
    setAProg(aMap);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  // Derive level progress for level_reach achievements from profile.level on-the-fly
  const aProgWithLevel = useMemo(() => {
    const m = { ...aProg };
    const lvl = profile?.level ?? 1;
    for (const a of achs) {
      if (a.goal_type === "level_reach") {
        const cur = m[a.id]?.progress ?? 0;
        if (lvl > cur) m[a.id] = { progress: lvl, claimed: m[a.id]?.claimed ?? false };
      }
    }
    return m;
  }, [aProg, achs, profile?.level]);

  const claimQuest = async (qId: string) => {
    setBusy(qId);
    const { data, error } = await (supabase as any).rpc("claim_daily_quest", { _quest_id: qId });
    setBusy(null);
    if (error) {
      toast.error(error.message ?? "تعذّر المطالبة");
      return;
    }
    const r = (data ?? {}) as { xp?: number; coins?: number; gems?: number };
    toast.success(`+${r.xp ?? 0} XP · +${r.coins ?? 0} 🪙 · +${r.gems ?? 0} 💎`);
    void load();
  };

  const claimAch = async (aId: string) => {
    setBusy(aId);
    const { data, error } = await (supabase as any).rpc("claim_achievement", { _ach_id: aId });
    setBusy(null);
    if (error) {
      toast.error(error.message ?? "تعذّر المطالبة");
      return;
    }
    const r = (data ?? {}) as { xp?: number; coins?: number; gems?: number };
    toast.success(`+${r.xp ?? 0} XP · +${r.coins ?? 0} 🪙 · +${r.gems ?? 0} 💎`);
    void load();
  };

  return (
    <div className="min-h-[100dvh] text-amber-100" style={{
      background: "radial-gradient(ellipse at top,#1a0f06 0%,#0a0503 70%,#000 100%)",
      paddingTop: "max(0.75rem, env(safe-area-inset-top))",
      paddingBottom: "max(5rem, env(safe-area-inset-bottom))",
    }}>
      <div className="max-w-xl mx-auto px-3">
        <div className="flex items-center justify-between py-3">
          <BackButton className="px-3 py-1.5 rounded-lg bg-black/50 border-2 border-amber-900/40 text-amber-200 font-black text-sm">← رجوع</BackButton>
          <h1 className="text-xl font-black" style={{ fontFamily: "'Pirata One', serif", textShadow: "0 0 12px rgba(255,180,80,.5)" }}>
            🏆 المهام والإنجازات
          </h1>
          <div className="w-9" />
        </div>

        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setTab("daily")}
            className={`flex-1 py-2 rounded-lg font-black text-sm border-2 transition ${
              tab === "daily"
                ? "bg-amber-600/30 border-amber-400 text-amber-50"
                : "bg-black/40 border-amber-900/40 text-amber-300"
            }`}
          >
            📅 مهام يومية
          </button>
          <button
            onClick={() => setTab("ach")}
            className={`flex-1 py-2 rounded-lg font-black text-sm border-2 transition ${
              tab === "ach"
                ? "bg-amber-600/30 border-amber-400 text-amber-50"
                : "bg-black/40 border-amber-900/40 text-amber-300"
            }`}
          >
            🏅 إنجازات
          </button>
        </div>

        {loading && <div className="text-center text-amber-300/70 py-8">…جاري التحميل</div>}

        {!loading && tab === "daily" && (
          <>
            <p className="text-xs text-amber-300/70 mb-2 text-center">
              تتجدد المهام يومياً عند منتصف الليل (توقيت الرياض)
            </p>
            <div className="space-y-2">
              {quests.length === 0 && (
                <div className="text-center text-amber-300/60 py-6">لا توجد مهام نشطة</div>
              )}
              {quests.map((q) => {
                const p = qProg[q.id] ?? { progress: 0, claimed: false };
                const done = p.progress >= q.goal_count;
                return (
                  <div key={q.id} className="rounded-xl p-3 border-2 border-amber-900/40 bg-black/50 backdrop-blur">
                    <div className="flex items-start gap-3">
                      <div className="text-3xl">{q.icon ?? "📌"}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-black text-sm text-amber-100">{q.title}</div>
                          <div className="text-[11px] text-amber-300/80 tabular-nums">
                            {Math.min(p.progress, q.goal_count).toLocaleString()} / {q.goal_count.toLocaleString()}
                          </div>
                        </div>
                        {q.description && (
                          <div className="text-[12px] text-amber-200/70 mt-0.5">{q.description}</div>
                        )}
                        <div className="mt-2"><Bar value={p.progress} max={q.goal_count} /></div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <RewardChips xp={q.reward_xp} coins={q.reward_coins} gems={q.reward_gems} />
                          <button
                            disabled={!done || p.claimed || busy === q.id}
                            onClick={() => claimQuest(q.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-black border-2 transition ${
                              p.claimed
                                ? "bg-emerald-900/40 border-emerald-600/40 text-emerald-200/70"
                                : done
                                ? "bg-amber-500 border-amber-300 text-black hover:scale-105 active:scale-95"
                                : "bg-black/40 border-amber-900/40 text-amber-300/50"
                            }`}
                          >
                            {p.claimed ? "تم الاستلام" : done ? "استلم" : "قيد التقدم"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!loading && tab === "ach" && (
          <>
            <p className="text-xs text-amber-300/70 mb-2 text-center">
              إنجازات دائمة — تكتمل مع تقدمك في اللعبة
            </p>
            <div className="space-y-2">
              {achs.length === 0 && (
                <div className="text-center text-amber-300/60 py-6">لا توجد إنجازات</div>
              )}
              {achs.map((a) => {
                const p = aProgWithLevel[a.id] ?? { progress: 0, claimed: false };
                const done = p.progress >= a.goal_count;
                return (
                  <div key={a.id} className="rounded-xl p-3 border-2 border-amber-900/40 bg-black/50 backdrop-blur">
                    <div className="flex items-start gap-3">
                      <div className="text-3xl">{a.icon ?? "🏅"}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-black text-sm text-amber-100">{a.title}</div>
                          <div className="text-[11px] text-amber-300/80 tabular-nums">
                            {Math.min(p.progress, a.goal_count).toLocaleString()} / {a.goal_count.toLocaleString()}
                          </div>
                        </div>
                        {a.description && (
                          <div className="text-[12px] text-amber-200/70 mt-0.5">{a.description}</div>
                        )}
                        <div className="mt-2"><Bar value={p.progress} max={a.goal_count} /></div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <RewardChips xp={a.reward_xp} coins={a.reward_coins} gems={a.reward_gems} />
                          <button
                            disabled={!done || p.claimed || busy === a.id}
                            onClick={() => claimAch(a.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-black border-2 transition ${
                              p.claimed
                                ? "bg-emerald-900/40 border-emerald-600/40 text-emerald-200/70"
                                : done
                                ? "bg-amber-500 border-amber-300 text-black hover:scale-105 active:scale-95"
                                : "bg-black/40 border-amber-900/40 text-amber-300/50"
                            }`}
                          >
                            {p.claimed ? "تم الاستلام" : done ? "استلم" : "قيد التقدم"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
