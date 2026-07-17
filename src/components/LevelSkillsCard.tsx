import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { rankFor, SKILLS, MAX_LEVEL, type SkillId } from "@/lib/ranks";

type Progress = {
  xp: number;
  level: number;
  max_level: number;
  current_threshold: number;
  next_threshold: number;
  to_next: number;
  into_level: number;
  xp_today: number;
  daily_cap: number;
  skill_points: number;
  scale: number;
};

type SkillsRow = {
  skill_points: number;
  skill_str: number;
  skill_def: number;
  skill_luck: number;
  skill_fish: number;
  skill_speed: number;
};

export function LevelSkillsCard({ userId }: { userId: string }) {
  const [prog, setProg] = useState<Progress | null>(null);
  const [skills, setSkills] = useState<SkillsRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const [{ data: p }, { data: s }] = await Promise.all([
      supabase.rpc("xp_progress" as never, { _user: userId } as never),
      supabase
        .from("profiles" as never)
        .select("skill_points,skill_str,skill_def,skill_luck,skill_fish,skill_speed")
        .eq("id", userId)
        .maybeSingle(),
    ]);
    setProg(p as Progress | null);
    setSkills(s as SkillsRow | null);
  };
  useEffect(() => { if (userId) load(); }, [userId]);

  const allocate = async (stat: SkillId) => {
    if (!skills || skills.skill_points <= 0 || busy) return;
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.rpc("allocate_skill_point" as never, { _stat: stat } as never);
    setBusy(false);
    if (error) { setMsg("خطأ: " + error.message); return; }
    setSkills(data as SkillsRow);
    setMsg(null);
    // refresh progress (level may not change but cap might be relevant)
    load();
  };

  if (!prog || !skills) {
    return (
      <section className="rounded-2xl p-4 glass-hud border border-accent/30 text-sm text-muted-foreground">
        جاري تحميل المستوى…
      </section>
    );
  }

  const rank = rankFor(prog.level);
  const pct = prog.to_next > 0
    ? Math.min(100, Math.round((prog.into_level / prog.to_next) * 100))
    : 100;
  const hasDailyCap = prog.daily_cap > 0;
  const capPct = hasDailyCap
    ? Math.min(100, Math.round((prog.xp_today / prog.daily_cap) * 100))
    : 100;
  const maxed = prog.level >= MAX_LEVEL;

  const skillRows: { id: SkillId; value: number }[] = [
    { id: "str",   value: skills.skill_str },
    { id: "def",   value: skills.skill_def },
    { id: "luck",  value: skills.skill_luck },
    { id: "fish",  value: skills.skill_fish },
    { id: "speed", value: skills.skill_speed },
  ];

  return (
    <section className="rounded-2xl overflow-hidden border-2 border-accent/40 bg-gradient-to-br from-slate-900/80 to-slate-950/80 shadow-xl">
      {/* Rank banner */}
      <div className={`bg-gradient-to-l ${rank.gradient} p-4 text-white relative overflow-hidden`}>
        <div className="absolute inset-0 opacity-25" style={{ backgroundImage: "radial-gradient(circle at 85% 15%, rgba(255,255,255,0.55) 0%, transparent 50%)" }} />
        <div className="relative flex items-center gap-3">
          <div className="text-4xl drop-shadow">{rank.emoji}</div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-bold text-white/80">الرتبة</div>
            <div className="text-lg font-black truncate">{rank.name}</div>
            <div className="text-[11px] text-white/80">المستوى {prog.level} / {MAX_LEVEL}</div>
          </div>
          <div className="text-end shrink-0">
            <div className="text-[10px] uppercase tracking-wider font-bold text-white/80">⭐ XP</div>
            <div className="text-base font-black">{Number(prog.xp).toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
            <span>التقدم للمستوى التالي</span>
            <span>
              {maxed ? "🏆 أقصى مستوى" : `${prog.into_level.toLocaleString()} / ${prog.to_next.toLocaleString()}`}
            </span>
          </div>
          <div className="h-3 rounded-full bg-slate-800 overflow-hidden border border-slate-700">
            <div className="h-full bg-gradient-to-l from-amber-400 via-yellow-300 to-amber-500 transition-all"
                 style={{ width: `${maxed ? 100 : pct}%` }} />
          </div>
        </div>

        {/* Daily cap */}
        <div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
            <span>الخبرة المكتسبة اليوم</span>
            <span>
              {prog.xp_today.toLocaleString()}{hasDailyCap ? ` / ${prog.daily_cap.toLocaleString()}` : " — بلا سقف"}
              {prog.scale < 1 && <span className="text-amber-300 ms-1">×{prog.scale}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden border border-slate-700">
            <div className={`h-full ${hasDailyCap && capPct >= 100 ? "bg-rose-500" : "bg-cyan-500"} transition-all`}
                 style={{ width: `${capPct}%` }} />
          </div>
          {prog.scale < 1 && (
            <div className="text-[10px] text-amber-300/80 mt-1">
              ⚠️ مكاسب الخبرة في مستواك مقللة إلى {Math.round(prog.scale * 100)}% (منع الاستغلال)
            </div>
          )}
        </div>

        {/* Skill points */}
        <div className="rounded-xl border border-amber-500/30 bg-slate-950/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-bold text-amber-200">🧬 نقاط المهارات</div>
            <div className="text-xs">
              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-200 font-bold">
                متاحة: {skills.skill_points}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {skillRows.map(({ id, value }) => {
              const def = SKILLS.find(s => s.id === id)!;
              const canSpend = skills.skill_points > 0 && !busy;
              return (
                <div key={id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-900/70 border border-slate-800">
                  <span className="text-lg shrink-0">{def.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold leading-tight">{def.name}</div>
                    <div className="text-[10px] text-muted-foreground leading-tight">{def.desc}</div>
                  </div>
                  <div className="text-sm font-black text-cyan-300 tabular-nums shrink-0 w-10 text-center">{value}</div>
                  <button
                    onClick={() => allocate(id)}
                    disabled={!canSpend}
                    className="px-2.5 py-1 rounded-md bg-amber-500/20 border border-amber-500/50 text-amber-200 text-sm font-black disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-500/30 active:scale-95"
                    aria-label={`زيادة ${def.name}`}
                  >+</button>
                </div>
              );
            })}
          </div>
          {msg && <div className="mt-2 text-xs text-rose-300">{msg}</div>}
          <div className="mt-2 text-[10px] text-muted-foreground">
            تحصل على نقطة مهارة واحدة عند كل ترقي في المستوى. وزّعها بحرية.
          </div>
        </div>

        <div className="text-[10px] text-muted-foreground border-t border-slate-800 pt-2">
          ⓘ خبرة المستوى منفصلة تماماً عن نقاط الفعاليات والترتيب الأسبوعي.
        </div>
      </div>
    </section>
  );
}
