// Elite VIP — exclusive subscription-only 5-tier system.
// The level itself is server-authoritative (see SQL get_elite_vip_level).
// This file ONLY contains visual presentation data — never trust these
// values for combat math or pricing; the server applies them via the
// `get_combat_multiplier` and `get_effective_shop_price` SQL functions.

import elite1 from "@/assets/elite-vip-1.png";
import elite2 from "@/assets/elite-vip-2.png";
import elite3 from "@/assets/elite-vip-3.png";
import elite4 from "@/assets/elite-vip-4.png";
import elite5 from "@/assets/elite-vip-5.png";

export type EliteVipTier = {
  level: 1 | 2 | 3 | 4 | 5;
  nameAr: string;
  emoji: string;
  monthlyPriceUsd: number;
  paddlePriceId: string;
  combatBonusPct: number;
  shopDiscountPct: number;
  dailyGems: number;
  badge: string;
  ringClass: string;
  nameColorClass: string;
  perks: string[];
};

export const ELITE_VIP_TIERS: EliteVipTier[] = [
  {
    level: 1,
    nameAr: "المرساة البرونزية",
    emoji: "⚓",
    monthlyPriceUsd: 19,
    paddlePriceId: "elite_vip_1_monthly",
    combatBonusPct: 5,
    shopDiscountPct: 5,
    dailyGems: 50,
    badge: elite1,
    ringClass: "ring-amber-700/70 shadow-[0_0_20px_rgba(180,83,9,0.5)]",
    nameColorClass: "",
    perks: [
      "⚔️ هجوم/دفاع +5%",
      "🛒 خصم متجر 5%",
      "💎 50 جوهرة يومياً",
      "🏷️ شارة المرساة البرونزية",
    ],
  },
  {
    level: 2,
    nameAr: "الدرع الفضي",
    emoji: "🛡️",
    monthlyPriceUsd: 29,
    paddlePriceId: "elite_vip_2_monthly",
    combatBonusPct: 10,
    shopDiscountPct: 10,
    dailyGems: 120,
    badge: elite2,
    ringClass: "ring-slate-300/80 shadow-[0_0_25px_rgba(148,163,184,0.6)]",
    nameColorClass: "",
    perks: [
      "⚔️ هجوم/دفاع +10%",
      "🛒 خصم متجر 10%",
      "💎 120 جوهرة يومياً",
      "🛡️ شارة الدرع الفضي",
    ],
  },
  {
    level: 3,
    nameAr: "التاج الذهبي",
    emoji: "👑",
    monthlyPriceUsd: 49,
    paddlePriceId: "elite_vip_3_monthly",
    combatBonusPct: 15,
    shopDiscountPct: 15,
    dailyGems: 250,
    badge: elite3,
    ringClass: "ring-amber-400/90 shadow-[0_0_35px_rgba(251,191,36,0.7)]",
    nameColorClass: "",
    perks: [
      "⚔️ هجوم/دفاع +15%",
      "🛒 خصم متجر 15%",
      "💎 250 جوهرة يومياً",
      "👑 شارة التاج الذهبي",
      "🌟 تراكب دخول عالمي (يعلن دخولك لكل اللاعبين)",
    ],
  },
  {
    level: 4,
    nameAr: "السفينة الملكية",
    emoji: "⛵",
    monthlyPriceUsd: 79,
    paddlePriceId: "elite_vip_4_monthly",
    combatBonusPct: 20,
    shopDiscountPct: 20,
    dailyGems: 450,
    badge: elite4,
    ringClass: "ring-sky-300 shadow-[0_0_40px_rgba(125,211,252,0.85)]",
    // VIP 4 → golden chat name
    nameColorClass:
      "bg-gradient-to-r from-yellow-300 via-amber-400 to-yellow-500 bg-clip-text text-transparent font-extrabold drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]",
    perks: [
      "⚔️ هجوم/دفاع +20%",
      "🛒 خصم متجر 20%",
      "💎 450 جوهرة يومياً",
      "⛵ شارة السفينة الملكية",
      "🌟 تراكب دخول عالمي",
      "✨ اسم ذهبي مميز في الشات",
    ],
  },
  {
    level: 5,
    nameAr: "التنين الأسطوري",
    emoji: "🐉",
    monthlyPriceUsd: 99,
    paddlePriceId: "elite_vip_5_monthly",
    combatBonusPct: 30,
    shopDiscountPct: 30,
    dailyGems: 800,
    badge: elite5,
    ringClass:
      "ring-fuchsia-400 shadow-[0_0_55px_rgba(232,121,249,0.95)] animate-pulse",
    // VIP 5 → rainbow legendary name with glow
    nameColorClass:
      "bg-gradient-to-r from-yellow-300 via-rose-400 via-fuchsia-400 to-amber-300 bg-clip-text text-transparent font-black drop-shadow-[0_0_12px_rgba(232,121,249,0.85)]",
    perks: [
      "⚔️ هجوم/دفاع +30% (الأقوى!)",
      "🛒 خصم متجر 30%",
      "💎 800 جوهرة يومياً",
      "🐉 شارة التنين الأسطوري المرصعة بالجواهر",
      "🌟 تراكب دخول عالمي ملحمي",
      "🌈 اسم متوهج أسطوري في الشات",
      "👑 جميع المميزات السابقة",
    ],
  },
];

export function getEliteVipTier(level: number | null | undefined): EliteVipTier | null {
  if (!level || level < 1) return null;
  const lv = Math.max(1, Math.min(5, Math.floor(level)));
  return ELITE_VIP_TIERS[lv - 1];
}
