// Cosmetic frames — equipped on avatar / name / message bubble / profile card.
// `ring`         → tailwind classes applied to the avatar wrapper
// `nameClass`    → tailwind classes applied to the display-name pill
// `bubbleClass`  → tailwind classes applied to the chat message bubble
// `profileClass` → tailwind classes applied to the outer profile card wrapper

import ariesImg from "@/assets/frames/aries.png";
import phoenixImg from "@/assets/frames/phoenix-wings.png";
import virgoImg from "@/assets/frames/virgo.png";
import leoImg from "@/assets/frames/leo.png";
import taurusImg from "@/assets/frames/taurus.png";
import geminiImg from "@/assets/frames/gemini.png";
import scorpioImg from "@/assets/frames/scorpio.png";
import piscesImg from "@/assets/frames/pisces.png";
import cosmicVipImg from "@/assets/frames/cosmic-vip.png";

export type FrameKind = "avatar" | "name" | "bubble" | "profile";

export type Frame = {
  id: string;
  name: string;
  kind: FrameKind;
  price: number;
  currency: "gem";
  rarity: "common" | "rare" | "epic" | "legendary" | "mythic";
  ring?: string;
  nameClass?: string;
  bubbleClass?: string;
  profileClass?: string;
  imageUrl?: string;
  animClass?: string;
  preview: string;
};

export const AVATAR_FRAMES: Frame[] = [
  {
    id: "af_aries", name: "إطار الحَمَل 🔥", kind: "avatar",
    price: 1000, currency: "gem", rarity: "rare", preview: "♈",
    imageUrl: ariesImg, animClass: "frame-anim-flame",
  },
  {
    id: "af_phoenix", name: "أجنحة العنقاء", kind: "avatar",
    price: 5000, currency: "gem", rarity: "epic", preview: "🔥",
    imageUrl: phoenixImg, animClass: "frame-anim-flame",
  },
  {
    id: "af_virgo", name: "إطار العذراء 🌾", kind: "avatar",
    price: 8000, currency: "gem", rarity: "epic", preview: "♍",
    imageUrl: virgoImg, animClass: "frame-anim-leaf",
  },
  {
    id: "af_leo", name: "إطار الأسد ☀️", kind: "avatar",
    price: 12000, currency: "gem", rarity: "legendary", preview: "♌",
    imageUrl: leoImg, animClass: "frame-anim-flame",
  },
  {
    id: "af_taurus", name: "إطار الثور 💚", kind: "avatar",
    price: 18000, currency: "gem", rarity: "legendary", preview: "♉",
    imageUrl: taurusImg, animClass: "frame-anim-leaf",
  },
  {
    id: "af_gemini", name: "إطار الجوزاء ✨", kind: "avatar",
    price: 25000, currency: "gem", rarity: "legendary", preview: "♊",
    imageUrl: geminiImg, animClass: "frame-anim-sparkle",
  },
  {
    id: "af_scorpio", name: "إطار العقرب 🦂", kind: "avatar",
    price: 50000, currency: "gem", rarity: "mythic", preview: "♏",
    imageUrl: scorpioImg, animClass: "frame-anim-pulse mix-blend-multiply",
  },
  {
    id: "af_pisces", name: "إطار الحوت 🐟", kind: "avatar",
    price: 75000, currency: "gem", rarity: "mythic", preview: "♓",
    imageUrl: piscesImg, animClass: "frame-anim-wave",
  },
  {
    id: "af_cosmic_vip", name: "🌌 الإطار الكوني (VIP 10 حصري)", kind: "avatar",
    price: 999999, currency: "gem", rarity: "mythic", preview: "🌌",
    imageUrl: cosmicVipImg, animClass: "frame-anim-pulse",
  },
];

// ─────── إطارات الاسم (لوحات فاخرة بحواف معدنية) ───────
export const NAME_FRAMES: Frame[] = [
  {
    id: "nf_aries", name: "لوحة الحَمَل ♈", kind: "name",
    price: 1000, currency: "gem", rarity: "rare", preview: "Aa",
    nameClass:
      "relative bg-gradient-to-b from-orange-500 via-red-600 to-orange-900 " +
      "border-[3px] border-double border-amber-200 ring-2 ring-orange-950/70 ring-offset-2 ring-offset-amber-300/80 " +
      "text-white font-extrabold tracking-wide " +
      "shadow-[inset_0_2px_0_rgba(255,255,255,0.5),inset_0_-2px_0_rgba(0,0,0,0.35),0_4px_14px_rgba(251,146,60,0.55)]",
  },
  {
    id: "nf_phoenix", name: "لوحة العنقاء 🔥", kind: "name",
    price: 5000, currency: "gem", rarity: "epic", preview: "Aa",
    nameClass:
      "relative bg-gradient-to-b from-amber-300 via-orange-500 to-rose-800 " +
      "border-[3px] border-double border-amber-100 ring-2 ring-rose-950/70 ring-offset-2 ring-offset-amber-200 " +
      "text-white font-extrabold tracking-wide " +
      "shadow-[inset_0_2px_0_rgba(255,255,255,0.55),inset_0_-2px_0_rgba(0,0,0,0.4),0_6px_18px_rgba(244,63,94,0.45)]",
  },
  {
    id: "nf_virgo", name: "لوحة العذراء 🌾", kind: "name",
    price: 8000, currency: "gem", rarity: "epic", preview: "Aa",
    nameClass:
      "relative bg-gradient-to-b from-amber-200 via-yellow-400 to-amber-700 " +
      "border-[3px] border-double border-amber-50 ring-2 ring-amber-900/70 ring-offset-2 ring-offset-yellow-200 " +
      "text-amber-950 font-extrabold tracking-wide " +
      "shadow-[inset_0_2px_0_rgba(255,255,255,0.7),inset_0_-2px_0_rgba(120,53,15,0.45),0_4px_14px_rgba(251,191,36,0.55)]",
  },
  {
    id: "nf_leo", name: "لوحة الأسد ☀️", kind: "name",
    price: 12000, currency: "gem", rarity: "legendary", preview: "Aa",
    nameClass:
      "relative bg-gradient-to-b from-yellow-200 via-amber-400 to-orange-700 " +
      "border-[3px] border-double border-yellow-50 ring-2 ring-amber-950/80 ring-offset-2 ring-offset-yellow-300 " +
      "text-amber-950 font-extrabold tracking-wide " +
      "shadow-[inset_0_2px_0_rgba(255,255,255,0.75),inset_0_-2px_0_rgba(120,53,15,0.5),0_6px_20px_rgba(251,191,36,0.7)]",
  },
  {
    id: "nf_taurus", name: "لوحة الثور 💚", kind: "name",
    price: 18000, currency: "gem", rarity: "legendary", preview: "Aa",
    nameClass:
      "relative bg-gradient-to-b from-emerald-300 via-teal-600 to-emerald-900 " +
      "border-[3px] border-double border-emerald-100 ring-2 ring-emerald-950/80 ring-offset-2 ring-offset-emerald-200 " +
      "text-white font-extrabold tracking-wide " +
      "shadow-[inset_0_2px_0_rgba(255,255,255,0.55),inset_0_-2px_0_rgba(0,0,0,0.4),0_6px_20px_rgba(16,185,129,0.55)]",
  },
  {
    id: "nf_gemini", name: "لوحة الجوزاء ✨", kind: "name",
    price: 25000, currency: "gem", rarity: "legendary", preview: "Aa",
    nameClass:
      "relative bg-gradient-to-b from-fuchsia-400 via-purple-600 to-violet-900 " +
      "border-[3px] border-double border-fuchsia-100 ring-2 ring-violet-950/80 ring-offset-2 ring-offset-fuchsia-200 " +
      "text-white font-extrabold tracking-wide " +
      "shadow-[inset_0_2px_0_rgba(255,255,255,0.6),inset_0_-2px_0_rgba(0,0,0,0.4),0_6px_22px_rgba(168,85,247,0.6)]",
  },
  {
    id: "nf_scorpio", name: "لوحة العقرب 🦂", kind: "name",
    price: 50000, currency: "gem", rarity: "mythic", preview: "Aa",
    nameClass:
      "relative bg-gradient-to-b from-rose-600 via-red-800 to-zinc-950 " +
      "border-[3px] border-double border-rose-200 ring-2 ring-black ring-offset-2 ring-offset-rose-300 " +
      "text-white font-extrabold tracking-wider " +
      "shadow-[inset_0_2px_0_rgba(255,255,255,0.45),inset_0_-2px_0_rgba(0,0,0,0.7),0_8px_26px_rgba(244,63,94,0.7)]",
  },
  {
    id: "nf_pisces", name: "لوحة الحوت 🐟", kind: "name",
    price: 75000, currency: "gem", rarity: "mythic", preview: "Aa",
    nameClass:
      "relative bg-gradient-to-b from-cyan-300 via-sky-600 to-blue-900 " +
      "border-[3px] border-double border-cyan-100 ring-2 ring-blue-950 ring-offset-2 ring-offset-cyan-200 " +
      "text-white font-extrabold tracking-wider " +
      "shadow-[inset_0_2px_0_rgba(255,255,255,0.65),inset_0_-2px_0_rgba(0,0,0,0.45),0_8px_26px_rgba(59,130,246,0.7)]",
  },
];

// ─────── إطارات فقاعة الشات (فاخرة بحواف ذهبية مزدوجة) ───────
export const BUBBLE_FRAMES: Frame[] = [
  {
    id: "bf_aries", name: "فقاعة الحَمَل ♈", kind: "bubble",
    price: 1000, currency: "gem", rarity: "rare", preview: "💬",
    bubbleClass:
      "relative bg-gradient-to-br from-orange-500 via-red-600 to-orange-900 " +
      "border-[3px] border-double border-amber-200 ring-2 ring-orange-950/70 ring-offset-2 ring-offset-amber-300/80 " +
      "text-white shadow-[inset_0_2px_0_rgba(255,255,255,0.45),inset_0_-2px_0_rgba(0,0,0,0.35),0_6px_18px_rgba(251,146,60,0.5)]",
  },
  {
    id: "bf_phoenix", name: "فقاعة العنقاء 🔥", kind: "bubble",
    price: 5000, currency: "gem", rarity: "epic", preview: "💬",
    bubbleClass:
      "relative bg-gradient-to-br from-amber-400 via-orange-600 to-rose-800 " +
      "border-[3px] border-double border-amber-100 ring-2 ring-rose-950/70 ring-offset-2 ring-offset-amber-200 " +
      "text-white shadow-[inset_0_2px_0_rgba(255,255,255,0.5),inset_0_-2px_0_rgba(0,0,0,0.4),0_8px_22px_rgba(244,63,94,0.5)]",
  },
  {
    id: "bf_virgo", name: "فقاعة العذراء 🌾", kind: "bubble",
    price: 8000, currency: "gem", rarity: "epic", preview: "💬",
    bubbleClass:
      "relative bg-gradient-to-br from-amber-200 via-yellow-500 to-amber-800 " +
      "border-[3px] border-double border-amber-50 ring-2 ring-amber-900/70 ring-offset-2 ring-offset-yellow-200 " +
      "text-amber-950 font-medium shadow-[inset_0_2px_0_rgba(255,255,255,0.65),inset_0_-2px_0_rgba(120,53,15,0.45),0_6px_20px_rgba(251,191,36,0.6)]",
  },
  {
    id: "bf_leo", name: "فقاعة الأسد ☀️", kind: "bubble",
    price: 12000, currency: "gem", rarity: "legendary", preview: "💬",
    bubbleClass:
      "relative bg-gradient-to-br from-yellow-200 via-amber-500 to-orange-800 " +
      "border-[3px] border-double border-yellow-50 ring-2 ring-amber-950/80 ring-offset-2 ring-offset-yellow-300 " +
      "text-amber-950 font-medium shadow-[inset_0_2px_0_rgba(255,255,255,0.7),inset_0_-2px_0_rgba(120,53,15,0.5),0_8px_24px_rgba(251,191,36,0.75)]",
  },
  {
    id: "bf_taurus", name: "فقاعة الثور 💚", kind: "bubble",
    price: 18000, currency: "gem", rarity: "legendary", preview: "💬",
    bubbleClass:
      "relative bg-gradient-to-br from-emerald-400 via-teal-600 to-emerald-900 " +
      "border-[3px] border-double border-emerald-100 ring-2 ring-emerald-950/80 ring-offset-2 ring-offset-emerald-200 " +
      "text-white shadow-[inset_0_2px_0_rgba(255,255,255,0.5),inset_0_-2px_0_rgba(0,0,0,0.4),0_8px_24px_rgba(16,185,129,0.6)]",
  },
  {
    id: "bf_gemini", name: "فقاعة الجوزاء ✨", kind: "bubble",
    price: 25000, currency: "gem", rarity: "legendary", preview: "💬",
    bubbleClass:
      "relative bg-gradient-to-br from-fuchsia-500 via-purple-600 to-violet-900 " +
      "border-[3px] border-double border-fuchsia-100 ring-2 ring-violet-950/80 ring-offset-2 ring-offset-fuchsia-200 " +
      "text-white shadow-[inset_0_2px_0_rgba(255,255,255,0.55),inset_0_-2px_0_rgba(0,0,0,0.4),0_8px_26px_rgba(168,85,247,0.65)]",
  },
  {
    id: "bf_scorpio", name: "فقاعة العقرب 🦂", kind: "bubble",
    price: 50000, currency: "gem", rarity: "mythic", preview: "💬",
    bubbleClass:
      "relative bg-gradient-to-br from-rose-600 via-red-800 to-zinc-950 " +
      "border-[3px] border-double border-rose-200 ring-2 ring-black ring-offset-2 ring-offset-rose-300 " +
      "text-white shadow-[inset_0_2px_0_rgba(255,255,255,0.4),inset_0_-2px_0_rgba(0,0,0,0.7),0_10px_30px_rgba(244,63,94,0.75)]",
  },
  {
    id: "bf_pisces", name: "فقاعة الحوت 🐟", kind: "bubble",
    price: 75000, currency: "gem", rarity: "mythic", preview: "💬",
    bubbleClass:
      "relative bg-gradient-to-br from-cyan-300 via-sky-600 to-blue-900 " +
      "border-[3px] border-double border-cyan-100 ring-2 ring-blue-950 ring-offset-2 ring-offset-cyan-200 " +
      "text-white shadow-[inset_0_2px_0_rgba(255,255,255,0.6),inset_0_-2px_0_rgba(0,0,0,0.45),0_10px_30px_rgba(59,130,246,0.75)]",
  },
];

// ─────── إطارات بطاقة البروفايل (إطارات مزخرفة مزدوجة) ───────
export const PROFILE_FRAMES: Frame[] = [
  {
    id: "pf_aries", name: "بطاقة الحَمَل ♈", kind: "profile",
    price: 1000, currency: "gem", rarity: "rare", preview: "♈",
    profileClass:
      "rounded-2xl p-[6px] bg-gradient-to-br from-orange-400 via-red-600 to-orange-900 " +
      "border-[3px] border-double border-amber-200 ring-2 ring-orange-950/70 ring-offset-2 ring-offset-amber-300 " +
      "shadow-[inset_0_2px_0_rgba(255,255,255,0.45),0_10px_30px_rgba(251,146,60,0.55)]",
  },
  {
    id: "pf_phoenix", name: "بطاقة العنقاء 🔥", kind: "profile",
    price: 5000, currency: "gem", rarity: "epic", preview: "🔥",
    profileClass:
      "rounded-2xl p-[6px] bg-gradient-to-br from-amber-300 via-orange-600 to-rose-800 " +
      "border-[3px] border-double border-amber-100 ring-2 ring-rose-950/70 ring-offset-2 ring-offset-amber-200 " +
      "shadow-[inset_0_2px_0_rgba(255,255,255,0.5),0_14px_36px_rgba(244,63,94,0.55)]",
  },
  {
    id: "pf_virgo", name: "بطاقة العذراء 🌾", kind: "profile",
    price: 8000, currency: "gem", rarity: "epic", preview: "♍",
    profileClass:
      "rounded-2xl p-[6px] bg-gradient-to-br from-amber-200 via-yellow-500 to-amber-800 " +
      "border-[3px] border-double border-amber-50 ring-2 ring-amber-900/70 ring-offset-2 ring-offset-yellow-200 " +
      "shadow-[inset_0_2px_0_rgba(255,255,255,0.65),0_14px_36px_rgba(251,191,36,0.6)]",
  },
  {
    id: "pf_leo", name: "بطاقة الأسد ☀️", kind: "profile",
    price: 12000, currency: "gem", rarity: "legendary", preview: "♌",
    profileClass:
      "rounded-2xl p-[6px] bg-gradient-to-br from-yellow-200 via-amber-500 to-orange-800 " +
      "border-[3px] border-double border-yellow-50 ring-2 ring-amber-950/80 ring-offset-2 ring-offset-yellow-300 " +
      "shadow-[inset_0_2px_0_rgba(255,255,255,0.7),0_16px_40px_rgba(251,191,36,0.75)]",
  },
  {
    id: "pf_taurus", name: "بطاقة الثور 💚", kind: "profile",
    price: 18000, currency: "gem", rarity: "legendary", preview: "♉",
    profileClass:
      "rounded-2xl p-[6px] bg-gradient-to-br from-emerald-400 via-teal-600 to-emerald-900 " +
      "border-[3px] border-double border-emerald-100 ring-2 ring-emerald-950/80 ring-offset-2 ring-offset-emerald-200 " +
      "shadow-[inset_0_2px_0_rgba(255,255,255,0.5),0_16px_40px_rgba(16,185,129,0.6)]",
  },
  {
    id: "pf_gemini", name: "بطاقة الجوزاء ✨", kind: "profile",
    price: 25000, currency: "gem", rarity: "legendary", preview: "♊",
    profileClass:
      "rounded-2xl p-[6px] bg-gradient-to-br from-fuchsia-500 via-purple-600 to-violet-900 " +
      "border-[3px] border-double border-fuchsia-100 ring-2 ring-violet-950/80 ring-offset-2 ring-offset-fuchsia-200 " +
      "shadow-[inset_0_2px_0_rgba(255,255,255,0.55),0_16px_42px_rgba(168,85,247,0.65)]",
  },
  {
    id: "pf_scorpio", name: "بطاقة العقرب 🦂", kind: "profile",
    price: 50000, currency: "gem", rarity: "mythic", preview: "♏",
    profileClass:
      "rounded-2xl p-[6px] bg-gradient-to-br from-rose-600 via-red-800 to-zinc-950 " +
      "border-[3px] border-double border-rose-200 ring-2 ring-black ring-offset-2 ring-offset-rose-300 " +
      "shadow-[inset_0_2px_0_rgba(255,255,255,0.4),0_20px_50px_rgba(244,63,94,0.75)]",
  },
  {
    id: "pf_pisces", name: "بطاقة الحوت 🐟", kind: "profile",
    price: 75000, currency: "gem", rarity: "mythic", preview: "♓",
    profileClass:
      "rounded-2xl p-[6px] bg-gradient-to-br from-cyan-300 via-sky-600 to-blue-900 " +
      "border-[3px] border-double border-cyan-100 ring-2 ring-blue-950 ring-offset-2 ring-offset-cyan-200 " +
      "shadow-[inset_0_2px_0_rgba(255,255,255,0.6),0_20px_50px_rgba(59,130,246,0.75)]",
  },
];

export const ALL_FRAMES: Frame[] = [
  ...AVATAR_FRAMES, ...NAME_FRAMES, ...BUBBLE_FRAMES, ...PROFILE_FRAMES,
];

export function frameById(id?: string | null): Frame | undefined {
  if (!id) return undefined;
  const frame = ALL_FRAMES.find((f) => f.id === id);
  if (!frame || frame.animClass) return frame;
  const motion = frameMotionClass(id);
  return motion ? { ...frame, animClass: motion } : frame;
}

function frameMotionClass(id: string): string {
  if (id.includes("aries") || id.includes("phoenix") || id.includes("leo")) return "frame-anim-flame";
  if (id.includes("virgo") || id.includes("taurus")) return "frame-anim-leaf";
  if (id.includes("gemini")) return "frame-anim-sparkle";
  if (id.includes("scorpio")) return "frame-anim-pulse";
  if (id.includes("pisces")) return "frame-anim-wave";
  return "frame-anim-float";
}

// Map frame kind → inventory item_type stored in DB
export const FRAME_KIND_TO_ITEM_TYPE: Record<FrameKind, string> = {
  avatar: "frame",
  name: "name_frame",
  bubble: "bubble_frame",
  profile: "profile_frame",
};

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
    description: "500 💎 + 25,000 🪙 + مملكة البلور",
    reward: { gems: 500, coins: 25_000, bgIds: ["crystal_kingdom"] },
  },
  {
    id: "bd_captain", category: "bundle", label: "باقة القبطان",  emoji: "🧭",
    amount: 0, currency: "gem", priceUSD: 9.99, popular: true,
    description: "1500 💎 + 100,000 🪙 + إطار ذهبي",
    reward: { gems: 1500, coins: 100_000, frameIds: ["af_leo"] },
  },
  {
    id: "bd_admiral", category: "bundle", label: "باقة الأميرال", emoji: "⚔️",
    amount: 0, currency: "gem", priceUSD: 24.99,
    description: "4000 💎 + 300,000 🪙 + الخلفيتين الجديدتين + إطار ياقوتي",
    reward: { gems: 4000, coins: 300_000, bgIds: ["crystal_kingdom", "eiffel_night"], frameIds: ["af_taurus"] },
  },
  {
    id: "bd_legend", category: "bundle", label: "باقة الأسطورة",  emoji: "🐉",
    amount: 0, currency: "gem", priceUSD: 49.99, tag: "محدود",
    description: "9000 💎 + 700,000 🪙 + الخلفيتين الجديدتين + إطار التنين + لوحة الأسطورة",
    reward: { gems: 9000, coins: 700_000, bgIds: ["crystal_kingdom", "eiffel_night"], frameIds: ["af_scorpio", "nf_leo"] },
  },
  {
    id: "bd_emperor", category: "bundle", label: "باقة الإمبراطور", emoji: "👑",
    amount: 0, currency: "gem", priceUSD: 99.99, tag: "أفضل قيمة",
    description: "20000 💎 + 1,500,000 🪙 + كل الخلفيات الجديدة + إطار الإمبراطور + جميع لوحات الأسماء",
    reward: {
      gems: 20_000, coins: 1_500_000,
      bgIds: ["crystal_kingdom", "eiffel_night"],
      frameIds: ["af_pisces", "nf_scorpio", "nf_pisces"],
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
    reward: { gems: 9000, frameIds: ["af_phoenix"], bgIds: ["eiffel_night"] },
  },
];
