// Whitelisted item catalog for the Trade System (crews, weapons, shields, antis).
// Mirrors the server-side whitelist in public._trade_norm_items.
import { CREWS } from "@/lib/crews";
import { WEAPONS } from "@/lib/weapons";

export type TradeItemType = "crew" | "weapon" | "shield" | "anti";

export interface TradeCatalogItem {
  type: TradeItemType;
  id: string;
  name: string;
  emoji: string;
  image?: string;
}

export const TRADE_SHIELDS: TradeCatalogItem[] = [
  { type: "shield", id: "shield_1h", name: "درع ساعة", emoji: "🛡️" },
  { type: "shield", id: "shield_4h", name: "درع 4 ساعات", emoji: "🛡️" },
  { type: "shield", id: "shield_1d", name: "درع يوم", emoji: "🛡️" },
  { type: "shield", id: "shield_2d", name: "درع يومين", emoji: "🛡️" },
  { type: "shield", id: "shield_7d", name: "درع أسبوع", emoji: "🛡️" },
  { type: "shield", id: "shield_30d", name: "درع شهر", emoji: "🛡️" },
];

export const TRADE_ANTIS: TradeCatalogItem[] = [
  { type: "anti", id: "anti_rocket", name: "مضاد صواريخ", emoji: "🚀" },
  { type: "anti", id: "anti_nuke", name: "مضاد قنبلة ذرية", emoji: "☢️" },
  { type: "anti", id: "anti_ad_bomb", name: "مضاد قنبلة إعلانية", emoji: "📺" },
];

export const TRADE_CATALOG: TradeCatalogItem[] = [
  ...CREWS.map((c) => ({ type: "crew" as const, id: c.id, name: c.name, emoji: c.emoji, image: c.image })),
  ...WEAPONS.map((w) => ({ type: "weapon" as const, id: w.id, name: w.name, emoji: w.emoji, image: w.image })),
  ...TRADE_SHIELDS,
  ...TRADE_ANTIS,
];

export const TRADE_GROUPS: { type: TradeItemType; label: string; items: TradeCatalogItem[] }[] = [
  { type: "crew", label: "طواقم 👨‍✈️", items: TRADE_CATALOG.filter((i) => i.type === "crew") },
  { type: "weapon", label: "أسلحة 🚀", items: TRADE_CATALOG.filter((i) => i.type === "weapon") },
  { type: "shield", label: "دروع 🛡️", items: TRADE_SHIELDS },
  { type: "anti", label: "مضادات 🧿", items: TRADE_ANTIS },
];

export function tradeItemLabel(type: string, id: string): TradeCatalogItem {
  const found = TRADE_CATALOG.find((i) => i.id === id);
  if (found) return found;
  return { type: (type as TradeItemType) ?? "crew", id, name: id, emoji: "📦" };
}
