/**
 * Ready-made prize catalog for admin pickers (Lucky Box…).
 *
 * Every option carries everything a prize row needs — type, item type, item id,
 * default amount, Arabic label and icon — so an admin only picks a prize and
 * all fields are filled automatically (no manual ids or names).
 */
import { CREWS } from "@/lib/crews";
import { WEAPONS } from "@/lib/weapons";
import { ALL_FRAMES, FRAME_KIND_TO_ITEM_TYPE } from "@/lib/frames";
import { BACKGROUNDS } from "@/lib/backgrounds";

export type PrizePreset = {
  key: string;
  group: string;
  name: string;
  icon: string;
  prize_type: "coins" | "gems" | "rubies" | "xp" | "item" | "dragon_equipment";
  item_type: string | null;
  item_id: string | null;
  amount: number;
};

const CURRENCY_PRESETS: PrizePreset[] = [
  { key: "coins:1000", group: "🪙 عملات", name: "1,000 عملة", icon: "🪙", prize_type: "coins", item_type: null, item_id: null, amount: 1000 },
  { key: "coins:100000", group: "🪙 عملات", name: "100,000 عملة", icon: "🪙", prize_type: "coins", item_type: null, item_id: null, amount: 100000 },
  { key: "coins:1000000", group: "🪙 عملات", name: "مليون عملة", icon: "🪙", prize_type: "coins", item_type: null, item_id: null, amount: 1000000 },
  { key: "coins:10000000", group: "🪙 عملات", name: "10 مليون عملة", icon: "🪙", prize_type: "coins", item_type: null, item_id: null, amount: 10000000 },
  { key: "coins:50000000", group: "🪙 عملات", name: "50 مليون عملة", icon: "🪙", prize_type: "coins", item_type: null, item_id: null, amount: 50000000 },
  { key: "gems:50", group: "💎 جواهر", name: "50 جوهرة", icon: "💎", prize_type: "gems", item_type: null, item_id: null, amount: 50 },
  { key: "gems:200", group: "💎 جواهر", name: "200 جوهرة", icon: "💎", prize_type: "gems", item_type: null, item_id: null, amount: 200 },
  { key: "gems:1000", group: "💎 جواهر", name: "1,000 جوهرة", icon: "💎", prize_type: "gems", item_type: null, item_id: null, amount: 1000 },
  { key: "gems:5000", group: "💎 جواهر", name: "5,000 جوهرة", icon: "💎", prize_type: "gems", item_type: null, item_id: null, amount: 5000 },
  { key: "rubies:5", group: "❤️ ياقوت", name: "5 ياقوت", icon: "❤️", prize_type: "rubies", item_type: null, item_id: null, amount: 5 },
  { key: "rubies:25", group: "❤️ ياقوت", name: "25 ياقوت", icon: "❤️", prize_type: "rubies", item_type: null, item_id: null, amount: 25 },
  { key: "xp:1000", group: "⭐ نقاط خبرة", name: "1,000 نقطة خبرة", icon: "⭐", prize_type: "xp", item_type: null, item_id: null, amount: 1000 },
  { key: "xp:10000", group: "⭐ نقاط خبرة", name: "10,000 نقطة خبرة", icon: "⭐", prize_type: "xp", item_type: null, item_id: null, amount: 10000 },
];

const SHIELD_PRESETS: PrizePreset[] = [
  { code: "shield_4h", name: "درع 4 ساعات" },
  { code: "shield_1d", name: "درع يوم" },
  { code: "shield_2d", name: "درع يومين" },
  { code: "shield_7d", name: "درع أسبوع" },
  { code: "shield_30d", name: "درع شهر" },
].map((s) => ({
  key: `item:shield:${s.code}`,
  group: "🛡️ دروع",
  name: s.name,
  icon: "🛡️",
  prize_type: "item" as const,
  item_type: "shield",
  item_id: s.code,
  amount: 1,
}));

const ANTI_PRESETS: PrizePreset[] = [
  { code: "anti_rocket", name: "مضاد صواريخ" },
  { code: "anti_nuke", name: "مضاد قنبلة ذرية" },
  { code: "anti_ad_bomb", name: "مضاد قنبلة إعلانية" },
].map((a) => ({
  key: `item:anti:${a.code}`,
  group: "🧪 مضادات",
  name: a.name,
  icon: "🧪",
  prize_type: "item" as const,
  item_type: "anti",
  item_id: a.code,
  amount: 1,
}));

const CREW_PRESETS: PrizePreset[] = CREWS.map((c) => ({
  key: `item:crew:${c.id}`,
  group: "👥 طواقم",
  name: c.name,
  icon: c.emoji || "👥",
  prize_type: "item" as const,
  item_type: "crew",
  item_id: c.id,
  amount: 1,
}));

const WEAPON_PRESETS: PrizePreset[] = WEAPONS.map((w) => ({
  key: `item:weapon:${w.id}`,
  group: "💥 أسلحة",
  name: w.name,
  icon: w.emoji || "💥",
  prize_type: "item" as const,
  item_type: "weapon",
  item_id: w.id,
  amount: 1,
}));

const FRAME_GROUP_AR: Record<string, string> = {
  frame: "🖼️ إطارات صورة",
  name_frame: "🏷️ إطارات اسم",
  bubble_frame: "💬 إطارات رسالة",
  profile_frame: "🪪 إطارات بطاقة",
};

const FRAME_PRESETS: PrizePreset[] = ALL_FRAMES.map((f) => {
  const itemType = FRAME_KIND_TO_ITEM_TYPE[f.kind] ?? "frame";
  return {
    key: `item:${itemType}:${f.id}`,
    group: FRAME_GROUP_AR[itemType] ?? "🖼️ إطارات",
    name: f.name,
    icon: f.preview ?? "🖼️",
    prize_type: "item" as const,
    item_type: itemType,
    item_id: f.id,
    amount: 1,
  };
});

const BACKGROUND_PRESETS: PrizePreset[] = BACKGROUNDS.map((b) => ({
  key: `item:background:${b.id}`,
  group: "🌅 خلفيات",
  name: b.name,
  icon: "🌅",
  prize_type: "item" as const,
  item_type: "background",
  item_id: b.id,
  amount: 1,
}));

const DRAGON_SLOT_AR: Record<string, string> = { weapon: "سلاح", armor: "درع", talisman: "تميمة" };
const DRAGON_RARITY_AR: Record<string, string> = {
  common: "عادي", rare: "نادر", epic: "ملحمي", legendary: "أسطوري", divine: "خرافي", fatak: "فتاك",
};

const DRAGON_PRESETS: PrizePreset[] = Object.keys(DRAGON_SLOT_AR).flatMap((slot) =>
  Object.keys(DRAGON_RARITY_AR).map((rarity) => ({
    key: `dragon:${slot}:${rarity}`,
    group: "🐉 معدات التنين",
    name: `${DRAGON_SLOT_AR[slot]} تنين ${DRAGON_RARITY_AR[rarity]}`,
    icon: "🐉",
    prize_type: "dragon_equipment" as const,
    item_type: slot,
    item_id: rarity,
    amount: 1,
  })),
);

export const PRIZE_PRESETS: PrizePreset[] = [
  ...CURRENCY_PRESETS,
  ...CREW_PRESETS,
  ...WEAPON_PRESETS,
  ...SHIELD_PRESETS,
  ...ANTI_PRESETS,
  ...FRAME_PRESETS,
  ...BACKGROUND_PRESETS,
  ...DRAGON_PRESETS,
];

export const PRIZE_PRESET_GROUPS: Array<{ group: string; items: PrizePreset[] }> = (() => {
  const map = new Map<string, PrizePreset[]>();
  for (const p of PRIZE_PRESETS) {
    const arr = map.get(p.group) ?? [];
    arr.push(p);
    map.set(p.group, arr);
  }
  return Array.from(map, ([group, items]) => ({ group, items }));
})();

export function findPreset(key: string): PrizePreset | undefined {
  return PRIZE_PRESETS.find((p) => p.key === key);
}

/** Key that matches a saved prize back to a preset (for the picker's value). */
export function presetKeyFor(p: {
  prize_type: string; item_type: string | null; item_id: string | null; amount: number;
}): string {
  if (p.prize_type === "item") return `item:${p.item_type ?? ""}:${p.item_id ?? ""}`;
  if (p.prize_type === "dragon_equipment") return `dragon:${p.item_type ?? ""}:${p.item_id ?? ""}`;
  return `${p.prize_type}:${p.amount}`;
}
