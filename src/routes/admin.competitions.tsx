import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FISH_LIST, FISH } from "@/lib/fish";
import { DurationPicker, formatTimeLeft } from "@/components/admin/DurationPicker";

export const Route = createFileRoute("/admin/competitions")({
  component: AdminCompetitions,
  ssr: false,
  head: () => ({ meta: [{ title: "الفعاليات — Admin" }] }),
});

type PrizeTier = {
  rank: number;
  coins: number;
  gems: number;
  xp: number;
  text: string;
};

type Row = {
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
  prize_tiers: PrizeTier[];
  starts_at: string;
  ends_at: string;
  active: boolean;
};

const METRICS = [
  { id: "explode_count", label: "🔥 أكثر عدد تفجيرات" },
  { id: "explode_damage", label: "💥 أعلى مجموع ضرر" },
  { id: "fish_total", label: "🎣 أكثر صيد (أي نوع)" },
  { id: "fish_specific", label: "🐟 أكثر صيد لنوع محدد" },
];

const THEMES = [
  { id: "gold", label: "🏆 ذهبي" },
  { id: "royal", label: "👑 ملكي" },
  { id: "inferno", label: "🔥 لهيب" },
  { id: "ocean", label: "🌊 محيط" },
  { id: "emerald", label: "💚 زمرد" },
  { id: "diamond", label: "💎 ألماس" },
  { id: "obsidian", label: "🖤 أوبسيديان" },
];

const RANK_LABEL = (r: number) =>
  r === 1 ? "🥇 المركز الأول" : r === 2 ? "🥈 المركز الثاني" : r === 3 ? "🥉 المركز الثالث" : `#${r} المركز ${r}`;

function emptyTier(rank: number): PrizeTier {
  return { rank, coins: 0, gems: 0, xp: 0, text: "" };
}

type LbRow = {
  user_id: string;
  display_name: string;
  avatar_emoji: string;
  avatar_url: string | null;
  level: number;
  score: number;
};

function AdminCompetitions() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [boards, setBoards] = useState<Record<string, LbRow[]>>({});

  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [emoji, setEmoji] = useState("🏆");
  const [bannerText, setBannerText] = useState("بطولة عظمى");
  const [theme, setTheme] = useState("gold");
  const [metric, setMetric] = useState("fish_specific");
  const [targetFish, setTargetFish] = useState(FISH_LIST[0]?.id ?? "");
  const [hideTarget, setHideTarget] = useState(true);
  const [tiers, setTiers] = useState<PrizeTier[]>([emptyTier(1)]);
  const [startD, setStartD] = useState(0);
  const [startH, setStartH] = useState(0);
  const [endD, setEndD] = useState(7);
  const [endH, setEndH] = useState(0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("competitions" as never)
      .select("*")
      .order("created_at", { ascending: false });
    const list = (data ?? []) as Row[];
    setRows(list as never);
    setLoading(false);
    const entries = await Promise.all(list.map(async (c) => {
      const { data: lb } = await supabase.rpc("get_competition_leaderboard" as never, { _competition_id: c.id } as never);
      return [c.id, (lb ?? []) as LbRow[]] as const;
    }));
    setBoards(Object.fromEntries(entries));
  };
  useEffect(() => { load(); }, []);

  const updateTier = (idx: number, patch: Partial<PrizeTier>) => {
    setTiers(t => t.map((x, i) => i === idx ? { ...x, ...patch } : x));
  };
  const addTier = () => setTiers(t => [...t, emptyTier(t.length + 1)]);
  const removeTier = (idx: number) => setTiers(t => t.filter((_, i) => i !== idx).map((x, i) => ({ ...x, rank: i + 1 })));

  const create = async () => {
    if (!title.trim()) { setMsg("اكتب عنوان الفعالية"); return; }
    const startOffset = startD * 24 + startH;
    const endOffset = endD * 24 + endH;
    if (endOffset <= startOffset) { setMsg("مدة النهاية يجب أن تكون أكبر من البداية"); return; }
    if (tiers.length === 0) { setMsg("أضف جائزة واحدة على الأقل"); return; }
    setSaving(true);
    setMsg(null);
    const { data: { user } } = await supabase.auth.getUser();
    const now = Date.now();
    const cleanTiers = tiers.map((t, i) => ({
      rank: i + 1,
      coins: Math.max(0, t.coins | 0),
      gems: Math.max(0, t.gems | 0),
      xp: Math.max(0, t.xp | 0),
      text: t.text.trim(),
    }));
    const first = cleanTiers[0];
    const payload = {
      title: title.trim(),
      description: desc.trim(),
      banner_emoji: emoji || "🏆",
      banner_text: bannerText.trim(),
      banner_theme: theme,
      metric,
      target_fish_id: metric === "fish_specific" ? targetFish : null,
      hide_target: metric === "fish_specific" ? hideTarget : false,
      // Legacy mirror of 1st place for backwards compatibility
      reward_coins: first.coins,
      reward_gems: first.gems,
      reward_xp: first.xp,
      reward_text: first.text,
      prize_tiers: cleanTiers,
      starts_at: new Date(now + startOffset * 3600_000).toISOString(),
      ends_at: new Date(now + endOffset * 3600_000).toISOString(),
      active: true,
      created_by: user?.id ?? null,
    };
    const { error } = await supabase.from("competitions" as never).insert(payload as never);
    setSaving(false);
    if (error) { setMsg("خطأ: " + error.message); return; }
    setMsg("✓ تم إنشاء الفعالية");
    setTitle(""); setDesc(""); setBannerText("بطولة عظمى");
    setTiers([emptyTier(1)]);
    setStartD(0); setStartH(0); setEndD(7); setEndH(0);
    load();
  };

  const toggle = async (id: string, active: boolean) => {
    await supabase.from("competitions" as never).update({ active: !active } as never).eq("id", id);
    load();
  };
  const remove = async (id: string) => {
    if (!confirm("حذف الفعالية؟")) return;
    await supabase.from("competitions" as never).delete().eq("id", id);
    load();
  };

  return (
    <div dir="rtl" className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">🏆 الفعاليات والمسابقات</h1>

      <section className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/30 p-4 md:p-5 space-y-4">
        <h2 className="text-lg font-bold text-amber-300">إنشاء فعالية جديدة</h2>

        <div className="grid md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-slate-400">عنوان الفعالية</span>
            <input value={title} onChange={e=>setTitle(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700" placeholder="مثلاً: ملك التفجير"/>
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">نوع المنافسة</span>
            <select value={metric} onChange={e=>setMetric(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">
              {METRICS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="text-xs text-slate-400">وصف</span>
          <textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={2} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700" placeholder="اشرح الفعالية"/>
        </label>

        {metric === "fish_specific" && (
          <div className="grid md:grid-cols-2 gap-3 p-3 rounded-lg bg-slate-950/60 border border-slate-700/50">
            <label className="block">
              <span className="text-xs text-slate-400">نوع السمك المستهدف</span>
              <select value={targetFish} onChange={e=>setTargetFish(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">
                {FISH_LIST.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2">
              <input type="checkbox" checked={hideTarget} onChange={e=>setHideTarget(e.target.checked)} className="w-5 h-5"/>
              <span className="text-sm">إخفاء النوع عن اللاعبين (مفاجأة 🤫)</span>
            </label>
            {targetFish && FISH[targetFish] && (
              <div className="md:col-span-2 flex items-center gap-3 p-2 rounded bg-slate-900">
                <img src={FISH[targetFish].img} alt="" className="w-12 h-12 object-contain"/>
                <div>
                  <div className="font-bold">{FISH[targetFish].name}</div>
                  <div className="text-xs text-slate-400">سيظهر للاعبين عند انتهاء الفعالية فقط (إذا فعّلت الإخفاء)</div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs text-slate-400">إيموجي البانر</span>
            <input value={emoji} onChange={e=>setEmoji(e.target.value)} maxLength={4} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-2xl text-center"/>
          </label>
          <label className="block md:col-span-2">
            <span className="text-xs text-slate-400">نص البانر الفخم</span>
            <input value={bannerText} onChange={e=>setBannerText(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700"/>
          </label>
          <label className="block md:col-span-3">
            <span className="text-xs text-slate-400">شكل البانر</span>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-1">
              {THEMES.map(t => (
                <button key={t.id} type="button" onClick={()=>setTheme(t.id)}
                  className={`px-3 py-2 rounded-lg border text-sm ${theme===t.id ? "border-amber-400 bg-amber-500/20" : "border-slate-700 bg-slate-800 hover:bg-slate-700"}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </label>
        </div>

        {/* Prize tiers */}
        <div className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-950/20 to-slate-950/60 p-3 md:p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-amber-200">🏅 جوائز المراتب</h3>
            <button type="button" onClick={addTier} className="text-xs px-3 py-1.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-200 hover:bg-amber-500/30">
              + إضافة مرتبة
            </button>
          </div>
          <p className="text-[11px] text-slate-400">يمكنك تحديد جائزة للأول فقط، أو الأول والثاني والثالث، أو أي عدد تريده.</p>

          {tiers.map((t, i) => (
            <div key={i} className="rounded-lg border border-slate-700/60 bg-slate-950/50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-bold text-sm text-amber-300">{RANK_LABEL(i + 1)}</div>
                {tiers.length > 1 && (
                  <button type="button" onClick={()=>removeTier(i)} className="text-xs px-2 py-1 rounded bg-red-900/40 hover:bg-red-900/60 text-red-200">حذف</button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <label className="block">
                  <span className="text-[11px] text-slate-400">🪙 عملات</span>
                  <input type="number" value={t.coins} onChange={e=>updateTier(i,{coins:+e.target.value})} className="w-full mt-1 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"/>
                </label>
                <label className="block">
                  <span className="text-[11px] text-slate-400">💎 جواهر</span>
                  <input type="number" value={t.gems} onChange={e=>updateTier(i,{gems:+e.target.value})} className="w-full mt-1 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"/>
                </label>
                <label className="block">
                  <span className="text-[11px] text-slate-400">⭐ XP</span>
                  <input type="number" value={t.xp} onChange={e=>updateTier(i,{xp:+e.target.value})} className="w-full mt-1 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"/>
                </label>
                <label className="block">
                  <span className="text-[11px] text-slate-400">🎁 مكافأة نصية</span>
                  <input value={t.text} onChange={e=>updateTier(i,{text:e.target.value})} placeholder="مثلاً: لقب البطل" className="w-full mt-1 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"/>
                </label>
              </div>
            </div>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <DurationPicker label="يبدأ بعد" days={startD} hours={startH}
            onChange={(d, h) => { setStartD(d); setStartH(h); }} allowZero zeroLabel="يبدأ فوراً"/>
          <DurationPicker label="ينتهي بعد" days={endD} hours={endH}
            onChange={(d, h) => { setEndD(d); setEndH(h); }}/>
        </div>

        <button onClick={create} disabled={saving} className="px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold disabled:opacity-50">
          {saving ? "جاري الإنشاء..." : "🚀 إطلاق الفعالية"}
        </button>
        {msg && <div className="text-sm text-amber-300">{msg}</div>}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">الفعاليات الحالية</h2>
        {loading && <div className="text-slate-400">جاري التحميل...</div>}
        {!loading && rows.length === 0 && <div className="text-slate-400">لا توجد فعاليات بعد.</div>}
        {rows.map(r => {
          const fishName = r.target_fish_id ? FISH[r.target_fish_id]?.name : null;
          const ended = new Date(r.ends_at).getTime() < Date.now();
          const rowTiers: PrizeTier[] = Array.isArray(r.prize_tiers) && r.prize_tiers.length > 0
            ? r.prize_tiers
            : [{ rank: 1, coins: r.reward_coins, gems: r.reward_gems, xp: r.reward_xp, text: r.reward_text }];
          return (
            <div key={r.id} className="rounded-xl border border-slate-700 bg-slate-900 p-4 flex items-start gap-3">
              <div className="text-3xl">{r.banner_emoji}</div>
              <div className="flex-1 min-w-0">
                <div className="font-bold flex items-center gap-2 flex-wrap">
                  {r.title}
                  {ended && <span className="text-xs px-2 py-0.5 rounded bg-slate-700">منتهية</span>}
                  {!r.active && <span className="text-xs px-2 py-0.5 rounded bg-red-900/60 text-red-200">معطّلة</span>}
                  {r.hide_target && <span className="text-xs px-2 py-0.5 rounded bg-purple-900/60 text-purple-200">🤫 مخفية</span>}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {METRICS.find(m => m.id === r.metric)?.label}
                  {fishName && <> — <b className="text-slate-200">{fishName}</b></>}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  ينتهي خلال: <b className="text-slate-300">{formatTimeLeft(r.ends_at)}</b>
                </div>
                <div className="text-xs text-amber-300 mt-2 space-y-0.5">
                  {rowTiers.map((t, i) => (
                    <div key={i}>
                      <b>{RANK_LABEL(t.rank ?? i + 1)}:</b> 🪙 {t.coins} · 💎 {t.gems} · ⭐ {t.xp}{t.text ? ` · ${t.text}` : ""}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <button onClick={()=>toggle(r.id, r.active)} className="text-xs px-2.5 py-1.5 rounded bg-slate-700 hover:bg-slate-600">
                  {r.active ? "تعطيل" : "تفعيل"}
                </button>
                <button onClick={()=>remove(r.id)} className="text-xs px-2.5 py-1.5 rounded bg-red-900/50 hover:bg-red-900/70 text-red-200">حذف</button>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
