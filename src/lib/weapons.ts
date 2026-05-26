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
    rarity: "common",
    desc: "يدمّر سفن المستوى 1-2 فقط",
  },
  {
    id: "rocket_medium",
    name: "صاروخ متوسط",
    emoji: "🎯",
    image: rocketMediumImg,
    price: 15000,
    currency: "coins",
    damage: 500,
    rarity: "rare",
    desc: "يدمّر سفن المستوى 3-7",
  },
  {
    id: "rocket_large",
    name: "صاروخ كبير",
    emoji: "💥",
    image: rocketLargeImg,
    price: 90000,
    currency: "coins",
    damage: 1500,
    rarity: "epic",
    desc: "يدمّر سفن المستوى 8-22",
  },
  {
    id: "nuke",
    name: "قنبلة ذرية",
    emoji: "☢️",
    image: nukeImg,
    price: 2500,
    currency: "gems",
    damage: 999999,
    rarity: "legendary",
    aoe: true,
    desc: "تفجّر جميع سفن الخصم دفعةً واحدة",
  },
];
