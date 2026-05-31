import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DurationPicker } from "@/components/admin/DurationPicker";

export const Route = createFileRoute("/admin/codes")({
  component: AdminCodesPage,
  ssr: false,
  head: () => ({ meta: [{ title: "أكواد الاستعمال — الإدارة" }] }),
});

type RewardType = "bundle" | "item" | "ship";
type DistMode = "limited" | "public"; // limited = عدد استخدامات محدد، public = للجميع مرة واحدة لكل شخص

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
  max_uses: number; // 0 = للجميع
  uses_count: number;
  expires_at: string | null;
  active: boolean;
  note: string;
  created_at: string;
};

function randomCode(len = 8): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function AdminCodesPage() {
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [loading, setLoading] = useState(true);

  // نموذج الإنشاء
  const [rewardType, setRewardType] = useState<RewardType>("bundle");
  const [code, setCode] = useState("");
  const [itemId, setItemId] = useState("");
  const [itemKind, setItemKind] = useState("weapon");
  const [coins, setCoins] = useState(0);
  const [gems, setGems] = useState(0);
  const [xp, setXp] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [distMode, setDistMode] = useState<DistMode>("limited");
  const [maxUses, setMaxUses] = useState(1);
  const [expD, setExpD] = useState(0);
  const [expH, setExpH] = useState(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // كميات الإنشاء السريع
  const [quickQty, setQuickQty] = useState(1);
  const [quickDist, setQuickDist] = useState<DistMode>("limited");

  // كتالوجات
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

  const insertCode = async (payload: {
    finalCode: string;
    reward_type: RewardType;
    item_id: string | null;
    item_kind: string | null;
    coins: number;
    gems: number;
    xp: number;
    quantity: number;
    max_uses: number;
    expires_at: string | null;
    note: string;
  }) => {
    const { data: { user } } = await supabase.auth.getUser();
    return supabase.from("redemption_codes").insert({
      code: payload.finalCode,
      reward_type: payload.reward_type,
      item_id: payload.item_id,
      item_kind: payload.item_kind,
      reward_coins: payload.coins,
      reward_gems: payload.gems,
      reward_xp: payload.xp,
      quantity: payload.quantity,
      max_uses: payload.max_uses,
      expires_at: payload.expires_at,
      note: payload.note,
      created_by: user?.id,
    });
  };

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
    const { error } = await insertCode({
      finalCode,
      reward_type: rewardType,
      item_id: rewardType === "bundle" ? null : itemId,
      item_kind: rewardType === "item" ? itemKind : null,
      coins: rewardType === "bundle" ? coins : 0,
      gems: rewardType === "bundle" ? gems : 0,
      xp: rewardType === "bundle" ? xp : 0,
      quantity: Math.max(1, quantity),
      max_uses: distMode === "public" ? 0 : Math.max(1, maxUses),
      expires_at: (expD * 24 + expH) > 0 ? new Date(Date.now() + (expD * 24 + expH) * 3600_000).toISOString() : null,
      note,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`✅ تم إنشاء الكود ${finalCode}`);
    try { await navigator.clipboard.writeText(finalCode); } catch { /* ignore */ }
    setCode(""); setNote("");
    setCoins(0); setGems(0); setXp(0); setQuantity(1); setMaxUses(1); setExpD(0); setExpH(0); setItemId("");
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
    label: string;
  }) => {
    const finalCode = randomCode();
    const qty = Math.max(1, quickQty);
    const max_uses = quickDist === "public" ? 0 : 1;
    const { error } = await insertCode({
      finalCode,
      reward_type: opts.rewardType,
      item_id: opts.rewardType === "bundle" ? null : (opts.itemId ?? null),
      item_kind: opts.rewardType === "item" ? (opts.itemKind ?? null) : null,
      coins: (opts.coins ?? 0) * (opts.rewardType === "bundle" ? qty : 1),
      gems: (opts.gems ?? 0) * (opts.rewardType === "bundle" ? qty : 1),
      xp: (opts.xp ?? 0) * (opts.rewardType === "bundle" ? qty : 1),
      quantity: opts.rewardType === "bundle" ? 1 : qty,
      max_uses,
      expires_at: null,
      note: `${opts.label}${qty > 1 ? ` × ${qty}` : ""}${quickDist === "public" ? " — للجميع" : ""}`,
    });
    if (error) { toast.error(error.message); return; }
    try { await navigator.clipboard.writeText(finalCode); } catch { /* ignore */ }
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
    <div dir="rtl" className="p-3 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-bold">🎟️ أكواد الاستعمال</h1>
      </div>

      {/* ───────── شرح مبسّط لكل شيء في اللوحة ───────── */}
      <div className="rounded-xl border border-sky-700/60 bg-sky-950/40 p-3 md:p-4 text-sm leading-relaxed space-y-2">
        <div className="font-bold text-sky-200 text-base">📖 شرح اللوحة — اقرأها مرة واحدة</div>
        <ul className="space-y-1 text-sky-100/90 list-disc pr-5 text-[13px]">
          <li><b>الإنشاء السريع</b>: اضغط على أي منتج لإنشاء كود فوراً ويُنسخ تلقائياً. اختر أولاً <b>الكمية</b> ونوع التوزيع.</li>
          <li><b>الكمية</b>: كم سفينة أو كم قطعة يحصل عليها اللاعب عند استخدام الكود (مثال: 3 سفن، 5 دروع).</li>
          <li><b>نوع التوزيع</b>:
            <ul className="pr-4 mt-1 space-y-0.5 list-[circle]">
              <li><b>محدود</b>: تحدد عدد مرات الاستخدام الإجمالي (مثلاً 10 لاعبين فقط من أول من يستخدم الكود).</li>
              <li><b>للجميع — مرة لكل شخص</b>: كل لاعب في اللعبة يقدر يستخدم الكود مرة واحدة فقط، بلا حد على العدد الكلي.</li>
            </ul>
          </li>
          <li><b>الإنشاء المفصّل</b>: نموذج كامل لاختيار نوع المكافأة (ذهب/جواهر/خبرة، عنصر متجر، أو سفينة) مع كود مخصص وتاريخ انتهاء.</li>
          <li><b>قائمة الأكواد</b>: تعرض كل الأكواد المنشأة. تقدر تنسخ، تعطّل، أو تحذف.</li>
        </ul>
      </div>

      {/* ───────── الإنشاء السريع ───────── */}
      <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-3 md:p-4 space-y-3">
        <div className="text-sm font-bold text-emerald-200">⚡ إنشاء سريع — اختر الكمية والتوزيع ثم اضغط على المنتج</div>

        {/* أدوات الإنشاء السريع */}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-emerald-200 space-y-1">
            <span>الكمية (سفن/عناصر/مضاعف الذهب)</span>
            <input
              type="number"
              min={1}
              value={quickQty}
              onChange={(e) => setQuickQty(Math.max(1, Number(e.target.value) || 1))}
              className="w-full bg-slate-800 border border-emerald-700 rounded-md px-2 py-1.5 text-sm text-slate-100 font-bold text-center"
            />
          </label>
          <label className="text-xs text-emerald-200 space-y-1">
            <span>نوع التوزيع</span>
            <select
              value={quickDist}
              onChange={(e) => setQuickDist(e.target.value as DistMode)}
              className="w-full bg-slate-800 border border-emerald-700 rounded-md px-2 py-1.5 text-sm text-slate-100"
            >
              <option value="limited">🔒 محدود — مرة واحدة فقط لكل كود</option>
              <option value="public">🌍 للجميع — كل لاعب مرة واحدة</option>
            </select>
          </label>
        </div>

        <div className="space-y-1">
          <div className="text-[11px] text-emerald-300/80">💰 باقات الذهب والجواهر والخبرة</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {bundlePresets.map((b) => (
              <button
                key={b.label}
                onClick={() => quickCreate({ rewardType: "bundle", coins: b.coins, gems: b.gems, xp: b.xp, label: b.label })}
                className="px-2 py-2 rounded-lg bg-slate-800/70 hover:bg-emerald-800/40 border border-slate-700 hover:border-emerald-500 text-sm text-slate-100 text-right transition"
              >
                <span className="ml-1">{b.icon}</span>{b.label}
                {quickQty > 1 ? <span className="text-emerald-300"> × {quickQty}</span> : null}
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
                onClick={() => quickCreate({ rewardType: "item", itemId: it.code, itemKind: it.kind, label: it.name })}
                className="px-2 py-2 rounded-lg bg-slate-800/70 hover:bg-emerald-800/40 border border-slate-700 hover:border-emerald-500 text-xs text-slate-100 text-right transition truncate"
                title={it.name}
              >
                📦 {it.name}{quickQty > 1 ? <span className="text-emerald-300"> × {quickQty}</span> : null}
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
                ⛵ {s.name}{quickQty > 1 ? <span className="text-emerald-300"> × {quickQty}</span> : null}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ───────── الإنشاء المفصّل ───────── */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 md:p-4 space-y-3">
        <div className="text-sm font-bold text-indigo-200">🛠️ إنشاء مفصّل — تحكم كامل بكل تفصيل</div>

        {/* نوع المكافأة */}
        <div>
          <div className="text-[11px] text-slate-400 mb-1">نوع المكافأة</div>
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
                {t === "bundle" ? "💰 ذهب/جواهر/خبرة" : t === "item" ? "📦 عنصر متجر" : "⛵ سفينة"}
              </button>
            ))}
          </div>
        </div>

        {/* حقول المكافأة */}
        {rewardType === "bundle" && (
          <div className="grid grid-cols-3 gap-2">
            <NumField label="ذهب 🪙" value={coins} onChange={setCoins} />
            <NumField label="جواهر 💎" value={gems} onChange={setGems} />
            <NumField label="خبرة ✨" value={xp} onChange={setXp} />
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
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </label>
            <NumField label="كم قطعة يحصل عليها اللاعب" value={quantity} onChange={setQuantity} min={1} />
          </div>
        )}

        {rewardType === "ship" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-400 space-y-1">
              <span>السفينة</span>
              <select
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-100"
              >
                <option value="">— اختر —</option>
                {shipsCatalog.map((s) => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
            </label>
            <NumField label="كم سفينة يحصل عليها اللاعب" value={quantity} onChange={setQuantity} min={1} />
          </div>
        )}

        {/* نوع التوزيع */}
        <div>
          <div className="text-[11px] text-slate-400 mb-1">نوع التوزيع</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setDistMode("limited")}
              className={`px-3 py-2 rounded-lg text-xs font-bold border text-right ${
                distMode === "limited"
                  ? "bg-amber-600/30 border-amber-400 text-amber-100"
                  : "bg-slate-800/60 border-slate-700 text-slate-300"
              }`}
            >
              🔒 محدود
              <div className="text-[10px] font-normal opacity-80 mt-0.5">عدد استخدامات إجمالي محدد</div>
            </button>
            <button
              onClick={() => setDistMode("public")}
              className={`px-3 py-2 rounded-lg text-xs font-bold border text-right ${
                distMode === "public"
                  ? "bg-emerald-600/30 border-emerald-400 text-emerald-100"
                  : "bg-slate-800/60 border-slate-700 text-slate-300"
              }`}
            >
              🌍 للجميع — مرة لكل شخص
              <div className="text-[10px] font-normal opacity-80 mt-0.5">كل لاعب يقدر يستخدمه مرة واحدة فقط</div>
            </button>
          </div>
        </div>

        {/* الكود وتاريخ الانتهاء + الاستخدامات */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <label className="text-xs text-slate-400 space-y-1 md:col-span-1">
            <span>الكود (اتركه فارغ للتوليد التلقائي)</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="مثال: WELCOME10"
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-2 py-1.5 text-sm text-slate-100 font-mono tracking-wider"
            />
          </label>
          {distMode === "limited" && (
            <NumField label="عدد الاستخدامات الإجمالي" value={maxUses} onChange={setMaxUses} min={1} />
          )}
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
          <span>ملاحظة داخلية (تظهر للمشرف فقط)</span>
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
          {saving ? "جاري الإنشاء..." : "🎟️ إنشاء الكود ونسخه"}
        </button>
      </div>

      {/* ───────── قائمة الأكواد ───────── */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
        <div className="px-3 py-2 text-sm font-bold text-slate-300 border-b border-slate-800">
          📜 الأكواد المنشأة ({codes.length})
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
                    {c.max_uses === 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-900/50 text-emerald-200 font-bold">🌍 للجميع</span>
                    )}
                    {!c.active && <span className="text-[10px] px-2 py-0.5 rounded bg-red-900/40 text-red-200">معطل</span>}
                    {c.expires_at && new Date(c.expires_at) < new Date() && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-stone-700 text-stone-200">منتهي</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-1 flex flex-wrap gap-x-3">
                    <span>
                      {c.reward_type === "bundle"
                        ? `💰 ${c.reward_coins} ذهب • 💎 ${c.reward_gems} جوهرة • ✨ ${c.reward_xp} خبرة`
                        : c.reward_type === "item"
                        ? `📦 ${c.item_id} × ${c.quantity}`
                        : `⛵ ${c.item_id} × ${c.quantity}`}
                    </span>
                    <span>
                      {c.max_uses === 0
                        ? `استُخدم ${c.uses_count} مرة (بلا حد)`
                        : `الاستخدام: ${c.uses_count}/${c.max_uses}`}
                    </span>
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
