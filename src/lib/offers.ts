// Bundle offers — discounted weapon packs. Server-side prices live in the
// `buy_offer` RPC. Keep these in sync with the SQL function.
import rocketSmallImg from "@/assets/weapons/rocket-small.png";
import rocketMediumImg from "@/assets/weapons/rocket-medium.png";
import rocketLargeImg from "@/assets/weapons/rocket-large.png";
import nukeImg from "@/assets/weapons/nuke.png";
import adBombImg from "@/assets/weapons/ad-bomb.png";

export type OfferContent = { id: string; name: string; qty: number; image: string };

export type Offer = {
  id: string;
  name: string;
  desc: string;
  price: number;
  originalPrice: number;
  currency: "gem" | "coin";
  contents: OfferContent[];
  badge?: string; // e.g. "AFFORDABLE", "BEST", "MEGA"
  rarity?: "common" | "rare" | "epic" | "legendary";
};

export const OFFERS: Offer[] = [
  // ─── Gem offers (premium weapon bundles) ───
  {
    id: "offer_nuke_3",
    name: "حزمة القنابل الصغيرة",
    desc: "3 قنابل ذرية ☢️ — وفّر 10%",
    price: 270,
    originalPrice: 300,
    currency: "gem",
    contents: [{ id: "nuke", name: "قنبلة ذرية", qty: 3, image: nukeImg }],
    badge: "وفّر 10%",
    rarity: "rare",
  },
  {
    id: "offer_nuke_6",
    name: "حزمة المدمّر",
    desc: "6 قنابل ذرية ☢️ — وفّر 15%",
    price: 510,
    originalPrice: 600,
    currency: "gem",
    contents: [{ id: "nuke", name: "قنبلة ذرية", qty: 6, image: nukeImg }],
    badge: "الأكثر مبيعاً",
    rarity: "epic",
  },
  {
    id: "offer_nuke_12",
    name: "ترسانة القنابل",
    desc: "12 قنبلة ذرية ☢️ — وفّر 20%",
    price: 960,
    originalPrice: 1200,
    currency: "gem",
    contents: [{ id: "nuke", name: "قنبلة ذرية", qty: 12, image: nukeImg }],
    badge: "وفّر 20%",
    rarity: "legendary",
  },
  {
    id: "offer_adbomb_5",
    name: "حزمة القنابل الإعلانية",
    desc: "5 قنابل إعلانية 📺 — وفّر 15%",
    price: 765,
    originalPrice: 900,
    currency: "gem",
    contents: [{ id: "ad_bomb", name: "قنبلة إعلانية", qty: 5, image: adBombImg }],
    badge: "وفّر 15%",
    rarity: "epic",
  },
  {
    id: "offer_mix_warlord",
    name: "حزمة أمير الحرب",
    desc: "5 قنابل ذرية + 3 إعلانية — وفّر 15%",
    price: 880,
    originalPrice: 1040,
    currency: "gem",
    contents: [
      { id: "nuke", name: "قنبلة ذرية", qty: 5, image: nukeImg },
      { id: "ad_bomb", name: "قنبلة إعلانية", qty: 3, image: adBombImg },
    ],
    badge: "مميزة",
    rarity: "legendary",
  },
  {
    id: "offer_mix_mega",
    name: "حزمة الإمبراطور",
    desc: "10 قنابل ذرية + 5 إعلانية — وفّر 11%",
    price: 1700,
    originalPrice: 1900,
    currency: "gem",
    contents: [
      { id: "nuke", name: "قنبلة ذرية", qty: 10, image: nukeImg },
      { id: "ad_bomb", name: "قنبلة إعلانية", qty: 5, image: adBombImg },
    ],
    badge: "ضخمة",
    rarity: "legendary",
  },

  // ─── Coin offers ───
  {
    id: "offer_rocket_small_10",
    name: "حزمة الصواريخ الصغيرة",
    desc: "10 صواريخ صغيرة 🚀 — وفّر 20%",
    price: 12000,
    originalPrice: 15000,
    currency: "coin",
    contents: [{ id: "rocket_small", name: "صاروخ صغير", qty: 10, image: rocketSmallImg }],
    badge: "وفّر 20%",
    rarity: "common",
  },
  {
    id: "offer_rocket_medium_5",
    name: "حزمة الصواريخ المتوسطة",
    desc: "5 صواريخ متوسطة 🎯 — وفّر 20%",
    price: 60000,
    originalPrice: 75000,
    currency: "coin",
    contents: [{ id: "rocket_medium", name: "صاروخ متوسط", qty: 5, image: rocketMediumImg }],
    badge: "وفّر 20%",
    rarity: "rare",
  },
  {
    id: "offer_rocket_large_3",
    name: "حزمة الصواريخ الكبيرة",
    desc: "3 صواريخ كبيرة 💥 — وفّر 17%",
    price: 225000,
    originalPrice: 270000,
    currency: "coin",
    contents: [{ id: "rocket_large", name: "صاروخ كبير", qty: 3, image: rocketLargeImg }],
    badge: "وفّر 17%",
    rarity: "epic",
  },
  {
    id: "offer_rocket_assorted",
    name: "حزمة الترسانة المتنوعة",
    desc: "20 صغير + 5 متوسط + 1 كبير — وفّر 22%",
    price: 140000,
    originalPrice: 195000,
    currency: "coin",
    contents: [
      { id: "rocket_small", name: "صاروخ صغير", qty: 20, image: rocketSmallImg },
      { id: "rocket_medium", name: "صاروخ متوسط", qty: 5, image: rocketMediumImg },
      { id: "rocket_large", name: "صاروخ كبير", qty: 1, image: rocketLargeImg },
    ],
    badge: "أفضل قيمة",
    rarity: "legendary",
  },
];

export async function buyOfferRpc(offerId: string) {
  const { supabase } = await import("@/integrations/supabase/client");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase.rpc as any)("buy_offer", { _offer_id: offerId });
}
