// 44 fish catalog — split by tier. Higher tier = rarer + more valuable.
// Each ship tier catches 2 fish from its tier range.

import sardine from "@/assets/fish/sardine.png";
import anchovy from "@/assets/fish/anchovy.png";
import herring from "@/assets/fish/herring.png";
import smelt from "@/assets/fish/smelt.png";
import minnow from "@/assets/fish/minnow.png";
import mullet from "@/assets/fish/mullet.png";
import shrimp from "@/assets/fish/shrimp.png";
import crab_small from "@/assets/fish/crab_small.png";
import mackerel from "@/assets/fish/mackerel.png";
import bass from "@/assets/fish/bass.png";
import cod from "@/assets/fish/cod.png";
import snapper from "@/assets/fish/snapper.png";
import trout from "@/assets/fish/trout.png";
import salmon from "@/assets/fish/salmon.png";
import squid from "@/assets/fish/squid.png";
import tuna from "@/assets/fish/tuna.png";
import grouper from "@/assets/fish/grouper.png";
import octopus from "@/assets/fish/octopus.png";
import lobster from "@/assets/fish/lobster.png";
import eel from "@/assets/fish/eel.png";
import flounder from "@/assets/fish/flounder.png";
import carp from "@/assets/fish/carp.png";
import marlin from "@/assets/fish/marlin.png";
import swordfish from "@/assets/fish/swordfish.png";
import sailfish from "@/assets/fish/sailfish.png";
import barracuda from "@/assets/fish/barracuda.png";
import stingray from "@/assets/fish/stingray.png";
import shark from "@/assets/fish/shark.png";
import tang_blue from "@/assets/fish/tang_blue.png";
import koi from "@/assets/fish/koi.png";
import manta from "@/assets/fish/manta.png";
import hammerhead from "@/assets/fish/hammerhead.png";
import whale from "@/assets/fish/whale.png";
import orca from "@/assets/fish/orca.png";
import arowana from "@/assets/fish/arowana.png";
import goldfish from "@/assets/fish/goldfish.png";
import pearl from "@/assets/fish/pearl.png";
import kraken from "@/assets/fish/kraken.png";
import leviathan from "@/assets/fish/leviathan.png";
import megalodon from "@/assets/fish/megalodon.png";
import sea_dragon from "@/assets/fish/sea_dragon.png";
import poseidon from "@/assets/fish/poseidon.png";
import black_pearl from "@/assets/fish/black_pearl.png";
import golden_koi from "@/assets/fish/golden_koi.png";
import phoenix from "@/assets/fish/phoenix.png";
import abyss_titan from "@/assets/fish/abyss_titan.png";
import black_dragon from "@/assets/fish/black_dragon.png";

export const FISH_IMG: Record<string, string> = {
  sardine, anchovy, herring, smelt, minnow, mullet, shrimp, crab_small,
  mackerel, bass, cod, snapper, trout, salmon, squid,
  tuna, grouper, octopus, lobster, eel, flounder, carp,
  marlin, swordfish, sailfish, barracuda, stingray, shark, tang_blue, koi,
  manta, hammerhead, whale, orca, arowana, goldfish, pearl,
  kraken, leviathan, megalodon, sea_dragon, poseidon, black_pearl, golden_koi,
  phoenix, abyss_titan, black_dragon,
};

export type Fish = {
  id: string;
  name: string;
  emoji: string;
  img: string;
  price: number;   // coins per fish
  tier: 1 | 2 | 3 | 4 | 5 | 6;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";
};

type FishDef = Omit<Fish, "img">;



const FISH_DEFS: Record<string, FishDef> = {
  // ========== TIER 1 — رخيصة (سواحل) — 1-8 ==========
  sardine:    { id: "sardine",    name: "سردين",         emoji: "🐟", price: 1,   tier: 1, rarity: "common" },
  anchovy:    { id: "anchovy",    name: "أنشوجة",        emoji: "🐠", price: 1,   tier: 1, rarity: "common" },
  herring:    { id: "herring",    name: "رنجة",          emoji: "🐟", price: 1,  tier: 1, rarity: "common" },
  smelt:      { id: "smelt",      name: "سمك ذوب",       emoji: "🐠", price: 2,  tier: 1, rarity: "common" },
  minnow:     { id: "minnow",     name: "بلم",           emoji: "🐟", price: 2,  tier: 1, rarity: "common" },
  mullet:     { id: "mullet",     name: "بوري",          emoji: "🐠", price: 2,  tier: 1, rarity: "common" },
  shrimp:     { id: "shrimp",     name: "روبيان",        emoji: "🦐", price: 3,  tier: 1, rarity: "common" },
  crab_small: { id: "crab_small", name: "سلطعون صغير",   emoji: "🦀", price: 3,  tier: 1, rarity: "common" },

  // ========== TIER 2 — منتشرة — 10-20 ==========
  mackerel:   { id: "mackerel",   name: "ماكريل",        emoji: "🐟", price: 4,  tier: 2, rarity: "uncommon" },
  bass:       { id: "bass",       name: "قاروص",         emoji: "🐠", price: 5,  tier: 2, rarity: "uncommon" },
  cod:        { id: "cod",        name: "قد",            emoji: "🐟", price: 6,  tier: 2, rarity: "uncommon" },
  snapper:    { id: "snapper",    name: "نهاش",          emoji: "🐠", price: 6,  tier: 2, rarity: "uncommon" },
  trout:      { id: "trout",      name: "تروتة",         emoji: "🐟", price: 7,  tier: 2, rarity: "uncommon" },
  salmon:     { id: "salmon",     name: "سلمون",         emoji: "🐠", price: 8,  tier: 2, rarity: "uncommon" },
  squid:      { id: "squid",      name: "حبار",          emoji: "🦑", price: 8,  tier: 2, rarity: "uncommon" },

  // ========== TIER 3 — قيمة — 25-40 ==========
  tuna:       { id: "tuna",       name: "تونة",          emoji: "🐟", price: 10,  tier: 3, rarity: "rare" },
  grouper:    { id: "grouper",    name: "هامور",         emoji: "🐠", price: 11,  tier: 3, rarity: "rare" },
  octopus:    { id: "octopus",    name: "أخطبوط",        emoji: "🐙", price: 12,  tier: 3, rarity: "rare" },
  lobster:    { id: "lobster",    name: "كركند",         emoji: "🦞", price: 13,  tier: 3, rarity: "rare" },
  eel:        { id: "eel",        name: "ثعبان بحر",     emoji: "🐍", price: 14,  tier: 3, rarity: "rare" },
  flounder:   { id: "flounder",   name: "موسى",          emoji: "🐠", price: 15,  tier: 3, rarity: "rare" },
  carp:       { id: "carp",       name: "كارب",          emoji: "🐟", price: 16,  tier: 3, rarity: "rare" },

  // ========== TIER 4 — نادرة — 45-65 ==========
  marlin:     { id: "marlin",     name: "مارلين",        emoji: "🗡️", price: 18,  tier: 4, rarity: "epic" },
  swordfish:  { id: "swordfish",  name: "أبو سيف",       emoji: "⚔️", price: 20,  tier: 4, rarity: "epic" },
  sailfish:   { id: "sailfish",   name: "أبو شراع",      emoji: "🐟", price: 21,  tier: 4, rarity: "epic" },
  barracuda:  { id: "barracuda",  name: "باراكودا",      emoji: "🦈", price: 22,  tier: 4, rarity: "epic" },
  stingray:   { id: "stingray",   name: "لخمة",          emoji: "🪼", price: 23,  tier: 4, rarity: "epic" },
  shark:      { id: "shark",      name: "قرش",           emoji: "🦈", price: 25,  tier: 4, rarity: "epic" },
  tang_blue:  { id: "tang_blue",  name: "تانغ أزرق",     emoji: "🐠", price: 26,  tier: 4, rarity: "epic" },
  koi:        { id: "koi",        name: "كوي",           emoji: "🐠", price: 26,  tier: 4, rarity: "epic" },

  // ========== TIER 5 — أسطورية — 70-90 ==========
  manta:      { id: "manta",      name: "شيطان البحر",   emoji: "🪼", price: 28,   tier: 5, rarity: "legendary" },
  hammerhead: { id: "hammerhead", name: "أبو مطرقة",     emoji: "🦈", price: 30,   tier: 5, rarity: "legendary" },
  whale:      { id: "whale",      name: "حوت",           emoji: "🐋", price: 31,   tier: 5, rarity: "legendary" },
  orca:       { id: "orca",       name: "حوت قاتل",      emoji: "🐳", price: 33,   tier: 5, rarity: "legendary" },
  arowana:    { id: "arowana",    name: "أروانا",        emoji: "🐉", price: 34,   tier: 5, rarity: "legendary" },
  goldfish:   { id: "goldfish",   name: "سمكة ذهبية",    emoji: "🐡", price: 35,   tier: 5, rarity: "legendary" },
  pearl:      { id: "pearl",      name: "لؤلؤ",          emoji: "🫧", price: 36,   tier: 5, rarity: "legendary" },

  // ========== TIER 6 — أسطورية خرافية — 95-100 ==========
  kraken:     { id: "kraken",     name: "كراكن",         emoji: "🐙", price: 38,   tier: 6, rarity: "mythic" },
  leviathan:  { id: "leviathan",  name: "لوياثان",       emoji: "🐉", price: 38,   tier: 6, rarity: "mythic" },
  megalodon:  { id: "megalodon",  name: "ميغالودون",     emoji: "🦈", price: 39,   tier: 6, rarity: "mythic" },
  sea_dragon: { id: "sea_dragon", name: "تنين البحر",    emoji: "🐲", price: 39,   tier: 6, rarity: "mythic" },
  poseidon:   { id: "poseidon",   name: "حارس بوسيدون",  emoji: "🔱", price: 40,   tier: 6, rarity: "mythic" },
  black_pearl:{ id: "black_pearl",name: "اللؤلؤة السوداء",emoji: "⚫", price: 40,   tier: 6, rarity: "mythic" },
  golden_koi: { id: "golden_koi", name: "كوي ذهبي خالد", emoji: "🌟", price: 40,  tier: 6, rarity: "mythic" },

  // ========== EXCLUSIVE — حصرية لسفينة العنقاء ==========
  phoenix:    { id: "phoenix",    name: "عنقاء النار",   emoji: "🔥", price: 11,  tier: 6, rarity: "mythic" },

  // ========== EXCLUSIVE — حصرية للغواصة الملكية VIP ==========
  abyss_titan:{ id: "abyss_titan",name: "تيتان الأعماق", emoji: "🔱", price: 25,  tier: 6, rarity: "mythic" },

  // ========== EXCLUSIVE — حصرية لسفن التنين (T1/T2/T3) — السعر يُدار من لوحة الأدمن ==========
  black_dragon:{ id: "black_dragon", name: "التنين الأسود", emoji: "🐉", price: 100, tier: 6, rarity: "mythic" },
};

export const FISH: Record<string, Fish> = Object.fromEntries(
  Object.entries(FISH_DEFS).map(([k, v]) => [k, { ...v, img: FISH_IMG[k] ?? "" }])
);

export const FISH_LIST = Object.values(FISH);
export const FISH_TOTAL = FISH_LIST.length;


// Each ship tier catches 2 fish from its tier (rotated based on ship id).
// Phoenix ship (level 31) is exclusive — only catches phoenix fish.
export function fishForShip(shipLevel: number, shipId: number): string[] {
  if (shipLevel >= 34) return ["black_dragon"];
  if (shipLevel >= 33) return ["kraken", "leviathan", "poseidon"];
  if (shipLevel >= 32) return ["abyss_titan"];
  if (shipLevel >= 31) return ["phoenix"];
  const tier = Math.min(6, Math.max(1, Math.ceil(shipLevel / 5))) as 1|2|3|4|5|6;
  const pool = FISH_LIST.filter(f => f.tier === tier && f.id !== "phoenix" && f.id !== "abyss_titan" && f.id !== "black_dragon");
  if (pool.length === 0) return [];
  const a = pool[shipId % pool.length].id;
  const b = pool[(shipId + 3) % pool.length].id;
  return a === b ? [a] : [a, b];
}

export const RARITY_COLOR: Record<Fish["rarity"], string> = {
  common:    "from-stone-400 to-stone-600",
  uncommon:  "from-emerald-400 to-emerald-700",
  rare:      "from-sky-400 to-sky-700",
  epic:      "from-violet-400 to-violet-700",
  legendary: "from-amber-400 to-amber-700",
  mythic:    "from-rose-400 via-fuchsia-500 to-amber-500",
};
