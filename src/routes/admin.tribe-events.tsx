import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/tribe-events")({
  component: AdminTribeEvents,
  ssr: false,
  head: () => ({ meta: [{ title: "فعاليات صيد القبائل — Admin" }] }),
});

type Tier = { rank: number; gems: number; tribe_points: number };
type Metric = "fish" | "gold";
type Row = {
  id: string;
  title: string;
  description: string;
  banner_emoji: string;
  banner_theme: string;
  metric: Metric;
  starts_at: string;
  ends_at: string;
  active: boolean;
  reward_gems: number;
  winner_tribe_points: number;
  prize_tiers: Tier[] | null;
  winner_tribe_id: string | null;
  prizes_distributed_at: string | null;
  created_at: string;
};
const METRIC_LABEL: Record<Metric, string> = { fish: "🐟 صيد سمك", gold: "💰 جمع ذهب" };
const METRIC_UNIT: Record<Metric, string> = { fish: "🐟", gold: "💰" };

type LbRow = {
  tribe_id: string;
  tribe_name: string;
  tribe_emblem: string;
  tribe_banner: string;
  members_count: number;
  total_fish: number;
};

type RankRow = {
  tribe_id: string;
  tribe_name: string;
  tribe_emblem: string;
  tribe_banner: string;
  members_count: number;
  points: number;
  level: number;
};

const THEMES = [
  { id: "ocean", label: "🌊 محيط" },
  { id: "gold", label: "🏆 ذهبي" },
  { id: "emerald", label: "💚 زمرد" },
  { id: "royal", label: "👑 ملكي" },
  { id: "inferno", label: "🔥 لهيب" },
];

const DEFAULT_TIERS: Tier[] = [
  { rank: 1, gems: 5000, tribe_points: 500 },
  { rank: 2, gems: 2500, tribe_points: 250 },
  { rank: 3, gems: 1000, tribe_points: 100 },
];

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function normalizeTiers(t: any): Tier[] {
  if (!Array.isArray(t)) return [];
  return t
    .map((x: any) => ({
      rank: Math.max(1, Number(x?.rank) | 0),
      gems: Math.max(0, Number(x?.gems) | 0),
      tribe_points: Math.max(0, Number(x?.tribe_points) | 0),
    }))
    .sort((a, b) => a.rank - b.rank);
}

function TierEditor({ value, onChange }: { value: Tier[]; onChange: (t: Tier[]) => void }) {
  const update = (i: number, patch: Partial<Tier>) => {
    const next = value.map((t, j) => (j === i ? { ...t, ...patch } : t));
    onChange(next);
  };
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const add = () => {
    const nextRank = (value[value.length - 1]?.rank ?? 0) + 1;
    onChange([...value, { rank: nextRank, gems: 0, tribe_points: 0 }]);
  };
  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-400">🥇 جوائز الترتيب — كل سطر = ترتيب (1 = الأول، 2 = الثاني …). يمكن إضافة أي عدد من المراتب.</div>
      <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-2 space-y-1.5 max-h-72 overflow-y-auto">
        <div className="grid grid-cols-[60px_1fr_1fr_36px] gap-2 text-[10px] text-slate-400 px-1">
          <span>المركز</span>
          <span>💎 جواهر (تقسّم على الأعضاء)</span>
          <span>⭐ نقاط القبيلة</span>
          <span></span>
        </div>
        {value.map((t, i) => (
          <div key={i} className="grid grid-cols-[60px_1fr_1fr_36px] gap-2 items-center">
            <input
              type="number" min={1} value={t.rank}
              onChange={(e) => update(i, { rank: Math.max(1, +e.target.value | 0) })}
              className="px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-center text-sm"
            />
            <input
              type="number" min={0} value={t.gems}
              onChange={(e) => update(i, { gems: Math.max(0, +e.target.value | 0) })}
              className="px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"
            />
            <input
              type="number" min={0} value={t.tribe_points}
              onChange={(e) => update(i, { tribe_points: Math.max(0, +e.target.value | 0) })}
              className="px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"
            />
            <button onClick={() => remove(i)} className="px-2 py-1 rounded bg-red-900/40 hover:bg-red-900/70 text-red-200 text-sm border border-red-700/40">×</button>
          </div>
        ))}
        {value.length === 0 && <div className="text-xs text-slate-500 py-2 text-center">لا توجد مراتب — أضف على الأقل مرتبة واحدة.</div>}
      </div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={add} className="px-3 py-1.5 rounded bg-cyan-700 hover:bg-cyan-600 text-xs font-bold">➕ إضافة مرتبة</button>
        <button onClick={() => onChange(DEFAULT_TIERS)} className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs">↻ افتراضي (3 مراكز)</button>
        <button onClick={() => {
          const n = parseInt(prompt("عدد المراتب الإضافية:", "5") || "0", 10);
          if (!n || n <= 0) return;
          const startRank = (value[value.length - 1]?.rank ?? 0) + 1;
          const added: Tier[] = Array.from({ length: n }, (_, k) => ({
            rank: startRank + k, gems: 100, tribe_points: 10,
          }));
          onChange([...value, ...added]);
        }} className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs">⚡ إضافة جماعية</button>
      </div>
    </div>
  );
}

function AdminTribeEvents() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [boards, setBoards] = useState<Record<string, LbRow[]>>({});
  const [ranking, setRanking] = useState<RankRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  // create form
  const now = new Date();
  const inWeek = new Date(now.getTime() + 7 * 86400000);
  const [title, setTitle] = useState("فعالية صيد القبائل");
  const [desc, setDesc] = useState("القبيلة الأكثر صيداً تفوز بجوائز توزع على أعضائها بالتساوي.");
  const [emoji, setEmoji] = useState("🎣");
  const [theme, setTheme] = useState("ocean");
  const [metric, setMetric] = useState<Metric>("fish");
  const [startsAt, setStartsAt] = useState(toLocalInput(now.toISOString()));
  const [endsAt, setEndsAt] = useState(toLocalInput(inWeek.toISOString()));
  const [tiers, setTiers] = useState<Tier[]>(DEFAULT_TIERS);
  const [creating, setCreating] = useState(false);

  // tier editing per existing event
  const [tiersEdit, setTiersEdit] = useState<Record<string, Tier[]>>({});

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("tribe_fish_events" as never)
      .select("*")
      .order("created_at", { ascending: false });
    const list = ((data ?? []) as any[]).map((r) => ({
      ...r,
      prize_tiers: normalizeTiers(r.prize_tiers),
    })) as Row[];
    setRows(list);
    setTiersEdit(Object.fromEntries(list.map((r) => [r.id, r.prize_tiers ?? []])));
    setLoading(false);

    const entries = await Promise.all(list.map(async (r) => {
      const { data: lb } = await supabase.rpc("tribe_fish_event_leaderboard" as never, { p_event_id: r.id } as never);
      return [r.id, ((lb ?? []) as LbRow[]).slice(0, 20)] as const;
    }));
    setBoards(Object.fromEntries(entries));

    const { data: rk } = await supabase.rpc("tribes_ranking" as never, { p_limit: 100 } as never);
    setRanking((rk ?? []) as RankRow[]);
  };
  useEffect(() => { load(); }, []);

  const totalGems = useMemo(() => tiers.reduce((s, t) => s + (t.gems || 0), 0), [tiers]);
  const totalPoints = useMemo(() => tiers.reduce((s, t) => s + (t.tribe_points || 0), 0), [tiers]);

  const create = async () => {
    const s = new Date(startsAt);
    const e = new Date(endsAt);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) {
      setMsg("تواريخ غير صحيحة"); return;
    }
    if (tiers.length === 0) { setMsg("أضف على الأقل مرتبة واحدة للجوائز"); return; }
    setCreating(true);
    setMsg(null);
    const cleanTiers = normalizeTiers(tiers);
    const firstGems = cleanTiers.find((t) => t.rank === 1)?.gems ?? 0;
    const firstPts = cleanTiers.find((t) => t.rank === 1)?.tribe_points ?? 0;
    const { error } = await supabase.from("tribe_fish_events" as never).insert({
      title: title.trim() || (metric === "gold" ? "فعالية جمع الذهب" : "فعالية صيد القبائل"),
      description: desc.trim(),
      banner_emoji: emoji || (metric === "gold" ? "💰" : "🎣"),
      banner_theme: theme,
      metric,
      starts_at: s.toISOString(),
      ends_at: e.toISOString(),
      reward_gems: firstGems,
      winner_tribe_points: firstPts,
      prize_tiers: cleanTiers as any,
      active: true,
    } as never);
    setCreating(false);
    if (error) { setMsg("خطأ: " + error.message); return; }
    setMsg("✅ تم إنشاء الفعالية");
    load();
  };

  const saveTiers = async (r: Row) => {
    const clean = normalizeTiers(tiersEdit[r.id] ?? []);
    const firstGems = clean.find((t) => t.rank === 1)?.gems ?? 0;
    const firstPts = clean.find((t) => t.rank === 1)?.tribe_points ?? 0;
    const { error } = await supabase.from("tribe_fish_events" as never)
      .update({ prize_tiers: clean as any, reward_gems: firstGems, winner_tribe_points: firstPts } as never)
      .eq("id", r.id);
    if (error) { setMsg("خطأ في حفظ الجوائز: " + error.message); return; }
    setMsg("✅ تم حفظ جوائز الفعالية");
    load();
  };

  const toggleActive = async (r: Row) => {
    await supabase.from("tribe_fish_events" as never).update({ active: !r.active } as never).eq("id", r.id);
    load();
  };

  const remove = async (r: Row) => {
    if (!confirm("حذف الفعالية نهائياً؟")) return;
    await supabase.from("tribe_fish_events" as never).delete().eq("id", r.id);
    load();
  };

  const distribute = async (r: Row) => {
    if (!confirm("توزيع جوائز كل المراتب على القبائل الفائزة (الجواهر تنقسم على أعضاء كل قبيلة)؟ لا يمكن التراجع.")) return;
    const { data, error } = await supabase.rpc("distribute_tribe_fish_event_prizes" as never, { p_event_id: r.id } as never);
    if (error) { setMsg("خطأ: " + error.message); return; }
    const res = data as { reason?: string; results?: Array<{ rank: number; gems_total: number; gems_per_member: number; members_count: number; tribe_points: number }> };
    if (res?.reason === "no_participants") {
      setMsg("⚠️ لا يوجد مشاركون — تم إغلاق الفعالية بدون توزيع.");
    } else {
      const lines = (res?.results ?? []).map(x =>
        `#${x.rank}: 💎 ${x.gems_total} (${x.gems_per_member}/عضو × ${x.members_count}) — ⭐ ${x.tribe_points}`
      ).join(" | ");
      setMsg(`🏆 تم التوزيع — ${lines}`);
    }
    load();
  };

  const adjustTribePoints = async (rk: RankRow, sign: 1 | -1) => {
    const v = parseInt(prompt(`${sign > 0 ? "إضافة" : "خصم"} نقاط لـ ${rk.tribe_name}:`, "100") || "0", 10);
    if (!v || v <= 0) return;
    const reason = prompt("السبب (اختياري):", "") || "";
    const { error } = await supabase.rpc("admin_adjust_tribe_points" as never, {
      p_tribe_id: rk.tribe_id, p_delta: sign * v, p_reason: reason,
    } as never);
    if (error) { setMsg("خطأ: " + error.message); return; }
    setMsg(`✅ ${sign > 0 ? "تمت إضافة" : "تم خصم"} ${v} نقطة لـ ${rk.tribe_name}`);
    load();
  };

  const setTribePoints = async (rk: RankRow) => {
    const v = parseInt(prompt(`تعيين نقاط ${rk.tribe_name} مباشرة:`, String(rk.points)) || "", 10);
    if (isNaN(v) || v < 0) return;
    const reason = prompt("السبب (اختياري):", "") || "";
    const { error } = await supabase.rpc("admin_set_tribe_points" as never, {
      p_tribe_id: rk.tribe_id, p_value: v, p_reason: reason,
    } as never);
    if (error) { setMsg("خطأ: " + error.message); return; }
    setMsg(`✅ تم تعيين نقاط ${rk.tribe_name} إلى ${v}`);
    load();
  };

  return (
    <div dir="rtl" className="p-3 md:p-5 space-y-5 text-slate-100">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-bold text-cyan-300">🎣 فعاليات صيد القبائل</h1>
      </div>

      {msg && (
        <div className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm">{msg}</div>
      )}

      {/* Create */}
      <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-cyan-950/30 to-slate-900/70 p-4 space-y-3">
        <h2 className="font-bold text-cyan-200">➕ إنشاء فعالية جديدة</h2>
        <div className="grid md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-slate-400">العنوان</span>
            <input value={title} onChange={e=>setTitle(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700"/>
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">إيموجي</span>
            <input value={emoji} onChange={e=>setEmoji(e.target.value)} maxLength={4} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-2xl text-center"/>
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-slate-400">الوصف</span>
          <textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={2} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700"/>
        </label>
        <div className="grid md:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs text-slate-400">يبدأ</span>
            <input type="datetime-local" value={startsAt} onChange={e=>setStartsAt(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700"/>
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">ينتهي</span>
            <input type="datetime-local" value={endsAt} onChange={e=>setEndsAt(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700"/>
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">الشكل</span>
            <select value={theme} onChange={e=>setTheme(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">
              {THEMES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
        </div>

        <div>
          <div className="text-xs text-slate-400 mb-1">نوع الفعالية</div>
          <div className="flex gap-2">
            {(["fish","gold"] as Metric[]).map(m => (
              <button key={m} type="button" onClick={()=>setMetric(m)}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm font-bold ${metric===m ? "bg-cyan-600 border-cyan-400 text-white" : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"}`}>
                {METRIC_LABEL[m]}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {metric === "gold"
              ? "يُحسب مجموع الذهب اللي تبرّع فيه كل عضو لقبيلته خلال مدة الفعالية."
              : "يُحسب مجموع السمك اللي اصطاده أعضاء القبيلة خلال مدة الفعالية."}
          </div>
        </div>

        <TierEditor value={tiers} onChange={setTiers} />
        <div className="text-[11px] text-slate-400">إجمالي: 💎 {totalGems.toLocaleString()} جوهرة · ⭐ {totalPoints.toLocaleString()} نقطة قبيلة · {tiers.length} مرتبة</div>

        <button onClick={create} disabled={creating} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 font-bold disabled:opacity-60">
          {creating ? "جاري الإنشاء…" : "إنشاء الفعالية"}
        </button>
      </div>

      {/* Global ranking */}
      <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-950/20 to-slate-900/70 p-4 space-y-3">
        <h2 className="font-bold text-amber-200">🏆 ترتيب القبائل العام (حسب النقاط)</h2>
        {ranking.length === 0 ? (
          <div className="text-xs text-slate-500">لا توجد قبائل بعد.</div>
        ) : (
          <div className="max-h-96 overflow-y-auto space-y-1">
            {ranking.map((rk, i) => (
              <div key={rk.tribe_id} className={`flex items-center gap-2 px-2 py-1.5 rounded ${i===0 ? "bg-amber-500/15 border border-amber-500/40" : i<3 ? "bg-slate-800/60 border border-slate-700" : "bg-slate-900/40"}`}>
                <span className="w-8 text-center font-bold text-amber-300 text-sm">{i===0 ? "🥇" : i===1 ? "🥈" : i===2 ? "🥉" : `#${i+1}`}</span>
                <span className="text-lg">{rk.tribe_banner}</span>
                <span className="flex-1 font-semibold text-sm">{rk.tribe_emblem} {rk.tribe_name}</span>
                <span className="text-[10px] text-slate-400">{rk.members_count} عضو · L{rk.level}</span>
                <span className="font-bold text-cyan-300 min-w-[80px] text-end">⭐ {Number(rk.points).toLocaleString()}</span>
                <div className="flex gap-1">
                  <button onClick={()=>adjustTribePoints(rk, 1)} className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-xs font-bold">+</button>
                  <button onClick={()=>adjustTribePoints(rk, -1)} className="px-2 py-1 rounded bg-red-800 hover:bg-red-700 text-xs font-bold">−</button>
                  <button onClick={()=>setTribePoints(rk)} className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs">تعيين</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Events list */}
      <div className="space-y-4">
        <h2 className="font-bold text-slate-200">📜 كل الفعاليات</h2>
        {loading && <div className="text-slate-400 text-sm">جاري التحميل…</div>}
        {!loading && rows.length === 0 && <div className="text-slate-400 text-sm">لا توجد فعاليات.</div>}

        {rows.map(r => {
          const lb = boards[r.id] ?? [];
          const ended = new Date(r.ends_at).getTime() <= Date.now();
          const distributed = !!r.prizes_distributed_at;
          const editTiers = tiersEdit[r.id] ?? [];
          return (
            <div key={r.id} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-3 md:p-4 space-y-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <div className="text-lg font-bold flex items-center gap-2 flex-wrap">
                    <span>{r.banner_emoji}</span><span>{r.title}</span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs text-slate-200">{METRIC_LABEL[r.metric ?? "fish"]}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1 whitespace-pre-line">{r.description}</div>
                  <div className="text-[11px] text-slate-500 mt-2">
                    {new Date(r.starts_at).toLocaleString("ar")} ← {new Date(r.ends_at).toLocaleString("ar")}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="px-2 py-1 rounded bg-emerald-900/40 border border-emerald-700/50 text-emerald-200 text-xs font-bold">💎 {(r.prize_tiers ?? []).reduce((s, t) => s + (t.gems || 0), 0).toLocaleString()}</span>
                  <span className="px-2 py-1 rounded bg-purple-900/40 border border-purple-700/50 text-purple-200 text-xs font-bold">⭐ {(r.prize_tiers ?? []).reduce((s, t) => s + (t.tribe_points || 0), 0).toLocaleString()}</span>
                  <span className={`px-2 py-1 rounded text-xs font-bold ${r.active ? "bg-green-900/40 border border-green-700/50 text-green-200" : "bg-slate-800 border border-slate-700 text-slate-300"}`}>
                    {r.active ? "نشطة" : "مغلقة"}
                  </span>
                  {distributed && <span className="px-2 py-1 rounded bg-amber-900/40 border border-amber-700/50 text-amber-200 text-xs font-bold">✅ وزعت</span>}
                </div>
              </div>

              {/* Leaderboard */}
              <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-2">
                <div className="text-xs font-bold text-slate-300 mb-1">🏆 ترتيب القبائل في الفعالية</div>
                {lb.length === 0 ? (
                  <div className="text-xs text-slate-500 py-2">لا يوجد مشاركون بعد.</div>
                ) : (
                  <ol className="space-y-1">
                    {lb.map((t, i) => {
                      const tier = (r.prize_tiers ?? []).find(x => x.rank === i+1);
                      return (
                        <li key={t.tribe_id} className={`flex items-center gap-2 px-2 py-1.5 rounded ${i===0 ? "bg-amber-500/15 border border-amber-500/40" : "bg-slate-900/60"}`}>
                          <span className="w-8 text-center font-bold text-amber-300">{i===0 ? "🥇" : i===1 ? "🥈" : i===2 ? "🥉" : `#${i+1}`}</span>
                          <span className="text-lg">{t.tribe_banner}</span>
                          <span className="flex-1 font-semibold">{t.tribe_emblem} {t.tribe_name}</span>
                          <span className="text-xs text-slate-400">{t.members_count} عضو</span>
                          <span className="font-bold text-cyan-300">{Number(t.total_fish).toLocaleString()} 🐟</span>
                          {tier && (
                            <span className="text-[10px] text-emerald-300 whitespace-nowrap">💎 {tier.gems} · ⭐ {tier.tribe_points}</span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>

              {/* Prize tiers editor */}
              {!distributed && (
                <details className="rounded-lg border border-slate-700 bg-slate-950/50 p-2">
                  <summary className="cursor-pointer text-xs font-bold text-slate-300">🎁 تعديل جوائز المراتب ({editTiers.length})</summary>
                  <div className="mt-2">
                    <TierEditor value={editTiers} onChange={(t) => setTiersEdit({ ...tiersEdit, [r.id]: t })} />
                    <button onClick={() => saveTiers(r)} className="mt-2 px-3 py-1.5 rounded bg-cyan-700 hover:bg-cyan-600 text-xs font-bold">💾 حفظ الجوائز</button>
                  </div>
                </details>
              )}

              <div className="flex flex-wrap gap-2">
                <button onClick={()=>toggleActive(r)} className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-sm border border-slate-700">
                  {r.active ? "🔒 إغلاق" : "🔓 تنشيط"}
                </button>
                {ended && !distributed && (
                  <button onClick={()=>distribute(r)} className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-sm font-bold">
                    🎁 توزيع الجوائز
                  </button>
                )}
                <button onClick={()=>remove(r)} className="px-3 py-1.5 rounded bg-red-900/50 hover:bg-red-900/70 text-sm border border-red-700/50 text-red-200">
                  🗑️ حذف
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
