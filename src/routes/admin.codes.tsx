import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/codes")({
  component: AdminCodesPage,
  ssr: false,
  head: () => ({ meta: [{ title: "أكواد الاستعمال — Admin" }] }),
});

type RewardType = "bundle" | "item" | "ship";

type CodeRow = {
  id: string;
  code: string;
  reward_type: RewardType;
  item_id: string | null;
  item_kind: string | null;
  reward_coins: number;
  reward_gems: number;
  reward_xp: number;
  quantity: number;
  max_uses: number;
  uses_count: number;
  expires_at: string | null;
  active: boolean;
  note: string;
  created_at: string;
};

function randomCode(len = 10): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function AdminCodesPage() {
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Form
  const [rewardType, setRewardType] = useState<RewardType>("bundle");
  const [code, setCode] = useState("");
  const [itemId, setItemId] = useState("");
  const [itemKind, setItemKind] = useState("weapon");
  const [coins, setCoins] = useState(0);
  const [gems, setGems] = useState(0);
  const [xp, setXp] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [maxUses, setMaxUses] = useState(1);
  const [expiresAt, setExpiresAt] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Catalog options for item/ship selection
  const [itemsCatalog, setItemsCatalog] = useState<Array<{ code: string; name: string; kind: string }>>([]);
  const [shipsCatalog, setShipsCatalog] = useState<Array<{ code: string; name: string }>>([]);

  const loadCodes = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("redemption_codes")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error("فشل تحميل الأكواد");
    setCodes((data ?? []) as CodeRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCodes();
    supabase.from("items_catalog").select("code, name, kind").eq("active", true).order("sort_order").then(({ data }) => {
      setItemsCatalog((data ?? []) as Array<{ code: string; name: string; kind: string }>);
    });
    supabase.from("ship_catalog").select("code, name").eq("active", true).order("sort_order").then(({ data }) => {
      setShipsCatalog((data ?? []) as Array<{ code: string; name: string }>);
    });
  }, [loadCodes]);

  const createCode = async () => {
    const finalCode = (code.trim() || randomCode()).toUpperCase();
    if (!/^[A-Z0-9_-]{4,32}$/.test(finalCode)) {
      toast.error("الكود يجب أن يكون 4–32 حرف/رقم");
      return;
    }
    if (rewardType !== "bundle" && !itemId) {
      toast.error("اختر العنصر أو السفينة");
      return;
    }
    if (rewardType === "bundle" && coins === 0 && gems === 0 && xp === 0) {
      toast.error("أدخل قيمة واحدة على الأقل للمكافأة");
      return;
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("redemption_codes").insert({
      code: finalCode,
      reward_type: rewardType,
      item_id: rewardType === "bundle" ? null : itemId,
      item_kind: rewardType === "item" ? itemKind : null,
      reward_coins: rewardType === "bundle" ? coins : 0,
      reward_gems: rewardType === "bundle" ? gems : 0,
      reward_xp: rewardType === "bundle" ? xp : 0,
      quantity: Math.max(1, quantity),
      max_uses: Math.max(1, maxUses),
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      note,
      created_by: user?.id,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`تم إنشاء الكود ${finalCode}`);
    setCode("");
    setNote("");
    setCoins(0); setGems(0); setXp(0); setQuantity(1); setMaxUses(1); setExpiresAt(""); setItemId("");
    loadCodes();
  };

  const toggleActive = async (row: CodeRow) => {
    const { error } = await supabase
      .from("redemption_codes")
      .update({ active: !row.active })
      .eq("id", row.id);
    if (error) return toast.error(error.message);
    loadCodes();
  };

  const deleteCode = async (row: CodeRow) => {
    if (!confirm(`حذف الكود ${row.code}؟`)) return;
    const { error } = await supabase.from("redemption_codes").delete().eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success("تم الحذف");
    loadCodes();
  };

  const copyCode = async (c: string) => {
    try {
      await navigator.clipboard.writeText(c);
      toast.success("تم نسخ الكود");
    } catch {
      toast.error("تعذر النسخ");
    }
  };

  const quickCreate = async (opts: {
    rewardType: RewardType;
    itemId?: string;
    itemKind?: string;
    coins?: number;
    gems?: number;
    xp?: number;
    quantity?: number;
    label: string;
  }) => {
    const finalCode = randomCode();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("redemption_codes").insert({
      code: finalCode,
      reward_type: opts.rewardType,
      item_id: opts.rewardType === "bundle" ? null : (opts.itemId ?? null),
      item_kind: opts.rewardType === "item" ? (opts.itemKind ?? null) : null,
      reward_coins: opts.coins ?? 0,
      reward_gems: opts.gems ?? 0,
      reward_xp: opts.xp ?? 0,
      quantity: Math.max(1, opts.quantity ?? 1),
      max_uses: 1,
      expires_at: null,
      note: opts.label,
      created_by: user?.id,
    });
    if (error) { toast.error(error.message); return; }
    try { await navigator.clipboard.writeText(finalCode); } catch {}
    toast.success(`✅ ${finalCode} — تم النسخ`);
    loadCodes();
  };

  const bundlePresets: Array<{ label: string; coins?: number; gems?: number; xp?: number; icon: string }> = [
    { label: "1,000 ذهب", coins: 1000, icon: "🪙" },
    { label: "5,000 ذهب", coins: 5000, icon: "🪙" },
    { label: "25,000 ذهب", coins: 25000, icon: "🪙" },
    { label: "100,000 ذهب", coins: 100000, icon: "💰" },
    { label: "10 جواهر", gems: 10, icon: "💎" },
    { label: "50 جواهر", gems: 50, icon: "💎" },
    { label: "200 جواهر", gems: 200, icon: "💎" },
    { label: "1,000 خبرة", xp: 1000, icon: "✨" },
  ];

  return (
    <div className="p-3 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-bold">🎟️ أكواد الاستعمال</h1>
      </div>

      {/* Quick create — click any product to generate a one-use code */}
      <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-3 md:p-4 space-y-3">
        <div className="text-sm font-bold text-emerald-200">⚡ إنشاء سريع — اضغط على أي منتج لإنشاء كود تلقائي (استخدام واحد، يُنسخ مباشرة)</div>

        <div className="space-y-1">
          <div className="text-[11px] text-emerald-300/80">💰 باقات الذهب والجواهر والخبرة</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {bundlePresets.map((b) => (
              <button
                key={b.label}
                onClick={() => quickCreate({ rewardType: "bundle", coins: b.coins, gems: b.gems, xp: b.xp, label: b.label })}
                className="px-2 py-2 rounded-lg bg-slate-800/70 hover:bg-emerald-800/40 border border-slate-700 hover:border-emerald-500 text-sm text-slate-100 text-right transition"
              >
                <span className="mr-1">{b.icon}</span>{b.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[11px] text-emerald-300/80">📦 عناصر المتجر ({itemsCatalog.length})</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {itemsCatalog.map((it) => (
              <button
                key={it.code}
                onClick={() => quickCreate({ rewardType: "item", itemId: it.code, itemKind: it.kind, quantity: 1, label: it.name })}
                className="px-2 py-2 rounded-lg bg-slate-800/70 hover:bg-emerald-800/40 border border-slate-700 hover:border-emerald-500 text-xs text-slate-100 text-right transition truncate"
                title={it.name}
              >
                📦 {it.name}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[11px] text-emerald-300/80">⛵ السفن ({shipsCatalog.length})</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {shipsCatalog.map((s) => (
              <button
                key={s.code}
                onClick={() => quickCreate({ rewardType: "ship", itemId: s.code, label: s.name })}
                className="px-2 py-2 rounded-lg bg-slate-800/70 hover:bg-emerald-800/40 border border-slate-700 hover:border-emerald-500 text-xs text-slate-100 text-right transition truncate"
                title={s.name}
              >
                ⛵ {s.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Create form */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 md:p-4 space-y-3">
        <div className="text-sm font-bold text-indigo-200">إنشاء كود جديد</div>

        {/* Reward type */}
        <div className="flex flex-wrap gap-2">
          {(["bundle", "item", "ship"] as RewardType[]).map((t) => (
            <button
              key={t}
              onClick={() => setRewardType(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
                rewardType === t
                  ? "bg-indigo-600/30 border-indigo-400 text-indigo-100"
                  : "bg-slate-800/60 border-slate-700 text-slate-300"
              }`}
            >
              {t === "bundle" ? "💰 رصيد عملات/جواهر/خبرة" : t === "item" ? "📦 عنصر من المتجر" : "⛵ سفينة"}
            </button>
          ))}
        </div>

        {/* Reward fields */}
        {rewardType === "bundle" && (
          <div className="grid grid-cols-3 gap-2">
            <NumField label="عملات" value={coins} onChange={setCoins} />
            <NumField label="جواهر" value={gems} onChange={setGems} />
            <NumField label="خبرة" value={xp} onChange={setXp} />
          </div>
        )}

        {rewardType === "item" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-400 space-y-1">
              <span>العنصر</span>
              <select
                value={itemId}
                onChange={(e) => {
                  const v = e.target.value;
                  setItemId(v);
                  const c = itemsCatalog.find((x) => x.code === v);
                  if (c) setItemKind(c.kind);
                }}
                className="w-full bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-100"
              >
                <option value="">— اختر —</option>
                {itemsCatalog.map((c) => (
                  <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
                ))}
              </select>
            </label>
            <NumField label="الكمية" value={quantity} onChange={setQuantity} min={1} />
          </div>
        )}

        {rewardType === "ship" && (
          <label className="block text-xs text-slate-400 space-y-1">
            <span>السفينة</span>
            <select
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-100"
            >
              <option value="">— اختر —</option>
              {shipsCatalog.map((s) => (
                <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
              ))}
            </select>
          </label>
        )}

        {/* Code, uses, expiry */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <label className="text-xs text-slate-400 space-y-1 col-span-2">
            <span>الكود (اتركه فارغ للتوليد التلقائي)</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="مثال: WELCOME10"
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-100 font-mono tracking-wider"
            />
          </label>
          <NumField label="عدد الاستخدامات" value={maxUses} onChange={setMaxUses} min={1} />
          <label className="text-xs text-slate-400 space-y-1">
            <span>ينتهي في (اختياري)</span>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
        </div>

        <label className="block text-xs text-slate-400 space-y-1">
          <span>ملاحظة (للمشرف فقط)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="مثلاً: ترويج لاعب جديد"
            className="w-full bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-100"
          />
        </label>

        <button
          disabled={saving}
          onClick={createCode}
          className="w-full md:w-auto px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold disabled:opacity-50"
        >
          {saving ? "جاري الإنشاء..." : "🎟️ إنشاء الكود"}
        </button>
      </div>

      {/* Codes list */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
        <div className="px-3 py-2 text-sm font-bold text-slate-300 border-b border-slate-800">
          الأكواد المنشأة ({codes.length})
        </div>
        {loading ? (
          <div className="p-4 text-center text-slate-400 text-sm">جاري التحميل...</div>
        ) : codes.length === 0 ? (
          <div className="p-4 text-center text-slate-400 text-sm">لا توجد أكواد بعد</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {codes.map((c) => (
              <div key={c.id} className="p-3 flex flex-col md:flex-row md:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="font-mono text-base font-bold text-amber-200 tracking-wider">{c.code}</code>
                    <button
                      onClick={() => copyCode(c.code)}
                      className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                    >📋 نسخ</button>
                    {!c.active && <span className="text-[10px] px-2 py-0.5 rounded bg-red-900/40 text-red-200">معطل</span>}
                    {c.expires_at && new Date(c.expires_at) < new Date() && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-stone-700 text-stone-200">منتهي</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-1 flex flex-wrap gap-x-3">
                    <span>
                      {c.reward_type === "bundle"
                        ? `💰 ${c.reward_coins} عملة • 💎 ${c.reward_gems} جوهرة • ✨ ${c.reward_xp} خبرة`
                        : c.reward_type === "item"
                        ? `📦 ${c.item_id} × ${c.quantity}`
                        : `⛵ ${c.item_id}`}
                    </span>
                    <span>الاستخدام: {c.uses_count}/{c.max_uses}</span>
                    {c.expires_at && <span>ينتهي: {new Date(c.expires_at).toLocaleString("ar")}</span>}
                  </div>
                  {c.note && <div className="text-[11px] text-slate-500 mt-0.5">📝 {c.note}</div>}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleActive(c)}
                    className="text-xs px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200"
                  >
                    {c.active ? "تعطيل" : "تفعيل"}
                  </button>
                  <button
                    onClick={() => deleteCode(c)}
                    className="text-xs px-3 py-1.5 rounded-md bg-red-900/40 hover:bg-red-900/60 text-red-200"
                  >حذف</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, min = 0 }: { label: string; value: number; onChange: (n: number) => void; min?: number }) {
  return (
    <label className="text-xs text-slate-400 space-y-1">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
        className="w-full bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-100"
      />
    </label>
  );
}
