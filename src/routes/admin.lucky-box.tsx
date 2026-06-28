import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logAudit } from "@/hooks/use-admin";

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
const DRAGON_SLOTS = ["weapon", "armor", "talisman"] as const;
const DRAGON_RARITIES = ["common", "rare", "epic", "legendary", "divine", "fatak"] as const;

function AdminLuckyBox() {
  const [settings, setSettings] = useState<Settings>({
    enabled: true, cost_gems: 300, pct_common: 80, pct_rare: 18, pct_legendary: 2,
  });
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [recent, setRecent] = useState<Array<{ id: string; label: string; rarity: Rarity; created_at: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

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
    setPrizes((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    const { error } = await supabase.from("lucky_box_prizes").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
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

      {/* Prize buckets */}
      {(["legendary", "rare", "common"] as Rarity[]).map((rar) => {
        const meta = RARITY_META[rar];
        const list = prizes.filter((p) => p.rarity === rar);
        return (
          <section key={rar} className={`rounded-xl border ${meta.ring} ${meta.color} p-4`}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-bold text-base">
                  {rar === "legendary" ? "🔴🔥" : rar === "rare" ? "🔵" : "✨"} جوائز {meta.ar}
                </div>
                <div className="text-xs text-slate-400">{list.length} جائزة · يُسحب منها بالوزن</div>
              </div>
              <button onClick={() => addPrize(rar)}
                className="text-xs px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600">
                + إضافة
              </button>
            </div>
            <div className="space-y-2">
              {list.length === 0 && <div className="text-slate-500 text-sm">لا توجد جوائز في هذه الخانة بعد.</div>}
              {list.map((p) => (
                <PrizeRow key={p.id} prize={p} onChange={(patch) => updatePrize(p.id, patch)} onDelete={() => deletePrize(p.id)} />
              ))}
            </div>
          </section>
        );
      })}

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
  prize, onChange, onDelete,
}: {
  prize: Prize;
  onChange: (patch: Partial<Prize>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-lg bg-slate-900/60 border border-slate-800 p-2 grid grid-cols-12 gap-2 items-center">
      <input className="col-span-3 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"
        value={prize.label} placeholder="اسم الجائزة"
        onChange={(e) => onChange({ label: e.target.value })} />
      <input className="col-span-1 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm text-center"
        value={prize.icon} maxLength={4}
        onChange={(e) => onChange({ icon: e.target.value })} />
      <select className="col-span-2 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"
        value={prize.prize_type}
        onChange={(e) => onChange({ prize_type: e.target.value as PrizeType })}>
        <option value="coins">🪙 عملات</option>
        <option value="gems">💎 جواهر</option>
        <option value="rubies">❤️ ياقوت</option>
        <option value="xp">⭐ XP</option>
        <option value="item">🎒 عنصر مخزن</option>
        <option value="dragon_equipment">🐉 معدة تنين</option>
      </select>
      <input type="number" min={1}
        className="col-span-1 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"
        value={prize.amount} title="الكمية"
        onChange={(e) => onChange({ amount: Number(e.target.value) || 1 })} />
      {prize.prize_type === "item" ? (
        <>
          <select className="col-span-2 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"
            value={prize.item_type ?? ""}
            onChange={(e) => onChange({ item_type: e.target.value || null })}>
            <option value="">— نوع العنصر —</option>
            {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input className="col-span-2 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"
            value={prize.item_id ?? ""} placeholder="معرف العنصر"
            onChange={(e) => onChange({ item_id: e.target.value || null })} />
        </>
      ) : prize.prize_type === "dragon_equipment" ? (
        <>
          <select className="col-span-2 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"
            value={prize.item_type ?? ""}
            onChange={(e) => onChange({ item_type: e.target.value || null })}>
            <option value="">— الخانة —</option>
            {DRAGON_SLOTS.map((s) => <option key={s} value={s}>{s === "weapon" ? "سلاح" : s === "armor" ? "درع" : "تميمة"}</option>)}
          </select>
          <select className="col-span-2 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm"
            value={prize.item_id ?? ""}
            onChange={(e) => onChange({ item_id: e.target.value || null })}>
            <option value="">— الجودة —</option>
            {DRAGON_RARITIES.map((r) => <option key={r} value={r}>
              {r === "common" ? "عادي" : r === "rare" ? "نادر" : r === "epic" ? "ملحمي" : r === "legendary" ? "أسطوري" : "خرافي"}
            </option>)}
          </select>
        </>
      ) : (
        <div className="col-span-4 text-[10px] text-slate-500 px-1">— يُضاف لرصيد اللاعب —</div>
      )}
      <input type="number" min={1}
        className="col-span-1 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm" title="الوزن"
        value={prize.weight}
        onChange={(e) => onChange({ weight: Math.max(1, Number(e.target.value) || 1) })} />
      <div className="col-span-2 flex items-center justify-end gap-1">
        <label className="inline-flex items-center cursor-pointer">
          <input type="checkbox" className="sr-only peer" checked={prize.active}
            onChange={(e) => onChange({ active: e.target.checked })} />
          <div className="w-9 h-5 rounded-full bg-slate-700 peer-checked:bg-emerald-600 relative transition">
            <div className={`absolute top-0.5 ${prize.active ? "right-0.5" : "left-0.5"} w-4 h-4 bg-white rounded-full transition`} />
          </div>
        </label>
        <button onClick={onDelete}
          className="text-xs px-2 py-1 rounded bg-red-900/40 hover:bg-red-900/60 text-red-200">حذف</button>
      </div>
    </div>
  );
}
