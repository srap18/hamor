import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DurationPicker } from "@/components/admin/DurationPicker";
import { CREWS } from "@/lib/crews";
import { WEAPONS } from "@/lib/weapons";
import { ALL_FRAMES, FRAME_KIND_TO_ITEM_TYPE } from "@/lib/frames";

export const Route = createFileRoute("/admin/codes")({
  component: AdminCodesPage,
  ssr: false,
  head: () => ({ meta: [{ title: "أكواد الاستعمال — الإدارة" }] }),
});

// Shield options — granted via redeem_code as item_kind='shield' with quantity = hours
const SHIELD_ITEMS: Array<{ code: string; name: string; kind: string }> = [
  { code: "shield_4h",  name: "🛡️ درع 4 ساعات", kind: "shield" },
  { code: "shield_1d",  name: "🛡️ درع يوم",      kind: "shield" },
  { code: "shield_2d",  name: "🛡️ درع يومين",    kind: "shield" },
  { code: "shield_7d",  name: "🛡️ درع أسبوع",    kind: "shield" },
  { code: "shield_30d", name: "🛡️ درع شهر",      kind: "shield" },
];

// Local TS catalogs merged in so admin can bundle crews/weapons/frames/shields
// directly with proper Arabic names — without needing entries in items_catalog.
const KIND_LABEL: Record<string, string> = {
  crew: "👥 طواقم",
  weapon: "💥 أسلحة",
  shield: "🛡️ دروع",
  frame: "🖼️ إطارات صورة",
  name_frame: "🏷️ إطارات اسم",
  bubble_frame: "💬 إطارات رسالة",
  profile_frame: "🪪 إطارات بطاقة",
  misc: "📦 متفرقات",
};

const LOCAL_ITEMS: Array<{ code: string; name: string; kind: string }> = [
  ...CREWS.map((c) => ({ code: c.id, name: `${c.emoji} ${c.name}`, kind: "crew" })),
  ...WEAPONS.map((w) => ({ code: w.id, name: `${w.emoji} ${w.name}`, kind: "weapon" })),
  ...SHIELD_ITEMS,
  ...ALL_FRAMES.map((f) => ({
    code: f.id,
    name: `${f.preview ?? "🖼️"} ${f.name}`,
    kind: FRAME_KIND_TO_ITEM_TYPE[f.kind],
  })),
];

type RewardType = "bundle" | "item" | "ship";
type DistMode = "limited" | "public"; // limited = عدد استخدامات محدد، public = للجميع مرة واحدة لكل شخص

type ExtraReward = {
  type: RewardType;
  item_id?: string | null;
  item_kind?: string | null;
  quantity?: number;
  coins?: number;
  gems?: number;
  xp?: number;
};

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
  extra_rewards: ExtraReward[] | null;
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
  const [redemptionsFor, setRedemptionsFor] = useState<CodeRow | null>(null);

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
  const [dbItems, setDbItems] = useState<Array<{ code: string; name: string; kind: string }>>([]);
  const [shipsCatalog, setShipsCatalog] = useState<Array<{ code: string; name: string }>>([]);

  // الكتالوج الموحّد: عناصر قاعدة البيانات + الطواقم/الأسلحة/الدروع/الإطارات من الكود
  const itemsCatalog = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ code: string; name: string; kind: string }> = [];
    for (const it of [...LOCAL_ITEMS, ...dbItems]) {
      if (seen.has(it.code)) continue;
      seen.add(it.code);
      out.push(it);
    }
    return out;
  }, [dbItems]);

  // إنشاء مجمّع: اختر عدة أشياء + عملات في كود واحد
  const [bundleSelItems, setBundleSelItems] = useState<Record<string, number>>({}); // item code -> qty
  const [bundleSelShips, setBundleSelShips] = useState<Record<string, number>>({}); // ship code -> qty
  const [bundleCoins, setBundleCoins] = useState(0);
  const [bundleGems, setBundleGems] = useState(0);
  const [bundleXp, setBundleXp] = useState(0);
  const [bundleDist, setBundleDist] = useState<DistMode>("limited");
  const [bundleMaxUses, setBundleMaxUses] = useState(1);
  const [bundleNote, setBundleNote] = useState("");
  const [bundleCustomCode, setBundleCustomCode] = useState("");
  const [bundleSaving, setBundleSaving] = useState(false);

  const loadCodes = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("redemption_codes")
      .select("*")
      .is("archived_at", null)
      .order("created_at", { ascending: false });
    if (error) toast.error("فشل تحميل الأكواد");
    setCodes((data ?? []) as CodeRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCodes();
    supabase.from("items_catalog").select("code, name, kind").eq("active", true).order("sort_order").then(({ data }) => {
      setDbItems((data ?? []) as Array<{ code: string; name: string; kind: string }>);
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
    extra_rewards?: ExtraReward[];
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
      extra_rewards: payload.extra_rewards ?? [],
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

  const cleanupDeadCodes = async () => {
    const now = new Date();
    const dead = codes.filter((c) => {
      const expired = c.expires_at && new Date(c.expires_at) < now;
      const exhausted = c.max_uses > 0 && c.uses_count >= c.max_uses;
      return expired || exhausted;
    });
    if (dead.length === 0) {
      toast.info("لا يوجد أكواد منتهية أو مستنفدة للحذف");
      return;
    }
    if (!confirm(`حذف ${dead.length} كود منتهي/مستنفد؟ لا يمكن التراجع.`)) return;
    const ids = dead.map((c) => c.id);
    const { error } = await supabase.from("redemption_codes").delete().in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(`✅ تم حذف ${dead.length} كود`);
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

  const toggleBundleItem = (code: string) => {
    setBundleSelItems((prev) => {
      const next = { ...prev };
      if (next[code] != null) delete next[code];
      else next[code] = 1;
      return next;
    });
  };
  const toggleBundleShip = (code: string) => {
    setBundleSelShips((prev) => {
      const next = { ...prev };
      if (next[code] != null) delete next[code];
      else next[code] = 1;
      return next;
    });
  };

  const selectAllItemsByKind = (kind: string | null) => {
    setBundleSelItems((prev) => {
      const next = { ...prev };
      const target = kind ? itemsCatalog.filter((i) => i.kind === kind) : itemsCatalog;
      for (const it of target) if (next[it.code] == null) next[it.code] = 1;
      return next;
    });
  };
  const selectAllShips = () => {
    setBundleSelShips((prev) => {
      const next = { ...prev };
      for (const s of shipsCatalog) if (next[s.code] == null) next[s.code] = 1;
      return next;
    });
  };
  const clearBundleSelection = () => {
    setBundleSelItems({});
    setBundleSelShips({});
  };

  const createBundleCode = async () => {
    const itemsList = Object.entries(bundleSelItems);
    const shipsList = Object.entries(bundleSelShips);
    const hasCurrency = bundleCoins > 0 || bundleGems > 0 || bundleXp > 0;
    if (itemsList.length === 0 && shipsList.length === 0 && !hasCurrency) {
      toast.error("اختر شيئاً واحداً على الأقل أو أدخل ذهب/جواهر/خبرة");
      return;
    }
    const finalCode = (bundleCustomCode.trim() || randomCode()).toUpperCase();
    if (!/^[A-Z0-9_-]{4,32}$/.test(finalCode)) {
      toast.error("الكود يجب أن يكون 4–32 حرف/رقم");
      return;
    }
    const extras: ExtraReward[] = [];
    for (const [code, qty] of itemsList) {
      const meta = itemsCatalog.find((x) => x.code === code);
      extras.push({ type: "item", item_id: code, item_kind: meta?.kind ?? "misc", quantity: Math.max(1, qty) });
    }
    for (const [code, qty] of shipsList) {
      extras.push({ type: "ship", item_id: code, quantity: Math.max(1, qty) });
    }
    setBundleSaving(true);
    const { error } = await insertCode({
      finalCode,
      reward_type: "bundle", // عنصر رئيسي = الذهب/الجواهر/الخبرة (قد تكون صفرًا)
      item_id: null,
      item_kind: null,
      coins: bundleCoins,
      gems: bundleGems,
      xp: bundleXp,
      quantity: 1,
      max_uses: bundleDist === "public" ? 0 : Math.max(1, bundleMaxUses),
      expires_at: null,
      note: bundleNote || `كود مجمّع: ${extras.length} عنصر${hasCurrency ? " + عملات" : ""}`,
      extra_rewards: extras,
    });
    setBundleSaving(false);
    if (error) { toast.error(error.message); return; }
    try { await navigator.clipboard.writeText(finalCode); } catch { /* ignore */ }
    toast.success(`✅ ${finalCode} — تم النسخ`);
    setBundleCustomCode(""); setBundleNote("");
    setBundleCoins(0); setBundleGems(0); setBundleXp(0);
    clearBundleSelection();
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

      {/* ───────── الإنشاء المجمّع (كود واحد = عدة عناصر) ───────── */}
      <div className="rounded-xl border border-fuchsia-800/60 bg-fuchsia-950/30 p-3 md:p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm font-bold text-fuchsia-200">🎁 إنشاء كود مجمّع — اختر عدة عناصر/سفن في كود واحد</div>
          <div className="text-[11px] text-fuchsia-300/80">
            محدد: {Object.keys(bundleSelItems).length} عنصر • {Object.keys(bundleSelShips).length} سفينة
          </div>
        </div>

        {/* عملات/جواهر/خبرة (اختياري) */}
        <div className="grid grid-cols-3 gap-2">
          <NumField label="ذهب 🪙" value={bundleCoins} onChange={setBundleCoins} />
          <NumField label="جواهر 💎" value={bundleGems} onChange={setBundleGems} />
          <NumField label="خبرة ✨" value={bundleXp} onChange={setBundleXp} />
        </div>

        {/* عناصر متعددة الاختيار — مجموعة حسب النوع */}
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-[11px] text-fuchsia-300/80">📦 العناصر — اضغط للاختيار (مجمّعة حسب النوع)</div>
            <div className="flex gap-1 flex-wrap">
              <button onClick={() => selectAllItemsByKind(null)} className="text-[10px] px-2 py-0.5 rounded bg-fuchsia-800/40 hover:bg-fuchsia-700/50 text-fuchsia-100">+ الكل</button>
              <button onClick={clearBundleSelection} className="text-[10px] px-2 py-0.5 rounded bg-red-900/40 hover:bg-red-900/60 text-red-200">مسح الكل</button>
            </div>
          </div>

          {Array.from(new Set(itemsCatalog.map((i) => i.kind))).map((kind) => {
            const group = itemsCatalog.filter((i) => i.kind === kind);
            if (group.length === 0) return null;
            return (
              <div key={kind} className="space-y-1 rounded-lg border border-fuchsia-900/40 bg-black/20 p-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-[12px] font-bold text-fuchsia-200">
                    {KIND_LABEL[kind] ?? kind} <span className="text-fuchsia-400/70 text-[10px]">({group.length})</span>
                  </div>
                  <button
                    onClick={() => selectAllItemsByKind(kind)}
                    className="text-[10px] px-2 py-0.5 rounded bg-fuchsia-800/40 hover:bg-fuchsia-700/50 text-fuchsia-100"
                  >+ كل {KIND_LABEL[kind] ?? kind}</button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {group.map((it) => {
                    const sel = bundleSelItems[it.code] != null;
                    return (
                      <div key={it.code} className={`px-2 py-2 rounded-lg border text-xs text-right transition ${sel ? "bg-fuchsia-700/40 border-fuchsia-400" : "bg-slate-800/70 border-slate-700"}`}>
                        <button onClick={() => toggleBundleItem(it.code)} className="w-full text-right text-slate-100 truncate" title={it.name}>
                          {sel ? "✅" : "•"} {it.name}
                        </button>
                        {sel && (
                          <div className="mt-1 flex items-center gap-1">
                            <span className="text-[10px] text-fuchsia-200">×</span>
                            <input
                              type="number"
                              min={1}
                              value={bundleSelItems[it.code]}
                              onChange={(e) => setBundleSelItems((p) => ({ ...p, [it.code]: Math.max(1, Number(e.target.value) || 1) }))}
                              className="w-14 bg-slate-900 border border-fuchsia-700 rounded px-1 py-0.5 text-xs text-slate-100"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* السفن — متعدد الاختيار */}
        <div className="space-y-1">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-[11px] text-fuchsia-300/80">⛵ السفن — اضغط للاختيار</div>
            <button onClick={selectAllShips} className="text-[10px] px-2 py-0.5 rounded bg-fuchsia-800/40 hover:bg-fuchsia-700/50 text-fuchsia-100">+ كل السفن</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {shipsCatalog.map((s) => {
              const sel = bundleSelShips[s.code] != null;
              return (
                <div key={s.code} className={`px-2 py-2 rounded-lg border text-xs text-right transition ${sel ? "bg-fuchsia-700/40 border-fuchsia-400" : "bg-slate-800/70 border-slate-700"}`}>
                  <button onClick={() => toggleBundleShip(s.code)} className="w-full text-right text-slate-100 truncate" title={s.name}>
                    {sel ? "✅" : "⛵"} {s.name}
                  </button>
                  {sel && (
                    <div className="mt-1 flex items-center gap-1">
                      <span className="text-[10px] text-fuchsia-200">×</span>
                      <input
                        type="number"
                        min={1}
                        value={bundleSelShips[s.code]}
                        onChange={(e) => setBundleSelShips((p) => ({ ...p, [s.code]: Math.max(1, Number(e.target.value) || 1) }))}
                        className="w-14 bg-slate-900 border border-fuchsia-700 rounded px-1 py-0.5 text-xs text-slate-100"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* إعدادات الكود */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <label className="text-xs text-fuchsia-200 space-y-1">
            <span>الكود (فارغ = توليد تلقائي)</span>
            <input
              value={bundleCustomCode}
              onChange={(e) => setBundleCustomCode(e.target.value.toUpperCase())}
              placeholder="مثال: ALLSHIPS"
              className="w-full bg-slate-800 border border-fuchsia-700 rounded-md px-2 py-1.5 text-sm text-slate-100 font-mono tracking-wider"
            />
          </label>
          <label className="text-xs text-fuchsia-200 space-y-1">
            <span>نوع التوزيع</span>
            <select
              value={bundleDist}
              onChange={(e) => setBundleDist(e.target.value as DistMode)}
              className="w-full bg-slate-800 border border-fuchsia-700 rounded-md px-2 py-1.5 text-sm text-slate-100"
            >
              <option value="limited">🔒 محدود</option>
              <option value="public">🌍 للجميع — كل لاعب مرة واحدة</option>
            </select>
          </label>
          {bundleDist === "limited" && (
            <NumField label="عدد الاستخدامات الإجمالي" value={bundleMaxUses} onChange={setBundleMaxUses} min={1} />
          )}
        </div>

        <label className="block text-xs text-fuchsia-200 space-y-1">
          <span>ملاحظة (اختيارية)</span>
          <input
            value={bundleNote}
            onChange={(e) => setBundleNote(e.target.value)}
            placeholder="مثلاً: هدية كل السفن للمؤسسين"
            className="w-full bg-slate-800 border border-fuchsia-700 rounded-md px-2 py-1.5 text-sm text-slate-100"
          />
        </label>

        <button
          disabled={bundleSaving}
          onClick={createBundleCode}
          className="w-full md:w-auto px-4 py-2 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-bold disabled:opacity-50"
        >
          {bundleSaving ? "جاري الإنشاء..." : "🎁 إنشاء الكود المجمّع ونسخه"}
        </button>
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
          <DurationPicker label="ينتهي بعد (اختياري)" days={expD} hours={expH}
            onChange={(d, h) => { setExpD(d); setExpH(h); }}
            allowZero zeroLabel="بدون انتهاء" />

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
        <div className="px-3 py-2 text-sm font-bold text-slate-300 border-b border-slate-800 flex items-center justify-between gap-2">
          <span>📜 الأكواد المنشأة ({codes.length})</span>
          <button
            onClick={cleanupDeadCodes}
            className="text-[11px] px-2.5 py-1 rounded-md bg-rose-700 hover:bg-rose-600 text-white font-bold"
            title="حذف الأكواد المنتهية الصلاحية والمستنفدة"
          >🧹 تنظيف المنتهية/المستنفدة</button>
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
                  {Array.isArray(c.extra_rewards) && c.extra_rewards.length > 0 && (
                    <div className="text-[11px] text-fuchsia-300 mt-1 flex flex-wrap gap-1">
                      <span className="font-bold">🎁 مجمّع ({c.extra_rewards.length}):</span>
                      {c.extra_rewards.slice(0, 8).map((r, idx) => (
                        <span key={idx} className="px-1.5 py-0.5 rounded bg-fuchsia-900/40 border border-fuchsia-800">
                          {r.type === "ship" ? "⛵" : r.type === "item" ? "📦" : "💰"} {r.item_id ?? `${r.coins ?? 0}🪙`} {r.quantity && r.quantity > 1 ? `×${r.quantity}` : ""}
                        </span>
                      ))}
                      {c.extra_rewards.length > 8 && <span>… +{c.extra_rewards.length - 8}</span>}
                    </div>
                  )}
                  {c.note && <div className="text-[11px] text-slate-500 mt-0.5">📝 {c.note}</div>}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => setRedemptionsFor(c)}
                    className="text-xs px-3 py-1.5 rounded-md bg-indigo-900/50 hover:bg-indigo-800/60 text-indigo-200"
                    title="عرض من استخدم الكود وإلغاء الاستخدام"
                  >👥 المستخدمون ({c.uses_count})</button>
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

      {redemptionsFor && (
        <RedemptionsModal
          code={redemptionsFor}
          onClose={() => setRedemptionsFor(null)}
          onChanged={loadCodes}
        />
      )}
    </div>
  );
}

type Redemption = {
  user_id: string;
  redeemed_at: string;
  display_name: string | null;
  avatar_emoji: string | null;
};

function RedemptionsModal({ code, onClose, onChanged }: { code: CodeRow; onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<Redemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("admin_list_redemptions", { _code_id: code.id });
    if (error) toast.error(error.message);
    setRows((data ?? []) as Redemption[]);
    setLoading(false);
  }, [code.id]);

  useEffect(() => { load(); }, [load]);

  const revoke = async (userId: string, name: string) => {
    if (!confirm(`إلغاء استخدام الكود من ${name}؟ سيقدر يستخدمه مرة ثانية. (المكافآت التي حصل عليها لن تُسترد تلقائياً)`)) return;
    setBusy(userId);
    const { error } = await (supabase as any).rpc("admin_revoke_redemption", { _code_id: code.id, _user_id: userId });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("✅ تم إلغاء الاستخدام");
    load();
    onChanged();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" onClick={onClose}>
      <div dir="rtl" onClick={(e) => e.stopPropagation()} className="w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col rounded-xl border border-indigo-700 bg-slate-950 text-slate-100">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-400">مستخدمو الكود</div>
            <div className="font-mono font-bold text-amber-200">{code.code}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="text-center text-slate-400 text-sm p-4">جاري التحميل...</div>
          ) : rows.length === 0 ? (
            <div className="text-center text-slate-400 text-sm p-4">لم يستخدم أحد هذا الكود بعد</div>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => {
                const name = r.display_name || r.user_id.slice(0, 8);
                return (
                  <div key={r.user_id} className="flex items-center gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <div className="text-2xl">{r.avatar_emoji || "🧑‍✈️"}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate">{name}</div>
                      <div className="text-[11px] text-slate-500">{new Date(r.redeemed_at).toLocaleString("ar")}</div>
                    </div>
                    <button
                      disabled={busy === r.user_id}
                      onClick={() => revoke(r.user_id, name)}
                      className="text-xs px-3 py-1.5 rounded-md bg-rose-700 hover:bg-rose-600 text-white font-bold disabled:opacity-50"
                    >↩️ إلغاء</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="px-4 py-2 border-t border-slate-800 text-[11px] text-slate-500">
          إلغاء الاستخدام يمسح السجل ويرجع العدّاد، فيقدر اللاعب يستخدم الكود من جديد.
        </div>
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
