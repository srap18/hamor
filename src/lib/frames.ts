// Cosmetic frames — equipped on avatar or name in HUD.
// `ring` is a Tailwind class chunk applied to the avatar wrapper.
// `nameClass` is applied to the display name container.

export type Frame = {
  id: string;
  name: string;
  kind: "avatar" | "name";
  price: number;
  currency: "gem";
  rarity: "common" | "rare" | "epic" | "legendary" | "mythic";
  ring?: string;     // avatar frame styles (border / shadow / gradient ring)
  nameClass?: string; // name frame styles (background pill / glow / gradient text)
  preview: string;   // emoji or short label for catalog
};

export const AVATAR_FRAMES: Frame[] = [
  {
    id: "af_bronze", name: "إطار برونزي", kind: "avatar",
    price: 500, currency: "gem", rarity: "common", preview: "🟫",
    ring: "ring-2 ring-amber-200/60 outline outline-4 outline-amber-800 shadow-[0_0_18px_rgba(180,90,30,0.7),inset_0_0_10px_rgba(255,200,120,0.4)]",
  },
  {
    id: "af_silver", name: "إطار فضي", kind: "avatar",
    price: 2000, currency: "gem", rarity: "rare", preview: "⚪",
    ring: "ring-2 ring-white/70 outline outline-4 outline-slate-400 shadow-[0_0_22px_rgba(200,210,230,0.85),inset_0_0_14px_rgba(255,255,255,0.5)]",
  },
  {
    id: "af_gold", name: "إطار ذهبي", kind: "avatar",
    price: 6000, currency: "gem", rarity: "epic", preview: "🟡",
    ring: "ring-2 ring-amber-100 outline outline-[5px] outline-amber-500 shadow-[0_0_28px_rgba(251,191,36,1),inset_0_0_18px_rgba(255,235,150,0.6)]",
  },
  {
    id: "af_emerald", name: "إطار زمردي", kind: "avatar",
    price: 9000, currency: "gem", rarity: "epic", preview: "🟢",
    ring: "ring-2 ring-emerald-100 outline outline-[5px] outline-emerald-500 shadow-[0_0_30px_rgba(52,211,153,1),inset_0_0_18px_rgba(167,243,208,0.6)]",
  },
  {
    id: "af_ruby", name: "إطار ياقوتي", kind: "avatar",
    price: 18000, currency: "gem", rarity: "legendary", preview: "🔴",
    ring: "ring-2 ring-rose-100 outline outline-[5px] outline-rose-600 shadow-[0_0_36px_rgba(244,63,94,1),0_0_60px_rgba(244,63,94,0.6),inset_0_0_20px_rgba(255,200,210,0.6)]",
  },
  {
    id: "af_diamond", name: "إطار ماسي", kind: "avatar",
    price: 45000, currency: "gem", rarity: "mythic", preview: "💎",
    ring: "ring-2 ring-white outline outline-[6px] outline-cyan-300 shadow-[0_0_44px_rgba(103,232,249,1),0_0_80px_rgba(165,243,252,0.7),inset_0_0_22px_rgba(255,255,255,0.8)] animate-pulse",
  },
  {
    id: "af_dragon", name: "إطار التنين", kind: "avatar",
    price: 90000, currency: "gem", rarity: "mythic", preview: "🐉",
    ring: "ring-2 ring-amber-200 outline outline-[6px] outline-fuchsia-600 shadow-[0_0_48px_rgba(232,121,249,1),0_0_90px_rgba(251,191,36,0.6),inset_0_0_24px_rgba(255,215,255,0.7)] animate-pulse",
  },
  {
    id: "af_phoenix", name: "إطار العنقاء", kind: "avatar",
    price: 120000, currency: "gem", rarity: "mythic", preview: "🔥",
    ring: "ring-2 ring-amber-100 outline outline-[6px] outline-orange-600 shadow-[0_0_50px_rgba(251,146,60,1),0_0_100px_rgba(244,63,94,0.7),inset_0_0_24px_rgba(255,220,180,0.8)] animate-pulse",
  },
  {
    id: "af_imperial", name: "إطار الإمبراطور", kind: "avatar",
    price: 200000, currency: "gem", rarity: "mythic", preview: "👑",
    ring: "ring-2 ring-amber-200 outline outline-[7px] outline-amber-600 shadow-[0_0_55px_rgba(251,191,36,1),0_0_110px_rgba(168,85,247,0.6),inset_0_0_26px_rgba(255,240,180,0.9)] animate-pulse",
  },
];

export const NAME_FRAMES: Frame[] = [
  {
    id: "nf_simple", name: "لوحة بسيطة", kind: "name",
    price: 300, currency: "gem", rarity: "common", preview: "Aa",
    nameClass: "bg-gradient-to-b from-stone-700 to-stone-900 border-2 border-stone-400 text-stone-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]",
  },
  {
    id: "nf_sky", name: "لوحة سماوية", kind: "name",
    price: 1500, currency: "gem", rarity: "rare", preview: "Aa",
    nameClass: "bg-gradient-to-r from-sky-600 via-cyan-500 to-sky-800 border-2 border-sky-200 text-white shadow-[0_0_14px_rgba(56,189,248,0.7),inset_0_1px_0_rgba(255,255,255,0.3)]",
  },
  {
    id: "nf_gold", name: "لوحة ذهبية", kind: "name",
    price: 5000, currency: "gem", rarity: "epic", preview: "Aa",
    nameClass: "bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-700 border-2 border-amber-100 text-amber-950 font-extrabold shadow-[0_0_18px_rgba(251,191,36,0.9),inset_0_1px_0_rgba(255,255,255,0.5)]",
  },
  {
    id: "nf_emerald", name: "لوحة زمردية", kind: "name",
    price: 8000, currency: "gem", rarity: "epic", preview: "Aa",
    nameClass: "bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-800 border-2 border-emerald-100 text-white shadow-[0_0_18px_rgba(52,211,153,0.9),inset_0_1px_0_rgba(255,255,255,0.4)]",
  },
  {
    id: "nf_royal", name: "لوحة ملكية", kind: "name",
    price: 22000, currency: "gem", rarity: "legendary", preview: "👑",
    nameClass: "bg-gradient-to-r from-violet-600 via-purple-500 to-fuchsia-700 border-2 border-fuchsia-200 text-white font-extrabold shadow-[0_0_22px_rgba(232,121,249,1),0_0_40px_rgba(168,85,247,0.5),inset_0_1px_0_rgba(255,255,255,0.4)]",
  },
  {
    id: "nf_legend", name: "لوحة الأسطورة", kind: "name",
    price: 60000, currency: "gem", rarity: "mythic", preview: "🏆",
    nameClass: "bg-gradient-to-r from-amber-400 via-rose-500 to-fuchsia-600 border-2 border-amber-200 text-white font-extrabold shadow-[0_0_28px_rgba(251,191,36,1),0_0_50px_rgba(232,121,249,0.6),inset_0_1px_0_rgba(255,255,255,0.5)] animate-pulse",
  },
  {
    id: "nf_inferno", name: "لوحة الجحيم", kind: "name",
    price: 80000, currency: "gem", rarity: "mythic", preview: "🔥",
    nameClass: "bg-gradient-to-r from-orange-500 via-red-500 to-rose-700 border-2 border-amber-200 text-white font-extrabold shadow-[0_0_28px_rgba(251,146,60,1),0_0_55px_rgba(239,68,68,0.6),inset_0_1px_0_rgba(255,255,255,0.4)] animate-pulse",
  },
  {
    id: "nf_abyss", name: "لوحة الأعماق", kind: "name",
    price: 100000, currency: "gem", rarity: "mythic", preview: "🌊",
    nameClass: "bg-gradient-to-r from-cyan-400 via-blue-600 to-indigo-800 border-2 border-cyan-100 text-white font-extrabold shadow-[0_0_28px_rgba(103,232,249,1),0_0_55px_rgba(59,130,246,0.6),inset_0_1px_0_rgba(255,255,255,0.5)] animate-pulse",
  },
];

export const ALL_FRAMES: Frame[] = [...AVATAR_FRAMES, ...NAME_FRAMES];

export function frameById(id?: string | null): Frame | undefined {
  if (!id) return undefined;
  return ALL_FRAMES.find((f) => f.id === id);
}

// ============================================================
// Store offers — gem packs, coin packs, bundles & VIP
// ============================================================

export type OfferReward = {
  gems?: number;
  coins?: number;
  bgIds?: string[];   // background IDs unlocked
  frameIds?: string[]; // frame IDs unlocked
  rubies?: number;
};

export type Pack = {
  id: string;
  label: string;
  emoji: string;
  amount: number;        // legacy: gems granted (for backward compat)
  currency: "gem";
  priceUSD: number;
  bonus?: string;
  popular?: boolean;
  category: "gems" | "coins" | "bundle" | "vip";
  reward: OfferReward;
  tag?: string;          // e.g. "أفضل قيمة", "محدود", "جديد"
  description?: string;
};

export const GEM_PACKS: Pack[] = [
  // ─── Gems ───────────────────────────────────────────────
  { id: "gp_100",   category: "gems", label: "حفنة جواهر",     emoji: "💎", amount: 100,   currency: "gem", priceUSD: 0.99,  reward: { gems: 100 } },
  { id: "gp_550",   category: "gems", label: "كيس جواهر",       emoji: "💎", amount: 550,   currency: "gem", priceUSD: 4.99,  bonus: "+10%", reward: { gems: 550 }, tag: "جديد" },
  { id: "gp_1200",  category: "gems", label: "صندوق جواهر",     emoji: "💠", amount: 1200,  currency: "gem", priceUSD: 9.99,  bonus: "+20%", popular: true, reward: { gems: 1200 } },
  { id: "gp_3200",  category: "gems", label: "كنز الجواهر",     emoji: "💠", amount: 3200,  currency: "gem", priceUSD: 24.99, bonus: "+30%", reward: { gems: 3200 } },
  { id: "gp_7000",  category: "gems", label: "خزائن السفينة",   emoji: "🌊", amount: 7000,  currency: "gem", priceUSD: 49.99, bonus: "+40%", reward: { gems: 7000 } },
  { id: "gp_16000", category: "gems", label: "ثروة الإمبراطور", emoji: "👑", amount: 16000, currency: "gem", priceUSD: 99.99, bonus: "+60%", reward: { gems: 16000 }, tag: "أفضل قيمة" },

  // ─── Coins (Gold) ────────────────────────────────────────
  { id: "cp_10k",   category: "coins", label: "كيس ذهب صغير",   emoji: "🪙", amount: 0, currency: "gem", priceUSD: 1.99,  reward: { coins: 10_000 } },
  { id: "cp_60k",   category: "coins", label: "صندوق ذهب",      emoji: "💰", amount: 0, currency: "gem", priceUSD: 9.99,  bonus: "+15%", reward: { coins: 60_000 } },
  { id: "cp_180k",  category: "coins", label: "خزنة ذهب",       emoji: "💰", amount: 0, currency: "gem", priceUSD: 24.99, bonus: "+25%", popular: true, reward: { coins: 180_000 } },
  { id: "cp_500k",  category: "coins", label: "كنز القراصنة",    emoji: "🏴‍☠️", amount: 0, currency: "gem", priceUSD: 49.99, bonus: "+40%", reward: { coins: 500_000 } },
  { id: "cp_1m",    category: "coins", label: "جزيرة الذهب",    emoji: "🏝️", amount: 0, currency: "gem", priceUSD: 99.99, bonus: "+60%", reward: { coins: 1_200_000 }, tag: "أفضل قيمة" },

  // ─── Bundles ─────────────────────────────────────────────
  {
    id: "bd_starter", category: "bundle", label: "باقة المبتدئ",  emoji: "⚓",
    amount: 0, currency: "gem", priceUSD: 2.99, tag: "لمرة واحدة فقط",
    description: "500 💎 + 25,000 🪙 + خلفية الميناء",
    reward: { gems: 500, coins: 25_000, bgIds: ["harbor"] },
  },
  {
    id: "bd_captain", category: "bundle", label: "باقة القبطان",  emoji: "🧭",
    amount: 0, currency: "gem", priceUSD: 9.99, popular: true,
    description: "1500 💎 + 100,000 🪙 + إطار ذهبي",
    reward: { gems: 1500, coins: 100_000, frameIds: ["af_gold"] },
  },
  {
    id: "bd_admiral", category: "bundle", label: "باقة الأميرال", emoji: "⚔️",
    amount: 0, currency: "gem", priceUSD: 24.99,
    description: "4000 💎 + 300,000 🪙 + خلفيتان + إطار ياقوتي",
    reward: { gems: 4000, coins: 300_000, bgIds: ["sunset", "tropical"], frameIds: ["af_ruby"] },
  },
  {
    id: "bd_legend", category: "bundle", label: "باقة الأسطورة",  emoji: "🐉",
    amount: 0, currency: "gem", priceUSD: 49.99, tag: "محدود",
    description: "9000 💎 + 700,000 🪙 + 3 خلفيات + إطار التنين + لوحة الأسطورة",
    reward: { gems: 9000, coins: 700_000, bgIds: ["volcano", "arctic", "cursed"], frameIds: ["af_dragon", "nf_legend"] },
  },
  {
    id: "bd_emperor", category: "bundle", label: "باقة الإمبراطور", emoji: "👑",
    amount: 0, currency: "gem", priceUSD: 99.99, tag: "أفضل قيمة",
    description: "20000 💎 + 1,500,000 🪙 + كل الخلفيات + إطار الإمبراطور + جميع لوحات الأسماء",
    reward: {
      gems: 20_000, coins: 1_500_000,
      bgIds: ["harbor", "sunset", "tropical", "volcano", "arctic", "cursed", "night", "royal"],
      frameIds: ["af_imperial", "nf_inferno", "nf_abyss"],
      rubies: 50,
    },
  },

  // ─── VIP / Subscriptions ─────────────────────────────────
  {
    id: "vip_weekly", category: "vip", label: "VIP أسبوعي", emoji: "⭐",
    amount: 0, currency: "gem", priceUSD: 4.99,
    description: "200 💎 يومياً + ضعف XP + بدون انتظار إصلاح",
    reward: { gems: 1400 },
  },
  {
    id: "vip_monthly", category: "vip", label: "VIP شهري", emoji: "🌟",
    amount: 0, currency: "gem", priceUSD: 14.99, popular: true,
    description: "300 💎 يومياً + ضعف XP والذهب + خلفية حصرية + إطار VIP",
    reward: { gems: 9000, frameIds: ["af_phoenix"], bgIds: ["royal"] },
  },
];
