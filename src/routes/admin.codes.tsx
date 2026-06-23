import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DurationPicker } from "@/components/admin/DurationPicker";
import { CREWS } from "@/lib/crews";
import { WEAPONS } from "@/lib/weapons";
import { ALL_FRAMES, FRAME_KIND_TO_ITEM_TYPE } from "@/lib/frames";

import { ELITE_VIP_TIERS } from "@/lib/elite-vip";
import { formatSarFromUsd } from "@/lib/currency";
import { BACKGROUNDS } from "@/lib/backgrounds";
import { getShipByCode } from "@/lib/ships";

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

const ANTI_ITEMS: Array<{ code: string; name: string; kind: string }> = [
  { code: "anti_rocket",  name: "🚀 مضاد صواريخ",        kind: "anti" },
  { code: "anti_nuke",    name: "☢️ مضاد قنبلة ذرية",    kind: "anti" },
  { code: "anti_ad_bomb", name: "📺 مضاد قنبلة إعلانية", kind: "anti" },
];

// Local TS catalogs merged in so admin can bundle crews/weapons/frames/shields
// directly with proper Arabic names — without needing entries in items_catalog.
const KIND_LABEL: Record<string, string> = {
  crew: "👥 طواقم",
  weapon: "💥 أسلحة",
  shield: "🛡️ دروع",
  anti: "🧪 مضادات",
  frame: "🖼️ إطارات صورة",
  name_frame: "🏷️ إطارات اسم",
  bubble_frame: "💬 إطارات رسالة",
  profile_frame: "🪪 إطارات بطاقة",
  background: "🌅 خلفيات",
  misc: "📦 متفرقات",
};

const LOCAL_ITEMS: Array<{ code: string; name: string; kind: string }> = [
  ...CREWS.map((c) => ({ code: c.id, name: `${c.emoji} ${c.name}`, kind: "crew" })),
  ...WEAPONS.map((w) => ({ code: w.id, name: `${w.emoji} ${w.name}`, kind: "weapon" })),
  ...SHIELD_ITEMS,
  ...ANTI_ITEMS,
  ...ALL_FRAMES.map((f) => ({
    code: f.id,
    name: `${f.preview ?? "🖼️"} ${f.name}`,
    kind: FRAME_KIND_TO_ITEM_TYPE[f.kind],
  })),
  ...BACKGROUNDS.map((b) => ({ code: b.id, name: `🌅 ${b.name}`, kind: "background" })),
];

// Lookup: item code → Arabic name + image/emoji (used in code list rendering)
type ItemMeta = { name: string; image?: string; emoji?: string };
const ITEM_META: Record<string, ItemMeta> = {};
CREWS.forEach((c) => { ITEM_META[c.id] = { name: c.name, image: c.image, emoji: c.emoji }; });
WEAPONS.forEach((w) => { ITEM_META[w.id] = { name: w.name, image: w.image, emoji: w.emoji }; });
BACKGROUNDS.forEach((b) => { ITEM_META[b.id] = { name: b.name, image: b.image, emoji: "🌅" }; });
ALL_FRAMES.forEach((f) => { ITEM_META[f.id] = { name: f.name, image: f.imageUrl, emoji: f.preview }; });
SHIELD_ITEMS.forEach((s) => { ITEM_META[s.code] = { name: s.name, emoji: "🛡️" }; });

function getItemMeta(code: string, kind?: string): ItemMeta {
  if (ITEM_META[code]) return ITEM_META[code];
  if (kind === "ship") {
    try {
      const s = getShipByCode(code);
      return { name: s.name ?? code, image: s.image, emoji: "⛵" };
    } catch { /* fall through */ }
  }
  return { name: code, emoji: kind === "ship" ? "⛵" : "📦" };
}

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
  archived_at?: string | null;
  created_by?: string | null;
};

type CreatorMeta = { display_name: string | null; avatar_emoji: string | null };

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
  const [creators, setCreators] = useState<Record<string, CreatorMeta>>({});

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
    const rows = (data ?? []) as CodeRow[];
    setCodes(rows);
    setLoading(false);
    const adminIds = Array.from(new Set(rows.map((r) => r.created_by).filter(Boolean) as string[]));
    if (adminIds.length > 0) {
      const { data: ps } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_emoji")
        .in("id", adminIds);
      const map: Record<string, CreatorMeta> = {};
      (ps ?? []).forEach((p: { id: string; display_name: string | null; avatar_emoji: string | null }) => {
        map[p.id] = { display_name: p.display_name, avatar_emoji: p.avatar_emoji };
      });
      setCreators(map);
    }
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
    if (!confirm(`أرشفة الكود ${row.code}؟ سيختفي من القائمة، لكنك تقدر تجده من البحث وتسحب جوائزه من اللاعبين.`)) return;
    const { error } = await (supabase as any).rpc("admin_archive_code", { _code_id: row.id });
    if (error) return toast.error(error.message);
    toast.success("📦 تم الأرشفة");
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
      toast.info("لا يوجد أكواد منتهية أو مستنفدة");
      return;
    }
    if (!confirm(`أرشفة ${dead.length} كود منتهي/مستنفد؟ يقدر يرجع من البحث.`)) return;
    for (const c of dead) {
      await (supabase as any).rpc("admin_archive_code", { _code_id: c.id });
    }
    toast.success(`✅ تم أرشفة ${dead.length} كود`);
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

      <GrantToOnlinePanel codes={codes} />
      <RecentChatSendersPanel codes={codes} />



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
          <div className="text-[11px] text-emerald-300/80">🌅 الخلفيات ({BACKGROUNDS.length})</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {BACKGROUNDS.map((b) => (
              <button
                key={b.id}
                onClick={() => quickCreate({ rewardType: "item", itemId: b.id, itemKind: "background", label: `🌅 ${b.name}` })}
                className="px-2 py-2 rounded-lg bg-slate-800/70 hover:bg-amber-800/40 border border-slate-700 hover:border-amber-500 text-xs text-slate-100 text-right transition truncate"
                title={b.name}
              >
                🌅 {b.name}{quickQty > 1 ? <span className="text-amber-300"> × {quickQty}</span> : null}
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

      {/* ───────── إنشاء كود Elite VIP (اشتراك حصري 10 مستويات) ───────── */}
      <EliteVipCodeCreator onCreated={loadCodes} />



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

      {/* ───────── البحث عن كود مؤرشف ───────── */}
      <ArchivedLookup onOpenRedemptions={setRedemptionsFor} />

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
                  <div className="text-xs text-slate-400 mt-1 flex flex-wrap gap-x-3 gap-y-1 items-center">
                    {c.reward_type === "bundle" ? (
                      <span>{`💰 ${c.reward_coins} ذهب • 💎 ${c.reward_gems} جوهرة • ✨ ${c.reward_xp} خبرة`}</span>
                    ) : (() => {
                      const meta = getItemMeta(c.item_id ?? "", c.reward_type);
                      return (
                        <span className="inline-flex items-center gap-1.5">
                          {meta.image ? (
                            <img src={meta.image} alt="" className="w-5 h-5 rounded object-cover border border-slate-700" />
                          ) : (
                            <span>{meta.emoji ?? (c.reward_type === "ship" ? "⛵" : "📦")}</span>
                          )}
                          <span className="text-slate-200">{meta.name}</span>
                          <span className="text-slate-400">× {c.quantity}</span>
                        </span>
                      );
                    })()}
                    <span>
                      {c.max_uses === 0
                        ? `استُخدم ${c.uses_count} مرة (بلا حد)`
                        : `الاستخدام: ${c.uses_count}/${c.max_uses}`}
                    </span>
                    {c.expires_at && <span>ينتهي: {new Date(c.expires_at).toLocaleString("ar")}</span>}
                  </div>
                  {Array.isArray(c.extra_rewards) && c.extra_rewards.length > 0 && (
                    <div className="text-[11px] text-fuchsia-200 mt-1 flex flex-wrap gap-1 items-center">
                      <span className="font-bold text-fuchsia-300">🎁 مجمّع ({c.extra_rewards.length}):</span>
                      {c.extra_rewards.slice(0, 8).map((r, idx) => {
                        if ((r.type as string) === "coins" || !r.item_id) {
                          return (
                            <span key={idx} className="px-1.5 py-0.5 rounded bg-fuchsia-900/40 border border-fuchsia-800 inline-flex items-center gap-1">
                              💰 {r.coins ?? 0}🪙
                            </span>
                          );
                        }
                        const meta = getItemMeta(r.item_id, r.type);
                        return (
                          <span key={idx} className="px-1.5 py-0.5 rounded bg-fuchsia-900/40 border border-fuchsia-800 inline-flex items-center gap-1">
                            {meta.image ? (
                              <img src={meta.image} alt="" className="w-4 h-4 rounded object-cover border border-fuchsia-800/60" />
                            ) : (
                              <span>{meta.emoji ?? (r.type === "ship" ? "⛵" : "📦")}</span>
                            )}
                            <span>{meta.name}</span>
                            {r.quantity && r.quantity > 1 ? <span className="opacity-80">×{r.quantity}</span> : null}
                          </span>
                        );
                      })}
                      {c.extra_rewards.length > 8 && <span>… +{c.extra_rewards.length - 8}</span>}
                    </div>
                  )}
                  {c.note && <div className="text-[11px] text-slate-500 mt-0.5">📝 {c.note}</div>}
                  <div className="text-[11px] text-emerald-300/80 mt-0.5">
                    👤 أنشأها: {c.created_by
                      ? `${creators[c.created_by]?.avatar_emoji ?? "🧑‍✈️"} ${creators[c.created_by]?.display_name ?? c.created_by.slice(0, 8)}`
                      : "—"}
                    {" • "}
                    <span className="text-slate-500">{new Date(c.created_at).toLocaleString("ar")}</span>
                  </div>
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
    if (!confirm(`إلغاء استخدام الكود من ${name}؟\n\nسيتم سحب كل الجوائز التي حصل عليها (ذهب/جواهر/خبرة/عناصر/سفن) ويصير الكود متاحاً له من جديد.`)) return;
    setBusy(userId);
    const { error } = await (supabase as any).rpc("admin_revoke_redemption", { _code_id: code.id, _user_id: userId, _reclaim: true });
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
          الإلغاء يسحب كل جوائز الكود من اللاعب (ذهب/جواهر/خبرة/عناصر/سفن) ويُعيد له حق الاستخدام.
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

function ArchivedLookup({ onOpenRedemptions }: { onOpenRedemptions: (c: CodeRow) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CodeRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  const search = async () => {
    const term = q.trim();
    if (!term) return;
    setSearching(true);
    const { data, error } = await (supabase as any).rpc("admin_find_codes", { _q: term.toUpperCase() });
    setSearching(false);
    if (error) return toast.error(error.message);
    setResults((data ?? []) as CodeRow[]);
  };

  return (
    <div className="rounded-xl border border-amber-800/60 bg-amber-950/20 p-3 md:p-4 space-y-2">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between text-sm font-bold text-amber-200">
        <span>🔍 البحث عن كود (يشمل المحذوفة/المؤرشفة)</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <>
          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="ادخل الكود أو جزء منه..."
              className="flex-1 bg-slate-900 border border-amber-700 rounded-md px-3 py-2 text-sm font-mono text-amber-100"
            />
            <button
              onClick={search}
              disabled={searching || !q.trim()}
              className="px-4 py-2 rounded-md bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm disabled:opacity-50"
            >{searching ? "..." : "بحث"}</button>
          </div>
          {results.length > 0 && (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {results.map((c) => (
                <div key={c.id} className="flex items-center gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="font-mono font-bold text-amber-200">{c.code}</code>
                      {c.archived_at && <span className="text-[10px] px-2 py-0.5 rounded bg-stone-700 text-stone-200">📦 مؤرشف</span>}
                      <span className="text-[11px] text-slate-400">استُخدم {c.uses_count}×</span>
                    </div>
                    {c.note && <div className="text-[11px] text-slate-500 truncate">{c.note}</div>}
                  </div>
                  <button
                    onClick={() => onOpenRedemptions(c)}
                    className="text-xs px-3 py-1.5 rounded-md bg-indigo-700 hover:bg-indigo-600 text-white font-bold"
                  >👥 المستخدمون</button>
                </div>
              ))}
            </div>
          )}
          {q && !searching && results.length === 0 && (
            <div className="text-xs text-slate-500 text-center p-2">لم يتم البحث بعد أو لا نتائج</div>
          )}
        </>
      )}
    </div>
  );
}



// ════════════════════════════════════════════════════════════════════
// 💎 Elite VIP Code Creator — grants exclusive 5-tier subscription perks
// ════════════════════════════════════════════════════════════════════
function EliteVipCodeCreator({ onCreated }: { onCreated: () => void }) {
  const [level, setLevel] = useState<number>(1);
  const [days, setDays] = useState<number>(30);
  const [maxUses, setMaxUses] = useState(1);
  const [dist, setDist] = useState<"limited" | "public">("limited");
  const [customCode, setCustomCode] = useState("");
  const [saving, setSaving] = useState(false);
  const tier = ELITE_VIP_TIERS.find((t) => t.level === level);

  const create = async () => {
    const finalCode = (customCode.trim() || randomCode()).toUpperCase();
    if (!/^[A-Z0-9_-]{4,32}$/.test(finalCode)) { toast.error("الكود يجب أن يكون 4–32 حرف/رقم"); return; }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("redemption_codes" as never).insert({
      code: finalCode,
      reward_type: "bundle",
      reward_coins: 0, reward_gems: 0, reward_xp: 0,
      quantity: 1,
      max_uses: dist === "public" ? 0 : Math.max(1, maxUses),
      expires_at: null,
      note: `💎 Elite VIP ${level} ${tier?.nameAr ?? ""} — ${days === 0 ? "دائم" : `${days} يوم`}`,
      extra_rewards: [],
      reward_vip_level: 0,
      reward_vip_days: 0,
      reward_elite_vip_level: level,
      reward_elite_vip_days: days,
      created_by: user?.id,
    } as never);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    try { await navigator.clipboard.writeText(finalCode); } catch { /* ignore */ }
    toast.success(`✅ ${finalCode} — تم النسخ`);
    setCustomCode("");
    onCreated();
  };

  return (
    <div className="rounded-xl border-2 border-fuchsia-500/60 bg-gradient-to-br from-purple-950/60 via-fuchsia-950/40 to-amber-950/30 p-3 md:p-4 space-y-3 shadow-[0_0_30px_rgba(232,121,249,0.25)]">
      <div className="text-sm font-bold text-fuchsia-200 flex items-center gap-2">
        💎 إنشاء كود Elite VIP — يفعّل اشتراك حصري (5 مستويات)
        <span className="text-[10px] px-2 py-0.5 rounded bg-fuchsia-500/30 text-fuchsia-100 border border-fuchsia-400/50">حصري — لا يُكتسب باللعب</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <label className="text-xs text-fuchsia-200 space-y-1">
          <span>مستوى Elite VIP</span>
          <select value={level} onChange={(e) => setLevel(Number(e.target.value))}
            className="w-full bg-slate-800 border border-fuchsia-700 rounded-md px-2 py-1.5 text-sm text-slate-100">
            {ELITE_VIP_TIERS.map((t) => (
              <option key={t.level} value={t.level}>{t.emoji} Elite {t.level} — {t.nameAr}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-fuchsia-200 space-y-1">
          <span>المدة بالأيام (0 = دائم)</span>
          <input type="number" min={0} value={days}
            onChange={(e) => setDays(Math.max(0, Number(e.target.value) || 0))}
            className="w-full bg-slate-800 border border-fuchsia-700 rounded-md px-2 py-1.5 text-sm text-slate-100 text-center font-bold" />
        </label>
        <label className="text-xs text-fuchsia-200 space-y-1">
          <span>التوزيع</span>
          <select value={dist} onChange={(e) => setDist(e.target.value as "limited" | "public")}
            className="w-full bg-slate-800 border border-fuchsia-700 rounded-md px-2 py-1.5 text-sm text-slate-100">
            <option value="limited">🔒 محدود</option>
            <option value="public">🌍 للجميع — مرة لكل لاعب</option>
          </select>
        </label>
        {dist === "limited" && (
          <label className="text-xs text-fuchsia-200 space-y-1">
            <span>عدد الاستخدامات</span>
            <input type="number" min={1} value={maxUses}
              onChange={(e) => setMaxUses(Math.max(1, Number(e.target.value) || 1))}
              className="w-full bg-slate-800 border border-fuchsia-700 rounded-md px-2 py-1.5 text-sm text-slate-100 text-center font-bold" />
          </label>
        )}
      </div>

      <label className="block text-xs text-fuchsia-200 space-y-1">
        <span>الكود (فارغ = توليد تلقائي)</span>
        <input value={customCode} onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
          placeholder="مثلاً: ELITE5DRAGON"
          className="w-full bg-slate-800 border border-fuchsia-700 rounded-md px-2 py-1.5 text-sm text-slate-100 font-mono tracking-wider" />
      </label>

      {tier && (
        <div className="text-[11px] text-fuchsia-100/90 bg-black/40 rounded-lg p-2 border border-fuchsia-900/60">
          <div className="font-bold mb-1 flex items-center gap-2">
            <img src={tier.badge} alt="" className="w-8 h-8 object-contain" />
            {tier.emoji} Elite VIP {tier.level} — {tier.nameAr} ({formatSarFromUsd(tier.monthlyPriceUsd)}/شهر)
          </div>
          <ul className="space-y-0.5 pr-3">
            {tier.perks.map((p, i) => <li key={i}>• {p}</li>)}
          </ul>
        </div>
      )}

      <button disabled={saving} onClick={create}
        className="w-full md:w-auto px-4 py-2 rounded-lg bg-gradient-to-b from-fuchsia-500 to-purple-700 hover:from-fuchsia-400 hover:to-purple-600 text-white font-extrabold disabled:opacity-50 shadow-lg">
        {saving ? "جاري الإنشاء..." : "💎 إنشاء كود Elite VIP ونسخه"}
      </button>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// 🎁 Send a code to all online players (or those online within X minutes)
// ════════════════════════════════════════════════════════════════════
function GrantToOnlinePanel({ codes }: { codes: CodeRow[] }) {
  const [selectedCode, setSelectedCode] = useState<string>("");
  const [withinMin, setWithinMin] = useState<number>(0); // 0 = currently online only
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);

  const refreshPreview = useCallback(async (mins: number) => {
    setLoadingPreview(true);
    const { data, error } = await (supabase as any).rpc("admin_count_online", { _within_minutes: mins });
    setLoadingPreview(false);
    if (error) { setPreviewCount(null); return; }
    setPreviewCount(Number(data ?? 0));
  }, []);

  useEffect(() => {
    refreshPreview(withinMin);
  }, [withinMin, refreshPreview]);

  const activeCodes = useMemo(
    () => codes.filter((c) => c.active && (!c.expires_at || new Date(c.expires_at) > new Date())),
    [codes]
  );

  const send = async () => {
    if (!selectedCode) { toast.error("اختر كوداً"); return; }
    const target = previewCount ?? 0;
    const label = withinMin === 0 ? "المتصلين الآن" : `المتصلين خلال آخر ${withinMin} دقيقة`;
    if (!confirm(`إرسال الكود ${selectedCode} إلى ${target} لاعب (${label})؟`)) return;
    setSending(true);
    const { data, error } = await (supabase as any).rpc("admin_grant_code_to_online", {
      _code: selectedCode,
      _within_minutes: withinMin,
    });
    setSending(false);
    if (error) { toast.error(error.message); return; }
    const row = Array.isArray(data) ? data[0] : data;
    toast.success(`✅ تم: ${row?.granted ?? 0} لاعب • فشل: ${row?.failed ?? 0} • الإجمالي: ${row?.targeted ?? 0}`);
    refreshPreview(withinMin);
  };

  const presets = [
    { label: "🟢 المتصلين الآن", mins: 0 },
    { label: "🕐 آخر 10 دقائق", mins: 10 },
    { label: "🕐 آخر 30 دقيقة", mins: 30 },
    { label: "🕐 آخر ساعة", mins: 60 },
    { label: "🕐 آخر 3 ساعات", mins: 180 },
    { label: "🕐 آخر 24 ساعة", mins: 1440 },
  ];

  return (
    <div className="rounded-xl border border-fuchsia-700/60 bg-fuchsia-950/30 p-3 md:p-4 space-y-3">
      <div className="text-sm font-bold text-fuchsia-200">🎁 إرسال كود للاعبين المتصلين</div>
      <div className="text-[12px] text-fuchsia-100/80">
        اختر كوداً موجوداً وحدّد فترة آخر اتصال — راح يُسلّم لكل لاعب متصل خلال الفترة هدية الكود تلقائياً (يدخلها بدون ما يكتب أي شي).
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="text-xs text-fuchsia-200 space-y-1">
          <span>الكود</span>
          <select
            value={selectedCode}
            onChange={(e) => setSelectedCode(e.target.value)}
            className="w-full bg-slate-800 border border-fuchsia-700 rounded-md px-2 py-1.5 text-sm text-slate-100"
          >
            <option value="">— اختر كوداً —</option>
            {activeCodes.map((c) => (
              <option key={c.id} value={c.code}>
                {c.code} {c.note ? `• ${c.note}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-fuchsia-200 space-y-1">
          <span>الفترة (بالدقائق) — 0 = المتصلين الآن</span>
          <input
            type="number"
            min={0}
            value={withinMin}
            onChange={(e) => setWithinMin(Math.max(0, Number(e.target.value) || 0))}
            className="w-full bg-slate-800 border border-fuchsia-700 rounded-md px-2 py-1.5 text-sm text-slate-100 text-center font-bold"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p.mins}
            onClick={() => setWithinMin(p.mins)}
            className={`px-2 py-1 rounded-md text-[12px] border transition ${
              withinMin === p.mins
                ? "bg-fuchsia-700 border-fuchsia-400 text-white"
                : "bg-slate-800/60 border-slate-700 text-slate-200 hover:border-fuchsia-500"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="text-sm text-fuchsia-100">
          🎯 المستهدفون:{" "}
          <b className="text-white">
            {loadingPreview ? "..." : (previewCount ?? "—")}
          </b>{" "}
          لاعب
        </div>
        <button
          onClick={send}
          disabled={sending || !selectedCode || (previewCount ?? 0) <= 0}
          className="px-4 py-2 rounded-lg bg-gradient-to-b from-fuchsia-500 to-fuchsia-700 hover:from-fuchsia-400 hover:to-fuchsia-600 text-white font-extrabold disabled:opacity-50"
        >
          {sending ? "جاري الإرسال..." : "🎁 إرسال الكود الآن"}
        </button>
      </div>
    </div>
  );
}

// ─── آخر من كتب في الشات العام ───
type RecentSender = {
  sender_id: string;
  display_name: string;
  avatar_url: string | null;
  last_body: string;
  last_at: string;
  msg_count: number;
  distinct_count: number;
};

function RecentChatSendersPanel({ codes }: { codes: CodeRow[] }) {
  const [rows, setRows] = useState<RecentSender[]>([]);
  const [limit, setLimit] = useState<number>(() => {
    const v = Number(localStorage.getItem("contest:limit") || "10");
    return Number.isFinite(v) && v > 0 ? Math.min(50, v) : 10;
  });
  const [since, setSince] = useState<string | null>(() => localStorage.getItem("contest:since"));
  const [loading, setLoading] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string>("");
  const [granting, setGranting] = useState(false);
  const [grantedIds, setGrantedIds] = useState<Set<string>>(new Set());

  const activeCodes = useMemo(
    () => codes.filter((c) => c.active && (!c.expires_at || new Date(c.expires_at) > new Date())),
    [codes]
  );

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("admin_recent_chat_senders", {
      _limit: limit,
      _since: since,
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setRows((data ?? []) as RecentSender[]);
  }, [limit, since]);

  useEffect(() => { load(); }, [load]);

  // Realtime: أي رسالة جديدة في الشات العام تحدّث القائمة فوراً
  useEffect(() => {
    const ch = supabase
      .channel("admin-recent-senders")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: "channel=eq.public" },
        () => { load(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const startContest = () => {
    const now = new Date().toISOString();
    setSince(now);
    setGrantedIds(new Set());
    localStorage.setItem("contest:since", now);
    toast.success("🚩 بدأت المسابقة — اطلب من اللاعبين الكتابة الآن");
  };

  const resetContest = () => {
    setSince(null);
    setGrantedIds(new Set());
    localStorage.removeItem("contest:since");
    toast.info("تمت إعادة التعيين");
  };

  const updateLimit = (n: number) => {
    const v = Math.max(1, Math.min(50, n || 10));
    setLimit(v);
    localStorage.setItem("contest:limit", String(v));
  };

  const grantAll = async () => {
    if (!selectedCode) { toast.error("اختر كوداً أولاً"); return; }
    const targets = rows.filter((r) => !grantedIds.has(r.sender_id));
    if (targets.length === 0) { toast.info("لا يوجد من يستلم"); return; }
    if (!confirm(`تفعيل الكود ${selectedCode} لـ ${targets.length} لاعب؟`)) return;
    setGranting(true);
    let ok = 0, fail = 0;
    const reasons: Record<string, number> = {};
    const newGranted = new Set(grantedIds);
    await Promise.all(targets.map(async (r) => {
      const { error } = await (supabase as any).rpc("admin_redeem_code_for", {
        p_code: selectedCode,
        p_target_user: r.sender_id,
      });
      if (error) {
        fail++;
        const raw = String(error.message || error);
        const key = (raw.match(/(already_redeemed|code_exhausted|code_expired|code_disabled|invalid_code|admin_only|invalid_target|not_authenticated)/) || [, raw])[1];
        reasons[key] = (reasons[key] || 0) + 1;
      } else {
        ok++;
        newGranted.add(r.sender_id);
      }
    }));
    setGrantedIds(newGranted);
    setGranting(false);
    const reasonMap: Record<string, string> = {
      already_redeemed: "مفعّل مسبقاً لنفس الكود",
      code_exhausted: "نفذ الحد الأقصى للاستخدامات",
      code_expired: "الكود منتهي",
      code_disabled: "الكود معطّل",
      invalid_code: "كود غير صالح",
      admin_only: "ليس لديك صلاحية",
      invalid_target: "مستخدم غير صالح",
      not_authenticated: "غير مسجل دخول",
    };
    if (fail === 0) {
      toast.success(`✅ تم تفعيل ${selectedCode} لـ ${ok} لاعب`);
    } else {
      const details = Object.entries(reasons)
        .map(([k, n]) => `${reasonMap[k] || k}: ${n}`)
        .join(" • ");
      toast.warning(`نجح: ${ok} • فشل: ${fail} — السبب: ${details}`, { duration: 10000 });
    }
  };

  const timeAgo = (iso: string) => {
    const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return `${s}ث`;
    const m = Math.floor(s / 60); if (m < 60) return `${m}د`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}س`;
    return `${Math.floor(h / 24)}ي`;
  };

  return (
    <div className="rounded-xl border border-cyan-700/60 bg-cyan-950/30 p-3 md:p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-bold text-cyan-200">🏁 مسابقة الشات العام — تفعيل كود فوري</div>
        {since ? (
          <div className="text-[11px] text-emerald-300">
            🟢 المسابقة بدأت منذ {timeAgo(since)}
          </div>
        ) : (
          <div className="text-[11px] text-slate-400">— لم تبدأ بعد —</div>
        )}
      </div>

      <div className="text-[12px] text-cyan-100/80 leading-relaxed">
        1) اختر الكود والعدد. 2) اضغط «ابدأ المسابقة» وقل في الشات «اكتبوا». 3) القائمة تتحدّث فورياً. 4) اضغط «🎁 فعّل لكل الكاتبين» لإرسال الكود لجميعهم دفعة واحدة.
        <br />
        <span className="text-amber-200">⚠️ يتم تلقائياً استبعاد من يكرّر نفس الرسالة (سبام).</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="text-xs text-cyan-200 space-y-1">
          <span>الكود</span>
          <select
            value={selectedCode}
            onChange={(e) => setSelectedCode(e.target.value)}
            className="w-full bg-slate-800 border border-cyan-700 rounded-md px-2 py-1.5 text-sm text-slate-100"
          >
            <option value="">— اختر كوداً —</option>
            {activeCodes.map((c) => (
              <option key={c.id} value={c.code}>
                {c.code} {c.note ? `• ${c.note}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-cyan-200 space-y-1">
          <span>عدد الفائزين (آخر من كتبوا)</span>
          <input
            type="number" min={1} max={50}
            value={limit}
            onChange={(e) => updateLimit(Number(e.target.value))}
            className="w-full bg-slate-800 border border-cyan-700 rounded-md px-2 py-1.5 text-sm text-slate-100 text-center font-bold"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        {!since ? (
          <button
            onClick={startContest}
            className="px-3 py-2 rounded-lg bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-400 hover:to-emerald-600 text-white font-extrabold text-sm"
          >
            🚩 ابدأ المسابقة الآن
          </button>
        ) : (
          <button
            onClick={resetContest}
            className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm"
          >
            ↺ إعادة تعيين
          </button>
        )}
        <button
          onClick={grantAll}
          disabled={granting || !selectedCode || rows.length === 0}
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-gradient-to-b from-fuchsia-500 to-fuchsia-700 hover:from-fuchsia-400 hover:to-fuchsia-600 text-white font-extrabold text-sm disabled:opacity-50"
        >
          {granting ? "جارٍ التفعيل…" : `🎁 فعّل لكل الكاتبين (${rows.filter((r) => !grantedIds.has(r.sender_id)).length})`}
        </button>
      </div>

      <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
        <div className="text-[11px] text-cyan-200/70 px-1">
          {loading ? "…تحديث" : `${rows.length} لاعب${since ? " (منذ بداية المسابقة)" : " (آخر 7 أيام)"}`}
        </div>
        {rows.length === 0 ? (
          <div className="text-center text-cyan-200/70 text-sm py-4">
            {since ? "في انتظار الرسائل…" : "لا توجد رسائل حديثة"}
          </div>
        ) : rows.map((r, idx) => {
          const granted = grantedIds.has(r.sender_id);
          return (
            <div
              key={r.sender_id}
              className={`flex items-center gap-2 border rounded-lg px-2 py-1.5 ${
                granted ? "bg-emerald-950/40 border-emerald-700" : "bg-slate-900/60 border-slate-700"
              }`}
            >
              <div className="w-6 text-center text-[11px] font-black text-cyan-300">#{idx + 1}</div>
              {r.avatar_url ? (
                <img src={r.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover border border-cyan-700" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-slate-700 grid place-items-center text-sm">⚓</div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <div className="text-sm font-bold text-white truncate">{r.display_name}</div>
                  <div className="text-[10px] text-cyan-300/70 shrink-0">• {timeAgo(r.last_at)}</div>
                  <div className="text-[10px] bg-slate-700 text-cyan-200 px-1.5 rounded shrink-0" title="عدد الرسائل / المختلفة">
                    {r.msg_count}/{r.distinct_count}
                  </div>
                  {granted && <div className="text-[10px] bg-emerald-700 text-white px-1.5 rounded shrink-0">✓ تم</div>}
                </div>
                <div className="text-[11px] text-slate-300 truncate">{r.last_body}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
