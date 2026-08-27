import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FISH, COMBO_FISH_IDS } from "@/lib/fish";

export const Route = createFileRoute("/admin/fleet-combos")({
  component: AdminFleetCombos,
  ssr: false,
  head: () => ({ meta: [{ title: "خلطات السفن — Admin" }] }),
});

type ShipCat = { code: string; name: string; sort_order: number };
type Combo = {
  id: string;
  name: string;
  fish_id: string;
  qty: number;
  chance_pct: number;
  cooldown_minutes: number;
  active: boolean;
  ships: string[];
  claims?: number;
};

const emptyDraft = { name: "", fish_id: COMBO_FISH_IDS[0] as string, qty: 5, chance_pct: 100, cooldown_minutes: 0, ships: ["", "", ""] };

function AdminFleetCombos() {
  const [cats, setCats] = useState<ShipCat[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [draft, setDraft] = useState({ ...emptyDraft });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [{ data: cat }, { data: rows }, { data: ships }, { data: claims }] = await Promise.all([
      supabase.from("ship_catalog").select("code, name, sort_order").eq("active", true).order("sort_order"),
      supabase.from("fleet_combos").select("*").order("created_at", { ascending: false }),
      supabase.from("fleet_combo_ships").select("combo_id, catalog_code, slot").order("slot"),
      supabase.from("fleet_combo_claims").select("combo_id"),
    ]);
    setCats((cat ?? []) as ShipCat[]);
    const byCombo = new Map<string, string[]>();
    (ships ?? []).forEach((s: any) => {
      const arr = byCombo.get(s.combo_id) ?? [];
      arr.push(s.catalog_code);
      byCombo.set(s.combo_id, arr);
    });
    const counts = new Map<string, number>();
    (claims ?? []).forEach((c: any) => counts.set(c.combo_id, (counts.get(c.combo_id) ?? 0) + 1));
    setCombos(((rows ?? []) as any[]).map((r) => ({ ...r, ships: byCombo.get(r.id) ?? [], claims: counts.get(r.id) ?? 0 })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const create = async () => {
    setMsg(null);
    const ships = draft.ships.filter(Boolean);
    if (!draft.name.trim()) return setMsg("اكتب اسم الوصفة");
    if (ships.length !== 3) return setMsg("اختر 3 سفن");
    if (new Set(ships).size !== 3) return setMsg("لا تكرر نفس السفينة");
    setBusy(true);
    const { data, error } = await supabase
      .from("fleet_combos")
      .insert({
        name: draft.name.trim(),
        fish_id: draft.fish_id,
        qty: Math.max(1, Number(draft.qty) || 1),
        chance_pct: Math.min(100, Math.max(1, Number(draft.chance_pct) || 100)),
        cooldown_minutes: Math.max(0, Number(draft.cooldown_minutes) || 0),
      })
      .select("id")
      .single();
    if (error || !data) { setBusy(false); return setMsg(error?.message ?? "فشل الإنشاء"); }
    const { error: e2 } = await supabase
      .from("fleet_combo_ships")
      .insert(ships.map((code, i) => ({ combo_id: data.id, catalog_code: code, slot: i + 1 })));
    setBusy(false);
    if (e2) return setMsg(e2.message);
    setDraft({ ...emptyDraft });
    setMsg("✓ تم إنشاء الوصفة");
    await load();
  };

  const toggle = async (c: Combo) => {
    await supabase.from("fleet_combos").update({ active: !c.active }).eq("id", c.id);
    await load();
  };

  const remove = async (c: Combo) => {
    if (!confirm(`حذف «${c.name}» نهائيًا؟`)) return;
    await supabase.from("fleet_combos").delete().eq("id", c.id);
    await load();
  };

  const patch = async (c: Combo, field: "qty" | "chance_pct" | "cooldown_minutes", value: number) => {
    await supabase.from("fleet_combos").update({ [field]: value }).eq("id", c.id);
    await load();
  };

  const shipName = (code: string) => cats.find((c) => c.code === code)?.name ?? code;

  if (loading) return <div className="p-6 text-slate-300">جاري التحميل...</div>;

  return (
    <div dir="rtl" className="p-3 md:p-6 max-w-4xl mx-auto">
      <h1 className="text-xl md:text-2xl font-bold">🌟 خلطات السفن</h1>
      <p className="text-xs text-slate-400 mt-1 mb-4">
        اختر سمكة حصرية و3 سفن — إذا كانت السفن الثلاث في البحر تصيد وأكمل اللاعب الرحلة، يحصل على السمكة الحصرية.
      </p>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-3">
        <div className="text-sm font-bold text-slate-100">وصفة جديدة</div>
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="اسم الوصفة"
          className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-sm"
        />
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-400">السمكة الناتجة</span>
            <select
              value={draft.fish_id}
              onChange={(e) => setDraft({ ...draft, fish_id: e.target.value })}
              className="px-2 py-2 rounded-md bg-slate-800 border border-slate-700 text-sm"
            >
              {COMBO_FISH_IDS.map((id) => (
                <option key={id} value={id}>{FISH[id]?.name ?? id}</option>
              ))}
            </select>
          </label>
          <Num label="الكمية" value={draft.qty} onChange={(v) => setDraft({ ...draft, qty: v })} />
          <Num label="الاحتمالية %" value={draft.chance_pct} onChange={(v) => setDraft({ ...draft, chance_pct: v })} />
          <Num label="تبريد (دقائق)" value={draft.cooldown_minutes} onChange={(v) => setDraft({ ...draft, cooldown_minutes: v })} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <label key={i} className="flex flex-col gap-1">
              <span className="text-[10px] text-slate-400">السفينة {i + 1}</span>
              <select
                value={draft.ships[i]}
                onChange={(e) => {
                  const s = [...draft.ships];
                  s[i] = e.target.value;
                  setDraft({ ...draft, ships: s });
                }}
                className="px-2 py-2 rounded-md bg-slate-800 border border-slate-700 text-sm"
              >
                <option value="">— اختر —</option>
                {cats.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {msg && <div className="text-xs text-amber-300">{msg}</div>}
        <button
          onClick={create}
          disabled={busy}
          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-bold disabled:opacity-50"
        >
          {busy ? "..." : "إنشاء الوصفة"}
        </button>
      </section>

      <div className="mt-5 space-y-3">
        {combos.length === 0 && <div className="text-xs text-slate-500">لا توجد وصفات بعد.</div>}
        {combos.map((c) => (
          <section key={c.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <div className="flex items-center gap-3">
              <img src={FISH[c.fish_id]?.img ?? ""} alt={FISH[c.fish_id]?.name ?? c.fish_id} loading="lazy" className="w-12 h-12 object-contain" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-100">{c.name}</div>
                <div className="text-[11px] text-slate-400">
                  {FISH[c.fish_id]?.name ?? c.fish_id} × {c.qty} — {c.chance_pct}% — تفعّلت {c.claims} مرة
                </div>
              </div>
              <button onClick={() => toggle(c)} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${c.active ? "bg-emerald-700" : "bg-slate-700"}`}>
                {c.active ? "مفعّلة" : "معطّلة"}
              </button>
              <button onClick={() => remove(c)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-800">حذف</button>
            </div>
            <div className="mt-2 text-[11px] text-slate-300">🚢 {c.ships.map(shipName).join(" + ") || "بدون سفن!"}</div>
            <div className="mt-2 flex flex-wrap gap-3">
              <Num label="الكمية" value={c.qty} onChange={(v) => patch(c, "qty", Math.max(1, v))} />
              <Num label="الاحتمالية %" value={c.chance_pct} onChange={(v) => patch(c, "chance_pct", Math.min(100, Math.max(1, v)))} />
              <Num label="تبريد (دقائق)" value={c.cooldown_minutes} onChange={(v) => patch(c, "cooldown_minutes", Math.max(0, v))} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => { setLocal(String(value)); }, [value]);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-slate-400">{label}</span>
      <input
        type="number"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { const n = Number(local); if (Number.isFinite(n) && n !== value) onChange(n); }}
        className="w-24 px-2 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-sm text-slate-100"
      />
    </label>
  );
}
