// Crew catalog — new specialized roles
import luckImg from "@/assets/crews/luck.png";
import guideImg from "@/assets/crews/guide.png";
import thiefImg from "@/assets/crews/thief.png";
import sailorImg from "@/assets/crews/sailor.png";
import traderImg from "@/assets/crews/trader.png";
import policeImg from "@/assets/crews/police.png";
import fixer1Img from "@/assets/crews/fixer1.png";
import fixer2Img from "@/assets/crews/fixer2.png";
import fixer3Img from "@/assets/crews/fixer3.png";
import fixer4Img from "@/assets/crews/fixer4.png";
import goldenFisherImg from "@/assets/crews/golden-fisher.png";
import marketExpertAsset from "@/assets/crews/market-expert.png.asset.json";

export type Crew = {
  id: string;
  name: string;
  emoji: string;
  image?: string;
  price: number;
  currency: "coins" | "gems";
  bonus: string;
  rarity: "common" | "rare" | "epic" | "legendary";
};

// Fixer HP repair amounts (added to current hp, capped at maxHp).
export const FIXER_HEAL: Record<string, number> = {
  fixer_1: 1000,
  fixer_2: 5000,
  fixer_3: 70000,
  // fixer_4 = legendary → full repair on all 3 fleet ships
};

export const CREWS: Crew[] = [
  { id: "luck",    name: "الحظ",            emoji: "🍀", image: luckImg,   price: 30,     currency: "gems",  bonus: "يضاعف عدد الأسماك في كل عملية صيد",                      rarity: "epic" },
  { id: "guide",   name: "المرشد",          emoji: "🧭", image: guideImg,  price: 600000, currency: "coins", bonus: "يكشف لك نوع الأسماك التي تصيدها سفينتك الحالية",         rarity: "rare" },
  { id: "thief",   name: "السارق",          emoji: "🥷", image: thiefImg,  price: 25,     currency: "gems",  bonus: "يرفع سرعة السرقة 40% ويتخطى الشرطي بنسبة 80%",            rarity: "legendary" },
  { id: "sailor",  name: "بحار",            emoji: "⛵", image: sailorImg, price: 600000, currency: "coins", bonus: "يقلل وقت الصيد بنسبة 50%",                              rarity: "common" },
  { id: "trader",  name: "التاجر",          emoji: "💰", image: traderImg, price: 30,     currency: "gems",  bonus: "يكشف لك أسعار السمك المستقبلية خلال 10 ساعات القادمة",    rarity: "epic" },
  { id: "police",  name: "شرطي",            emoji: "👮", image: policeImg, price: 25,     currency: "gems",  bonus: "يقبض على السارق ويحمي ذهبك",                              rarity: "rare" },
  { id: "fixer_1", name: "مصلح صغير",       emoji: "🔧", image: fixer1Img, price: 200000,  currency: "coins", bonus: "يصلح فوراً 1,000 من دم أي سفينة",      rarity: "common" },
  { id: "fixer_2", name: "مصلح متوسط",      emoji: "🛠️", image: fixer2Img, price: 700000,  currency: "coins", bonus: "يصلح فوراً 5,000 من دم أي سفينة",      rarity: "rare" },
  { id: "fixer_3", name: "مصلح كبير",       emoji: "⚒️", image: fixer3Img, price: 3500000, currency: "coins", bonus: "يصلح فوراً 70,000 من دم أي سفينة",     rarity: "epic" },
  { id: "fixer_4", name: "مصلح أسطوري",     emoji: "🏆", image: fixer4Img, price: 50,      currency: "gems",  bonus: "يعبّي كل سفنك الـ3 فلل فوراً", rarity: "legendary" },
  { id: "golden_fisher", name: "الصياد الذهبي", emoji: "🏅", image: goldenFisherImg, price: 3000, currency: "gems", bonus: "يصيد تلقائياً على كل سفنك حتى وأنت أوف لاين + حصانة كاملة من الهجوم والسرقة 24 ساعة.", rarity: "legendary" },
  { id: "market_expert", name: "خبير الأسواق", emoji: "📈", image: marketExpertAsset.url, price: 1000, currency: "gems", bonus: "عند التفعيل (3 ساعات): يبيع كل سمكة بأعلى سعر محدد لها بغض النظر عن سعر السوق الحالي.", rarity: "legendary" },
];
