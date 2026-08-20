import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logAudit } from "@/hooks/use-admin";
import { PRIZE_PRESET_GROUPS, findPreset, presetKeyFor } from "@/lib/prize-catalog";


export const Route = createFileRoute("/admin/lucky-box")({
  component: AdminLuckyBox,
  ssr: false,
});

type Rarity = "common" | "rare" | "legendary";
type PrizeType = "coins" | "gems" | "rubies" | "xp" | "item" | "dragon_equipment";
type Prize = {
  id: string;
  rarity: Rarity;
  prize_type: PrizeType;
  item_type: string | null;
  item_id: string | null;
  amount: number;
  label: string;
  icon: string;
  weight: number;
  active: boolean;
};
type Settings = {
  enabled: boolean;
  cost_gems: number;
  pct_common: number;
  pct_rare: number;
  pct_legendary: number;
};

const RARITY_META: Record<Rarity, { ar: string; color: string; ring: string }> = {
  common:    { ar: "عادية",      color: "bg-stone-700/30",  ring: "border-stone-500/40" },
  rare:      { ar: "نادرة",      color: "bg-sky-700/20",    ring: "border-sky-500/50" },
  legendary: { ar: "نادرة جدًا", color: "bg-red-700/20",    ring: "border-red-500/60" },
};
const ITEM_TYPES = [
  "crew", "weapon", "anti", "shield",
  "consumable", "decoration", "frame", "background", "name_frame", "bubble_frame", "profile_frame",
] as const;
const ITEM_TYPE_AR: Record<(typeof ITEM_TYPES)[number], string> = {
  crew: "طاقم", weapon: "سلاح", anti: "مضاد", shield: "درع",
  consumable: "مستهلك", decoration: "زينة", frame: "إطار", background: "خلفية",
  name_frame: "إطار الاسم", bubble_frame: "إطار الفقاعة", profile_frame: "إطار الملف",
};
const PRIZE_TYPE_AR: Record<PrizeType, string> = {
  coins: "🪙 عملات", gems: "💎 جواهر", rubies: "❤️ ياقوت", xp: "⭐ نقاط خبرة",
  item: "🎒 عنصر مخزن", dragon_equipment: "🐉 معدة تنين",
};
const DRAGON_SLOTS = ["weapon", "armor", "talisman"] as const;
const DRAGON_RARITIES = ["common", "rare", "epic", "legendary", "divine", "fatak"] as const;


// Mirrors the validation in open_lucky_box() so we never save a prize the
// server will later refuse to grant.
function validatePrize(p: Pick<Prize, "prize_type" | "item_type" | "item_id" | "amount">): string | null {
  if (p.prize_type === "coins" || p.prize_type === "gems" || p.prize_type === "rubies" || p.prize_type === "xp") {
    if (!p.amount || p.amount <= 0) return "الكمية يجب أن تكون أكبر من صفر";
    return null;
  }
  if (p.prize_type === "item") {
    if (!p.item_type) return "اختر نوع العنصر";
    if (!p.item_id || !p.item_id.trim()) return "أدخل معرّف العنصر";
    if (!p.amount || p.amount <= 0) return "الكمية يجب أن تكون أكبر من صفر";
    return null;
  }
  if (p.prize_type === "dragon_equipment") {
    if (!p.item_type || !(DRAGON_SLOTS as readonly string[]).includes(p.item_type)) return "اختر الخانة (سلاح/درع/تميمة)";
    if (!p.item_id || !(DRAGON_RARITIES as readonly string[]).includes(p.item_id)) return "اختر الجودة";
    return null;
  }
  return "نوع جائزة غير معروف";
}

function AdminLuckyBox() {
  const [settings, setSettings] = useState<Settings>({
    enabled: true, cost_gems: 300, pct_common: 80, pct_rare: 18, pct_legendary: 2,
  });
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [recent, setRecent] = useState<Array<{ id: string; label: string; rarity: Rarity; created_at: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Rarity>("legendary");


  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: s }, { data: p }, { data: r }] = await Promise.all([
      supabase.from("lucky_box_settings").select("*").maybeSingle(),
      supabase.from("lucky_box_prizes").select("*").order("rarity").order("weight", { ascending: false }),
      supabase.from("lucky_box_opens").select("id,label,rarity,created_at").order("created_at", { ascending: false }).limit(15),
    ]);
    if (s) setSettings({
      enabled: s.enabled, cost_gems: s.cost_gems,
      pct_common: s.pct_common, pct_rare: s.pct_rare, pct_legendary: s.pct_legendary,
    });
    setPrizes((p ?? []) as unknown as Prize[]);
    setRecent((r ?? []) as unknown as typeof recent);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const saveSettings = async () => {
    setBusy(true);
    const { error } = await supabase.from("lucky_box_settings").upsert({ id: true, ...settings, updated_at: new Date().toISOString() });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await logAudit("lucky_box_settings_update", null, settings);
    toast.success("تم حفظ الإعدادات");
  };

  const updatePrize = async (id: string, patch: Partial<Prize>) => {
    let merged: Prize | undefined;
    setPrizes((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, ...patch };
        // When the prize type changes, reset incompatible fields so the row
        // can never end up in a half-configured (invalid) state.
        if (patch.prize_type && patch.prize_type !== p.prize_type) {
          next.item_type = null;
          next.item_id = null;
          if (patch.prize_type === "dragon_equipment") next.amount = 1;
          if (patch.prize_type === "coins" && (!next.amount || next.amount <= 0)) next.amount = 1000;
        }
        // Refuse to activate an invalid prize — protect open_lucky_box.
        if (patch.active === true) {
          const err = validatePrize(next);
          if (err) {
            toast.error(`لا يمكن التفعيل: ${err}`);
            next.active = false;
          }
        }
        merged = next;
        return next;
      }),
    );
    if (!merged) return;
    const finalPatch: Partial<Prize> = {
      ...patch,
      item_type: merged.item_type,
      item_id: merged.item_id,
      amount: merged.amount,
      active: merged.active,
    };
    const { error } = await supabase
      .from("lucky_box_prizes")
      .update({ ...finalPatch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
  };

  const deletePrize = async (id: string) => {
    if (!confirm("حذف هذه الجائزة؟")) return;
    const { error } = await supabase.from("lucky_box_prizes").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setPrizes((prev) => prev.filter((p) => p.id !== id));
  };

  const addPrize = async (rarity: Rarity) => {
    const newRow = {
      rarity, prize_type: "coins" as PrizeType, amount: 1000, label: "1,000 عملة", icon: "🪙", weight: 1, active: true,
    };
    const { data, error } = await supabase.from("lucky_box_prizes").insert(newRow).select().single();
    if (error) { toast.error(error.message); return; }
    setPrizes((prev) => [...prev, data as unknown as Prize]);
  };

  if (loading) return <div className="p-6 text-slate-300">جاري التحميل…</div>;

  return (
    <div className="p-3 md:p-6 max-w-4xl space-y-6">
      <header>
        <h1 className="text-xl md:text-2xl font-bold">🎁 صندوق الحظ</h1>
        <p className="text-slate-400 text-xs md:text-sm mt-1">تحكّم بالسعر، النسب، الجوائز، وآخر الفتحات.</p>
      </header>

      {/* Settings */}
      <section className="rounded-xl border border-amber-700/40 bg-amber-900/10 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">حالة الصندوق</div>
            <div className="text-xs text-slate-400">عند الإيقاف لن يستطيع اللاعبون الفتح.</div>
          </div>
          <label className="inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={settings.enabled}
              onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} />
            <div className="w-12 h-6 rounded-full bg-slate-700 peer-checked:bg-emerald-600 relative transition">
              <div className={`absolute top-0.5 ${settings.enabled ? "right-0.5" : "left-0.5"} w-5 h-5 bg-white rounded-full transition`} />
            </div>
            <span className="ms-2 text-sm font-bold">{settings.enabled ? "تعمل" : "موقوفة"}</span>
          </label>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-slate-400">السعر (💎)</label>
            <input type="number" min={0}
              className="w-full mt-1 px-3 py-2 rounded bg-slate-800 border border-slate-700 text-sm"
              value={settings.cost_gems}
              onChange={(e) => setSettings({ ...settings, cost_gems: Number(e.target.value) || 0 })} />
          </div>
          {(["pct_common","pct_rare","pct_legendary"] as const).map((k) => (
            <div key={k}>
              <label className="text-xs text-slate-400">
                {k === "pct_common" ? "% عادية" : k === "pct_rare" ? "% نادرة" : "% نادرة جدًا"}
              </label>
              <input type="number" min={0} max={100}
                className="w-full mt-1 px-3 py-2 rounded bg-slate-800 border border-slate-700 text-sm"
                value={settings[k]}
                onChange={(e) => setSettings({ ...settings, [k]: Number(e.target.value) || 0 })} />
            </div>
          ))}
        </div>
        <div className="text-xs text-slate-400">
          المجموع الحالي للنسب: <span className="font-bold">{settings.pct_common + settings.pct_rare + settings.pct_legendary}</span>
          {" "}(لا يلزم 100% — السحب موزون نسبيًا)
        </div>
        <div className="flex justify-end">
          <button onClick={saveSettings} disabled={busy}
            className="px-5 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-bold disabled:opacity-50">
            💾 حفظ الإعدادات
          </button>
        </div>
      </section>

      {/* Prize buckets — one rarity at a time */}
      {(() => {
        const meta = RARITY_META[tab];
        const pctTotal = Math.max(1, settings.pct_common + settings.pct_rare + settings.pct_legendary);
        const rarPct = ((tab === "common" ? settings.pct_common : tab === "rare" ? settings.pct_rare : settings.pct_legendary) / pctTotal) * 100;
        const list = prizes.filter((p) => p.rarity === tab);
        const activeWeight = list.filter((p) => p.active).reduce((s, p) => s + Math.max(1, p.weight), 0) || 1;
        const chanceOf = (p: Prize) => (p.active ? (rarPct * Math.max(1, p.weight)) / activeWeight : 0);
        const sorted = [...list].sort((a, b) => chanceOf(b) - chanceOf(a));
        return (
          <section className={`rounded-xl border ${meta.ring} ${meta.color} p-4`}>
            {/* Rarity tabs */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {(["legendary", "rare", "common"] as Rarity[]).map((r) => {
                const on = r === tab;
                const n = prizes.filter((x) => x.rarity === r).length;
                return (
                  <button key={r} onClick={() => setTab(r)}
                    className={`py-2 rounded-xl text-xs font-bold border transition ${
                      on ? "bg-amber-500/20 border-amber-400/60 text-amber-100" : "bg-slate-900/60 border-slate-700 text-slate-400"
                    }`}>
                    <div>{r === "legendary" ? "🔴🔥" : r === "rare" ? "🔵" : "✨"} {RARITY_META[r].ar}</div>
                    <div className="text-[10px] opacity-70">{n} جائزة</div>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-bold text-base">جوائز {meta.ar}</div>
                <div className="text-xs text-slate-400">
                  فرصة هذه الفئة كاملة: <span className="text-amber-200 font-bold">{rarPct.toFixed(1)}%</span> · موزّعة على الجوائز المفعّلة
                </div>
              </div>
              <button onClick={() => addPrize(tab)}
                className="text-xs px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600">
                + إضافة
              </button>
            </div>
            <div className="space-y-2">
              {sorted.length === 0 && <div className="text-slate-500 text-sm">لا توجد جوائز في هذه الفئة بعد.</div>}
              {sorted.map((p) => (
                <PrizeRow key={p.id} prize={p} chance={chanceOf(p)}
                  onChange={(patch) => updatePrize(p.id, patch)} onDelete={() => deletePrize(p.id)} />
              ))}
            </div>
          </section>
        );
      })()}


      {/* Recent opens */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="font-semibold mb-3">آخر الفتحات</h2>
        <div className="space-y-1 text-sm">
          {recent.length === 0 && <div className="text-slate-500">لا توجد فتحات بعد.</div>}
          {recent.map((r) => (
            <div key={r.id} className="flex items-center justify-between border-b border-slate-800/50 py-1">
              <div className={
                r.rarity === "legendary" ? "text-red-300 font-bold"
                : r.rarity === "rare" ? "text-sky-300 font-bold" : "text-slate-300"
              }>{RARITY_META[r.rarity].ar} · {r.label}</div>
              <div className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString("ar")}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PrizeRow({
  prize, chance, onChange, onDelete,
}: {
  prize: Prize;
  chance: number;
  onChange: (patch: Partial<Prize>) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const invalidReason = validatePrize(prize);
  const isCurrency = ["coins", "gems", "rubies", "xp"].includes(prize.prize_type);
  return (
    <div className={`rounded-xl bg-slate-900/70 border ${invalidReason && prize.active ? "border-red-600/70" : "border-slate-800"} overflow-hidden`}>
      {/* Summary bar (always visible) */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 p-3 text-right hover:bg-slate-800/40"
      >
        <span className="text-xl shrink-0">{prize.icon || "🎁"}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold truncate">{prize.label || "بدون اسم"}</span>
          <span className="block text-[11px] text-slate-400 truncate">
            {PRIZE_TYPE_AR[prize.prize_type]} · {prize.amount.toLocaleString("ar-EG")}
            {!prize.active ? " · معطّلة" : ""}
            {invalidReason ? " · ناقصة الإعداد" : ""}
          </span>
        </span>
        <span className="shrink-0 text-center px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40">
          <span className="block text-sm font-black text-amber-200 tabular-nums">{chance.toFixed(1)}%</span>
          <span className="block text-[9px] text-amber-200/70">فرصة الظهور</span>
        </span>
        <span className="shrink-0 text-slate-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="p-3 pt-0 space-y-3">
          {invalidReason && (
            <div className="text-[11px] text-red-300 bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2">
              ⚠️ {invalidReason} — لن تُمنح للاعبين حتى تُكمل الإعداد.
            </div>
          )}

          {/* One-click prize picker — fills every field automatically */}
          <div>
            <label className="text-[10px] text-slate-400 block mb-1">اختر الجائزة (يعبّي كل الخانات تلقائياً)</label>
            <select
              className="w-full px-3 py-2.5 rounded-lg bg-emerald-950/50 border border-emerald-700/60 text-sm font-bold"
              value={presetKeyFor(prize)}
              onChange={(e) => {
                const preset = findPreset(e.target.value);
                if (!preset) return;
                onChange({
                  prize_type: preset.prize_type,
                  item_type: preset.item_type,
                  item_id: preset.item_id,
                  amount: preset.amount,
                  label: preset.name,
                  icon: preset.icon,
                });
              }}
            >
              <option value="">— اختر جائزة جاهزة —</option>
              {PRIZE_PRESET_GROUPS.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((p) => (
                    <option key={p.key} value={p.key}>{p.icon} {p.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="text-[10px] text-slate-500 mt-1">
              الاسم والأيقونة والمعرّف تتعبّى تلقائياً — عدّل الكمية أو الوزن فقط إذا حبيت.
            </div>
          </div>

          {/* Controls: enable + delete */}
          <div className="flex items-center justify-end gap-2">
            <label className="inline-flex items-center cursor-pointer gap-2">
              <span className="text-xs text-slate-400">{prize.active ? "مفعّلة" : "معطّلة"}</span>
              <input type="checkbox" className="sr-only peer" checked={prize.active}
                onChange={(e) => onChange({ active: e.target.checked })} />
              <div className="w-11 h-6 rounded-full bg-slate-700 peer-checked:bg-emerald-600 relative transition shrink-0">
                <div className={`absolute top-0.5 ${prize.active ? "right-0.5" : "left-0.5"} w-5 h-5 bg-white rounded-full transition`} />
              </div>
            </label>
            <button onClick={onDelete}
              className="text-xs px-3 py-2 rounded-lg bg-red-900/40 hover:bg-red-900/70 text-red-200 border border-red-900/50">حذف</button>
          </div>

          {/* Amount + weight */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">
                {prize.prize_type === "dragon_equipment" ? "عدد القطع" : isCurrency ? "الكمية" : "عدد النسخ"}
              </label>
              <input type="number" min={1}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm"
                value={prize.amount} title="الكمية"
                onChange={(e) => onChange({ amount: Number(e.target.value) || 1 })} />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">الوزن (كل ما زاد زادت الفرصة)</label>
              <input type="number" min={1}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm"
                value={prize.weight} title="الوزن"
                onChange={(e) => onChange({ weight: Math.max(1, Number(e.target.value) || 1) })} />
              <div className="text-[10px] text-amber-200/70 mt-1">فرصة ظهورها الآن: {chance.toFixed(1)}%</div>
            </div>
          </div>

          {/* Advanced (manual) — hidden by default */}
          <details className="rounded-lg border border-slate-800 bg-slate-950/40">
            <summary className="cursor-pointer text-[11px] text-slate-400 px-3 py-2">إعداد يدوي متقدم (اختياري)</summary>
            <div className="p-3 pt-0 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">اسم الجائزة</label>
                  <input className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm"
                    value={prize.label} placeholder="مثال: 50 مليون ذهب"
                    onChange={(e) => onChange({ label: e.target.value })} />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">الأيقونة</label>
                  <input className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-center"
                    value={prize.icon} maxLength={4}
                    onChange={(e) => onChange({ icon: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">نوع الجائزة</label>
                <select className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm"
                  value={prize.prize_type}
                  onChange={(e) => onChange({ prize_type: e.target.value as PrizeType })}>
                  <option value="coins">🪙 عملات</option>
                  <option value="gems">💎 جواهر</option>
                  <option value="rubies">❤️ ياقوت</option>
                  <option value="xp">⭐ نقاط خبرة</option>
                  <option value="item">🎒 عنصر مخزن</option>
                  <option value="dragon_equipment">🐉 معدة تنين</option>
                </select>
              </div>


          {/* Item-specific fields */}
          {!isCurrency && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800/60">
              {prize.prize_type === "item" ? (
                <>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">نوع العنصر</label>
                    <select className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm"
                      value={prize.item_type ?? ""}
                      onChange={(e) => onChange({ item_type: e.target.value || null })}>
                      <option value="">— اختر —</option>
                      {ITEM_TYPES.map((t) => <option key={t} value={t}>{ITEM_TYPE_AR[t]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">معرّف العنصر (كما في اللعبة)</label>
                    <input className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm"
                      value={prize.item_id ?? ""} placeholder="مثال: sailor"
                      onChange={(e) => onChange({ item_id: e.target.value || null })} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">خانة التنين</label>
                    <select className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm"
                      value={prize.item_type ?? ""}
                      onChange={(e) => onChange({ item_type: e.target.value || null })}>
                      <option value="">— اختر —</option>
                      {DRAGON_SLOTS.map((s) => <option key={s} value={s}>{s === "weapon" ? "سلاح" : s === "armor" ? "درع" : "تميمة"}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">جودة المعدة</label>
                    <select className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm"
                      value={prize.item_id ?? ""}
                      onChange={(e) => onChange({ item_id: e.target.value || null })}>
                      <option value="">— اختر —</option>
                      {DRAGON_RARITIES.map((r) => <option key={r} value={r}>
                        {r === "common" ? "عادي" : r === "rare" ? "نادر" : r === "epic" ? "ملحمي" : r === "legendary" ? "أسطوري" : r === "divine" ? "خرافي" : "فتاك"}
                      </option>)}
                    </select>
                  </div>
                </>
              )}
            </div>
          )}
            </div>
          </details>
        </div>
      )}

    </div>
  );
}

