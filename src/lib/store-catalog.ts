// Canonical catalog of packs that map to real Stripe prices.
// Each pack has a `stripePriceId` — the server uses ONLY the priceId from this
// file to create the checkout (never trust client price/amount).

export type PackCategory = "bundle" | "vip" | "gems" | "shield" | "weapon" | "coins" | "crew";

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
  stripePriceId: string;
  subscription?: boolean;
  weeklyLimit?: number;
  oneTime?: boolean;
  tag?: string;
  popular?: boolean;
  bonus?: string;
  description?: string;
  reward: {
    gems?: number;
    coins?: number;
    rubies?: number;
    shieldDays?: number;
    vipDays?: number;
    items?: PackInventoryItem[];
  };
};

export const STORE_PACKS: StorePack[] = [
  // ───── Bundles ────────────────────────────────────────────
  {
    id: "bd_starter",
    category: "bundle",
    label: "🎁 باقة المبتدئ",
    emoji: "⚓",
    priceUSD: 2.99,
    stripePriceId: "price_1TbBYEBXfl6qYczzwYUvThdC",
    oneTime: true,
    tag: "لمرة واحدة فقط",
    description: "700 💎 + 20,000 🪙 + حماية 3 أيام 🛡️ — قيمة $15",
    reward: { gems: 700, coins: 20_000, shieldDays: 3 },
  },
  {
    id: "bd_weekend",
    category: "bundle",
    label: "🌅 عرض نهاية الأسبوع",
    emoji: "🌅",
    priceUSD: 4.99,
    stripePriceId: "bd_weekend",
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
    stripePriceId: "price_1TbBbFBXfl6qYczz6puMOn2F",
    description: "1,500 💎 + 150,000 🪙",
    reward: { gems: 1_500, coins: 150_000 },
  },
  {
    id: "bd_pirate_chest",
    category: "bundle",
    label: "🏴‍☠️ صندوق القرصان",
    emoji: "🏴‍☠️",
    priceUSD: 24.99,
    stripePriceId: "bd_pirate_chest",
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
    stripePriceId: "bd_mega",
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
    stripePriceId: "bd_emperor",
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
    stripePriceId: "price_1TbBYvBXfl6qYczzITwpLMHY",
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
    stripePriceId: "price_1TbBLlBXfl6qYczzhS4kwRJJ",
    reward: { gems: 100 },
  },
  {
    id: "gp_300",
    category: "gems",
    label: "كيس جواهر صغير",
    emoji: "💎",
    priceUSD: 2.49,
    stripePriceId: "gp_300",
    bonus: "+20%",
    reward: { gems: 300 },
  },
  {
    id: "gp_550",
    category: "gems",
    label: "كيس جواهر",
    emoji: "💎",
    priceUSD: 4.99,
    stripePriceId: "price_1TbBMDBXfl6qYczzIY6TCqkN",
    bonus: "+10%",
    reward: { gems: 550 },
  },
  {
    id: "gp_1250",
    category: "gems",
    label: "صندوق جواهر",
    emoji: "💠",
    priceUSD: 9.99,
    stripePriceId: "price_1TbBOsBXfl6qYczzzXExftmc",
    bonus: "+25%",
    popular: true,
    tag: "أفضل قيمة",
    reward: { gems: 1_250 },
  },
  {
    id: "gp_2800",
    category: "gems",
    label: "خزنة جواهر",
    emoji: "🔷",
    priceUSD: 19.99,
    stripePriceId: "price_1TbBRXBXfl6qYczz3F4CVfCM",
    bonus: "+12%",
    reward: { gems: 2_800 },
  },
  {
    id: "gp_4500",
    category: "gems",
    label: "خزنة جواهر كبرى",
    emoji: "🔶",
    priceUSD: 29.99,
    stripePriceId: "gp_4500",
    bonus: "+30%",
    reward: { gems: 4_500 },
  },
  {
    id: "gp_7500",
    category: "gems",
    label: "كنز القرصان",
    emoji: "🏴‍☠️",
    priceUSD: 49.99,
    stripePriceId: "price_1TbBUUBXfl6qYczzVLsD6ciX",
    bonus: "+25% + صندوق",
    reward: { gems: 7_500 },
  },
  {
    id: "gp_12000",
    category: "gems",
    label: "كنز الجواهر الملكي",
    emoji: "💠",
    priceUSD: 74.99,
    stripePriceId: "gp_12000",
    bonus: "+35%",
    tag: "ملكي",
    reward: { gems: 12_000 },
  },
  {
    id: "gp_17000",
    category: "gems",
    label: "كنز الإمبراطور",
    emoji: "👑",
    priceUSD: 99.99,
    stripePriceId: "price_1TbBXmBXfl6qYczz01Amwt8Z",
    bonus: "+36% + 3 صناديق",
    tag: "أفضل قيمة",
    reward: { gems: 17_000 },
  },


  // ───── Coins ──────────────────────────────────────────────
  {
    id: "coins_50k",
    category: "coins",
    label: "🪙 كيس ذهب",
    emoji: "🪙",
    priceUSD: 1.99,
    stripePriceId: "coins_50k",
    description: "50,000 🪙",
    reward: { coins: 50_000 },
  },
  {
    id: "coins_250k",
    category: "coins",
    label: "💰 صندوق ذهب",
    emoji: "💰",
    priceUSD: 7.99,
    stripePriceId: "coins_250k",
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
    stripePriceId: "coins_1m",
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
    stripePriceId: "shield_1d",
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
    stripePriceId: "price_1TbBahBXfl6qYczzMKgGzRPc",
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
    stripePriceId: "shield_3d",
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
    stripePriceId: "shield_week",
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
    stripePriceId: "ad_bomb_pack",
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
    stripePriceId: "wp_rocket_bundle",
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
    stripePriceId: "wp_ad_bomb_3",
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
    stripePriceId: "wp_nuke_pack",
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
    stripePriceId: "wp_arsenal",
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

  // ───── Crews ──────────────────────────────────────────────
  {
    id: "cr_starter",
    category: "crew",
    label: "⚓ طاقم المبتدئ",
    emoji: "⚓",
    priceUSD: 4.99,
    stripePriceId: "cr_starter",
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
    stripePriceId: "cr_fishing",
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
    stripePriceId: "cr_legendary",
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
];

export function getPack(id: string): StorePack | undefined {
  return STORE_PACKS.find((p) => p.id === id);
}
