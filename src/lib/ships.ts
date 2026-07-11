// Original 8 — kept for these market levels: 1, 4, 7, 11, 15, 19, 23, 27
import ship01 from "@/assets/ships/ship-lvl-1.png";
import ship04 from "@/assets/ships/ship-lvl-4.png";
import ship07 from "@/assets/ships/ship-lvl-7.png";
import ship11 from "@/assets/ships/ship-lvl-11.png";
import ship15 from "@/assets/ships/ship-05-hunter.png";
import ship19Asset from "@/assets/ships/ship-lvl-19-v2.png.asset.json";
const ship19 = ship19Asset.url;
import ship23 from "@/assets/ships/ship-07-legendary.png";
import ship27Asset from "@/assets/ships/ship-lvl-27-v2.png.asset.json";
const ship27 = ship27Asset.url;

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
import ship28Asset from "@/assets/ships/ship-lvl-28-v2.png.asset.json";
const ship28 = ship28Asset.url;
import ship29 from "@/assets/ships/ship-lvl-29.png";
import ship30 from "@/assets/ships/ship-lvl-30.png";
import shipPhoenix from "@/assets/ships/ship-phoenix.png";
import shipSubmarineAsset from "@/assets/ships/ship-vip-submarine.png.asset.json";
const shipSubmarine = shipSubmarineAsset.url;

// Dragon ships — 3 tiers (red / silver / gold)
import shipDragonRed from "@/assets/ships/ship-dragon-red.png";
import shipDragonSilver from "@/assets/ships/ship-dragon-silver.png";
import shipDragonGold from "@/assets/ships/ship-dragon-gold.png";

// Upgradeable submarine — 5 tiers (1★ yellow → 4★ yellow → red ★)
import subStar1Asset from "@/assets/ships/sub-star-1.png.asset.json";
import subStar2Asset from "@/assets/ships/sub-star-2.png.asset.json";
import subStar3Asset from "@/assets/ships/sub-star-3.png.asset.json";
import subStar4Asset from "@/assets/ships/sub-star-4.png.asset.json";
import subStarRedAsset from "@/assets/ships/sub-star-red.png.asset.json";
const SUB_STAR_IMAGES: Record<number, string> = {
  1: subStar1Asset.url,
  2: subStar2Asset.url,
  3: subStar3Asset.url,
  4: subStar4Asset.url,
  5: subStarRedAsset.url,
};
export function getUpgradeSubImage(stars: number): string {
  return SUB_STAR_IMAGES[Math.max(1, Math.min(5, stars || 1))];
}
export const UPGRADE_SUB_STAR_CAPACITY: Record<number, number> = {
  1: 350000, 2: 500000, 3: 700000, 4: 850000, 5: 1000000,
};
export const UPGRADE_SUB_SUCCESS_PCT: Record<number, number> = {
  1: 60, 2: 50, 3: 40, 4: 25,
};
export const UPGRADE_SUB_COST = 1_000_000_000;

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
  32: shipSubmarine,
  33: subStar1Asset.url,
  34: shipDragonRed,
  35: shipDragonSilver,
  36: shipDragonGold,
};

// Some ship PNGs are drawn with bow facing RIGHT instead of the default LEFT.
// Listed here so renderers can normalize every ship to the same on-screen
// direction (toward shore when docked, toward sea when fishing, rightward in shop).
// Verified against the local ship sprite sheet: everything not listed is bow-LEFT.
const BOW_FACES_RIGHT: Record<number, boolean> = {
  3: true, 4: true, 5: true, 6: true, 8: true,
  11: true, 12: true, 13: true, 16: true,
  19: true, 24: true, 26: true, 27: true, 28: true, 30: true, 31: true, 33: true,
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
  1:  { ar: "قارب صغير",              rarity: "Starter",   flavor: "قارب خشبي بسيط للمبتدئين في الموانئ القريبة.",         storage: 80,     price: 400,         fishingMinutes: 1,    fishPool: ["sardine","anchovy"] },
  2:  { ar: "قارب كبير",              rarity: "Common",    flavor: "قارب خشبي معزّز بصاري قصير وشراع متهالك.",            storage: 180,    price: 2500,        fishingMinutes: 1.5,  fishPool: ["sardine","herring","smelt"] },
  3:  { ar: "سفينة شراعية",            rarity: "Common",    flavor: "سفينة شراعية رشيقة تجوب المياه الساحلية.",            storage: 600,    price: 7500,        fishingMinutes: 2.5,  fishPool: ["minnow","mullet","anchovy"] },
  4:  { ar: "سفينة مجداف",             rarity: "Common",    flavor: "سفينة بمجاديف قوية لرحلات أطول قليلاً.",              storage: 900,    price: 11000,       fishingMinutes: 3.5,  fishPool: ["shrimp","crab_small","sardine"] },
  5:  { ar: "يخت أبيض",                rarity: "Uncommon",  flavor: "يخت أبيض أنيق بمحرك هادئ.",                          storage: 1200,   price: 20000,       fishingMinutes: 4,    fishPool: ["mullet","shrimp","herring"] },
  6:  { ar: "قارب حرب",                rarity: "Uncommon",  flavor: "قارب حربي مدرّع لمواجهة البحار الخطرة.",              storage: 1800,   price: 50000,       fishingMinutes: 5,    fishPool: ["mackerel","bass","shrimp"] },
  7:  { ar: "كمين",                    rarity: "Uncommon",  flavor: "سفينة كمين شبحية تنقض على فرائسها.",                  storage: 2500,   price: 90000,       fishingMinutes: 5.5,  fishPool: ["cod","snapper","mackerel"] },
  8:  { ar: "حفارة",                   rarity: "Rare",      flavor: "حفّارة بحرية ثقيلة تجرف أعماق البحر.",                storage: 3500,   price: 150000,      fishingMinutes: 6.5,  fishPool: ["trout","salmon","bass"] },
  9:  { ar: "باخرة",                   rarity: "Rare",      flavor: "باخرة ضخمة بمداخن بخار ومستودعات واسعة.",             storage: 5000,   price: 300000,      fishingMinutes: 8,    fishPool: ["squid","snapper","cod"] },
  10: { ar: "سفينة أبحاث",             rarity: "Rare",      flavor: "سفينة أبحاث علمية بأجهزة سونار متقدمة.",              storage: 7500,   price: 700000,      fishingMinutes: 10,   fishPool: ["salmon","squid","trout"] },
  11: { ar: "سفينة الفانوس",           rarity: "Epic",      flavor: "سفينة بفوانيس متوهجة تجذب كائنات الأعماق.",            storage: 9000,   price: 2200000,     fishingMinutes: 11,   fishPool: ["tuna","grouper","salmon"] },
  12: { ar: "سفينة الميلاد",           rarity: "Epic",      flavor: "سفينة احتفالية مزخرفة بأضواء وأشرعة فاخرة.",          storage: 13000,  price: 5000000,     fishingMinutes: 13,   fishPool: ["octopus","lobster","squid"] },
  13: { ar: "سفينة الصقر",             rarity: "Epic",      flavor: "سفينة سريعة كالصقر تنقضّ على الفرائس.",               storage: 16000,  price: 8000000,     fishingMinutes: 14,   fishPool: ["eel","flounder","grouper"] },
  14: { ar: "سفينة الأعماق",           rarity: "Epic",      flavor: "سفينة أعماق متخصصة بالنزول لقاع المحيط.",             storage: 20000,  price: 12000000,    fishingMinutes: 16,   fishPool: ["carp","tuna","eel"] },
  15: { ar: "سفينة العاصفة",           rarity: "Epic",      flavor: "سفينة تشق العواصف بلا خوف.",                          storage: 25000,  price: 18000000,    fishingMinutes: 18,   fishPool: ["flounder","carp","octopus"] },
  16: { ar: "سفينة الكابوس",           rarity: "Epic+",     flavor: "سفينة شبحية سوداء تثير الرعب.",                       storage: 30000,  price: 25000000,    fishingMinutes: 19,   fishPool: ["marlin","swordfish","lobster"] },
  17: { ar: "سفينة المحيط الأزرق",     rarity: "Epic+",     flavor: "سفينة محيطية تجوب المياه الزرقاء الواسعة.",           storage: 36000,  price: 34000000,    fishingMinutes: 21,   fishPool: ["sailfish","barracuda","marlin"] },
  18: { ar: "سفينة الإعصار",           rarity: "Epic+",     flavor: "سفينة لا توقفها الأعاصير ولا الأمواج.",               storage: 42000,  price: 45000000,    fishingMinutes: 23,   fishPool: ["stingray","shark","swordfish"] },
  19: { ar: "سفينة الجبروت",           rarity: "Epic+",     flavor: "سفينة جبّارة بهيكل فولاذي ضخم.",                      storage: 50000,  price: 60000000,    fishingMinutes: 25,   fishPool: ["tang_blue","koi","sailfish"] },
  20: { ar: "سفينة الموجة السوداء",    rarity: "Legendary", flavor: "سفينة مظلمة كموجة الليل.",                            storage: 60000,  price: 80000000,    fishingMinutes: 27,   fishPool: ["shark","stingray","barracuda"] },
  21: { ar: "سفينة الفاتح البحري",     rarity: "Legendary", flavor: "سفينة فاتحة للأقاليم البحرية النائية.",              storage: 72000,  price: 110000000,   fishingMinutes: 30,   fishPool: ["manta","hammerhead","shark"] },
  22: { ar: "سفينة نجم البحر",         rarity: "Legendary", flavor: "سفينة تتلألأ كنجمٍ يهتدي به البحّارة.",              storage: 85000,  price: 150000000,   fishingMinutes: 33,   fishPool: ["whale","orca","manta"] },
  23: { ar: "سفينة أسطورة الأعماق",    rarity: "Legendary", flavor: "سفينة الأسطورة التي تجوب أعمق الأعماق.",             storage: 100000, price: 200000000,   fishingMinutes: 35,   fishPool: ["arowana","goldfish","hammerhead"] },
  24: { ar: "سفينة نهاية المحيط",      rarity: "Legendary", flavor: "سفينة نهائية تصل لحدود المحيط البعيد.",              storage: 120000, price: 300000000,   fishingMinutes: 39,   fishPool: ["pearl","koi","tang_blue"] },
  25: { ar: "سفينة العرش البحري",      rarity: "Mythic",    flavor: "عرش بحري ملكي للقباطنة الأسطوريين.",                 storage: 140000, price: 650000000,   fishingMinutes: 42,   fishPool: ["orca","whale","arowana"] },
  26: { ar: "سفينة أسد الأعماق",       rarity: "Mythic",    flavor: "سفينة الأسد المرعبة بقوة لا تُقهر.",                  storage: 165000, price: 800000000,   fishingMinutes: 45,   fishPool: ["kraken","leviathan","goldfish"] },
  27: { ar: "سفينة التيتانيوم البحري", rarity: "Mythic",    flavor: "سفينة تيتانيوم لا يخترقها شيء.",                      storage: 190000, price: 1000000000,  fishingMinutes: 49,   fishPool: ["megalodon","sea_dragon","pearl"] },
  28: { ar: "سفينة ملك المحيط",        rarity: "Mythic",    flavor: "سفينة ملك المحيط بلا منازع.",                         storage: 220000, price: 3640000000,  fishingMinutes: 52,   fishPool: ["poseidon","kraken","leviathan"] },
  29: { ar: "سفينة التنين البحري",     rarity: "Mythic",    flavor: "تنين بحري ينفث الرعب في الأمواج.",                    storage: 260000, price: 9100000000,  fishingMinutes: 57,   fishPool: ["black_pearl","megalodon","sea_dragon"] },
  30: { ar: "سفينة نهاية الأعماق",     rarity: "Mythic",    flavor: "السفينة النهائية: نهاية كل الأعماق.",                 storage: 300000, price: 16380000000, fishingMinutes: 60,   fishPool: ["golden_koi","poseidon","black_pearl"] },
  31: { ar: "سفينة العنقاء التنينية",  rarity: "Legendary", flavor: "سفينة العنقاء الحمراء — حصرية للمتجر، تصيد عنقاء النار النادرة فقط. سعة 13 ألف ودمّ 13 ألف.", storage: 13000,  price: 0,           fishingMinutes: 20,   fishPool: ["phoenix"] },
  32: { ar: "الغواصة الملكية VIP",     rarity: "Mythic",    flavor: "غواصة سوداء فاخرة حصرية لأعضاء VIP 5 فأعلى — تصيد تيتان الأعماق النادر.", storage: 350000, price: 0,           fishingMinutes: 45,   fishPool: ["abyss_titan"] },
  33: { ar: "الغواصة القابلة للترقية",  rarity: "Legendary", flavor: "غواصة قابلة للترقية بنظام نجوم. تبدأ بنجمة صفراء (سعة 350 ألف) وتترقى حتى النجمة الحمراء (سعة 1 مليون). كل ترقية بـ 1 مليار ذهب — نسب النجاح: 100/95/90/70%. عند الفشل ترجع لمستوى أدنى. تصيد الأروانا الفضية وشبح المرجان النادرَين.", storage: 350000, price: 19500000000, fishingMinutes: 50, fishPool: ["silver_arowana","coral_phantom"] },
  34: { ar: "سفينة التنين الدموي",      rarity: "Legendary", flavor: "سفينة تنين حمراء أسطورية — دم 20,000 وسعة 20,000 وصيد كل 20 دقيقة. تصيد التنين الأسود الأسطوري النادر 🐉.", storage: 20000, price: 0, fishingMinutes: 20, fishPool: ["black_dragon"] },
  35: { ar: "سفينة التنين الفضي",       rarity: "Legendary", flavor: "سفينة تنين فضية أسطورية — دم 40,000 وسعة 40,000 وصيد كل 30 دقيقة. تصيد التنين الأسود الأسطوري النادر 🐉.", storage: 40000, price: 0, fishingMinutes: 30, fishPool: ["black_dragon"] },
  36: { ar: "سفينة التنين الذهبي",      rarity: "Mythic",    flavor: "سفينة تنين ذهبية ملكية خرافية — دم 60,000 وسعة 60,000 وصيد كل 40 دقيقة. تصيد التنين الأسود الأسطوري النادر 🐉.", storage: 60000, price: 0, fishingMinutes: 40, fishPool: ["black_dragon"] },
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
      repairSeconds: 14400, // 4h (max)
      fishingSeconds: Math.round(d.fishingMinutes * 60),
      fishPool: d.fishPool,
      flavor: d.flavor,
    };
  }
  // Submarine VIP (level 32) — exclusive, premium stats.
  // NOTE: per-instance HP/storage is scaled at claim time on the server based
  // on the player's VIP level (60k @ VIP5 → 350k @ VIP10). The values here
  // represent the MAX potential — actual per-ship storage comes from max_hp.
  if (level === 32) {
    return {
      code: "submarine",
      name: d.ar,
      title: d.ar,
      image: IMG_BY_LEVEL[32],
      price: d.price,
      marketLevel: 32,
      rarity: d.rarity,
      maxHp: 350000,
      armor: 150,
      speed: 90,
      storage: d.storage,
      repairSeconds: 14400, // 4h (max)
      fishingSeconds: Math.round(d.fishingMinutes * 60),
      fishPool: d.fishPool,
      flavor: d.flavor,
    };
  }
  // Upgradeable submarine (level 33) — stars-based stats (base = 1★).
  if (level === 33) {
    return {
      code: "upgrade-sub",
      name: d.ar,
      title: d.ar,
      image: SUB_STAR_IMAGES[1],
      price: d.price,
      marketLevel: 33,
      rarity: d.rarity,
      maxHp: 350000,
      armor: 140,
      speed: 85,
      storage: 350000,
      repairSeconds: 14400,
      fishingSeconds: Math.round(d.fishingMinutes * 60),
      fishPool: d.fishPool,
      flavor: d.flavor,
    };
  }
  // Dragon ships (levels 34/35/36) — Paddle-shop exclusive, catch black_dragon fish.
  if (level >= 34 && level <= 36) {
    const codeMap: Record<number, string> = { 34: "dragon-t1", 35: "dragon-t2", 36: "dragon-t3" };
    const armorMap: Record<number, number> = { 34: 120, 35: 160, 36: 220 };
    const speedMap: Record<number, number> = { 34: 100, 35: 110, 36: 120 };
    return {
      code: codeMap[level],
      name: d.ar,
      title: d.ar,
      image: IMG_BY_LEVEL[level],
      price: d.price,
      marketLevel: level,
      rarity: d.rarity,
      maxHp: d.storage,
      armor: armorMap[level],
      speed: speedMap[level],
      storage: d.storage,
      repairSeconds: 14400,
      fishingSeconds: Math.round(d.fishingMinutes * 60),
      fishPool: d.fishPool,
      flavor: d.flavor,
    };
  }
  // دم السفينة = سعتها (طاقة السفينة)
  const maxHp = d.storage;
  const armor = 4 + Math.floor((level - 1) * 3.5);
  const speed = 9 + Math.floor((level - 1) * 1.4);
  // مدة إصلاح السفينة المدمَّرة (مطابقة لصيغة قاعدة البيانات):
  // تدرّج خطي من دقيقة واحدة (L1) إلى 4 ساعات (L30).
  const repairSeconds = Math.round(60 + (Math.min(30, Math.max(1, level)) - 1) * (14400 - 60) / 29);
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

// Regular ships in the market: 1..30 plus level 33 (upgradeable submarine).
// Level 31 (phoenix) and 32 (VIP submarine) stay shop-exclusive.
export const UPGRADE_SUB_SHIP: ShipDef = buildShip(33);
export const SHIPS: ShipDef[] = [
  ...Array.from({ length: 30 }, (_, i) => buildShip(i + 1)),
  UPGRADE_SUB_SHIP,
];

// Special shop-exclusive ships (not in ship market, not sold for coins).
export const PHOENIX_SHIP: ShipDef = buildShip(31);
export const SUBMARINE_SHIP: ShipDef = buildShip(32);
export const DRAGON_T1_SHIP: ShipDef = buildShip(34);
export const DRAGON_T2_SHIP: ShipDef = buildShip(35);
export const DRAGON_T3_SHIP: ShipDef = buildShip(36);

const ALL_SHIPS: ShipDef[] = [...SHIPS, PHOENIX_SHIP, SUBMARINE_SHIP, DRAGON_T1_SHIP, DRAGON_T2_SHIP, DRAGON_T3_SHIP];

export const STARTER_SHIP = SHIPS[0];

export function getShipByCode(code: string | null | undefined): ShipDef {
  if (!code) return STARTER_SHIP;
  const direct = ALL_SHIPS.find((s) => s.code === code);
  if (direct) return direct;
  const m = code.match(/(\d+)\s*$/);
  if (m) {
    const lvl = parseInt(m[1], 10);
    if (lvl >= 1) return getShipByMarketLevel(lvl);
  }
  return STARTER_SHIP;
}

// Map a market level to the ship definition.
// 31 = phoenix, 32 = VIP submarine, 33 = upgradeable submarine, 34-36 = dragon ships.
export function getShipByMarketLevel(level: number): ShipDef {
  if (level >= 36) return DRAGON_T3_SHIP;
  if (level >= 35) return DRAGON_T2_SHIP;
  if (level >= 34) return DRAGON_T1_SHIP;
  if (level >= 33) return UPGRADE_SUB_SHIP;
  if (level >= 32) return SUBMARINE_SHIP;
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
  const overrides = (globalThis as { __FM_CAP_OVERRIDES__?: Record<number, number> }).__FM_CAP_OVERRIDES__;
  if (overrides && overrides[lvl] != null) return overrides[lvl];
  const landmarks: Record<number, number> = {
    26: 6000000, 27: 11000000, 28: 17000000, 29: 23000000, 30: 30000000,
  };
  if (landmarks[lvl] != null) return landmarks[lvl];
  let cap = 10000;
  for (let l = 2; l <= lvl; l++) {
    if (l <= 10) cap += 10000;
    else if (l <= 20) cap += 20000;
    else cap += 116666;
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

