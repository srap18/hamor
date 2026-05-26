import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SHIPS, fishMarketCapacity } from "@/lib/ships";
import { FM_CAP_OVERRIDES } from "@/lib/economy-overrides";

export const Route = createFileRoute("/admin/content")({
  component: AdminContent,
  ssr: false,
});

type Tab = "quests" | "achievements" | "lootboxes" | "events" | "catalog" | "economy";

function AdminContent() {
  const [tab, setTab] = useState<Tab>("economy");

  const TABS: Array<{ id: Tab; label: string; icon: string }> = [
    { id: "economy", label: "الاقتصاد", icon: "💰" },
    { id: "quests", label: "المهام اليومية", icon: "🎯" },
    { id: "achievements", label: "الإنجازات", icon: "🏆" },
    { id: "lootboxes", label: "الصناديق", icon: "🎁" },
    { id: "events", label: "الفعاليات", icon: "🎉" },
    { id: "catalog", label: "كاتالوج العناصر", icon: "📦" },
  ];

  return (
    <div className="p-3 md:p-6">
      <h1 className="text-xl md:text-2xl font-bold mb-4">محتوى اللعبة</h1>

      <div className="flex gap-1 mb-4 border-b border-slate-800 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 transition ${
              tab === t.id ? "border-indigo-500 text-indigo-200" : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "economy" && <EconomyTab />}
      {tab === "quests" && <QuestsTab />}
      {tab === "achievements" && <AchievementsTab />}
      {tab === "lootboxes" && <LootboxesTab />}
      {tab === "events" && <EventsTab />}
      {tab === "catalog" && <CatalogTab />}
    </div>
  );
}

/* ============== Generic CRUD helpers ============== */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-slate-400 block mb-1">{label}</label>
      {children}
    </div>
  );
}
const inp = "w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500";

/* ============== Quests ============== */
type Quest = {
  id: string; title: string; description: string; icon: string;
  goal_type: string; goal_count: number;
  reward_coins: number; reward_xp: number; reward_gems: number;
  active: boolean;
};
function QuestsTab() {
  const [list, setList] = useState<Quest[]>([]);
  const empty = { title: "", description: "", icon: "🎯", goal_type: "catch_fish", goal_count: 1, reward_coins: 100, reward_xp: 20, reward_gems: 0, active: true };
  const [form, setForm] = useState<Partial<Quest>>(empty);
  const load = async () => { const { data } = await supabase.from("daily_quests").select("*").order("created_at", { ascending: false }); setList((data ?? []) as Quest[]); };
  useEffect(() => { load(); }, []);
  const save = async () => {
    if (!form.title?.trim()) return;
    const payload = { ...form, title: form.title.trim() };
    if (form.id) await supabase.from("daily_quests").update(payload).eq("id", form.id);
    else await supabase.from("daily_quests").insert(payload as never);
    setForm(empty); load();
  };
  const del = async (id: string) => { if (confirm("حذف؟")) { await supabase.from("daily_quests").delete().eq("id", id); load(); } };
  return (
    <div className="grid md:grid-cols-[1fr_360px] gap-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/60"><tr><th className="text-right p-3">المهمة</th><th className="text-right p-3">النوع</th><th className="text-right p-3">الهدف</th><th className="text-right p-3">المكافأة</th><th className="text-right p-3">⚙️</th></tr></thead>
          <tbody>
            {list.map((q) => (
              <tr key={q.id} className="border-t border-slate-800/50">
                <td className="p-3">{q.icon} {q.title} {!q.active && <span className="text-xs text-slate-500">(معطّلة)</span>}</td>
                <td className="p-3 text-xs text-slate-400">{q.goal_type}</td>
                <td className="p-3">{q.goal_count}</td>
                <td className="p-3 text-xs">🪙{q.reward_coins} · ⭐{q.reward_xp} · 💎{q.reward_gems}</td>
                <td className="p-3"><div className="flex gap-1"><button onClick={() => setForm(q)} className="text-indigo-300 text-xs">تعديل</button><button onClick={() => del(q.id)} className="text-red-400 text-xs">حذف</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3 h-fit">
        <h3 className="font-semibold">{form.id ? "تعديل مهمة" : "مهمة جديدة"}</h3>
        <Field label="العنوان"><input className={inp} value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="الوصف"><input className={inp} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="الأيقونة"><input className={inp} value={form.icon ?? ""} onChange={(e) => setForm({ ...form, icon: e.target.value })} /></Field>
          <Field label="عدد الهدف"><input type="number" className={inp} value={form.goal_count ?? 1} onChange={(e) => setForm({ ...form, goal_count: Number(e.target.value) })} /></Field>
        </div>
        <Field label="نوع الهدف">
          <select className={inp} value={form.goal_type ?? "catch_fish"} onChange={(e) => setForm({ ...form, goal_type: e.target.value })}>
            <option value="login">تسجيل دخول</option>
            <option value="catch_fish">اصطياد سمك</option>
            <option value="win_pvp">فوز معركة</option>
            <option value="buy_ship">شراء سفينة</option>
            <option value="send_ship">إرسال سفينة</option>
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="🪙"><input type="number" className={inp} value={form.reward_coins ?? 0} onChange={(e) => setForm({ ...form, reward_coins: Number(e.target.value) })} /></Field>
          <Field label="⭐"><input type="number" className={inp} value={form.reward_xp ?? 0} onChange={(e) => setForm({ ...form, reward_xp: Number(e.target.value) })} /></Field>
          <Field label="💎"><input type="number" className={inp} value={form.reward_gems ?? 0} onChange={(e) => setForm({ ...form, reward_gems: Number(e.target.value) })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active ?? true} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> نشطة</label>
        <div className="flex gap-2">
          <button onClick={save} className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold">حفظ</button>
          {form.id && <button onClick={() => setForm(empty)} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">جديد</button>}
        </div>
      </div>
    </div>
  );
}

/* ============== Achievements ============== */
type Ach = { id: string; code: string; title: string; description: string; icon: string; goal_type: string; goal_count: number; reward_coins: number; reward_xp: number; reward_gems: number; active: boolean; sort_order: number };
function AchievementsTab() {
  const [list, setList] = useState<Ach[]>([]);
  const empty = { code: "", title: "", description: "", icon: "🏆", goal_type: "catch_fish", goal_count: 10, reward_coins: 500, reward_xp: 100, reward_gems: 0, active: true, sort_order: 0 };
  const [form, setForm] = useState<Partial<Ach>>(empty);
  const load = async () => { const { data } = await supabase.from("achievements").select("*").order("sort_order"); setList((data ?? []) as Ach[]); };
  useEffect(() => { load(); }, []);
  const save = async () => {
    if (!form.title?.trim() || !form.code?.trim()) return;
    if (form.id) await supabase.from("achievements").update(form).eq("id", form.id);
    else await supabase.from("achievements").insert(form as never);
    setForm(empty); load();
  };
  const del = async (id: string) => { if (confirm("حذف؟")) { await supabase.from("achievements").delete().eq("id", id); load(); } };
  return (
    <div className="grid md:grid-cols-[1fr_360px] gap-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/60"><tr><th className="text-right p-3">الإنجاز</th><th className="text-right p-3">الكود</th><th className="text-right p-3">الهدف</th><th className="text-right p-3">المكافأة</th><th className="text-right p-3">⚙️</th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className="border-t border-slate-800/50">
                <td className="p-3">{a.icon} {a.title}</td>
                <td className="p-3 text-xs text-slate-400 font-mono">{a.code}</td>
                <td className="p-3 text-xs">{a.goal_type} ×{a.goal_count}</td>
                <td className="p-3 text-xs">🪙{a.reward_coins} ⭐{a.reward_xp}</td>
                <td className="p-3"><div className="flex gap-1"><button onClick={() => setForm(a)} className="text-indigo-300 text-xs">تعديل</button><button onClick={() => del(a.id)} className="text-red-400 text-xs">حذف</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3 h-fit">
        <h3 className="font-semibold">{form.id ? "تعديل إنجاز" : "إنجاز جديد"}</h3>
        <Field label="الكود (فريد)"><input className={inp} value={form.code ?? ""} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
        <Field label="العنوان"><input className={inp} value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="الوصف"><input className={inp} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="الأيقونة"><input className={inp} value={form.icon ?? ""} onChange={(e) => setForm({ ...form, icon: e.target.value })} /></Field>
          <Field label="عدد الهدف"><input type="number" className={inp} value={form.goal_count ?? 1} onChange={(e) => setForm({ ...form, goal_count: Number(e.target.value) })} /></Field>
        </div>
        <Field label="نوع الهدف">
          <select className={inp} value={form.goal_type ?? "catch_fish"} onChange={(e) => setForm({ ...form, goal_type: e.target.value })}>
            <option value="catch_fish">اصطياد سمك</option>
            <option value="win_pvp">فوز معركة</option>
            <option value="own_ship">امتلاك سفن</option>
            <option value="coins_held">امتلاك عملات</option>
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="🪙"><input type="number" className={inp} value={form.reward_coins ?? 0} onChange={(e) => setForm({ ...form, reward_coins: Number(e.target.value) })} /></Field>
          <Field label="⭐"><input type="number" className={inp} value={form.reward_xp ?? 0} onChange={(e) => setForm({ ...form, reward_xp: Number(e.target.value) })} /></Field>
          <Field label="💎"><input type="number" className={inp} value={form.reward_gems ?? 0} onChange={(e) => setForm({ ...form, reward_gems: Number(e.target.value) })} /></Field>
        </div>
        <Field label="ترتيب العرض"><input type="number" className={inp} value={form.sort_order ?? 0} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active ?? true} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> نشط</label>
        <div className="flex gap-2">
          <button onClick={save} className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold">حفظ</button>
          {form.id && <button onClick={() => setForm(empty)} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">جديد</button>}
        </div>
      </div>
    </div>
  );
}

/* ============== Lootboxes ============== */
type Box = { id: string; name: string; icon: string; rarity: string; cost_coins: number; cost_gems: number; min_coins: number; max_coins: number; min_gems: number; max_gems: number; min_xp: number; max_xp: number; active: boolean };
function LootboxesTab() {
  const [list, setList] = useState<Box[]>([]);
  const empty = { name: "", icon: "📦", rarity: "common", cost_coins: 200, cost_gems: 0, min_coins: 100, max_coins: 500, min_gems: 0, max_gems: 0, min_xp: 10, max_xp: 50, active: true };
  const [form, setForm] = useState<Partial<Box>>(empty);
  const load = async () => { const { data } = await supabase.from("lootbox_types").select("*").order("cost_coins"); setList((data ?? []) as Box[]); };
  useEffect(() => { load(); }, []);
  const save = async () => {
    if (!form.name?.trim()) return;
    if (form.id) await supabase.from("lootbox_types").update(form).eq("id", form.id);
    else await supabase.from("lootbox_types").insert(form as never);
    setForm(empty); load();
  };
  const del = async (id: string) => { if (confirm("حذف؟")) { await supabase.from("lootbox_types").delete().eq("id", id); load(); } };
  return (
    <div className="grid md:grid-cols-[1fr_360px] gap-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/60"><tr><th className="text-right p-3">الصندوق</th><th className="text-right p-3">الندرة</th><th className="text-right p-3">السعر</th><th className="text-right p-3">المحتوى</th><th className="text-right p-3">⚙️</th></tr></thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id} className="border-t border-slate-800/50">
                <td className="p-3">{b.icon} {b.name}</td>
                <td className="p-3 text-xs">{b.rarity}</td>
                <td className="p-3 text-xs">🪙{b.cost_coins} 💎{b.cost_gems}</td>
                <td className="p-3 text-xs">🪙{b.min_coins}-{b.max_coins} · ⭐{b.min_xp}-{b.max_xp}</td>
                <td className="p-3"><div className="flex gap-1"><button onClick={() => setForm(b)} className="text-indigo-300 text-xs">تعديل</button><button onClick={() => del(b.id)} className="text-red-400 text-xs">حذف</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3 h-fit">
        <h3 className="font-semibold">{form.id ? "تعديل صندوق" : "صندوق جديد"}</h3>
        <Field label="الاسم"><input className={inp} value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="الأيقونة"><input className={inp} value={form.icon ?? ""} onChange={(e) => setForm({ ...form, icon: e.target.value })} /></Field>
          <Field label="الندرة"><select className={inp} value={form.rarity ?? "common"} onChange={(e) => setForm({ ...form, rarity: e.target.value })}><option value="common">عادي</option><option value="rare">نادر</option><option value="epic">ملحمي</option><option value="legendary">أسطوري</option></select></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="سعر 🪙"><input type="number" className={inp} value={form.cost_coins ?? 0} onChange={(e) => setForm({ ...form, cost_coins: Number(e.target.value) })} /></Field>
          <Field label="سعر 💎"><input type="number" className={inp} value={form.cost_gems ?? 0} onChange={(e) => setForm({ ...form, cost_gems: Number(e.target.value) })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="🪙 من"><input type="number" className={inp} value={form.min_coins ?? 0} onChange={(e) => setForm({ ...form, min_coins: Number(e.target.value) })} /></Field>
          <Field label="🪙 إلى"><input type="number" className={inp} value={form.max_coins ?? 0} onChange={(e) => setForm({ ...form, max_coins: Number(e.target.value) })} /></Field>
          <Field label="💎 من"><input type="number" className={inp} value={form.min_gems ?? 0} onChange={(e) => setForm({ ...form, min_gems: Number(e.target.value) })} /></Field>
          <Field label="💎 إلى"><input type="number" className={inp} value={form.max_gems ?? 0} onChange={(e) => setForm({ ...form, max_gems: Number(e.target.value) })} /></Field>
          <Field label="⭐ من"><input type="number" className={inp} value={form.min_xp ?? 0} onChange={(e) => setForm({ ...form, min_xp: Number(e.target.value) })} /></Field>
          <Field label="⭐ إلى"><input type="number" className={inp} value={form.max_xp ?? 0} onChange={(e) => setForm({ ...form, max_xp: Number(e.target.value) })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active ?? true} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> نشط</label>
        <div className="flex gap-2">
          <button onClick={save} className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold">حفظ</button>
          {form.id && <button onClick={() => setForm(empty)} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">جديد</button>}
        </div>
      </div>
    </div>
  );
}

/* ============== Events ============== */
type Evt = { id: string; title: string; description: string; banner: string; starts_at: string; ends_at: string; xp_multiplier: number; coin_multiplier: number; active: boolean };
function EventsTab() {
  const [list, setList] = useState<Evt[]>([]);
  const now = new Date().toISOString().slice(0, 16);
  const week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16);
  const empty = { title: "", description: "", banner: "🎉", starts_at: now, ends_at: week, xp_multiplier: 2, coin_multiplier: 2, active: true };
  const [form, setForm] = useState<Partial<Evt>>(empty);
  const load = async () => { const { data } = await supabase.from("events").select("*").order("starts_at", { ascending: false }); setList((data ?? []) as Evt[]); };
  useEffect(() => { load(); }, []);
  const save = async () => {
    if (!form.title?.trim()) return;
    if (form.id) await supabase.from("events").update(form).eq("id", form.id);
    else await supabase.from("events").insert(form as never);
    setForm(empty); load();
  };
  const del = async (id: string) => { if (confirm("حذف؟")) { await supabase.from("events").delete().eq("id", id); load(); } };
  return (
    <div className="grid md:grid-cols-[1fr_360px] gap-4">
      <div className="space-y-2">
        {list.map((e) => (
          <div key={e.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-lg font-semibold">{e.banner} {e.title}</div>
                <div className="text-sm text-slate-400 mt-1">{e.description}</div>
                <div className="text-xs text-slate-500 mt-2">
                  من {new Date(e.starts_at).toLocaleString("ar")} إلى {new Date(e.ends_at).toLocaleString("ar")}
                </div>
                <div className="text-xs mt-1">⭐×{e.xp_multiplier} · 🪙×{e.coin_multiplier} · {e.active ? "🟢 نشط" : "⏸ معطّل"}</div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setForm({ ...e, starts_at: e.starts_at.slice(0, 16), ends_at: e.ends_at.slice(0, 16) })} className="text-indigo-300 text-xs">تعديل</button>
                <button onClick={() => del(e.id)} className="text-red-400 text-xs">حذف</button>
              </div>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="text-slate-500 text-sm">لا توجد فعاليات</div>}
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3 h-fit">
        <h3 className="font-semibold">{form.id ? "تعديل فعالية" : "فعالية جديدة"}</h3>
        <Field label="العنوان"><input className={inp} value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="الوصف"><textarea rows={3} className={inp + " resize-none"} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="الأيقونة/البانر"><input className={inp} value={form.banner ?? ""} onChange={(e) => setForm({ ...form, banner: e.target.value })} /></Field>
        <Field label="البداية"><input type="datetime-local" className={inp} value={form.starts_at ?? ""} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></Field>
        <Field label="النهاية"><input type="datetime-local" className={inp} value={form.ends_at ?? ""} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="مضاعف ⭐"><input type="number" step="0.1" className={inp} value={form.xp_multiplier ?? 1} onChange={(e) => setForm({ ...form, xp_multiplier: Number(e.target.value) })} /></Field>
          <Field label="مضاعف 🪙"><input type="number" step="0.1" className={inp} value={form.coin_multiplier ?? 1} onChange={(e) => setForm({ ...form, coin_multiplier: Number(e.target.value) })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active ?? true} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> نشط</label>
        <div className="flex gap-2">
          <button onClick={save} className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold">حفظ</button>
          {form.id && <button onClick={() => setForm(empty)} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">جديد</button>}
        </div>
      </div>
    </div>
  );
}

/* ============== Catalog (ships/fish/etc) ============== */
type Item = { id: string; kind: string; code: string; name: string; description: string; icon: string; price_coins: number; price_gems: number; rarity: string; active: boolean; sort_order: number };
function CatalogTab() {
  const [list, setList] = useState<Item[]>([]);
  const [kindFilter, setKindFilter] = useState("ship");
  const empty = { kind: kindFilter, code: "", name: "", description: "", icon: "⚓", price_coins: 1000, price_gems: 0, rarity: "common", active: true, sort_order: 0 };
  const [form, setForm] = useState<Partial<Item>>(empty);
  const load = async () => { const { data } = await supabase.from("items_catalog").select("*").eq("kind", kindFilter).order("sort_order"); setList((data ?? []) as Item[]); };
  useEffect(() => { load(); setForm({ ...empty, kind: kindFilter }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kindFilter]);
  const save = async () => {
    if (!form.name?.trim() || !form.code?.trim()) return;
    if (form.id) await supabase.from("items_catalog").update(form).eq("id", form.id);
    else await supabase.from("items_catalog").insert({ ...form, kind: kindFilter } as never);
    setForm({ ...empty, kind: kindFilter }); load();
  };
  const del = async (id: string) => { if (confirm("حذف؟")) { await supabase.from("items_catalog").delete().eq("id", id); load(); } };
  return (
    <div>
      <div className="flex gap-2 mb-3">
        {[{ k: "ship", l: "⛵ سفن" }, { k: "fish", l: "🐟 أسماك" }, { k: "background", l: "🌅 خلفيات" }, { k: "frame", l: "🖼 إطارات" }].map((t) => (
          <button key={t.k} onClick={() => setKindFilter(t.k)} className={`px-3 py-1.5 rounded-lg text-xs ${kindFilter === t.k ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>{t.l}</button>
        ))}
      </div>
      <div className="grid md:grid-cols-[1fr_360px] gap-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60"><tr><th className="text-right p-3">العنصر</th><th className="text-right p-3">الكود</th><th className="text-right p-3">الندرة</th><th className="text-right p-3">السعر</th><th className="text-right p-3">⚙️</th></tr></thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.id} className="border-t border-slate-800/50">
                  <td className="p-3">{i.icon} {i.name} {!i.active && <span className="text-xs text-slate-500">(معطّل)</span>}</td>
                  <td className="p-3 text-xs font-mono text-slate-400">{i.code}</td>
                  <td className="p-3 text-xs">{i.rarity}</td>
                  <td className="p-3 text-xs">🪙{i.price_coins} 💎{i.price_gems}</td>
                  <td className="p-3"><div className="flex gap-1"><button onClick={() => setForm(i)} className="text-indigo-300 text-xs">تعديل</button><button onClick={() => del(i.id)} className="text-red-400 text-xs">حذف</button></div></td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-500">لا توجد عناصر — أضف من النموذج</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3 h-fit">
          <h3 className="font-semibold">{form.id ? "تعديل عنصر" : "عنصر جديد"}</h3>
          <Field label="الكود (فريد للنوع)"><input className={inp} value={form.code ?? ""} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          <Field label="الاسم"><input className={inp} value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="الوصف"><input className={inp} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="الأيقونة"><input className={inp} value={form.icon ?? ""} onChange={(e) => setForm({ ...form, icon: e.target.value })} /></Field>
            <Field label="الندرة"><select className={inp} value={form.rarity ?? "common"} onChange={(e) => setForm({ ...form, rarity: e.target.value })}><option value="common">عادي</option><option value="rare">نادر</option><option value="epic">ملحمي</option><option value="legendary">أسطوري</option></select></Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="🪙"><input type="number" className={inp} value={form.price_coins ?? 0} onChange={(e) => setForm({ ...form, price_coins: Number(e.target.value) })} /></Field>
            <Field label="💎"><input type="number" className={inp} value={form.price_gems ?? 0} onChange={(e) => setForm({ ...form, price_gems: Number(e.target.value) })} /></Field>
          </div>
          <Field label="ترتيب"><input type="number" className={inp} value={form.sort_order ?? 0} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active ?? true} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> نشط</label>
          <div className="flex gap-2">
            <button onClick={save} className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold">حفظ</button>
            {form.id && <button onClick={() => setForm({ ...empty, kind: kindFilter })} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">جديد</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============== Economy: Ships + Fish Market + Client Prices ============== */
type ShipOverrideRow = {
  level: number;
  price?: number;
  storage?: number;
  fishingMinutes?: number;
  maxHp?: number;
};
type CipRow = { item_id: string; item_type: string; price_coins: number; price_gems: number };

function EconomyTab() {
  const [sub, setSub] = useState<"ships" | "fishmarket" | "prices">("ships");
  return (
    <div>
      <div className="flex gap-2 mb-4">
        {[
          { k: "ships", l: "⛵ السفن (لكل مستوى)" },
          { k: "fishmarket", l: "🐟 سعة سوق السمك" },
          { k: "prices", l: "💵 أسعار الكتالوج العامة" },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setSub(t.k as typeof sub)}
            className={`px-3 py-1.5 rounded-lg text-xs ${sub === t.k ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
          >{t.l}</button>
        ))}
      </div>
      {sub === "ships" && <ShipOverridesTable />}
      {sub === "fishmarket" && <FishMarketTable />}
      {sub === "prices" && <ClientItemPricesTable />}
    </div>
  );
}

function ShipOverridesTable() {
  const [rows, setRows] = useState<Record<number, ShipOverrideRow>>({});
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("ship_overrides").select("level, overrides");
      const map: Record<number, ShipOverrideRow> = {};
      for (const r of data ?? []) {
        const ov = (r.overrides ?? {}) as Partial<ShipOverrideRow>;
        map[r.level as number] = { level: r.level as number, ...ov };
      }
      setRows(map);
    })();
  }, []);

  const update = (level: number, key: keyof ShipOverrideRow, val: string) => {
    setRows((p) => ({
      ...p,
      [level]: { ...(p[level] ?? { level }), [key]: val === "" ? undefined : Number(val) },
    }));
    setDirty((d) => new Set(d).add(level));
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      for (const level of dirty) {
        const r = rows[level] ?? { level };
        const overrides: Record<string, number> = {};
        if (r.price != null) overrides.price = r.price;
        if (r.storage != null) overrides.storage = r.storage;
        if (r.fishingMinutes != null) overrides.fishingMinutes = r.fishingMinutes;
        if (r.maxHp != null) overrides.maxHp = r.maxHp;
        await supabase.from("ship_overrides").upsert({ level, overrides } as never);
        // apply locally in memory
        const ship = SHIPS[level - 1];
        if (ship) {
          if (overrides.price != null) ship.price = overrides.price;
          if (overrides.storage != null) ship.storage = overrides.storage;
          if (overrides.maxHp != null) ship.maxHp = overrides.maxHp;
          if (overrides.fishingMinutes != null) ship.fishingSeconds = Math.round(overrides.fishingMinutes * 60);
        }
        // propagate maxHp to all owned ships of this template so existing players see new HP
        if (overrides.maxHp != null) {
          const newMax = overrides.maxHp;
          const sb = supabase as unknown as {
            from: (t: string) => {
              select: (c: string) => { eq: (c: string, v: number) => Promise<{ data: Array<{ id: string; hp: number | null; max_hp: number | null }> | null }> };
              update: (v: Record<string, number>) => { eq: (c: string, v: string) => Promise<unknown> };
            };
          };
          const { data: owned } = await sb.from("ships").select("id, hp, max_hp").eq("template_id", level);
          for (const row of owned ?? []) {
            const nextHp = Math.min(Number(row.hp ?? newMax), newMax);
            await sb.from("ships").update({ max_hp: newMax, hp: nextHp }).eq("id", row.id);
          }
        }
      }
      setDirty(new Set());
      setMsg("✓ تم الحفظ");
      setTimeout(() => setMsg(""), 2000);
    } finally { setSaving(false); }
  };

  const resetLevel = async (level: number) => {
    if (!confirm(`إعادة سفينة المستوى ${level} للقيم الافتراضية؟`)) return;
    await supabase.from("ship_overrides").delete().eq("level", level);
    setRows((p) => { const n = { ...p }; delete n[level]; return n; });
    location.reload();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">القيم الفارغة = استخدام الافتراضي. الحفظ يُطبَّق فوراً.</p>
        <div className="flex items-center gap-2">
          {msg && <span className="text-xs text-emerald-400">{msg}</span>}
          <button onClick={saveAll} disabled={saving || dirty.size === 0}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold disabled:opacity-40">
            {saving ? "جاري الحفظ..." : `حفظ (${dirty.size})`}
          </button>
        </div>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-800/60 sticky top-0">
            <tr>
              <th className="p-2 text-right">المستوى</th>
              <th className="p-2 text-right">الاسم</th>
              <th className="p-2 text-right">السعر 🪙</th>
              <th className="p-2 text-right">السعة 📦</th>
              <th className="p-2 text-right">مدة الصيد (دقيقة)</th>
              <th className="p-2 text-right">HP ❤️</th>
              <th className="p-2 text-right">⚙️</th>
            </tr>
          </thead>
          <tbody>
            {SHIPS.map((s) => {
              const r = rows[s.marketLevel] ?? {};
              const has = rows[s.marketLevel] != null;
              return (
                <tr key={s.marketLevel} className={`border-t border-slate-800/50 ${has ? "bg-indigo-950/20" : ""}`}>
                  <td className="p-2 font-semibold">L{s.marketLevel}</td>
                  <td className="p-2">{s.name}</td>
                  <td className="p-2"><input type="number" placeholder={String(s.price)} value={r.price ?? ""} onChange={(e) => update(s.marketLevel, "price", e.target.value)} className="w-28 px-2 py-1 rounded bg-slate-800 border border-slate-700" /></td>
                  <td className="p-2"><input type="number" placeholder={String(s.storage)} value={r.storage ?? ""} onChange={(e) => update(s.marketLevel, "storage", e.target.value)} className="w-24 px-2 py-1 rounded bg-slate-800 border border-slate-700" /></td>
                  <td className="p-2"><input type="number" step="0.5" placeholder={String((s.fishingSeconds / 60).toFixed(1))} value={r.fishingMinutes ?? ""} onChange={(e) => update(s.marketLevel, "fishingMinutes", e.target.value)} className="w-20 px-2 py-1 rounded bg-slate-800 border border-slate-700" /></td>
                  <td className="p-2"><input type="number" placeholder={String(s.maxHp)} value={r.maxHp ?? ""} onChange={(e) => update(s.marketLevel, "maxHp", e.target.value)} className="w-20 px-2 py-1 rounded bg-slate-800 border border-slate-700" /></td>
                  <td className="p-2">{has && <button onClick={() => resetLevel(s.marketLevel)} className="text-red-400 text-xs">إعادة</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FishMarketTable() {
  const [overrides, setOverrides] = useState<Record<number, number | "">>({});
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("economy_settings").select("value").eq("key", "fish_market_capacity_overrides").maybeSingle();
      const v = (data?.value ?? {}) as Record<string, number>;
      const map: Record<number, number> = {};
      for (const [k, val] of Object.entries(v)) map[Number(k)] = Number(val);
      setOverrides(map);
    })();
  }, []);

  const update = (lvl: number, val: string) => {
    setOverrides((p) => ({ ...p, [lvl]: val === "" ? "" : Number(val) }));
    setDirty(true);
  };

  const save = async () => {
    const value: Record<string, number> = {};
    for (const [k, v] of Object.entries(overrides)) if (v !== "" && v != null) value[k] = Number(v);
    await supabase.from("economy_settings").upsert({ key: "fish_market_capacity_overrides", value } as never);
    // apply locally
    for (const k of Object.keys(FM_CAP_OVERRIDES)) delete FM_CAP_OVERRIDES[Number(k)];
    for (const [k, v] of Object.entries(value)) FM_CAP_OVERRIDES[Number(k)] = v;
    setDirty(false);
    setMsg("✓ تم الحفظ");
    setTimeout(() => setMsg(""), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">القيم الفارغة = استخدام السعة الافتراضية المحسوبة.</p>
        <div className="flex items-center gap-2">
          {msg && <span className="text-xs text-emerald-400">{msg}</span>}
          <button onClick={save} disabled={!dirty} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold disabled:opacity-40">حفظ</button>
        </div>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-800/60 sticky top-0">
            <tr>
              <th className="p-2 text-right">المستوى</th>
              <th className="p-2 text-right">الافتراضي</th>
              <th className="p-2 text-right">سعة مخصّصة</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 30 }, (_, i) => i + 1).map((lvl) => (
              <tr key={lvl} className="border-t border-slate-800/50">
                <td className="p-2 font-semibold">L{lvl}</td>
                <td className="p-2 text-slate-400">{fishMarketCapacity(lvl).toLocaleString()}</td>
                <td className="p-2">
                  <input type="number" placeholder="—" value={overrides[lvl] ?? ""} onChange={(e) => update(lvl, e.target.value)}
                    className="w-36 px-2 py-1 rounded bg-slate-800 border border-slate-700" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClientItemPricesTable() {
  const [rows, setRows] = useState<CipRow[]>([]);
  const [form, setForm] = useState<Partial<CipRow>>({ item_id: "", item_type: "background", price_coins: 0, price_gems: 0 });
  const load = async () => {
    const { data } = await supabase.from("client_item_prices").select("*").order("item_type");
    setRows((data ?? []) as CipRow[]);
  };
  useEffect(() => { load(); }, []);
  const save = async () => {
    if (!form.item_id?.trim() || !form.item_type?.trim()) return;
    await supabase.from("client_item_prices").upsert({
      item_id: form.item_id.trim(),
      item_type: form.item_type.trim(),
      price_coins: form.price_coins ?? 0,
      price_gems: form.price_gems ?? 0,
    } as never);
    setForm({ item_id: "", item_type: form.item_type, price_coins: 0, price_gems: 0 });
    load();
  };
  const del = async (item_id: string, item_type: string) => {
    if (!confirm("حذف؟")) return;
    await supabase.from("client_item_prices").delete().eq("item_id", item_id).eq("item_type", item_type);
    load();
  };

  return (
    <div className="grid md:grid-cols-[1fr_320px] gap-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-800/60"><tr>
            <th className="p-2 text-right">المعرّف</th>
            <th className="p-2 text-right">النوع</th>
            <th className="p-2 text-right">🪙</th>
            <th className="p-2 text-right">💎</th>
            <th className="p-2 text-right">⚙️</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.item_type}-${r.item_id}`} className="border-t border-slate-800/50">
                <td className="p-2 font-mono">{r.item_id}</td>
                <td className="p-2 text-slate-400">{r.item_type}</td>
                <td className="p-2">{r.price_coins}</td>
                <td className="p-2">{r.price_gems}</td>
                <td className="p-2"><div className="flex gap-2">
                  <button onClick={() => setForm(r)} className="text-indigo-300">تعديل</button>
                  <button onClick={() => del(r.item_id, r.item_type)} className="text-red-400">حذف</button>
                </div></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-500">لا توجد أسعار مخصّصة</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3 h-fit">
        <h3 className="font-semibold">إضافة / تعديل سعر</h3>
        <Field label="المعرّف (item_id)"><input className={inp} value={form.item_id ?? ""} onChange={(e) => setForm({ ...form, item_id: e.target.value })} /></Field>
        <Field label="النوع (item_type)">
          <select className={inp} value={form.item_type ?? "background"} onChange={(e) => setForm({ ...form, item_type: e.target.value })}>
            <option value="background">background</option>
            <option value="frame">frame</option>
            <option value="avatar">avatar</option>
            <option value="ship">ship</option>
            <option value="other">other</option>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="🪙"><input type="number" className={inp} value={form.price_coins ?? 0} onChange={(e) => setForm({ ...form, price_coins: Number(e.target.value) })} /></Field>
          <Field label="💎"><input type="number" className={inp} value={form.price_gems ?? 0} onChange={(e) => setForm({ ...form, price_gems: Number(e.target.value) })} /></Field>
        </div>
        <button onClick={save} className="w-full px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold">حفظ</button>
      </div>
    </div>
  );
}
