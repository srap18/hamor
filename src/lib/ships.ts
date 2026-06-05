// Unified luxurious ship image used for every market level (1..30).
import shipUnified from "@/assets/ships/ship-lvl-30.png";
import shipPhoenix from "@/assets/ships/ship-phoenix.png";
import shipSubmarineAsset from "@/assets/ships/ship-vip-submarine.png.asset.json";
const shipSubmarine = shipSubmarineAsset.url;

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

// Single luxurious image used for every market level (1..30).
// Phoenix (31) and Submarine (32) keep their own unique art.
function imageForLevel(level: number): string {
  if (level === 31) return shipPhoenix;
  if (level === 32) return shipSubmarine;
  return shipUnified;
}

// All unified-image ships face the same direction — no per-level flip needed.
export function shipBowFacesRight(_level: number): boolean {
  return false;
}

// ─────── المصدر الموحّد لتعريف السفن ───────
type ShipOverride = {
  ar: string;
  rarity: string;
  flavor: string;
  storage: number;
  price: number;
  fishingMinutes: number;
  fishPool: string[];
};

const SHIP_DATA: Record<number, ShipOverride> = {
  1:  { ar: "قارب صغير",              rarity: "Starter",   flavor: "قارب خشبي بسيط للمبتدئين في الموانئ القريبة.",         storage: 80,     price: 400,         fishingMinutes: 2.5,  fishPool: ["sardine","anchovy"] },
  2:  { ar: "قارب كبير",              rarity: "Common",    flavor: "قارب خشبي معزّز بصاري قصير وشراع متهالك.",            storage: 180,    price: 2500,        fishingMinutes: 4.5,  fishPool: ["sardine","herring","smelt"] },
  3:  { ar: "سفينة شراعية",            rarity: "Common",    flavor: "سفينة شراعية رشيقة تجوب المياه الساحلية.",            storage: 600,    price: 7500,        fishingMinutes: 6,    fishPool: ["minnow","mullet","anchovy"] },
  4:  { ar: "سفينة مجداف",             rarity: "Common",    flavor: "سفينة بمجاديف قوية لرحلات أطول قليلاً.",              storage: 900,    price: 11000,       fishingMinutes: 7.5,  fishPool: ["shrimp","crab_small","sardine"] },
  5:  { ar: "يخت أبيض",                rarity: "Uncommon",  flavor: "يخت أبيض أنيق بمحرك هادئ.",                          storage: 1200,   price: 20000,       fishingMinutes: 9,    fishPool: ["mullet","shrimp","herring"] },
  6:  { ar: "قارب حرب",                rarity: "Uncommon",  flavor: "قارب حربي مدرّع لمواجهة البحار الخطرة.",              storage: 1800,   price: 50000,       fishingMinutes: 11,   fishPool: ["mackerel","bass","shrimp"] },
  7:  { ar: "كمين",                    rarity: "Uncommon",  flavor: "سفينة كمين شبحية تنقض على فرائسها.",                  storage: 2500,   price: 90000,       fishingMinutes: 13,   fishPool: ["cod","snapper","mackerel"] },
  8:  { ar: "حفارة",                   rarity: "Rare",      flavor: "حفّارة بحرية ثقيلة تجرف أعماق البحر.",                storage: 3500,   price: 150000,      fishingMinutes: 14,   fishPool: ["trout","salmon","bass"] },
  9:  { ar: "باخرة",                   rarity: "Rare",      flavor: "باخرة ضخمة بمداخن بخار ومستودعات واسعة.",             storage: 5000,   price: 300000,      fishingMinutes: 16,   fishPool: ["squid","snapper","cod"] },
  10: { ar: "سفينة أبحاث",             rarity: "Rare",      flavor: "سفينة أبحاث علمية بأجهزة سونار متقدمة.",              storage: 7500,   price: 700000,      fishingMinutes: 20,   fishPool: ["salmon","squid","trout"] },
  11: { ar: "سفينة الفانوس",           rarity: "Epic",      flavor: "سفينة بفوانيس متوهجة تجذب كائنات الأعماق.",            storage: 9000,   price: 2200000,     fishingMinutes: 24,   fishPool: ["tuna","grouper","salmon"] },
  12: { ar: "سفينة الميلاد",           rarity: "Epic",      flavor: "سفينة احتفالية مزخرفة بأضواء وأشرعة فاخرة.",          storage: 13000,  price: 5000000,     fishingMinutes: 27,   fishPool: ["octopus","lobster","squid"] },
  13: { ar: "سفينة الصقر",             rarity: "Epic",      flavor: "سفينة سريعة كالصقر تنقضّ على الفرائس.",               storage: 16000,  price: 8000000,     fishingMinutes: 30,   fishPool: ["eel","flounder","grouper"] },
  14: { ar: "سفينة الأعماق",           rarity: "Epic",      flavor: "سفينة أعماق متخصصة بالنزول لقاع المحيط.",             storage: 20000,  price: 12000000,    fishingMinutes: 33,   fishPool: ["carp","tuna","eel"] },
  15: { ar: "سفينة العاصفة",           rarity: "Epic",      flavor: "سفينة تشق العواصف بلا خوف.",                          storage: 25000,  price: 18000000,    fishingMinutes: 36,   fishPool: ["flounder","carp","octopus"] },
  16: { ar: "سفينة الكابوس",           rarity: "Epic+",     flavor: "سفينة شبحية سوداء تثير الرعب.",                       storage: 30000,  price: 25000000,    fishingMinutes: 39,   fishPool: ["marlin","swordfish","lobster"] },
  17: { ar: "سفينة المحيط الأزرق",     rarity: "Epic+",     flavor: "سفينة محيطية تجوب المياه الزرقاء الواسعة.",           storage: 36000,  price: 34000000,    fishingMinutes: 42,   fishPool: ["sailfish","barracuda","marlin"] },
  18: { ar: "سفينة الإعصار",           rarity: "Epic+",     flavor: "سفينة لا توقفها الأعاصير ولا الأمواج.",               storage: 42000,  price: 45000000,    fishingMinutes: 46,   fishPool: ["stingray","shark","swordfish"] },
  19: { ar: "سفينة الجبروت",           rarity: "Epic+",     flavor: "سفينة جبّارة بهيكل فولاذي ضخم.",                      storage: 50000,  price: 60000000,    fishingMinutes: 50,   fishPool: ["tang_blue","koi","sailfish"] },
  20: { ar: "سفينة الموجة السوداء",    rarity: "Legendary", flavor: "سفينة مظلمة كموجة الليل.",                            storage: 60000,  price: 80000000,    fishingMinutes: 55,   fishPool: ["shark","stingray","barracuda"] },
  21: { ar: "سفينة الفاتح البحري",     rarity: "Legendary", flavor: "سفينة فاتحة للأقاليم البحرية النائية.",              storage: 72000,  price: 110000000,   fishingMinutes: 60,   fishPool: ["manta","hammerhead","shark"] },
  22: { ar: "سفينة نجم البحر",         rarity: "Legendary", flavor: "سفينة تتلألأ كنجمٍ يهتدي به البحّارة.",              storage: 85000,  price: 150000000,   fishingMinutes: 66,   fishPool: ["whale","orca","manta"] },
  23: { ar: "سفينة أسطورة الأعماق",    rarity: "Legendary", flavor: "سفينة الأسطورة التي تجوب أعمق الأعماق.",             storage: 100000, price: 200000000,   fishingMinutes: 72,   fishPool: ["arowana","goldfish","hammerhead"] },
  24: { ar: "سفينة نهاية المحيط",      rarity: "Legendary", flavor: "سفينة نهائية تصل لحدود المحيط البعيد.",              storage: 120000, price: 300000000,   fishingMinutes: 80,   fishPool: ["pearl","koi","tang_blue"] },
  25: { ar: "ثاوزند سني",              rarity: "Mythic",    flavor: "سفينة الأحلام بشراع الجولي روجر ورأس الأسد الذهبي.", storage: 140000, price: 650000000,   fishingMinutes: 88,   fishPool: ["orca","whale","arowana"] },
  26: { ar: "سفينة الكيوبي",           rarity: "Mythic",    flavor: "سفينة النينجا برأس الثعلب ذو الأذناب التسعة وشعار كونوها.", storage: 165000, price: 800000000,   fishingMinutes: 96,   fishPool: ["kraken","leviathan","goldfish"] },
  27: { ar: "سفينة كاسر الجدران",      rarity: "Mythic",    flavor: "سفينة فيلق الاستطلاع برأس العملاق المدرّع.",          storage: 190000, price: 1000000000,  fishingMinutes: 105,  fishPool: ["megalodon","sea_dragon","pearl"] },
  28: { ar: "سفينة شينلونغ",           rarity: "Mythic",    flavor: "سفينة التنين الذهبي وكرات الدراغون السبع.",            storage: 220000, price: 2000000000,  fishingMinutes: 115,  fishPool: ["poseidon","kraken","leviathan"] },
  29: { ar: "سفينة التنين البحري",     rarity: "Mythic",    flavor: "تنين بحري ينفث الرعب في الأمواج.",                    storage: 260000, price: 5000000000,  fishingMinutes: 125,  fishPool: ["black_pearl","megalodon","sea_dragon"] },
  30: { ar: "سفينة نهاية الأعماق",     rarity: "Mythic",    flavor: "السفينة النهائية: نهاية كل الأعماق.",                 storage: 300000, price: 9000000000,  fishingMinutes: 140,  fishPool: ["golden_koi","poseidon","black_pearl","kraken"] },
  31: { ar: "سفينة العنقاء التنينية",  rarity: "Legendary", flavor: "سفينة العنقاء الحمراء — حصرية للمتجر، تصيد عنقاء النار النادرة فقط. سعة 13 ألف ودمّ 13 ألف.", storage: 13000,  price: 0,           fishingMinutes: 20,   fishPool: ["phoenix"] },
  32: { ar: "الغواصة الملكية VIP",     rarity: "Mythic",    flavor: "غواصة سوداء فاخرة حصرية لأعضاء VIP 5 فأعلى — تنزل لأعماق المحيط وتصيد تيتان الأعماق النادر. كل عضو VIP 5+ يستلم 3 غواصات. السعة والدمّ يتدرّجان حسب مستوى VIP وقت الاستلام: VIP 5 = 60 ألف، VIP 6 = 118 ألف، VIP 7 = 176 ألف، VIP 8 = 234 ألف، VIP 9 = 292 ألف، VIP 10 = 350 ألف.", storage: 350000, price: 0,           fishingMinutes: 45,   fishPool: ["abyss_titan"] },
};

function buildShip(level: number): ShipDef {
  const d = SHIP_DATA[level];
  if (level === 31) {
    return {
      code: "phoenix",
      name: d.ar,
      title: d.ar,
      image: imageForLevel(31),
      price: d.price,
      marketLevel: 31,
      rarity: d.rarity,
      maxHp: 13000,
      armor: 80,
      speed: 60,
      storage: d.storage,
      repairSeconds: 36000,
      fishingSeconds: Math.round(d.fishingMinutes * 60),
      fishPool: d.fishPool,
      flavor: d.flavor,
    };
  }
  if (level === 32) {
    return {
      code: "submarine",
      name: d.ar,
      title: d.ar,
      image: imageForLevel(32),
      price: d.price,
      marketLevel: 32,
      rarity: d.rarity,
      maxHp: 350000,
      armor: 150,
      speed: 90,
      storage: d.storage,
      repairSeconds: 86400,
      fishingSeconds: Math.round(d.fishingMinutes * 60),
      fishPool: d.fishPool,
      flavor: d.flavor,
    };
  }
  const maxHp = d.storage;
  const armor = 4 + Math.floor((level - 1) * 3.5);
  const speed = 9 + Math.floor((level - 1) * 1.4);
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
    image: imageForLevel(level),
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

export const SHIPS: ShipDef[] = Array.from({ length: 30 }, (_, i) => buildShip(i + 1));
export const PHOENIX_SHIP: ShipDef = buildShip(31);
export const SUBMARINE_SHIP: ShipDef = buildShip(32);

const ALL_SHIPS: ShipDef[] = [...SHIPS, PHOENIX_SHIP, SUBMARINE_SHIP];

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

export function getShipByMarketLevel(level: number): ShipDef {
  if (level >= 32) return SUBMARINE_SHIP;
  if (level >= 31) return PHOENIX_SHIP;
  const clamped = Math.max(1, Math.min(30, Math.round(level)));
  return SHIPS[clamped - 1];
}

export function getShipImage(code: string | null | undefined): string {
  return getShipByCode(code).image;
}

export function catchPerTrip(ship: ShipDef): number {
  return Math.max(1, ship.storage);
}

// ─────── سعة سوق السمك حسب المستوى ───────
export function fishMarketCapacity(level: number): number {
  const lvl = Math.max(1, Math.min(30, Math.round(level || 1)));
  const overrides = (globalThis as { __FM_CAP_OVERRIDES__?: Record<number, number> }).__FM_CAP_OVERRIDES__;
  if (overrides && overrides[lvl] != null) return overrides[lvl];
  let cap = 10000;
  for (let l = 2; l <= lvl; l++) {
    if (l <= 10) cap += 10000;
    else if (l <= 20) cap += 30000;
    else cap += 100000;
  }
  return cap;
}
