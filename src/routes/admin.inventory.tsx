import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/inventory")({
  component: AdminInventoryPage,
  ssr: false,
  head: () => ({ meta: [{ title: "أكبر مالكي المنتجات — لوحة التحكم" }] }),
});

type Holder = {
  user_id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  avatar_emoji: string | null;
  ship_market_level: number;
  total_qty: number;
  breakdown: Array<{ item_type: string; item_id: string; qty: number }>;
};

const FILTERS: Array<{ key: string; label: string; icon: string; type: string | null; id: string | null }> = [
  { key: "weapons", label: "كل الأسلحة", icon: "💥", type: "weapon", id: null },
  { key: "nuke", label: "القنبلة الذرية", icon: "☢️", type: "weapon", id: "nuke" },
  { key: "ad_bomb", label: "القنبلة الإعلانية", icon: "📺", type: "weapon", id: "ad_bomb" },
  { key: "kraken_bomb", label: "قنبلة الكراكن", icon: "🐙", type: "weapon", id: "kraken_bomb" },
  { key: "doom_annihilator", label: "صاعقة الفناء", icon: "☄️", type: "weapon", id: "doom_annihilator" },
  { key: "rocket_small", label: "صاروخ صغير", icon: "🚀", type: "weapon", id: "rocket_small" },
  { key: "rocket_medium", label: "صاروخ متوسط", icon: "🚀", type: "weapon", id: "rocket_medium" },
  { key: "rocket_large", label: "صاروخ كبير", icon: "🚀", type: "weapon", id: "rocket_large" },
  { key: "anti", label: "المضادات", icon: "🛡️", type: "anti", id: null },
  { key: "shield", label: "الدروع", icon: "🔰", type: "shield", id: null },
  { key: "disabler", label: "المعطلات", icon: "🧨", type: "disabler", id: null },
  { key: "crew", label: "الطواقم", icon: "🧑‍✈️", type: "crew", id: null },
  { key: "all", label: "كل المخزن", icon: "📦", type: null, id: null },
];

const ITEM_LABELS: Record<string, string> = {
  nuke: "قنبلة ذرية",
  ad_bomb: "قنبلة إعلانية",
  kraken_bomb: "قنبلة الكراكن",
  doom_annihilator: "صاعقة الفناء",
  rocket_small: "صاروخ صغير",
  rocket_medium: "صاروخ متوسط",
  rocket_large: "صاروخ كبير",
  anti_nuke: "مضاد ذري",
  anti_ad_bomb: "مضاد إعلاني",
  anti_rocket: "مضاد صواريخ",
  anti_kraken: "مضاد كراكن",
  disabler_nuke: "معطل ذري",
  disabler_ad_bomb: "معطل إعلاني",
  disabler_rocket: "معطل صواريخ",
  disabler_kraken: "معطل كراكن",
  fixer_1: "مصلح 1",
  fixer_2: "مصلح 2",
  fixer_3: "مصلح 3",
  fixer_4: "المصلح الأسطوري",
  golden_fisher: "الصياد الذهبي",
  market_expert: "خبير السوق",
  police: "شرطي",
  thief: "لص",
  sailor: "بحّار",
  guide: "دليل",
  luck: "حظ",
  trader: "تاجر",
};

function AdminInventoryPage() {
  const [filter, setFilter] = useState("weapons");
  const [rows, setRows] = useState<Holder[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (key: string) => {
    const f = FILTERS.find((x) => x.key === key) || FILTERS[0];
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc("admin_top_inventory_holders", {
        _item_type: f.type,
        _item_id: f.id,
        _limit: 200,
      });
      if (error) throw error;
      setRows((data as Holder[]) || []);
    } catch (e: any) {
      toast.error(e?.message || "تعذّر تحميل البيانات");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (!q.trim()) return true;
        const s = q.toLowerCase();
        return (
          (r.display_name || "").toLowerCase().includes(s) ||
          (r.username || "").toLowerCase().includes(s)
        );
      }),
    [rows, q],
  );

  const grandTotal = filtered.reduce((a, r) => a + Number(r.total_qty || 0), 0);

  return (
    <div className="p-4 space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">📦 أكبر مالكي المنتجات</h1>
          <p className="text-sm text-slate-400">ترتيب اللاعبين حسب كمية المنتجات في المخزن</p>
        </div>
        <button
          onClick={() => load(filter)}
          className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
        >
          🔄 تحديث
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition ${
              filter === f.key
                ? "bg-indigo-600 border-indigo-400 text-white"
                : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {f.icon} {f.label}
          </button>
        ))}
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="بحث باسم اللاعب..."
        className="w-full max-w-sm px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-sm"
      />

      <div className="text-xs text-slate-400">
        {filtered.length} لاعب — الإجمالي {grandTotal.toLocaleString("en-US")} قطعة
      </div>

      {loading ? (
        <div className="text-slate-400 py-10 text-center">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="text-slate-400 py-10 text-center">لا توجد بيانات</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r, i) => (
            <div key={r.user_id} className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
              <button
                onClick={() => setOpen(open === r.user_id ? null : r.user_id)}
                className="w-full flex items-center gap-3 p-3 text-right hover:bg-slate-800/60"
              >
                <span className="w-8 text-center font-bold text-slate-400">{i + 1}</span>
                {r.avatar_url ? (
                  <img src={r.avatar_url} alt={r.display_name} className="w-9 h-9 rounded-full object-cover" loading="lazy" />
                ) : (
                  <span className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center text-lg">
                    {r.avatar_emoji || "🐟"}
                  </span>
                )}
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-slate-100 font-semibold">{r.display_name}</span>
                  <span className="block text-xs text-slate-500 truncate">
                    {r.username ? `@${r.username}` : ""} • سوق سفن {r.ship_market_level}
                  </span>
                </span>
                <span className="text-emerald-400 font-bold tabular-nums">
                  {Number(r.total_qty).toLocaleString("en-US")}
                </span>
                <span className="text-slate-500 text-xs">{open === r.user_id ? "▲" : "▼"}</span>
              </button>
              {open === r.user_id && (
                <div className="px-3 pb-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(r.breakdown || []).map((b) => (
                    <div
                      key={`${b.item_type}:${b.item_id}`}
                      className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-1.5 text-xs flex justify-between gap-2"
                    >
                      <span className="text-slate-300 truncate">{ITEM_LABELS[b.item_id] || b.item_id}</span>
                      <span className="text-amber-400 font-bold tabular-nums">{Number(b.qty).toLocaleString("en-US")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
