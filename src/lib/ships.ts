// Original 8 — kept for these market levels: 1, 4, 7, 11, 15, 19, 23, 27
import ship01 from "@/assets/ships/ship-01-wooden.png";
import ship04 from "@/assets/ships/ship-02-motor.png";
import ship07 from "@/assets/ships/ship-03-trawler.png";
import ship11 from "@/assets/ships/ship-04-deepsea.png";
import ship15 from "@/assets/ships/ship-05-hunter.png";
import ship19 from "@/assets/ships/ship-06-factory.png";
import ship23 from "@/assets/ships/ship-07-legendary.png";
import ship27 from "@/assets/ships/ship-08-mythic.png";

// 22 new unique ships — one per remaining market level
import ship02 from "@/assets/ships/ship-lvl-2.png";
import ship03 from "@/assets/ships/ship-lvl-3.png";
import ship05 from "@/assets/ships/ship-lvl-5.png";
import ship06 from "@/assets/ships/ship-lvl-6.png";
import ship08 from "@/assets/ships/ship-lvl-8.png";
import ship09 from "@/assets/ships/ship-lvl-9.png";
import ship10 from "@/assets/ships/ship-lvl-10.png";
import ship12 from "@/assets/ships/ship-lvl-12.png";
import ship13 from "@/assets/ships/ship-lvl-13.png";
import ship14 from "@/assets/ships/ship-lvl-14.png";
import ship16 from "@/assets/ships/ship-lvl-16.png";
import ship17 from "@/assets/ships/ship-lvl-17.png";
import ship18 from "@/assets/ships/ship-lvl-18.png";
import ship20 from "@/assets/ships/ship-lvl-20.png";
import ship21 from "@/assets/ships/ship-lvl-21.png";
import ship22 from "@/assets/ships/ship-lvl-22.png";
import ship24 from "@/assets/ships/ship-lvl-24.png";
import ship25 from "@/assets/ships/ship-lvl-25.png";
import ship26 from "@/assets/ships/ship-lvl-26.png";
import ship28 from "@/assets/ships/ship-lvl-28.png";
import ship29 from "@/assets/ships/ship-lvl-29.png";
import ship30 from "@/assets/ships/ship-lvl-30.png";

export type ShipDef = {
  code: string;
  name: string;
  title: string;
  image: string;
  price: number;
  marketLevel: number;
  rarity: string;
  maxHp: number;
  armor: number;
  speed: number;
  storage: number;
  repairSeconds: number;
  flavor: string;
};

// One unique image per market level — no duplicates.
const IMG_BY_LEVEL: Record<number, string> = {
  1: ship01, 2: ship02, 3: ship03, 4: ship04, 5: ship05, 6: ship06,
  7: ship07, 8: ship08, 9: ship09, 10: ship10, 11: ship11, 12: ship12,
  13: ship13, 14: ship14, 15: ship15, 16: ship16, 17: ship17, 18: ship18,
  19: ship19, 20: ship20, 21: ship21, 22: ship22, 23: ship23, 24: ship24,
  25: ship25, 26: ship26, 27: ship27, 28: ship28, 29: ship29, 30: ship30,
};

const NAME_BY_LEVEL: Record<number, { en: string; ar: string; flavor: string; rarity: string }> = {
  1:  { en: "Wooden Skiff Mk I",       ar: "قارب خشبي - I",     rarity: "Starter",   flavor: "قارب خشبي بسيط للمبتدئين في الموانئ القريبة." },
  2:  { en: "Wooden Skiff Mk II",      ar: "قارب خشبي - II",    rarity: "Common",    flavor: "قارب خشبي معزّز بصاري قصير وشراع متهالك." },
  3:  { en: "Wooden Skiff Mk III",     ar: "قارب خشبي - III",   rarity: "Common",    flavor: "قارب خشبي مزدوج الصواري مع كابينة وشباك صيد." },
  4:  { en: "Motor Cutter Mk I",       ar: "زورق محرك - I",     rarity: "Common",    flavor: "زورق فيبرجلاس صغير بمحرك خارجي للمياه الساحلية." },
  5:  { en: "Motor Cutter Mk II",      ar: "زورق محرك - II",    rarity: "Uncommon",  flavor: "زورق محرك أبيض بصاري رادار وكابينة مغلقة." },
  6:  { en: "Motor Cutter Mk III",     ar: "زورق محرك - III",   rarity: "Uncommon",  flavor: "زورق أزرق وأبيض بمحركين داخليين وصنارات صيد." },
  7:  { en: "Steel Trawler Mk I",      ar: "ترالر فولاذي - I",  rarity: "Uncommon",  flavor: "ترالر فولاذي بشبكات احترافية لرحلات صيد أطول." },
  8:  { en: "Steel Trawler Mk II",     ar: "ترالر فولاذي - II", rarity: "Rare",      flavor: "ترالر أخضر بكابينة عالية ورافعات وشباك ضخمة." },
  9:  { en: "Steel Trawler Mk III",    ar: "ترالر فولاذي - III",rarity: "Rare",      flavor: "ترالر أحمر تجاري بمدخنتي بخار وبكرة شباك خلفية." },
  10: { en: "Steel Trawler Mk IV",     ar: "ترالر فولاذي - IV", rarity: "Rare",      flavor: "ترالر محيطي ضخم بهيكل فولاذي ورافعات متعددة." },
  11: { en: "Deep Sea Vessel Mk I",    ar: "سفينة الأعماق - I", rarity: "Rare",      flavor: "سفينة أعماق بجسر كبير وتجهيزات بحرية ثقيلة." },
  12: { en: "Deep Sea Vessel Mk II",   ar: "سفينة الأعماق - II",rarity: "Epic",      flavor: "سفينة بحرية ضخمة بمنصة هليكوبتر وبرج عالٍ." },
  13: { en: "Deep Sea Vessel Mk III",  ar: "سفينة الأعماق - III",rarity: "Epic",     flavor: "سفينة رمادية معزّزة برادارات وأنظمة سونار متقدمة." },
  14: { en: "Deep Sea Vessel Mk IV",   ar: "سفينة الأعماق - IV",rarity: "Epic",      flavor: "سفينة بحث وصيد سوداء عملاقة بأبراج توأم وإضاءة." },
  15: { en: "Hunter Warship Mk I",     ar: "سفينة هجومية - I",  rarity: "Epic",      flavor: "سفينة هجومية مرعبة بتسليح واضح للمعارك البحرية." },
  16: { en: "Hunter Warship Mk II",    ar: "سفينة هجومية - II", rarity: "Epic+",     flavor: "سفينة دورية رمادية بمدفع رئيسي ومنصات صواريخ." },
  17: { en: "Hunter Warship Mk III",   ar: "سفينة هجومية - III",rarity: "Epic+",     flavor: "كورفيت سوداء شبحية بهيكل مائل وأضواء حمراء." },
  18: { en: "Hunter Warship Mk IV",    ar: "سفينة هجومية - IV", rarity: "Epic+",     flavor: "مدمّرة ثقيلة بمدافع بحرية وأبراج رادار متعددة." },
  19: { en: "Factory Ship Mk I",       ar: "سفينة المصنع - I",  rarity: "Epic+",     flavor: "عملاقة صناعية بتفاصيل ثقيلة وإنتاج مرتفع." },
  20: { en: "Factory Ship Mk II",      ar: "سفينة المصنع - II", rarity: "Legendary", flavor: "سفينة معالجة صناعية ضخمة برافعات ومداخن متعددة." },
  21: { en: "Factory Ship Mk III",     ar: "سفينة المصنع - III",rarity: "Legendary", flavor: "سفينة برتقالية ضخمة ببنية شاهقة ونوافذ مضاءة." },
  22: { en: "Factory Ship Mk IV",      ar: "سفينة المصنع - IV", rarity: "Legendary", flavor: "مصنع بحري عملاق كالقلعة مع مداخن تنفث الدخان." },
  23: { en: "Royal Galleon Mk I",      ar: "سفينة ملكية - I",   rarity: "Legendary", flavor: "سفينة ملكية فخمة بهالة أسطورية على الأمواج." },
  24: { en: "Royal Galleon Mk II",     ar: "سفينة ملكية - II",  rarity: "Legendary", flavor: "يخت ملكي أسود وذهبي بثلاث صواري مزخرفة." },
  25: { en: "Royal Galleon Mk III",    ar: "سفينة ملكية - III", rarity: "Mythic",    flavor: "غاليون أسود بزخارف ذهبية وأربع صواري وفوانيس متوهجة." },
  26: { en: "Royal Galleon Mk IV",     ar: "سفينة ملكية - IV",  rarity: "Mythic",    flavor: "سفينة قيادة ملكية بهيكل أسود وزخارف ذهبية معقدة." },
  27: { en: "Mythic Leviathan Mk I",   ar: "الليفايثان - I",    rarity: "Mythic",    flavor: "وحش بحري نهائي بتصميم نهاية اللعبة." },
  28: { en: "Mythic Leviathan Mk II",  ar: "الليفايثان - II",   rarity: "Mythic",    flavor: "سفينة ليفايثان أسطورية بأشواك سوداء ورموز زرقاء متوهجة." },
  29: { en: "Mythic Leviathan Mk III", ar: "الليفايثان - III",  rarity: "Mythic",    flavor: "دريدنوت ليفايثان بمدافع وأذرع كالمجسات وأضواء حمراء." },
  30: { en: "Mythic Leviathan Mk IV",  ar: "الليفايثان - IV",   rarity: "Mythic",    flavor: "وحش ليفايثان نهائي ببرج مدمر وعيون أرجوانية متوهجة." },
};

function buildShip(level: number): ShipDef {
  const meta = NAME_BY_LEVEL[level];
  const price = Math.round(300 * Math.pow(1.42, level - 1));
  const maxHp = 80 + (level - 1) * 65;
  const armor = 4 + Math.floor((level - 1) * 3.5);
  const speed = 9 + Math.floor((level - 1) * 1.4);
  // Catch per trip: level 1 = 100 fish, level 30 = 150,000 fish (geometric distribution).
  // Storage shown in UI = catchPerTrip * 50 so the storage number remains meaningful.
  const catchAmount = Math.max(1, Math.round(100 * Math.pow(1500, (level - 1) / 29)));
  const storage = catchAmount * 50;
  const repairSeconds = Math.round(240 * Math.pow(1.20, level - 1));
  return {
    code: `ship-lvl-${level}`,
    name: meta.en,
    title: meta.ar,
    image: IMG_BY_LEVEL[level],
    price,
    marketLevel: level,
    rarity: meta.rarity,
    maxHp,
    armor,
    speed,
    storage,
    repairSeconds,
    flavor: meta.flavor,
  };
}

export const SHIPS: ShipDef[] = Array.from({ length: 30 }, (_, i) => buildShip(i + 1));

export const STARTER_SHIP = SHIPS[0];

export function getShipByCode(code: string | null | undefined): ShipDef {
  if (!code) return STARTER_SHIP;
  return SHIPS.find((s) => s.code === code) ?? STARTER_SHIP;
}

// Map a market level (1..30) to the ship definition for that level.
export function getShipByMarketLevel(level: number): ShipDef {
  const clamped = Math.max(1, Math.min(30, Math.round(level)));
  return SHIPS[clamped - 1];
}

export function getShipImage(code: string | null | undefined): string {
  return getShipByCode(code).image;
}

// Single source of truth: how many fish a ship hauls per full trip.
// Used by both the shipyard display and the in-game collection logic.
export function catchPerTrip(ship: ShipDef): number {
  return Math.max(1, Math.round(ship.storage / 50));
}
