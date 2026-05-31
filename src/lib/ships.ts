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
import shipPhoenix from "@/assets/ships/ship-phoenix.png";

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
  fishingSeconds: number;
  fishPool: string[];
  flavor: string;
};

// One unique image per market level — no duplicates.
const IMG_BY_LEVEL: Record<number, string> = {
  1: ship01, 2: ship02, 3: ship03, 4: ship04, 5: ship05, 6: ship06,
  7: ship07, 8: ship08, 9: ship09, 10: ship10, 11: ship11, 12: ship12,
  13: ship13, 14: ship14, 15: ship15, 16: ship16, 17: ship17, 18: ship18,
  19: ship19, 20: ship20, 21: ship21, 22: ship22, 23: ship23, 24: ship24,
  25: ship25, 26: ship26, 27: ship27, 28: ship28, 29: ship29, 30: ship30,
  31: shipPhoenix,
};

// Some ship PNGs are drawn with bow facing RIGHT instead of the default LEFT.
// Listed here so the renderer can normalize them all to the same on-screen
// direction (toward shore when docked, toward sea when fishing).
// Verified via image inspection — these market levels ship art that natively
// has the bow pointing RIGHT. Everything else is bow-LEFT.
const BOW_FACES_RIGHT: Record<number, boolean> = {
  1: true, 4: true, 5: true, 6: true, 8: true, 11: true, 12: true,
  13: true, 16: true, 19: true, 27: true, 28: true, 30: true, 31: true,
};

export function shipBowFacesRight(level: number): boolean {
  return !!BOW_FACES_RIGHT[level];
}

// ─────── المصدر الموحّد لتعريف السفن ───────
// أي تحديث على هذه القائمة ينعكس على كل واجهات اللعبة (سوق السفن، الأسطول، الصيد ...).
type ShipOverride = {
  ar: string;
  rarity: string;
  flavor: string;
  storage: number;       // السعة = طاقة السفينة
  price: number;         // السعر بالذهب
  fishingMinutes: number;// مدة الصيد بالدقائق
  fishPool: string[];    // أنواع السمك المتاحة
};

const SHIP_DATA: Record<number, ShipOverride> = {
  1:  { ar: "قارب صغير",              rarity: "Starter",   flavor: "قارب خشبي بسيط للمبتدئين في الموانئ القريبة.",         storage: 80,     price: 400,         fishingMinutes: 2.5,  fishPool: ["sardine"] },
  2:  { ar: "قارب كبير",              rarity: "Common",    flavor: "قارب خشبي معزّز بصاري قصير وشراع متهالك.",            storage: 180,    price: 2500,        fishingMinutes: 4.5,  fishPool: ["sardine"] },
  3:  { ar: "سفينة شراعية",            rarity: "Common",    flavor: "سفينة شراعية رشيقة تجوب المياه الساحلية.",            storage: 600,    price: 7500,        fishingMinutes: 6,    fishPool: ["sardine","tuna"] },
  4:  { ar: "سفينة مجداف",             rarity: "Common",    flavor: "سفينة بمجاديف قوية لرحلات أطول قليلاً.",              storage: 900,    price: 11000,       fishingMinutes: 7.5,  fishPool: ["sardine","shrimp"] },
  5:  { ar: "يخت أبيض",                rarity: "Uncommon",  flavor: "يخت أبيض أنيق بمحرك هادئ.",                          storage: 1200,   price: 20000,       fishingMinutes: 9,    fishPool: ["sardine","shrimp","tuna"] },
  6:  { ar: "قارب حرب",                rarity: "Uncommon",  flavor: "قارب حربي مدرّع لمواجهة البحار الخطرة.",              storage: 1800,   price: 50000,       fishingMinutes: 11,   fishPool: ["grouper","shrimp"] },
  7:  { ar: "كمين",                    rarity: "Uncommon",  flavor: "سفينة كمين شبحية تنقض على فرائسها.",                  storage: 2500,   price: 90000,       fishingMinutes: 13,   fishPool: ["squid","tuna"] },
  8:  { ar: "حفارة",                   rarity: "Rare",      flavor: "حفّارة بحرية ثقيلة تجرف أعماق البحر.",                storage: 3500,   price: 150000,      fishingMinutes: 14,   fishPool: ["squid","grouper"] },
  9:  { ar: "باخرة",                   rarity: "Rare",      flavor: "باخرة ضخمة بمداخن بخار ومستودعات واسعة.",             storage: 5000,   price: 300000,      fishingMinutes: 16,   fishPool: ["grouper","carp"] },
  10: { ar: "سفينة أبحاث",             rarity: "Rare",      flavor: "سفينة أبحاث علمية بأجهزة سونار متقدمة.",              storage: 7500,   price: 700000,      fishingMinutes: 20,   fishPool: ["eel","tang_blue","tuna"] },
  11: { ar: "سفينة الفانوس",           rarity: "Epic",      flavor: "سفينة بفوانيس متوهجة تجذب كائنات الأعماق.",            storage: 9000,   price: 2200000,     fishingMinutes: 24,   fishPool: ["stingray","goldfish"] },
  12: { ar: "سفينة الميلاد",           rarity: "Epic",      flavor: "سفينة احتفالية مزخرفة بأضواء وأشرعة فاخرة.",          storage: 13000,  price: 5000000,     fishingMinutes: 27,   fishPool: ["shark","squid","snapper"] },
  13: { ar: "سفينة الصقر",             rarity: "Epic",      flavor: "سفينة سريعة كالصقر تنقضّ على الفرائس.",               storage: 16000,  price: 8000000,     fishingMinutes: 30,   fishPool: ["shark","tuna","squid"] },
  14: { ar: "سفينة الأعماق",           rarity: "Epic",      flavor: "سفينة أعماق متخصصة بالنزول لقاع المحيط.",             storage: 20000,  price: 12000000,    fishingMinutes: 33,   fishPool: ["grouper","eel","snapper"] },
  15: { ar: "سفينة العاصفة",           rarity: "Epic",      flavor: "سفينة تشق العواصف بلا خوف.",                          storage: 25000,  price: 18000000,    fishingMinutes: 36,   fishPool: ["tuna","shark","grouper"] },
  16: { ar: "سفينة الكابوس",           rarity: "Epic+",     flavor: "سفينة شبحية سوداء تثير الرعب.",                       storage: 30000,  price: 25000000,    fishingMinutes: 39,   fishPool: ["squid","stingray","goldfish"] },
  17: { ar: "سفينة المحيط الأزرق",     rarity: "Epic+",     flavor: "سفينة محيطية تجوب المياه الزرقاء الواسعة.",           storage: 36000,  price: 34000000,    fishingMinutes: 42,   fishPool: ["carp","tuna","grouper"] },
  18: { ar: "سفينة الإعصار",           rarity: "Epic+",     flavor: "سفينة لا توقفها الأعاصير ولا الأمواج.",               storage: 42000,  price: 45000000,    fishingMinutes: 46,   fishPool: ["shark","squid","eel"] },
  19: { ar: "سفينة الجبروت",           rarity: "Epic+",     flavor: "سفينة جبّارة بهيكل فولاذي ضخم.",                      storage: 50000,  price: 60000000,    fishingMinutes: 50,   fishPool: ["grouper","tuna","shark"] },
  20: { ar: "سفينة الموجة السوداء",    rarity: "Legendary", flavor: "سفينة مظلمة كموجة الليل.",                            storage: 60000,  price: 80000000,    fishingMinutes: 55,   fishPool: ["stingray","squid","snapper"] },
  21: { ar: "سفينة الفاتح البحري",     rarity: "Legendary", flavor: "سفينة فاتحة للأقاليم البحرية النائية.",              storage: 72000,  price: 110000000,   fishingMinutes: 60,   fishPool: ["shark","grouper","tuna"] },
  22: { ar: "سفينة نجم البحر",         rarity: "Legendary", flavor: "سفينة تتلألأ كنجمٍ يهتدي به البحّارة.",              storage: 85000,  price: 150000000,   fishingMinutes: 66,   fishPool: ["eel","carp","squid"] },
  23: { ar: "سفينة أسطورة الأعماق",    rarity: "Legendary", flavor: "سفينة الأسطورة التي تجوب أعمق الأعماق.",             storage: 100000, price: 200000000,   fishingMinutes: 72,   fishPool: ["shark","tuna","stingray"] },
  24: { ar: "سفينة نهاية المحيط",      rarity: "Legendary", flavor: "سفينة نهائية تصل لحدود المحيط البعيد.",              storage: 120000, price: 300000000,   fishingMinutes: 80,   fishPool: ["shark","tuna","squid","stingray","grouper","carp"] },
  25: { ar: "سفينة العرش البحري",      rarity: "Mythic",    flavor: "عرش بحري ملكي للقباطنة الأسطوريين.",                 storage: 140000, price: 650000000,   fishingMinutes: 88,   fishPool: ["shark","tuna","grouper","carp"] },
  26: { ar: "سفينة أسد الأعماق",       rarity: "Mythic",    flavor: "سفينة الأسد المرعبة بقوة لا تُقهر.",                  storage: 165000, price: 800000000,   fishingMinutes: 96,   fishPool: ["shark","squid","tuna","stingray"] },
  27: { ar: "سفينة التيتانيوم البحري", rarity: "Mythic",    flavor: "سفينة تيتانيوم لا يخترقها شيء.",                      storage: 190000, price: 1000000000,  fishingMinutes: 105,  fishPool: ["shark","tuna","grouper","squid","carp"] },
  28: { ar: "سفينة ملك المحيط",        rarity: "Mythic",    flavor: "سفينة ملك المحيط بلا منازع.",                         storage: 220000, price: 2000000000,  fishingMinutes: 115,  fishPool: ["shark","stingray","tuna","grouper","squid","snapper","carp"] },
  29: { ar: "سفينة التنين البحري",     rarity: "Mythic",    flavor: "تنين بحري ينفث الرعب في الأمواج.",                    storage: 260000, price: 5000000000,  fishingMinutes: 125,  fishPool: ["shark","tuna","stingray","grouper","squid"] },
  30: { ar: "سفينة نهاية الأعماق",     rarity: "Mythic",    flavor: "السفينة النهائية: نهاية كل الأعماق.",                 storage: 300000, price: 9000000000,  fishingMinutes: 140,  fishPool: ["shark","tuna","grouper","carp","squid","stingray","snapper","eel"] },
  31: { ar: "سفينة العنقاء التنينية",  rarity: "Legendary", flavor: "سفينة العنقاء الحمراء — حصرية للمتجر، تصيد عنقاء النار النادرة فقط. سعة 13 ألف ودمّ 13 ألف.", storage: 13000,  price: 0,           fishingMinutes: 20,   fishPool: ["phoenix"] },
};

function buildShip(level: number): ShipDef {
  const d = SHIP_DATA[level];
  // Phoenix ship (level 31) — special tuned values, doesn't follow the formula.
  if (level === 31) {
    return {
      code: "phoenix",
      name: d.ar,
      title: d.ar,
      image: IMG_BY_LEVEL[31],
      price: d.price,
      marketLevel: 31,
      rarity: d.rarity,
      maxHp: 13000,
      armor: 80,
      speed: 60,
      storage: d.storage,
      repairSeconds: 36000, // 10h
      fishingSeconds: Math.round(d.fishingMinutes * 60),
      fishPool: d.fishPool,
      flavor: d.flavor,
    };
  }
  // دم السفينة = سعتها (طاقة السفينة)
  const maxHp = d.storage;
  const armor = 4 + Math.floor((level - 1) * 3.5);
  const speed = 9 + Math.floor((level - 1) * 1.4);
  // التقسيم المتدرّج لمدة إصلاح السفينة المدمَّرة (نفس صيغة قاعدة البيانات)
  //  L1..10  : 1h  → 5h
  //  L11..20 : 5h  → 10h
  //  L21..25 : 11h → 20h
  //  L26..30 : 21h → 24h
  let repairSeconds: number;
  if (level <= 10) repairSeconds = Math.round(3600  + (level - 1)  * (18000 - 3600)  / 9);
  else if (level <= 20) repairSeconds = Math.round(18000 + (level - 11) * (36000 - 18000) / 9);
  else if (level <= 25) repairSeconds = Math.round(39600 + (level - 21) * (72000 - 39600) / 4);
  else repairSeconds = Math.round(75600 + (level - 26) * (86400 - 75600) / 4);
  const fishingSeconds = Math.round(d.fishingMinutes * 60);
  return {
    code: `ship-lvl-${level}`,
    name: d.ar,
    title: d.ar,
    image: IMG_BY_LEVEL[level],
    price: d.price,
    marketLevel: level,
    rarity: d.rarity,
    maxHp,
    armor,
    speed,
    storage: d.storage,
    repairSeconds,
    fishingSeconds,
    fishPool: d.fishPool,
    flavor: d.flavor,
  };
}

// Regular ships (1..30) shown in the ship market.
export const SHIPS: ShipDef[] = Array.from({ length: 30 }, (_, i) => buildShip(i + 1));

// Special shop-exclusive ships (not in ship market, not sold for coins).
export const PHOENIX_SHIP: ShipDef = buildShip(31);
const ALL_SHIPS: ShipDef[] = [...SHIPS, PHOENIX_SHIP];

export const STARTER_SHIP = SHIPS[0];

export function getShipByCode(code: string | null | undefined): ShipDef {
  if (!code) return STARTER_SHIP;
  return ALL_SHIPS.find((s) => s.code === code) ?? STARTER_SHIP;
}

// Map a market level (1..31) to the ship definition.
// Level 31 = the special phoenix shop ship.
export function getShipByMarketLevel(level: number): ShipDef {
  if (level >= 31) return PHOENIX_SHIP;
  const clamped = Math.max(1, Math.min(30, Math.round(level)));
  return SHIPS[clamped - 1];
}

export function getShipImage(code: string | null | undefined): string {
  return getShipByCode(code).image;
}

// السعة الكاملة للسفينة = ما تحمله في رحلة واحدة (طاقة = سعة).
export function catchPerTrip(ship: ShipDef): number {
  return Math.max(1, ship.storage);
}

// ─────── سعة سوق السمك حسب المستوى ───────
// L1 = 10000. +10000 لكل مستوى حتى 10، +30000 من 11 إلى 20، +100000 من 21 فما فوق.
// يمكن لمسؤول النظام تجاوز أي مستوى عبر economy_settings.
export function fishMarketCapacity(level: number): number {
  const lvl = Math.max(1, Math.min(30, Math.round(level || 1)));
  // lazy import to avoid circular dep at module init
  const overrides = (globalThis as { __FM_CAP_OVERRIDES__?: Record<number, number> }).__FM_CAP_OVERRIDES__;
  if (overrides && overrides[lvl] != null) return overrides[lvl];
  let cap = 10000;
  for (let l = 2; l <= lvl; l++) {
    if (l <= 10) cap += 10000;      // 2–10: +10k
    else if (l <= 20) cap += 30000;  // 11–20: +30k
    else cap += 100000;              // 21+: +100k
  }
  return cap;
}


// ─────── سعة سوق السفن حسب المستوى ───────
// L1 = 10,000. نفس نمط زيادات سوق السمك ×20.
const SM_INCREMENTS: number[] = [
  /* L2  */ 10000,
  /* L3  */ 10000,
  /* L4  */ 20000,
  /* L5  */ 30000,
  /* L6  */ 40000,
  /* L7  */ 50000,
  /* L8  */ 60000,
  /* L9  */ 70000,
  /* L10 */ 80000,
  /* L11 */ 100000,
  /* L12 */ 120000,
  /* L13 */ 140000,
  /* L14 */ 160000,
  /* L15 */ 200000,
];

export function shipMarketCapacity(level: number): number {
  const lvl = Math.max(1, Math.min(30, Math.round(level || 1)));
  let cap = 10000;
  for (let l = 2; l <= lvl; l++) {
    if (l <= 15) cap += SM_INCREMENTS[l - 2];
    else if (l <= 23) cap += 400000;   // 16-23: +400k
    else if (l <= 27) cap += 1000000;  // 24-27: +1M
    else cap += 2000000;               // 28+:   +2M
  }
  return cap;
}

