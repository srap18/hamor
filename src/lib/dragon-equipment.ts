// Dragon equipment catalog and helpers
import swordImg from "@/assets/dragon-sword.png";
import shieldImg from "@/assets/dragon-shield.png";
import talismanImg from "@/assets/dragon-talisman.png";

export type Slot = "weapon" | "armor" | "talisman";
export type Rarity = "common" | "rare" | "epic" | "legendary" | "divine" | "fatak";

export type EquipmentItem = {
  id: string;
  user_id: string;
  slot: Slot;
  rarity: Rarity;
  name: string;
  stats: Record<string, number | boolean>;
  equipped: boolean;
  acquired_at: string;
};

export const SLOT_IMG: Record<Slot, string> = {
  weapon: swordImg,
  armor: shieldImg,
  talisman: talismanImg,
};

export const SLOT_LABEL: Record<Slot, string> = {
  weapon: "سلاح",
  armor: "درع",
  talisman: "تميمة",
};

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "عادي",
  rare: "نادر",
  epic: "ملحمي",
  legendary: "أسطوري",
  divine: "خرافي",
  fatak: "فتاك",
};

export const RARITY_COLOR: Record<Rarity, { ring: string; glow: string; text: string; bg: string }> = {
  common:    { ring: "border-stone-400/60",   glow: "rgba(168,162,158,0.4)", text: "text-stone-200",   bg: "from-stone-700/40 to-stone-900/40" },
  rare:      { ring: "border-sky-400/70",     glow: "rgba(56,189,248,0.6)",  text: "text-sky-200",     bg: "from-sky-700/30 to-sky-950/40" },
  epic:      { ring: "border-purple-400/80",  glow: "rgba(168,85,247,0.7)",  text: "text-purple-200",  bg: "from-purple-700/30 to-purple-950/40" },
  legendary: { ring: "border-amber-400/90",   glow: "rgba(251,191,36,0.8)",  text: "text-amber-200",   bg: "from-amber-600/30 to-amber-900/40" },
  divine:    { ring: "border-rose-400",       glow: "rgba(244,63,94,1)",     text: "text-rose-200",    bg: "from-rose-700/40 to-rose-950/50" },
  fatak:     { ring: "border-red-500",        glow: "rgba(239,68,68,1)",     text: "text-red-100",     bg: "from-red-800/50 to-black/60" },
};

export const RARITY_ORDER: Rarity[] = ["common", "rare", "epic", "legendary", "divine", "fatak"];

export type ShopOffer = {
  slot: Slot;
  rarity: Rarity;
  currency: "coins" | "gems";
  price: number;
};

export const SHOP: ShopOffer[] = [
  // Gold tier (common + rare only)
  { slot: "weapon",   rarity: "common", currency: "coins", price: 50000 },
  { slot: "weapon",   rarity: "rare",   currency: "coins", price: 250000 },
  { slot: "armor",    rarity: "common", currency: "coins", price: 50000 },
  { slot: "armor",    rarity: "rare",   currency: "coins", price: 250000 },
  { slot: "talisman", rarity: "common", currency: "coins", price: 50000 },
  { slot: "talisman", rarity: "rare",   currency: "coins", price: 250000 },
  // Gem tier (rare → divine — expensive elite)
  { slot: "weapon",   rarity: "rare",      currency: "gems", price: 3000 },
  { slot: "weapon",   rarity: "epic",      currency: "gems", price: 9000 },
  { slot: "weapon",   rarity: "legendary", currency: "gems", price: 22000 },
  { slot: "weapon",   rarity: "divine",    currency: "gems", price: 45000 },
  { slot: "armor",    rarity: "rare",      currency: "gems", price: 3000 },
  { slot: "armor",    rarity: "epic",      currency: "gems", price: 9000 },
  { slot: "armor",    rarity: "legendary", currency: "gems", price: 22000 },
  { slot: "armor",    rarity: "divine",    currency: "gems", price: 45000 },
  { slot: "talisman", rarity: "rare",      currency: "gems", price: 3000 },
  { slot: "talisman", rarity: "epic",      currency: "gems", price: 9000 },
  { slot: "talisman", rarity: "legendary", currency: "gems", price: 22000 },
  { slot: "talisman", rarity: "divine",    currency: "gems", price: 45000 },
];

export const UPGRADE_COST: Record<Rarity, number | null> = {
  common: 1500,    // → rare
  rare: 6000,      // → epic
  epic: 15000,     // → legendary
  legendary: 35000,// → divine
  divine: null,
};

export function nextRarity(r: Rarity): Rarity | null {
  const i = RARITY_ORDER.indexOf(r);
  return i < 0 || i >= RARITY_ORDER.length - 1 ? null : RARITY_ORDER[i + 1];
}
