import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FISH_LIST, FISH } from "@/lib/fish";
import { SHIPS, PHOENIX_SHIP, SUBMARINE_SHIP } from "@/lib/ships";
import { WEAPONS } from "@/lib/weapons";
import { CREWS } from "@/lib/crews";
import { AVATAR_FRAMES, NAME_FRAMES, BUBBLE_FRAMES, PROFILE_FRAMES } from "@/lib/frames";
import { BACKGROUNDS } from "@/lib/backgrounds";
import { DurationPicker, formatTimeLeft } from "@/components/admin/DurationPicker";

export const Route = createFileRoute("/admin/competitions")({
  component: AdminCompetitions,
  ssr: false,
  head: () => ({ meta: [{ title: "الفعاليات — Admin" }] }),
});

type PrizeItem = { type: string; code: string; qty: number };
type PrizeTier = {
  rank: number;
  coins: number;
  gems: number;
  rubies: number;
  xp: number;
  text: string;
  items: PrizeItem[];
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
  
  prizes_distributed_at: string | null;
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
  r === 1 ? "🥇 الأول" : r === 2 ? "🥈 الثاني" : r === 3 ? "🥉 الثالث" : `#${r}`;

// Available item types + their catalog source for prize selection
const ITEM_TYPES: { id: string; label: string; options: { code: string; name: string }[] }[] = [
  { id: "ship", label: "🚢 سفينة", options: [...SHIPS, PHOENIX_SHIP, SUBMARINE_SHIP].map(s => ({ code: s.code, name: `${s.name} (${s.code})` })) },
  { id: "fish", label: "🐟 سمكة", options: FISH_LIST.map(f => ({ code: f.id, name: f.name })) },
  { id: "weapon", label: "🚀 سلاح", options: WEAPONS.map(w => ({ code: w.id, name: `${w.emoji} ${w.name}` })) },
  { id: "crew", label: "👥 طاقم", options: CREWS.map(c => ({ code: c.id, name: `${c.emoji} ${c.name}` })) },
  { id: "frame", label: "🖼️ إطار صورة", options: AVATAR_FRAMES.map(f => ({ code: f.id, name: f.name })) },
  { id: "name_frame", label: "✨ إطار اسم", options: NAME_FRAMES.map(f => ({ code: f.id, name: f.name })) },
  { id: "bubble_frame", label: "💬 إطار فقاعة", options: BUBBLE_FRAMES.map(f => ({ code: f.id, name: f.name })) },
  { id: "profile_frame", label: "🪪 إطار بروفايل", options: PROFILE_FRAMES.map(f => ({ code: f.id, name: f.name })) },
  { id: "background", label: "🌅 خلفية", options: BACKGROUNDS.map(b => ({ code: b.id, name: b.name })) },
];

function emptyTier(rank: number): PrizeTier {
  return { rank, coins: 0, gems: 0, rubies: 0, xp: 0, text: "", items: [] };
}

function normalizeTier(t: Partial<PrizeTier> & { rank?: number }, idx: number): PrizeTier {
  return {
    rank: t.rank ?? idx + 1,
    coins: t.coins ?? 0,
    gems: t.gems ?? 0,
    rubies: t.rubies ?? 0,
    xp: t.xp ?? 0,
    text: t.text ?? "",
    items: Array.isArray(t.items) ? t.items.map(it => ({ type: it.type, code: it.code, qty: Math.max(1, it.qty | 0) })) : [],
  };
}

type LbRow = {
  user_id: string;
  display_name: string;
  avatar_emoji: string;
  avatar_url: string | null;
  level: number;
  score: number;
};

// ---------- Tier editor (shared between create + edit) ----------
function TierEditor({ tiers, setTiers }: { tiers: PrizeTier[]; setTiers: (next: PrizeTier[]) => void }) {
  const update = (i: number, patch: Partial<PrizeTier>) =>
    setTiers(tiers.map((x, j) => j === i ? { ...x, ...patch } : x));
  const add = () => setTiers([...tiers, emptyTier(tiers.length + 1)]);
  const remove = (i: number) => setTiers(tiers.filter((_, j) => j !== i).map((x, j) => ({ ...x, rank: j + 1 })));
  const addItem = (i: number, type: string) => {
    const def = ITEM_TYPES.find(t => t.id === type);
    if (!def || def.options.length === 0) return;
    update(i, { items: [...tiers[i].items, { type, code: def.options[0].code, qty: 1 }] });
  };
  const updItem = (i: number, ix: number, patch: Partial<PrizeItem>) => {
    const items = tiers[i].items.map((it, k) => k === ix ? { ...it, ...patch } : it);
    update(i, { items });
  };
  const delItem = (i: number, ix: number) => update(i, { items: tiers[i].items.filter((_, k) => k !== ix) });

  return (
    <div className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-950/20 to-slate-950/60 p-3 md:p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-amber-200">🏅 جوائز المراتب</h3>
        <button type="button" onClick={add} className="text-xs px-3 py-1.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-200 hover:bg-amber-500/30">
          + إضافة مرتبة
        </button>
      </div>

      {tiers.map((t, i) => (
        <div key={i} className="rounded-lg border border-slate-700/60 bg-slate-950/50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-bold text-sm text-amber-300">{RANK_LABEL(i + 1)}</div>
            {tiers.length > 1 && (
              <button type="button" onClick={() => remove(i)} className="text-xs px-2 py-1 rounded bg-red-900/40 hover:bg-red-900/60 text-red-200">حذف</button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <label className="block">
              <span className="text-[11px] text-slate-400">🪙 عملات</span>
              <input type="number" value={t.coins} onChange={e=>update(i,{coins:+e.target.value})} className="w-full mt-1 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"/>
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-400">💎 جواهر</span>
              <input type="number" value={t.gems} onChange={e=>update(i,{gems:+e.target.value})} className="w-full mt-1 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"/>
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-400">❤️ ياقوت</span>
              <input type="number" value={t.rubies} onChange={e=>update(i,{rubies:+e.target.value})} className="w-full mt-1 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"/>
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-400">⭐ XP</span>
              <input type="number" value={t.xp} onChange={e=>update(i,{xp:+e.target.value})} className="w-full mt-1 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"/>
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-400">🎁 نص</span>
              <input value={t.text} onChange={e=>update(i,{text:e.target.value})} placeholder="مثلاً: لقب البطل" className="w-full mt-1 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"/>
            </label>
          </div>

          {/* Items list */}
          <div className="space-y-1.5 pt-1">
            <div className="text-[11px] text-slate-400">🎁 منتجات إضافية (سفن، أسماك، أسلحة، إطارات، خلفيات…)</div>
            {t.items.map((it, ix) => {
              const def = ITEM_TYPES.find(d => d.id === it.type);
              return (
                <div key={ix} className="flex flex-wrap items-center gap-1.5 p-1.5 rounded bg-slate-900/80 border border-slate-800">
                  <select value={it.type} onChange={e=>{
                    const newType = e.target.value;
                    const ndef = ITEM_TYPES.find(d => d.id === newType);
                    updItem(i, ix, { type: newType, code: ndef?.options[0]?.code ?? "" });
                  }} className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-xs">
                    {ITEM_TYPES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                  <select value={it.code} onChange={e=>updItem(i,ix,{code:e.target.value})} className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-xs flex-1 min-w-[140px]">
                    {def?.options.map(o => <option key={o.code} value={o.code}>{o.name}</option>)}
                  </select>
                  <input type="number" min={1} value={it.qty} onChange={e=>updItem(i,ix,{qty: Math.max(1, +e.target.value || 1)})} className="w-16 px-2 py-1 rounded bg-slate-800 border border-slate-700 text-xs text-center"/>
                  <button type="button" onClick={()=>delItem(i,ix)} className="text-xs px-2 py-1 rounded bg-red-900/40 hover:bg-red-900/60 text-red-200">×</button>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {ITEM_TYPES.map(d => (
                <button key={d.id} type="button" onClick={()=>addItem(i, d.id)} className="text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700">
                  + {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Edit existing competition modal ----------
function EditCompetition({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const toLocal = (iso: string) => {
    const d = new Date(iso);
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
  };
  const [title, setTitle] = useState(row.title);
  const [desc, setDesc] = useState(row.description);
  const [emoji, setEmoji] = useState(row.banner_emoji);
  const [bannerText, setBannerText] = useState(row.banner_text);
  const [theme, setTheme] = useState(row.banner_theme);
  const [hideTarget, setHideTarget] = useState(row.hide_target);
  const [startsAt, setStartsAt] = useState(toLocal(row.starts_at));
  const [endsAt, setEndsAt] = useState(toLocal(row.ends_at));
  const initialTiers = useMemo<PrizeTier[]>(() => {
    const arr = Array.isArray(row.prize_tiers) && row.prize_tiers.length > 0
      ? row.prize_tiers
      : [{ rank: 1, coins: row.reward_coins, gems: row.reward_gems, rubies: 0, xp: row.reward_xp, text: row.reward_text, items: [] }];
    return arr.map(normalizeTier);
  }, [row]);
  const [tiers, setTiers] = useState<PrizeTier[]>(initialTiers);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    const starts = new Date(startsAt);
    const ends = new Date(endsAt);
    if (isNaN(starts.getTime()) || isNaN(ends.getTime()) || ends <= starts) {
      setMsg("تواريخ غير صحيحة"); return;
    }
    setSaving(true);
    setMsg(null);
    const cleanTiers = tiers.map((t, i) => ({
      rank: i + 1,
      coins: Math.max(0, t.coins | 0),
      gems: Math.max(0, t.gems | 0),
      rubies: Math.max(0, t.rubies | 0),
      xp: Math.max(0, t.xp | 0),
      text: (t.text || "").trim(),
      items: t.items.filter(it => it.type && it.code).map(it => ({ type: it.type, code: it.code, qty: Math.max(1, it.qty | 0) })),
    }));
    const first = cleanTiers[0] ?? { coins: 0, gems: 0, xp: 0, text: "" };
    const { error } = await supabase
      .from("competitions" as never)
      .update({
        title: title.trim() || row.title,
        description: desc.trim(),
        banner_emoji: emoji || "🏆",
        banner_text: bannerText.trim(),
        banner_theme: theme,
        hide_target: hideTarget,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        prize_tiers: cleanTiers,
        reward_coins: first.coins,
        reward_gems: first.gems,
        reward_xp: first.xp,
        reward_text: first.text,
      } as never)
      .eq("id", row.id);
    setSaving(false);
    if (error) { setMsg("خطأ: " + error.message); return; }
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start md:items-center justify-center p-2 md:p-6 overflow-y-auto" dir="rtl">
      <div className="w-full max-w-3xl bg-slate-900 border border-amber-500/40 rounded-2xl p-4 md:p-5 space-y-4 my-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-amber-300">✏️ تعديل الفعالية</h2>
          <button onClick={onClose} className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-sm">إغلاق</button>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-slate-400">العنوان</span>
            <input value={title} onChange={e=>setTitle(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700"/>
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">نص البانر</span>
            <input value={bannerText} onChange={e=>setBannerText(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700"/>
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-slate-400">الوصف</span>
          <textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={2} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700"/>
        </label>
        <div className="grid md:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs text-slate-400">إيموجي</span>
            <input value={emoji} onChange={e=>setEmoji(e.target.value)} maxLength={4} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-2xl text-center"/>
          </label>
          <label className="block md:col-span-2">
            <span className="text-xs text-slate-400">الشكل</span>
            <select value={theme} onChange={e=>setTheme(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">
              {THEMES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-slate-400">يبدأ في</span>
            <input type="datetime-local" value={startsAt} onChange={e=>setStartsAt(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700"/>
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">ينتهي في</span>
            <input type="datetime-local" value={endsAt} onChange={e=>setEndsAt(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700"/>
          </label>
        </div>

        {row.metric === "fish_specific" && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={hideTarget} onChange={e=>setHideTarget(e.target.checked)} className="w-5 h-5"/>
            <span className="text-sm">إخفاء نوع السمك (مفاجأة 🤫)</span>
          </label>
        )}

        <TierEditor tiers={tiers} setTiers={setTiers}/>

        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving} className="px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold disabled:opacity-50">
            {saving ? "جاري الحفظ..." : "💾 حفظ التعديلات"}
          </button>
          {msg && <span className="text-sm text-amber-300">{msg}</span>}
        </div>
        <p className="text-[11px] text-slate-500">
          ✓ يمكنك تعديل الوقت والجوائز حتى لو كانت الفعالية باديه — المشاركون لن يتأثروا، ستوزع الجوائز حسب القيم الحالية عند الانتهاء.
        </p>
      </div>
    </div>
  );
}

// ---------- Main page ----------
function AdminCompetitions() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [boards, setBoards] = useState<Record<string, LbRow[]>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

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

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel("admin-competition-leaderboard-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "competition_catches" },
        () => {
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => { void load(); }, 250);
        },
      )
      .subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, []);

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
      rubies: Math.max(0, t.rubies | 0),
      xp: Math.max(0, t.xp | 0),
      text: t.text.trim(),
      items: t.items.filter(it => it.type && it.code).map(it => ({ type: it.type, code: it.code, qty: Math.max(1, it.qty | 0) })),
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
  const distributeNow = async (id: string) => {
    if (!confirm("توزيع الجوائز فوراً وإقفال الفعالية؟ لا يمكن التراجع.")) return;
    const { error } = await (supabase as any).rpc("finalize_competition", { _competition_id: id });
    if (error) { alert("خطأ: " + error.message); return; }
    alert("✓ تم توزيع الجوائز");
    load();
  };



  const editingRow = rows.find(r => r.id === editingId) ?? null;

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

        <TierEditor tiers={tiers} setTiers={setTiers}/>

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
            ? r.prize_tiers.map(normalizeTier)
            : [normalizeTier({ rank: 1, coins: r.reward_coins, gems: r.reward_gems, xp: r.reward_xp, text: r.reward_text }, 0)];
          const board = boards[r.id] ?? [];
          return (
            <div key={r.id} className="rounded-xl border border-slate-700 bg-slate-900 p-4">
              <div className="flex items-start gap-3">
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
                    {rowTiers.map((t, i) => {
                      const itemSummary = (t.items ?? []).map(it => {
                        const def = ITEM_TYPES.find(d => d.id === it.type);
                        const opt = def?.options.find(o => o.code === it.code);
                        return `${opt?.name ?? it.code}×${it.qty}`;
                      }).join(" · ");
                      return (
                        <div key={i}>
                          <b>{RANK_LABEL(t.rank ?? i + 1)}:</b> 🪙 {t.coins} · 💎 {t.gems}{t.rubies ? ` · ❤️ ${t.rubies}` : ""} · ⭐ {t.xp}{t.text ? ` · ${t.text}` : ""}{itemSummary ? ` · 🎁 ${itemSummary}` : ""}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <button onClick={()=>setEditingId(r.id)} className="text-xs px-2.5 py-1.5 rounded bg-amber-700/60 hover:bg-amber-700/80 text-amber-100">✏️ تعديل</button>
                  <button onClick={()=>toggle(r.id, r.active)} className="text-xs px-2.5 py-1.5 rounded bg-slate-700 hover:bg-slate-600">
                    {r.active ? "تعطيل" : "تفعيل"}
                  </button>
                  {!r.prizes_distributed_at && (
                    <button onClick={()=>distributeNow(r.id)} className="text-xs px-2.5 py-1.5 rounded bg-emerald-700/60 hover:bg-emerald-700/80 text-emerald-100">⚡ توزيع الجوائز الآن</button>
                  )}
                  {r.prizes_distributed_at && (
                    <span className="text-[10px] px-2 py-1 rounded bg-emerald-900/40 text-emerald-300 text-center">✓ وُزِّعت الجوائز</span>
                  )}
                  <button onClick={()=>remove(r.id)} className="text-xs px-2.5 py-1.5 rounded bg-red-900/50 hover:bg-red-900/70 text-red-200">حذف</button>
                </div>
              </div>


              <div className="mt-3 pt-3 border-t border-slate-800">
                <div className="text-xs font-bold text-slate-300 mb-2">🏅 الترتيب الحالي</div>
                {board.length === 0 ? (
                  <div className="text-xs text-slate-500 py-2">لا توجد نقاط مسجلة بعد.</div>
                ) : (
                  <ol className="space-y-1">
                    {board.map((p, i) => {
                      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i+1}`;
                      return (
                        <li key={p.user_id} className="flex items-center gap-2 px-2 py-1 rounded bg-slate-950/60 border border-slate-800">
                          <span className="w-8 text-center text-xs font-black">{medal}</span>
                          {p.avatar_url ? (
                            <img src={p.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover"/>
                          ) : (
                            <span className="text-base">{p.avatar_emoji || "🧑‍✈️"}</span>
                          )}
                          <span className="flex-1 truncate text-xs">{p.display_name || "—"}</span>
                          <span className="text-xs font-black text-amber-300">{p.score?.toLocaleString?.() ?? p.score}</span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {editingRow && (
        <EditCompetition row={editingRow} onClose={()=>setEditingId(null)} onSaved={load}/>
      )}
    </div>
  );
}
