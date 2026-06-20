import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/tribe-events")({
  component: AdminTribeEvents,
  ssr: false,
  head: () => ({ meta: [{ title: "فعاليات صيد القبائل — Admin" }] }),
});

type Row = {
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
  created_at: string;
};

type LbRow = {
  tribe_id: string;
  tribe_name: string;
  tribe_emblem: string;
  tribe_banner: string;
  members_count: number;
  total_fish: number;
};

const THEMES = [
  { id: "ocean", label: "🌊 محيط" },
  { id: "gold", label: "🏆 ذهبي" },
  { id: "emerald", label: "💚 زمرد" },
  { id: "royal", label: "👑 ملكي" },
  { id: "inferno", label: "🔥 لهيب" },
];

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function AdminTribeEvents() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [boards, setBoards] = useState<Record<string, LbRow[]>>({});
  const [msg, setMsg] = useState<string | null>(null);

  // create form
  const now = new Date();
  const inWeek = new Date(now.getTime() + 7 * 86400000);
  const [title, setTitle] = useState("فعالية صيد القبائل");
  const [desc, setDesc] = useState("القبيلة الأكثر صيداً تفوز بجائزة جواهر توزع على أعضائها بالتساوي.");
  const [emoji, setEmoji] = useState("🎣");
  const [theme, setTheme] = useState("ocean");
  const [startsAt, setStartsAt] = useState(toLocalInput(now.toISOString()));
  const [endsAt, setEndsAt] = useState(toLocalInput(inWeek.toISOString()));
  const [rewardGems, setRewardGems] = useState<number>(1000);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("tribe_fish_events" as never)
      .select("*")
      .order("created_at", { ascending: false });
    const list = (data ?? []) as Row[];
    setRows(list);
    setLoading(false);
    const entries = await Promise.all(list.map(async (r) => {
      const { data: lb } = await supabase.rpc("tribe_fish_event_leaderboard" as never, { p_event_id: r.id } as never);
      return [r.id, ((lb ?? []) as LbRow[]).slice(0, 10)] as const;
    }));
    setBoards(Object.fromEntries(entries));
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    const s = new Date(startsAt);
    const e = new Date(endsAt);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) {
      setMsg("تواريخ غير صحيحة"); return;
    }
    setCreating(true);
    setMsg(null);
    const { error } = await supabase.from("tribe_fish_events" as never).insert({
      title: title.trim() || "فعالية صيد القبائل",
      description: desc.trim(),
      banner_emoji: emoji || "🎣",
      banner_theme: theme,
      starts_at: s.toISOString(),
      ends_at: e.toISOString(),
      reward_gems: Math.max(0, rewardGems | 0),
      active: true,
    } as never);
    setCreating(false);
    if (error) { setMsg("خطأ: " + error.message); return; }
    setMsg("✅ تم إنشاء الفعالية");
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
    if (!confirm(`توزيع ${r.reward_gems} جوهرة على أعضاء القبيلة الفائزة؟ لا يمكن التراجع.`)) return;
    const { data, error } = await supabase.rpc("distribute_tribe_fish_event_prizes" as never, { p_event_id: r.id } as never);
    if (error) { setMsg("خطأ: " + error.message); return; }
    const res = data as { winner_tribe_id?: string; total_fish?: number; members_count?: number; gems_per_member?: number; reason?: string };
    if (res?.reason === "no_participants") {
      setMsg("⚠️ لا يوجد مشاركون — تم إغلاق الفعالية بدون توزيع.");
    } else {
      setMsg(`🏆 تم التوزيع — ${res.gems_per_member} جوهرة لكل عضو (${res.members_count} عضو، ${res.total_fish} سمكة)`);
    }
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
        <div className="grid md:grid-cols-4 gap-3">
          <label className="block">
            <span className="text-xs text-slate-400">يبدأ</span>
            <input type="datetime-local" value={startsAt} onChange={e=>setStartsAt(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700"/>
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">ينتهي</span>
            <input type="datetime-local" value={endsAt} onChange={e=>setEndsAt(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700"/>
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">💎 جواهر للقبيلة الفائزة</span>
            <input type="number" min={0} value={rewardGems} onChange={e=>setRewardGems(+e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700"/>
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">الشكل</span>
            <select value={theme} onChange={e=>setTheme(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">
              {THEMES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
        </div>
        <button onClick={create} disabled={creating} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 font-bold disabled:opacity-60">
          {creating ? "جاري الإنشاء…" : "إنشاء الفعالية"}
        </button>
      </div>

      {/* List */}
      <div className="space-y-4">
        <h2 className="font-bold text-slate-200">📜 كل الفعاليات</h2>
        {loading && <div className="text-slate-400 text-sm">جاري التحميل…</div>}
        {!loading && rows.length === 0 && <div className="text-slate-400 text-sm">لا توجد فعاليات.</div>}

        {rows.map(r => {
          const lb = boards[r.id] ?? [];
          const ended = new Date(r.ends_at).getTime() <= Date.now();
          const distributed = !!r.prizes_distributed_at;
          return (
            <div key={r.id} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-3 md:p-4 space-y-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <div className="text-lg font-bold">
                    <span className="me-2">{r.banner_emoji}</span>{r.title}
                  </div>
                  <div className="text-xs text-slate-400 mt-1 whitespace-pre-line">{r.description}</div>
                  <div className="text-[11px] text-slate-500 mt-2">
                    {new Date(r.starts_at).toLocaleString("ar")} ← {new Date(r.ends_at).toLocaleString("ar")}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="px-2 py-1 rounded bg-emerald-900/40 border border-emerald-700/50 text-emerald-200 text-xs font-bold">💎 {r.reward_gems}</span>
                  <span className={`px-2 py-1 rounded text-xs font-bold ${r.active ? "bg-green-900/40 border border-green-700/50 text-green-200" : "bg-slate-800 border border-slate-700 text-slate-300"}`}>
                    {r.active ? "نشطة" : "مغلقة"}
                  </span>
                  {distributed && <span className="px-2 py-1 rounded bg-amber-900/40 border border-amber-700/50 text-amber-200 text-xs font-bold">✅ وزعت</span>}
                </div>
              </div>

              {/* Leaderboard */}
              <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-2">
                <div className="text-xs font-bold text-slate-300 mb-1">🏆 ترتيب القبائل</div>
                {lb.length === 0 ? (
                  <div className="text-xs text-slate-500 py-2">لا يوجد مشاركون بعد.</div>
                ) : (
                  <ol className="space-y-1">
                    {lb.map((t, i) => (
                      <li key={t.tribe_id} className={`flex items-center gap-2 px-2 py-1.5 rounded ${i===0 ? "bg-amber-500/15 border border-amber-500/40" : "bg-slate-900/60"}`}>
                        <span className="w-6 text-center font-bold text-amber-300">{i===0 ? "🥇" : i===1 ? "🥈" : i===2 ? "🥉" : `#${i+1}`}</span>
                        <span className="text-lg">{t.tribe_banner}</span>
                        <span className="flex-1 font-semibold">{t.tribe_emblem} {t.tribe_name}</span>
                        <span className="text-xs text-slate-400">{t.members_count} عضو</span>
                        <span className="font-bold text-cyan-300">{Number(t.total_fish).toLocaleString()} 🐟</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

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
