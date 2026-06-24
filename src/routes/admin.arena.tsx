import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logAudit } from "@/hooks/use-admin";

export const Route = createFileRoute("/admin/arena")({
  component: AdminArenaPage,
  ssr: false,
});

type Reward = { rank: string; text: string };
type Settings = {
  enabled: boolean;
  locked_title: string;
  locked_message: string;
  rewards: Reward[];
  event_active: boolean;
  event_title: string | null;
  event_multiplier: number;
  event_ends_at: string | null;
};

const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  locked_title: "🔒 الأرينا مقفلة مؤقتاً",
  locked_message: "سنفتحها قريباً بتحديث جديد. ترقّبوا!",
  rewards: [],
  event_active: false,
  event_title: "",
  event_multiplier: 2,
  event_ends_at: null,
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function AdminArenaPage() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [topCount, setTopCount] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("arena_settings").select("*").maybeSingle();
    if (data) setS({ ...DEFAULT_SETTINGS, ...(data as Settings) });
    const ws = (() => {
      const d = new Date();
      const day = d.getUTCDay();
      const diff = (day + 6) % 7;
      d.setUTCDate(d.getUTCDate() - diff);
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 10);
    })();
    const { count } = await supabase.from("arena_scores")
      .select("user_id", { count: "exact", head: true }).eq("week_start", ws);
    setTopCount(count ?? 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    const payload = {
      id: true,
      enabled: s.enabled,
      locked_title: s.locked_title,
      locked_message: s.locked_message,
      rewards: s.rewards,
      event_active: s.event_active,
      event_title: s.event_title?.trim() || null,
      event_multiplier: Number(s.event_multiplier) || 1,
      event_ends_at: s.event_ends_at || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("arena_settings").upsert(payload);
    if (error) { toast.error(error.message); setSaving(false); return; }
    await logAudit("arena_settings_update", null, payload);
    toast.success("تم الحفظ");
    setSaving(false);
  };

  const resetScores = async () => {
    if (!confirm("تصفير جميع نقاط الأرينا الأسبوعية؟ لا يمكن التراجع.")) return;
    const { error } = await supabase.from("arena_scores").delete().not("user_id", "is", null);
    if (error) { toast.error(error.message); return; }
    await logAudit("arena_scores_reset", null, {});
    toast.success("تم تصفير النقاط");
    await load();
  };

  const updateReward = (i: number, field: keyof Reward, value: string) => {
    const next = [...s.rewards];
    next[i] = { ...next[i], [field]: value };
    setS({ ...s, rewards: next });
  };
  const addReward = () => setS({ ...s, rewards: [...s.rewards, { rank: "", text: "" }] });
  const removeReward = (i: number) => setS({ ...s, rewards: s.rewards.filter((_, idx) => idx !== i) });

  if (loading) return <div className="p-6 text-slate-300">جاري التحميل…</div>;

  return (
    <div className="p-3 md:p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">🏟️ إعدادات الأرينا</h1>
        <p className="text-slate-400 text-xs md:text-sm mt-1">تحكّم بالتشغيل والجوائز والفعاليات وتصفير النقاط.</p>
      </div>

      {/* Status / toggle */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">حالة الأرينا</div>
            <div className="text-xs text-slate-400">عند الإيقاف لن تُسجَّل أي نقاط، وتظهر للاعبين رسالة الإقفال.</div>
          </div>
          <label className="inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer"
              checked={s.enabled}
              onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
            <div className="w-12 h-6 rounded-full bg-slate-700 peer-checked:bg-emerald-600 relative transition">
              <div className={`absolute top-0.5 ${s.enabled ? "right-0.5" : "left-0.5"} w-5 h-5 bg-white rounded-full transition`} />
            </div>
            <span className="ms-2 text-sm font-bold">{s.enabled ? "تعمل" : "متوقفة"}</span>
          </label>
        </div>
        <div className="grid md:grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-slate-400">عنوان رسالة الإقفال</label>
            <input className="w-full mt-1 px-3 py-2 rounded bg-slate-800 border border-slate-700 text-sm"
              value={s.locked_title} onChange={(e) => setS({ ...s, locked_title: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-slate-400">نص رسالة الإقفال</label>
            <input className="w-full mt-1 px-3 py-2 rounded bg-slate-800 border border-slate-700 text-sm"
              value={s.locked_message} onChange={(e) => setS({ ...s, locked_message: e.target.value })} />
          </div>
        </div>
      </section>

      {/* Event */}
      <section className="rounded-xl border border-pink-700/40 bg-pink-900/10 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">🎉 فعالية الأرينا</div>
            <div className="text-xs text-slate-400">تُضاعف النقاط المكتسبة طوال فترة الفعالية.</div>
          </div>
          <label className="inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer"
              checked={s.event_active}
              onChange={(e) => setS({ ...s, event_active: e.target.checked })} />
            <div className="w-12 h-6 rounded-full bg-slate-700 peer-checked:bg-pink-600 relative transition">
              <div className={`absolute top-0.5 ${s.event_active ? "right-0.5" : "left-0.5"} w-5 h-5 bg-white rounded-full transition`} />
            </div>
            <span className="ms-2 text-sm font-bold">{s.event_active ? "مفعّلة" : "موقوفة"}</span>
          </label>
        </div>
        <div className="grid md:grid-cols-3 gap-2">
          <div className="md:col-span-2">
            <label className="text-xs text-slate-400">عنوان الفعالية</label>
            <input className="w-full mt-1 px-3 py-2 rounded bg-slate-800 border border-slate-700 text-sm"
              placeholder="مثال: ويكند الأرينا الذهبي"
              value={s.event_title ?? ""} onChange={(e) => setS({ ...s, event_title: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-slate-400">المضاعِف (1 – 10)</label>
            <input type="number" min={1} max={10} step={0.5}
              className="w-full mt-1 px-3 py-2 rounded bg-slate-800 border border-slate-700 text-sm"
              value={s.event_multiplier}
              onChange={(e) => setS({ ...s, event_multiplier: Number(e.target.value) })} />
          </div>
          <div className="md:col-span-3">
            <label className="text-xs text-slate-400">ينتهي في (اختياري)</label>
            <input type="datetime-local"
              className="w-full mt-1 px-3 py-2 rounded bg-slate-800 border border-slate-700 text-sm"
              value={toLocalInput(s.event_ends_at)}
              onChange={(e) => setS({ ...s, event_ends_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            <div className="text-[10px] text-slate-500 mt-1">اتركه فارغاً لتبقى الفعالية مفعّلة بلا نهاية.</div>
          </div>
        </div>
      </section>

      {/* Rewards */}
      <section className="rounded-xl border border-amber-700/40 bg-amber-900/10 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">🎁 جوائز نهاية الأسبوع</div>
            <div className="text-xs text-slate-400">تظهر في صفحة الأرينا للاعبين.</div>
          </div>
          <button onClick={addReward} className="text-xs px-3 py-1.5 rounded bg-amber-700/40 hover:bg-amber-700/60 text-amber-100 border border-amber-600/40">
            + إضافة جائزة
          </button>
        </div>
        <div className="space-y-2">
          {s.rewards.map((r, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input className="w-32 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"
                placeholder="🥇 #1" value={r.rank} onChange={(e) => updateReward(i, "rank", e.target.value)} />
              <input className="flex-1 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"
                placeholder="وصف الجائزة" value={r.text} onChange={(e) => updateReward(i, "text", e.target.value)} />
              <button onClick={() => removeReward(i)} className="text-xs px-2 py-1.5 rounded bg-red-900/40 hover:bg-red-900/60 text-red-200">حذف</button>
            </div>
          ))}
          {s.rewards.length === 0 && <div className="text-slate-500 text-sm">لا توجد جوائز — اضغط «إضافة جائزة».</div>}
        </div>
      </section>

      {/* Reset scores */}
      <section className="rounded-xl border border-red-800/50 bg-red-900/10 p-4 flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-red-200">تصفير النقاط</div>
          <div className="text-xs text-slate-400">عدد لاعبي الأسبوع الحالي: {topCount ?? 0}</div>
        </div>
        <button onClick={resetScores} className="text-sm px-4 py-2 rounded bg-red-700 hover:bg-red-600 font-bold">
          ⚠️ تصفير
        </button>
      </section>

      <div className="sticky bottom-0 -mx-3 md:-mx-6 px-3 md:px-6 py-3 bg-slate-950/80 backdrop-blur border-t border-slate-800 flex gap-2 justify-end">
        <button onClick={load} className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-sm">إلغاء</button>
        <button onClick={save} disabled={saving}
          className="px-5 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-bold disabled:opacity-50">
          {saving ? "⏳ حفظ…" : "💾 حفظ الإعدادات"}
        </button>
      </div>
    </div>
  );
}
