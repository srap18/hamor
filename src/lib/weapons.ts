// Weapon catalog — used when attacking other players' ships.
// Damage is balanced against ship HP scale: L1=80 HP up to L30=1965 HP.
// Only the Nuke (aoe=true) can destroy a max-level ship and it hits ALL ships at once.
import rocketSmallImg from "@/assets/weapons/rocket-small.png";
import rocketMediumImg from "@/assets/weapons/rocket-medium.png";
import rocketLargeImg from "@/assets/weapons/rocket-large.png";
import nukeImg from "@/assets/weapons/nuke.png";

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
    damage: 120,
    xp: 15,
    rarity: "common",
    desc: "يدمّر سفن المستوى 1-2 فقط — يمنحك 15 خبرة",
  },
  {
    id: "rocket_medium",
    name: "صاروخ متوسط",
    emoji: "🎯",
    image: rocketMediumImg,
    price: 15000,
    currency: "coins",
    damage: 500,
    xp: 60,
    rarity: "rare",
    desc: "يدمّر سفن المستوى 3-7 — يمنحك 60 خبرة",
  },
  {
    id: "rocket_large",
    name: "صاروخ كبير",
    emoji: "💥",
    image: rocketLargeImg,
    price: 90000,
    currency: "coins",
    damage: 1500,
    xp: 200,
    rarity: "epic",
    desc: "يدمّر سفن المستوى 8-22 — يمنحك 200 خبرة",
  },
  {
    id: "nuke",
    name: "قنبلة ذرية",
    emoji: "☢️",
    image: nukeImg,
    price: 100,
    currency: "gems",
    damage: 70000,
    xp: 500,
    rarity: "legendary",
    aoe: true,
    desc: "تصيب جميع سفن الخصم بـ 70,000 ضرر — 500 خبرة لكل سفينة",
  },
  {
    id: "ad_bomb",
    name: "قنبلة إعلانية",
    emoji: "📺",
    price: 0,
    currency: "gems",
    damage: 70000,
    xp: 250,
    rarity: "epic",
    aoe: true,
    desc: "تفجير فوري + إعلان ساعة على محيط الخصم. 70,000 ضرر + 250 خبرة لكل سفينة. تتوفر فقط عبر كود شحن.",
  },
];

