// Canonical catalog of packs that map to real Stripe prices.
// Each pack has a `stripePriceId` — the server uses ONLY the priceId from this
// file to create the checkout (never trust client price/amount).

import adBombStoreImg from "@/assets/ad-bomb-store.jpg.asset.json";

export type PackCategory = "bundle" | "vip" | "gems" | "shield" | "weapon";

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
  image?: string;
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
    id: "bd_lootbox5",
    category: "bundle",
    label: "📦 حزمة صناديق أسطورية × 5",
    emoji: "📦",
    priceUSD: 14.99,
    stripePriceId: "price_1TbBbFBXfl6qYczz6puMOn2F",
    description: "1,200 💎 + 150,000 🪙 + 30 ياقوت 🔴",
    reward: { gems: 1_200, coins: 150_000, rubies: 30 },
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

  // ───── Shield (limited 2/week) ────────────────────────────
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
