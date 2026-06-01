// VIP tier configuration — must match server-side gem amounts in claim_vip_daily()
export type VipTier = {
  level: number;
  name: string;
  emoji: string;
  color: string;       // tailwind text/border accent
  bgGradient: string;  // tailwind bg gradient
  dailyGems: number;
  perks: string[];
};

export const VIP_TIERS: VipTier[] = [
  {
    level: 1, name: "برونزي", emoji: "🥉",
    color: "amber-700", bgGradient: "from-amber-900/60 to-stone-950",
    dailyGems: 50,
    perks: [
      "💎 50 جوهرة يومياً مجاناً",
      "🏷️ شارة VIP بجانب اسمك",
      "💬 لون مميز في الشات",
    ],
  },
  {
    level: 2, name: "فضي", emoji: "🥈",
    color: "slate-300", bgGradient: "from-slate-700/60 to-stone-950",
    dailyGems: 100,
    perks: [
      "💎 100 جوهرة يومياً",
      "✨ خبرة +5% على كل سمكة",
      "🪙 ذهب +5% عند البيع",
    ],
  },
  {
    level: 3, name: "ذهبي", emoji: "🥇",
    color: "amber-400", bgGradient: "from-amber-600/60 to-stone-950",
    dailyGems: 200,
    perks: [
      "💎 200 جوهرة يومياً",
      "✨ خبرة +10%",
      "🪙 ذهب +10%",
      "🎁 صندوق هدية أسبوعي",
    ],
  },
  {
    level: 4, name: "ياقوتي", emoji: "💠",
    color: "sky-300", bgGradient: "from-sky-700/60 to-stone-950",
    dailyGems: 350,
    perks: [
      "💎 350 جوهرة يومياً",
      "✨ خبرة +15%",
      "🪙 ذهب +15%",
      "⚓ تصليح السفن أسرع بـ 10%",
    ],
  },
  {
    level: 5, name: "زمردي", emoji: "💚",
    color: "emerald-300", bgGradient: "from-emerald-700/60 to-stone-950",
    dailyGems: 500,
    perks: [
      "💎 500 جوهرة يومياً",
      "✨ خبرة +20%",
      "🪙 ذهب +20%",
      "⚓ تصليح أسرع 15%",
      "🛡️ درع 4 ساعات يومياً",
    ],
  },
  {
    level: 6, name: "مرجاني", emoji: "🪸",
    color: "rose-300", bgGradient: "from-rose-700/60 to-stone-950",
    dailyGems: 750,
    perks: [
      "💎 750 جوهرة يومياً",
      "✨ خبرة +25%",
      "🪙 ذهب +25%",
      "🎨 إطار حصري للصورة",
      "🛡️ درع 8 ساعات يومياً",
    ],
  },
  {
    level: 7, name: "لؤلؤي", emoji: "🦪",
    color: "cyan-200", bgGradient: "from-cyan-700/60 to-stone-950",
    dailyGems: 1000,
    perks: [
      "💎 1000 جوهرة يومياً",
      "✨ خبرة +30%",
      "🪙 ذهب +30%",
      "⛵ خانة سفينة إضافية",
      "🛡️ درع 12 ساعة يومياً",
    ],
  },
  {
    level: 8, name: "ماسي", emoji: "💎",
    color: "indigo-300", bgGradient: "from-indigo-700/60 to-stone-950",
    dailyGems: 1500,
    perks: [
      "💎 1500 جوهرة يومياً",
      "✨ خبرة +35%",
      "🪙 ذهب +35%",
      "🌅 خلفية ملكية حصرية",
      "🛡️ درع 24 ساعة يومياً",
    ],
  },
  {
    level: 9, name: "ملكي", emoji: "👑",
    color: "fuchsia-300", bgGradient: "from-fuchsia-700/60 to-stone-950",
    dailyGems: 2000,
    perks: [
      "💎 2000 جوهرة يومياً",
      "✨ خبرة +40%",
      "🪙 ذهب +40%",
      "🏴‍☠️ شعار ذهبي حصري",
      "🎁 صندوق ملكي يومي",
    ],
  },
  {
    level: 10, name: "كوني", emoji: "🌌",
    color: "violet-300", bgGradient: "from-violet-700/70 to-fuchsia-950",
    dailyGems: 3000,
    perks: [
      "💎 3000 جوهرة يومياً (الأعلى!)",
      "✨ خبرة +50%",
      "🪙 ذهب +50%",
      "🌠 إطار كوني نادر",
      "👑 جميع المميزات السابقة",
      "💬 أولوية في الدعم",
    ],
  },
];

export function getVipTier(level: number | null | undefined): VipTier | null {
  if (!level || level < 1) return null;
  const lv = Math.max(1, Math.min(10, Math.floor(level)));
  return VIP_TIERS[lv - 1];
}
