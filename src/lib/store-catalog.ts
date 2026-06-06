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
    description: "1,200 💎 + 150,000 🪙 + 30 ياقوت 🔴",
    reward: { gems: 1_200, coins: 150_000, rubies: 30 },
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
    description: "2,500 💎 + 300,000 🪙 + 50 ياقوت 🔴 + درع 5 أيام 🛡️",
    reward: { gems: 2_500, coins: 300_000, rubies: 50, shieldDays: 5 },
  },
  {
    id: "bd_mega",
    category: "bundle",
    label: "💥 الباقة الضخمة",
    emoji: "💥",
    priceUSD: 39.99,
    stripePriceId: "bd_mega",
    tag: "أفضل قيمة",
    description: "4,000 💎 + 500,000 🪙 + 80 ياقوت 🔴",
    reward: { gems: 4_000, coins: 500_000, rubies: 80 },
  },
  {
    id: "bd_emperor",
    category: "bundle",
    label: "👑 كنز الإمبراطور الفخم",
    emoji: "👑",
    priceUSD: 74.99,
    stripePriceId: "bd_emperor",
    tag: "حصري",
    description: "10,000 💎 + 1,000,000 🪙 + 150 ياقوت 🔴",
    reward: { gems: 10_000, coins: 1_000_000, rubies: 150 },
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
    bonus: "+12% + ياقوت",
    reward: { gems: 2_800, rubies: 20 },
  },
  {
    id: "gp_4500",
    category: "gems",
    label: "خزنة جواهر كبرى",
    emoji: "🔶",
    priceUSD: 29.99,
    stripePriceId: "gp_4500",
    bonus: "+30% + ياقوت",
    reward: { gems: 4_500, rubies: 40 },
  },
  {
    id: "gp_7500",
    category: "gems",
    label: "كنز القرصان",
    emoji: "🏴‍☠️",
    priceUSD: 49.99,
    stripePriceId: "price_1TbBUUBXfl6qYczzVLsD6ciX",
    bonus: "+25% + 80 ياقوت + صندوق",
    reward: { gems: 7_500, rubies: 80 },
  },
  {
    id: "gp_12000",
    category: "gems",
    label: "كنز الجواهر الملكي",
    emoji: "💠",
    priceUSD: 74.99,
    stripePriceId: "gp_12000",
    bonus: "+35% + 180 ياقوت",
    tag: "ملكي",
    reward: { gems: 12_000, rubies: 180 },
  },
  {
    id: "gp_17000",
    category: "gems",
    label: "كنز الإمبراطور",
    emoji: "👑",
    priceUSD: 99.99,
    stripePriceId: "price_1TbBXmBXfl6qYczz01Amwt8Z",
    bonus: "+36% + 250 ياقوت + 3 صناديق",
    tag: "أفضل قيمة",
    reward: { gems: 17_000, rubies: 250 },
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
    bonus: "+ ياقوت",
    description: "250,000 🪙 + 10 ياقوت 🔴",
    reward: { coins: 250_000, rubies: 10 },
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
    description: "1,000,000 🪙 + 50 ياقوت 🔴",
    reward: { coins: 1_000_000, rubies: 50 },
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
];

export function getPack(id: string): StorePack | undefined {
  return STORE_PACKS.find((p) => p.id === id);
}
