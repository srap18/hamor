// Canonical catalog of packs. The pack `id` is also the Paddle price
// `external_id` — checkout resolves it server-side (never trust client price).

import shipPhoenixImg from "@/assets/ships/ship-phoenix.png";
import gemIcon from "@/assets/icon-gem-3d.png";
import rocketLargeImg from "@/assets/weapons/rocket-large.png";
import rocketMediumImg from "@/assets/weapons/rocket-medium.png";
import nukeImg from "@/assets/weapons/nuke.png";
import adBombImg from "@/assets/weapons/ad-bomb.png";

export type PackCategory = "offers" | "bundle" | "vip" | "gems" | "shield" | "weapon" | "coins" | "crew";

export type PackInventoryItem = {
  itemType: string;
  itemId: string;
  qty: number;
};

export type StorePack = {
  id: string;
  category: PackCategory;
  label: string;
  emoji: string;
  priceUSD: number;
  
  subscription?: boolean;
  weeklyLimit?: number;
  oneTime?: boolean;
  tag?: string;
  popular?: boolean;
  bonus?: string;
  description?: string;
  images?: string[];
  disabled?: boolean;
  reward: {
    gems?: number;
    coins?: number;
    rubies?: number;
    shieldDays?: number;
    vipDays?: number;
    phoenixShips?: number;
    items?: PackInventoryItem[];
  };
};

export const STORE_PACKS: StorePack[] = [
  // ───── Gem Offers 🎁 ────────────────────────────────
  {
    id: "offer_gems_550_15off",
    category: "offers",
    label: "🎁 عرض 500 جوهرة 💎",
    emoji: "💎",
    priceUSD: 4.0,
    tag: "عرض!",
    description: "500 💎 بسعر مميّز",
    images: [gemIcon],
    reward: { gems: 500 },
  },
  {
    id: "offer_gems_1250_15off",
    category: "offers",
    label: "🎁 عرض 1,000 جوهرة 💠",
    emoji: "💠",
    priceUSD: 6.67,
    tag: "عرض!",
    popular: true,
    description: "1,000 💎 بسعر مميّز",
    images: [gemIcon],
    reward: { gems: 1_000 },
  },
  {
    id: "offer_gems_2800_15off",
    category: "offers",
    label: "🎁 عرض 4,000 جوهرة 🔷",
    emoji: "🔷",
    priceUSD: 13.33,
    tag: "الأكثر قيمة",
    description: "4,000 💎 بسعر مميّز",
    images: [gemIcon],
    reward: { gems: 4_000 },
  },
  {
    id: "offer_gems_7500_15off",
    category: "offers",
    label: "🎁 عرض ضخم 30,000 جوهرة 🏴‍☠️",
    emoji: "🏴‍☠️",
    priceUSD: 100.0,
    tag: "ميجا عرض",
    popular: true,
    description: "30,000 💎 — أفضل قيمة على الإطلاق",
    images: [gemIcon],
    reward: { gems: 30_000 },
  },

  // ───── Frame Offers (Paddle real-money) ───────────────────
  {
    id: "offer_frame_phoenix_set",
    category: "offers",
    label: "🔥 طقم العنقاء الكامل + 500 جوهرة",
    emoji: "🦅",
    priceUSD: 7.99,
    tag: "خصم 60%",
    popular: true,
    description: "إطار صورة + لوحة اسم + فقاعة شات + بطاقة بروفايل (العنقاء 🔥) + 500 💎",
    reward: {
      gems: 500,
      items: [
        { itemType: "frame",         itemId: "af_phoenix", qty: 1 },
        { itemType: "name_frame",    itemId: "nf_phoenix", qty: 1 },
        { itemType: "bubble_frame",  itemId: "bf_phoenix", qty: 1 },
        { itemType: "profile_frame", itemId: "pf_phoenix", qty: 1 },
      ],
    },
  },
  {
    id: "offer_frame_legendary_set",
    category: "offers",
    label: "☀️ طقم الأسد الأسطوري + 1500 جوهرة",
    emoji: "👑",
    priceUSD: 19.99,
    tag: "خصم 65%",
    popular: true,
    description: "كل إطارات الأسد الأسطورية (صورة + اسم + فقاعة + بطاقة) + 1,500 💎",
    reward: {
      gems: 1_500,
      items: [
        { itemType: "frame",         itemId: "af_leo", qty: 1 },
        { itemType: "name_frame",    itemId: "nf_leo", qty: 1 },
        { itemType: "bubble_frame",  itemId: "bf_leo", qty: 1 },
        { itemType: "profile_frame", itemId: "pf_leo", qty: 1 },
      ],
    },
  },
  {
    id: "offer_frame_mythic_set",
    category: "offers",
    label: "🌌 طقم الإطارات الخيالية + 3000 جوهرة",
    emoji: "💫",
    priceUSD: 39.99,
    tag: "حصري",
    description: "كل إطارات العقرب 🦂 والحوت 🐟 الخيالية (8 إطارات) + 3,000 💎 — قيمة هائلة",
    reward: {
      gems: 3_000,
      items: [
        { itemType: "frame",         itemId: "af_scorpio", qty: 1 },
        { itemType: "name_frame",    itemId: "nf_scorpio", qty: 1 },
        { itemType: "bubble_frame",  itemId: "bf_scorpio", qty: 1 },
        { itemType: "profile_frame", itemId: "pf_scorpio", qty: 1 },
        { itemType: "frame",         itemId: "af_pisces", qty: 1 },
        { itemType: "name_frame",    itemId: "nf_pisces", qty: 1 },
        { itemType: "bubble_frame",  itemId: "bf_pisces", qty: 1 },
        { itemType: "profile_frame", itemId: "pf_pisces", qty: 1 },
      ],
    },
  },


  // ───── Hot Offer: Phoenix Trio ────────────────────────────
  {
    id: "bd_phoenix_trio",
    category: "bundle",
    label: "🔥 ثلاثية العنقاء + 1000 جوهرة",
    emoji: "🦅",
    priceUSD: 25.99,
    popular: true,
    tag: "حصري",
    description: "3 سفن العنقاء الأسطورية + 1,000 💎 — عرض محدود",
    images: [shipPhoenixImg, gemIcon],
    reward: { gems: 1_000, phoenixShips: 3 },
  },

  // ───── Bundles ────────────────────────────────────────────
  {
    id: "bd_starter",
    category: "bundle",
    label: "🎁 باقة المبتدئ",
    emoji: "⚓",
    priceUSD: 2.99,
    oneTime: true,
    tag: "لمرة واحدة فقط",
    description: "700 💎 + 20,000 🪙 + حماية 3 أيام 🛡️ — قيمة 56 ر.س",
    reward: { gems: 700, coins: 20_000, shieldDays: 3 },
  },
  {
    id: "bd_weekend",
    category: "bundle",
    label: "🌅 عرض نهاية الأسبوع",
    emoji: "🌅",
    priceUSD: 4.99,
    tag: "خصم 40%",
    description: "1,500 💎 + 50,000 🪙 + درع يومين 🛡️",
    reward: { gems: 1_500, coins: 50_000, shieldDays: 2 },
  },
  {
    id: "bd_lootbox5",
    category: "bundle",
    label: "📦 حزمة صناديق أسطورية × 5",
    emoji: "📦",
    priceUSD: 14.99,
    description: "1,500 💎 + 150,000 🪙",
    reward: { gems: 1_500, coins: 150_000 },
  },
  {
    id: "bd_pirate_chest",
    category: "bundle",
    label: "🏴‍☠️ صندوق القرصان",
    emoji: "🏴‍☠️",
    priceUSD: 24.99,
    popular: true,
    tag: "الأكثر طلباً",
    description: "3,000 💎 + 300,000 🪙 + درع 5 أيام 🛡️",
    reward: { gems: 3_000, coins: 300_000, shieldDays: 5 },
  },
  {
    id: "bd_mega",
    category: "bundle",
    label: "💥 الباقة الضخمة",
    emoji: "💥",
    priceUSD: 39.99,
    tag: "أفضل قيمة",
    description: "5,000 💎 + 500,000 🪙",
    reward: { gems: 5_000, coins: 500_000 },
  },
  {
    id: "bd_emperor",
    category: "bundle",
    label: "👑 كنز الإمبراطور الفخم",
    emoji: "👑",
    priceUSD: 74.99,
    tag: "حصري",
    description: "12,000 💎 + 1,000,000 🪙",
    reward: { gems: 12_000, coins: 1_000_000 },
  },


  // ───── VIP Subscription ───────────────────────────────────
  {
    id: "vip_monthly",
    category: "vip",
    label: "👑 VIP شهري",
    emoji: "👑",
    priceUSD: 9.99,
    subscription: true,
    popular: true,
    description: "6,000 💎 + حماية 30 يوم + شارة VIP ذهبية",
    reward: { gems: 6_000, vipDays: 30 },
  },

  // ───── Gems ───────────────────────────────────────────────
  {
    id: "gp_100",
    category: "gems",
    label: "حفنة جواهر",
    emoji: "💎",
    priceUSD: 0.99,
    reward: { gems: 200 },
  },
  {
    id: "gp_300",
    category: "gems",
    label: "كيس جواهر صغير",
    emoji: "💎",
    priceUSD: 2.49,
    bonus: "+20%",
    reward: { gems: 550 },
  },
  {
    id: "gp_550",
    category: "gems",
    label: "كيس جواهر",
    emoji: "💎",
    priceUSD: 4.99,
    bonus: "+15%",
    reward: { gems: 1_150 },
  },
  {
    id: "gp_1250",
    category: "gems",
    label: "صندوق جواهر",
    emoji: "💠",
    priceUSD: 9.99,
    bonus: "+25%",
    popular: true,
    tag: "أفضل قيمة",
    reward: { gems: 2_400 },
  },
  {
    id: "gp_2800",
    category: "gems",
    label: "خزنة جواهر",
    emoji: "🔷",
    priceUSD: 19.99,
    bonus: "+15%",
    reward: { gems: 5_000 },
  },
  {
    id: "gp_4500",
    category: "gems",
    label: "خزنة جواهر كبرى",
    emoji: "🔶",
    priceUSD: 29.99,
    bonus: "+30%",
    reward: { gems: 7_800 },
  },
  {
    id: "gp_7500",
    category: "gems",
    label: "كنز القرصان",
    emoji: "🏴‍☠️",
    priceUSD: 49.99,
    bonus: "+25% + صندوق",
    reward: { gems: 13_500 },
  },
  {
    id: "gp_12000",
    category: "gems",
    label: "كنز الجواهر الملكي",
    emoji: "💠",
    priceUSD: 74.99,
    bonus: "+35%",
    tag: "ملكي",
    reward: { gems: 21_000 },
  },
  {
    id: "gp_17000",
    category: "gems",
    label: "كنز الإمبراطور",
    emoji: "👑",
    priceUSD: 99.99,
    bonus: "+40% + 3 صناديق",
    tag: "أفضل قيمة",
    reward: { gems: 29_000 },
  },



  // ───── Coins ──────────────────────────────────────────────
  {
    id: "coins_50k",
    category: "coins",
    label: "🪙 كيس ذهب",
    emoji: "🪙",
    priceUSD: 1.99,
    description: "50,000 🪙",
    reward: { coins: 50_000 },
  },
  {
    id: "coins_250k",
    category: "coins",
    label: "💰 صندوق ذهب",
    emoji: "💰",
    priceUSD: 7.99,
    bonus: "+30%",
    description: "250,000 🪙",
    reward: { coins: 250_000 },
  },
  {
    id: "coins_1m",
    category: "coins",
    label: "🏆 خزنة الذهب",
    emoji: "🏆",
    priceUSD: 24.99,
    popular: true,
    tag: "أفضل قيمة",
    description: "1,000,000 🪙",
    reward: { coins: 1_000_000 },
  },


  // ───── Shield (limited 2/week) ────────────────────────────
  {
    id: "shield_1d",
    category: "shield",
    label: "🛡️ درع يوم واحد",
    emoji: "🛡️",
    priceUSD: 0.99,
    weeklyLimit: 2,
    tag: "محدود 2/أسبوع",
    description: "حماية كاملة من الهجمات والسرقة لمدة 24 ساعة",
    reward: { shieldDays: 1 },
  },
  {
    id: "shield_2d",
    category: "shield",
    label: "🛡️ درع الحماية - يومين",
    emoji: "🛡️",
    priceUSD: 1.99,
    weeklyLimit: 2,
    tag: "محدود 2/أسبوع",
    description: "حماية كاملة من الهجمات والسرقة لمدة يومين",
    reward: { shieldDays: 2 },
  },
  {
    id: "shield_3d",
    category: "shield",
    label: "🛡️ درع 3 أيام",
    emoji: "🛡️",
    priceUSD: 2.99,
    weeklyLimit: 2,
    tag: "محدود 2/أسبوع",
    description: "حماية كاملة لمدة 3 أيام — قيمة ممتازة",
    reward: { shieldDays: 3 },
  },
  {
    id: "shield_week",
    category: "shield",
    label: "🛡️ درع أسبوع كامل",
    emoji: "🛡️",
    priceUSD: 5.99,
    weeklyLimit: 2,
    popular: true,
    tag: "أفضل قيمة",
    description: "أسبوع كامل من الحماية القوية — وفّر 30%",
    reward: { shieldDays: 7 },
  },

  // ───── Weapons ────────────────────────────────────────────
  {
    id: "ad_bomb_pack",
    category: "weapon",
    label: "📺 قنبلة إعلانية",
    emoji: "📺",
    priceUSD: 1.99,
    tag: "جديد",
    description: "قنبلة واحدة — انفجار فوري + إعلان ساعة كاملة + 70,000 ضرر على كل سفنه",
    reward: { items: [{ itemType: "weapon", itemId: "ad_bomb", qty: 1 }] },
  },
  {
    id: "wp_rocket_bundle",
    category: "weapon",
    label: "🚀 حزمة الصواريخ",
    emoji: "🚀",
    priceUSD: 3.99,
    description: "5 صواريخ متوسطة + 2 صاروخ كبير",
    reward: {
      items: [
        { itemType: "weapon", itemId: "rocket_medium", qty: 5 },
        { itemType: "weapon", itemId: "rocket_large", qty: 2 },
      ],
    },
  },
  {
    id: "wp_ad_bomb_3",
    category: "weapon",
    label: "📺 ثلاث قنابل إعلانية",
    emoji: "📺",
    priceUSD: 4.99,
    bonus: "وفّر 15%",
    description: "3 قنابل إعلانية بسعر أقل من شراء فردي",
    reward: { items: [{ itemType: "weapon", itemId: "ad_bomb", qty: 3 }] },
  },
  {
    id: "wp_nuke_pack",
    category: "weapon",
    label: "☢️ باقة النوويات",
    emoji: "☢️",
    priceUSD: 9.99,
    tag: "قوي",
    description: "3 قنابل نووية — دمار شامل",
    reward: { items: [{ itemType: "weapon", itemId: "nuke", qty: 3 }] },
  },
  {
    id: "wp_arsenal",
    category: "weapon",
    label: "💣 ترسانة القرصان",
    emoji: "💣",
    priceUSD: 19.99,
    popular: true,
    tag: "أفضل قيمة",
    description: "10 صاروخ كبير + 2 نووية + قنبلة إعلانية",
    reward: {
      items: [
        { itemType: "weapon", itemId: "rocket_large", qty: 10 },
        { itemType: "weapon", itemId: "nuke", qty: 2 },
        { itemType: "weapon", itemId: "ad_bomb", qty: 1 },
      ],
    },
  },

  {
    id: "wp_rocket_mega",
    category: "weapon",
    label: "🚀 حزمة الصواريخ الميجا",
    emoji: "🚀",
    priceUSD: 14.99,
    tag: "خصم 40%",
    description: "30 صاروخ كبير + 10 صواريخ متوسطة — وفّر 40%",
    images: [rocketLargeImg, rocketMediumImg],
    reward: {
      items: [
        { itemType: "weapon", itemId: "rocket_large", qty: 30 },
        { itemType: "weapon", itemId: "rocket_medium", qty: 10 },
      ],
    },
  },
  {
    id: "wp_ad_bomb_10",
    category: "weapon",
    label: "📺 عشر قنابل إعلانية",
    emoji: "📺",
    priceUSD: 13.99,
    tag: "أفضل قيمة",
    description: "10 قنابل إعلانية — وفّر 30% عن الفردي",
    images: [adBombImg],
    reward: { items: [{ itemType: "weapon", itemId: "ad_bomb", qty: 10 }] },
  },
  {
    id: "wp_nuke_giant",
    category: "weapon",
    label: "☢️ باقة النوويات العملاقة",
    emoji: "☢️",
    priceUSD: 24.99,
    tag: "قوي",
    description: "10 قنابل نووية — دمار شامل بسعر مخفض",
    images: [nukeImg],
    reward: { items: [{ itemType: "weapon", itemId: "nuke", qty: 10 }] },
  },
  {
    id: "wp_warlord",
    category: "weapon",
    label: "💥 ترسانة سيد الحرب",
    emoji: "💥",
    priceUSD: 39.99,
    popular: true,
    tag: "أسطوري",
    description: "50 صاروخ كبير + 5 نووية + 5 قنابل إعلانية — العرض الأقوى",
    images: [nukeImg, rocketLargeImg],
    reward: {
      items: [
        { itemType: "weapon", itemId: "rocket_large", qty: 50 },
        { itemType: "weapon", itemId: "nuke", qty: 5 },
        { itemType: "weapon", itemId: "ad_bomb", qty: 5 },
      ],
    },
  },
  {
    id: "wp_nuke_mega_50",
    category: "offers",
    label: "☢️ باقة 50 نووية",
    emoji: "☢️",
    priceUSD: 25.0,
    tag: "خصم ضخم",
    popular: true,
    description: "50 قنبلة نووية — عرض خاص بسعر مخفض جداً",
    images: [nukeImg],
    reward: { items: [{ itemType: "weapon", itemId: "nuke", qty: 50 }] },
  },
  {
    id: "wp_bomb_box_mix",
    category: "offers",
    label: "📦 صندوق القنابل المنوعة",
    emoji: "📦",
    priceUSD: 17.99,
    tag: "خصم 25%",
    description: "15 صاروخ متوسط + 10 صاروخ كبير + 5 نووية + 5 قنابل إعلانية",
    images: [nukeImg, adBombImg, rocketLargeImg],
    reward: {
      items: [
        { itemType: "weapon", itemId: "rocket_medium", qty: 15 },
        { itemType: "weapon", itemId: "rocket_large", qty: 10 },
        { itemType: "weapon", itemId: "nuke", qty: 5 },
        { itemType: "weapon", itemId: "ad_bomb", qty: 5 },
      ],
    },
  },
  {
    id: "wp_ad_bomb_15",
    category: "offers",
    label: "📺 15 قنبلة إعلانية",
    emoji: "📺",
    priceUSD: 10.0,
    tag: "خصم ضخم",
    popular: true,
    description: "15 قنبلة إعلانية بسعر 37.5 ر.س فقط — أفضل عرض",
    images: [adBombImg],
    reward: { items: [{ itemType: "weapon", itemId: "ad_bomb", qty: 15 }] },
  },

  // ───── Crews ──────────────────────────────────────────────
  {
    id: "cr_starter",
    category: "crew",
    label: "⚓ طاقم المبتدئ",
    emoji: "⚓",
    priceUSD: 4.99,
    description: "السارق + الشرطي + التاجر — بداية قوية",
    reward: {
      items: [
        { itemType: "crew", itemId: "thief", qty: 1 },
        { itemType: "crew", itemId: "police", qty: 1 },
        { itemType: "crew", itemId: "trader", qty: 1 },
      ],
    },
  },
  {
    id: "cr_fishing",
    category: "crew",
    label: "🎣 طاقم الصياد",
    emoji: "🎣",
    priceUSD: 7.99,
    bonus: "وفّر 25%",
    description: "الحظ + بحار + المرشد + 2 مصلح كبير",
    reward: {
      items: [
        { itemType: "crew", itemId: "luck", qty: 1 },
        { itemType: "crew", itemId: "sailor", qty: 1 },
        { itemType: "crew", itemId: "guide", qty: 1 },
        { itemType: "crew", itemId: "fixer_3", qty: 2 },
      ],
    },
  },
  {
    id: "cr_legendary",
    category: "crew",
    label: "🏆 الطاقم الأسطوري",
    emoji: "🏆",
    priceUSD: 14.99,
    popular: true,
    tag: "أسطوري",
    description: "مصلح أسطوري + السارق + التاجر + الحظ — كل ما تحتاجه",
    reward: {
      items: [
        { itemType: "crew", itemId: "fixer_4", qty: 1 },
        { itemType: "crew", itemId: "thief", qty: 1 },
        { itemType: "crew", itemId: "trader", qty: 1 },
        { itemType: "crew", itemId: "luck", qty: 1 },
      ],
    },
  },
  {
    id: "cr_mega_100",
    category: "offers",
    label: "👥 باقة 100 طاقم منوعة",
    emoji: "👥",
    priceUSD: 25.0,
    tag: "خصم 25%",
    popular: true,
    description: "25 حظ + 25 سارق + 20 تاجر + 15 شرطي + 15 بحار — خصم 25%",
    reward: {
      items: [
        { itemType: "crew", itemId: "luck", qty: 25 },
        { itemType: "crew", itemId: "thief", qty: 25 },
        { itemType: "crew", itemId: "trader", qty: 20 },
        { itemType: "crew", itemId: "police", qty: 15 },
        { itemType: "crew", itemId: "sailor", qty: 15 },
      ],
    },
  },

  // ───── Golden Fisher (premium recharge-only) ────────────────
  {
    id: "cr_golden_fisher_2pack",
    category: "crew",
    label: "🏅 طاقم الصياد الذهبي × 2",
    emoji: "🏅",
    priceUSD: 20,
    tag: "موقوف مؤقتاً",
    disabled: true,
    description: "⏸️ طاقم الصياد الذهبي موقف مؤقتاً قيد الفحص — ارجع لاحقاً.",
    reward: {
      items: [{ itemType: "crew", itemId: "golden_fisher", qty: 2 }],
    },
  },
];

export function getPack(id: string): StorePack | undefined {
  return STORE_PACKS.find((p) => p.id === id);
}
