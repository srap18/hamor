// Weapon catalog — used when attacking other players' ships.
// Damage is balanced against ship HP scale: L1=80 HP up to L30=1965 HP.
// Only the Nuke (aoe=true) can destroy a max-level ship and it hits ALL ships at once.
import rocketSmallImg from "@/assets/weapons/rocket-small.webp";
import rocketMediumImg from "@/assets/weapons/rocket-medium.webp";
import rocketLargeImg from "@/assets/weapons/rocket-large.webp";
import nukeImg from "@/assets/weapons/nuke.webp";
import adBombImg from "@/assets/weapons/ad-bomb.webp";
import krakenBombImg from "@/assets/weapons/kraken-bomb.png";
import doomAnnihilatorImg from "@/assets/weapons/doom-annihilator.png";

export type Weapon = {
  id: string;
  name: string;
  emoji: string;
  image?: string;
  price: number;
  currency: "coins" | "gems";
  damage: number;
  xp: number; // XP awarded to attacker per ship hit
  rarity: "common" | "rare" | "epic" | "legendary";
  aoe?: boolean; // true = hits every ship in the target fleet (nuke)
  unlimited?: boolean; // true = ignores HP entirely, destroys every ship
  noShop?: boolean; // true = never sold in the shop / trade (admin-granted only)
  desc?: string;
};



export const WEAPONS: Weapon[] = [
  {
    id: "rocket_small",
    name: "صاروخ صغير",
    emoji: "🚀",
    image: rocketSmallImg,
    price: 1500,
    currency: "coins",
    damage: 800,
    xp: 0,
    rarity: "common",
    desc: "يدمّر سفن المستوى 1-3",
  },
  {
    id: "rocket_medium",
    name: "صاروخ متوسط",
    emoji: "🎯",
    image: rocketMediumImg,
    price: 15000,
    currency: "coins",
    damage: 4000,
    xp: 0,
    rarity: "rare",
    desc: "يدمّر سفن المستوى 4-8",
  },
  {
    id: "rocket_large",
    name: "صاروخ كبير",
    emoji: "💥",
    image: rocketLargeImg,
    price: 90000,
    currency: "coins",
    damage: 18000,
    xp: 50,
    rarity: "epic",
    desc: "يدمّر سفن المستوى 9-13 — يمنحك 50 خبرة",
  },

  {
    id: "nuke",
    name: "قنبلة ذرية",
    emoji: "☢️",
    image: nukeImg,
    price: 100,
    currency: "gems",
    damage: 70_000,
    xp: 250,
    rarity: "legendary",
    aoe: true,
    desc: "تدمّر جميع سفن الخصم فوراً مهما كان حجمها — 250 خبرة",

  },
  {
    id: "ad_bomb",
    name: "قنبلة إعلانية",
    emoji: "📺",
    image: adBombImg,
    price: 180,
    currency: "gems",
    damage: 70_000,
    xp: 500,
    rarity: "epic",
    aoe: true,
    desc: "تدمّر جميع سفن الخصم فوراً + إعلان ساعة على محيطه. 500 خبرة.",

  },
  {
    id: "kraken_bomb",
    name: "قنبلة الكراكن",
    emoji: "🐙",
    image: krakenBombImg,
    price: 10000,
    currency: "gems",
    damage: 70_000,
    xp: 700,
    rarity: "legendary",
    aoe: true,
    desc: "70,000 ضرر على كل سفن الخصم + تسحب سمك مخزنه بحد مساحتك الفاضية. 700 خبرة · 3 يومياً.",
  },
];

