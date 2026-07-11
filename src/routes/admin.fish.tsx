import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getShipByMarketLevel } from "@/lib/ships";
import { FISH } from "@/lib/fish";

export const Route = createFileRoute("/admin/fish")({
  component: AdminFishPrices,
  ssr: false,
  head: () => ({ meta: [{ title: "أسعار السمك — Admin" }] }),
});

type Setting = {
  fish_id: string;
  min_price: number;
  max_price: number;
  max_hourly_change: number;
};

type Row = {
  fish_id: string;
  min_price: string;
  max_price: string;
  max_hourly_change: string;
  saving?: boolean;
  saved?: boolean;
  error?: string;
  dirty?: boolean;
};

const SHIP_LEVELS = Array.from({ length: 36 }, (_, i) => i + 1);

function AdminFishPrices() {
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: settings }, { data: live }] = await Promise.all([
        supabase.from("fish_price_settings").select("*"),
        supabase.from("fish_market_prices").select("fish_id, min_price, max_price"),
      ]);
      const map: Record<string, Row> = {};
      const live_map = new Map((live ?? []).map((r: any) => [r.fish_id, r]));
      const set_map = new Map(((settings ?? []) as Setting[]).map((r) => [r.fish_id, r]));
      Object.values(FISH).forEach((f) => {
        const s = set_map.get(f.id);
        const l = live_map.get(f.id) as any;
        map[f.id] = {
          fish_id: f.id,
          min_price: s ? String(s.min_price) : l ? String(l.min_price) : String(f.price),
          max_price: s ? String(s.max_price) : l ? String(l.max_price) : String(f.price * 2),
          max_hourly_change: s ? String(s.max_hourly_change) : "1",
        };
      });
      setRows(map);
      setLoading(false);
    })();
  }, []);

  const update = (id: string, key: keyof Row, val: string) => {
    setRows((p) => ({ ...p, [id]: { ...p[id], [key]: val, dirty: true, saved: false, error: undefined } }));
  };

  const save = async (id: string) => {
    const r = rows[id];
    const min = Number(r.min_price);
    const max = Number(r.max_price);
    const hc = Number(r.max_hourly_change);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(hc) || min < 0 || max < min || hc < 0) {
      setRows((p) => ({ ...p, [id]: { ...p[id], error: "قيم غير صحيحة" } }));
      return;
    }
    setRows((p) => ({ ...p, [id]: { ...p[id], saving: true, error: undefined } }));
    const { error } = await supabase
      .from("fish_price_settings")
      .upsert({ fish_id: id, min_price: min, max_price: max, max_hourly_change: hc, updated_at: new Date().toISOString() });
    setRows((p) => ({
      ...p,
      [id]: { ...p[id], saving: false, saved: !error, dirty: false, error: error?.message },
    }));
  };

  const recomputeNow = async () => {
    setRecomputing(true);
    await (supabase as any).rpc("recompute_fish_prices");
    setRecomputing(false);
  };

  const shipBlocks = useMemo(() => {
    const seen = new Set<string>();
    return SHIP_LEVELS.map((lvl) => {
      const ship = getShipByMarketLevel(lvl);
      const fishIds = (ship.fishPool ?? []).filter((id) => FISH[id] && !seen.has(id));
      fishIds.forEach((id) => seen.add(id));
      return { lvl, ship, fishIds };
    }).filter((b) => b.fishIds.length > 0);
  }, []);

  if (loading) return <div className="p-6 text-slate-300">جاري التحميل...</div>;

  return (
    <div dir="rtl" className="p-3 md:p-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">أسعار السمك</h1>
          <p className="text-xs text-slate-400 mt-1">
            عدّل الحد الأدنى والأقصى لكل سمكة، وكم يقدر السعر يرتفع أو ينزل في الساعة الواحدة.
          </p>
        </div>
        <button
          onClick={recomputeNow}
          disabled={recomputing}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium disabled:opacity-50"
        >
          {recomputing ? "..." : "🔄 إعادة حساب الأسعار الآن"}
        </button>
      </div>

      <div className="space-y-5">
        {shipBlocks.map(({ lvl, ship, fishIds }) => (
          <section key={lvl} className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
            <header className="flex items-center gap-3 p-3 border-b border-slate-800 bg-slate-900">
              <img
                src={ship.image}
                alt={ship.name}
                className="w-16 h-16 object-contain shrink-0"
                style={{ filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.5))" }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-100">المستوى {lvl} — {ship.name}</div>
                <div className="text-[11px] text-slate-400">{ship.rarity}</div>
              </div>
            </header>
            <div className="divide-y divide-slate-800">
              {fishIds.map((fid) => {
                const f = FISH[fid];
                const r = rows[fid];
                if (!r) return null;
                return (
                  <div key={fid} className="p-3 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 min-w-[140px]">
                      <img src={f.img} alt={f.name} className="w-10 h-10 object-contain" />
                      <div>
                        <div className="text-sm font-medium text-slate-100">{f.name}</div>
                        <div className="text-[10px] text-slate-500">{fid}</div>
                      </div>
                    </div>
                    <NumField label="الحد الأدنى" value={r.min_price} onChange={(v) => update(fid, "min_price", v)} />
                    <NumField label="الحد الأقصى" value={r.max_price} onChange={(v) => update(fid, "max_price", v)} />
                    <NumField label="حد التغير/ساعة" value={r.max_hourly_change} onChange={(v) => update(fid, "max_hourly_change", v)} />
                    <button
                      onClick={() => save(fid)}
                      disabled={r.saving || !r.dirty}
                      className={`px-3 py-2 rounded-lg text-xs font-bold ${
                        r.dirty
                          ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                          : r.saved
                            ? "bg-emerald-900/40 text-emerald-300"
                            : "bg-slate-800 text-slate-400"
                      } disabled:opacity-60`}
                    >
                      {r.saving ? "..." : r.saved && !r.dirty ? "✓ محفوظ" : "حفظ"}
                    </button>
                    {r.error && <span className="text-[10px] text-rose-300">{r.error}</span>}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-slate-400">{label}</span>
      <input
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 px-2 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
      />
    </label>
  );
}
