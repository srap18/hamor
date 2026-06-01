// VIP tier configuration — gems values must match server-side claim_vip_daily()
export type VipTier = {
  level: number;
  name: string;
  emoji: string;
  color: string;
  bgGradient: string;
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
      "🏷️ شارة VIP فخمة بجانب اسمك في الشات",
      "💬 لون مميز في الشات",
    ],
  },
  {
    level: 2, name: "فضي", emoji: "🥈",
    color: "slate-300", bgGradient: "from-slate-700/60 to-stone-950",
    dailyGems: 100,
    perks: [
      "💎 100 جوهرة يومياً",
      "✨ خبرة +10% على كل سمكة",
      "🪙 ذهب +10% عند البيع",
    ],
  },
  {
    level: 3, name: "ذهبي", emoji: "🥇",
    color: "amber-400", bgGradient: "from-amber-600/60 to-stone-950",
    dailyGems: 200,
    perks: [
      "💎 200 جوهرة يومياً",
      "✨ خبرة +20%",
      "🪙 ذهب +20%",
      "🎁 صندوق هدية أسبوعي",
    ],
  },
  {
    level: 4, name: "ياقوتي", emoji: "💠",
    color: "sky-300", bgGradient: "from-sky-700/60 to-stone-950",
    dailyGems: 350,
    perks: [
      "💎 350 جوهرة يومياً",
      "✨ خبرة +30%",
      "🪙 ذهب +30%",
      "⚓ تصليح السفن أسرع بـ 20%",
    ],
  },
  {
    level: 5, name: "زمردي", emoji: "💚",
    color: "emerald-300", bgGradient: "from-emerald-700/60 to-stone-950",
    dailyGems: 550,
    perks: [
      "💎 550 جوهرة يومياً",
      "✨ خبرة +40%",
      "🪙 ذهب +40%",
      "⚓ تصليح أسرع 30%",
      "🛡️ درع 1 ساعة يومياً للمخزن (قابل للتجميع)",
    ],
  },
  {
    level: 6, name: "مرجاني", emoji: "🪸",
    color: "rose-300", bgGradient: "from-rose-700/60 to-stone-950",
    dailyGems: 800,
    perks: [
      "💎 800 جوهرة يومياً",
      "✨ خبرة +50%",
      "🪙 ذهب +50%",
      "🎨 إطار حصري للصورة",
      "🛡️ درع 1 ساعة يومياً للمخزن",
    ],
  },
  {
    level: 7, name: "لؤلؤي", emoji: "🦪",
    color: "cyan-200", bgGradient: "from-cyan-700/60 to-stone-950",
    dailyGems: 1200,
    perks: [
      "💎 1200 جوهرة يومياً",
      "✨ خبرة +60%",
      "🪙 ذهب +60%",
      "🛡️ درعان (2) ساعة يومياً للمخزن",
    ],
  },
  {
    level: 8, name: "ماسي", emoji: "💎",
    color: "indigo-300", bgGradient: "from-indigo-700/60 to-stone-950",
    dailyGems: 1700,
    perks: [
      "💎 1700 جوهرة يومياً",
      "✨ خبرة +70%",
      "🪙 ذهب +70%",
      "🌅 خلفية ملكية حصرية",
      "🛡️ درعان (2) ساعة يومياً للمخزن",
    ],
  },
  {
    level: 9, name: "ملكي", emoji: "👑",
    color: "fuchsia-300", bgGradient: "from-fuchsia-700/60 to-stone-950",
    dailyGems: 2300,
    perks: [
      "💎 2300 جوهرة يومياً",
      "✨ خبرة +85%",
      "🪙 ذهب +85%",
      "🏴‍☠️ شعار ذهبي حصري",
      "🛡️ ثلاثة (3) دروع يومياً للمخزن",
      "🎁 صندوق ملكي يومي — يحتوي جميع الطواقم + جميع الصواريخ تروح للمخزن!",
    ],
  },
  {
    level: 10, name: "كوني", emoji: "🌌",
    color: "violet-300", bgGradient: "from-violet-700/70 to-fuchsia-950",
    dailyGems: 3000,
    perks: [
      "💎 3000 جوهرة يومياً (الأعلى!)",
      "✨ خبرة +100%",
      "🪙 ذهب +100%",
      "🌠 إطار كوني حصري نادر (لا يُباع في المتجر!)",
      "🛡️ ثلاثة (3) دروع يومياً للمخزن",
      "🎁 صندوق ملكي يومي",
      "👑 جميع المميزات السابقة مفعّلة",
    ],
  },
];

export function getVipTier(level: number | null | undefined): VipTier | null {
  if (!level || level < 1) return null;
  const lv = Math.max(1, Math.min(10, Math.floor(level)));
  return VIP_TIERS[lv - 1];
}
