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

export const CREWS: Crew[] = [
  { id: "luck",    name: "الحظ",            emoji: "🍀", image: luckImg,   price: 300,    currency: "gems",  bonus: "يضاعف عدد الأسماك في كل عملية صيد",                      rarity: "epic" },
  { id: "guide",   name: "المرشد",          emoji: "🧭", image: guideImg,  price: 600000, currency: "coins", bonus: "يكشف لك نوع الأسماك التي تصيدها سفينتك الحالية",         rarity: "rare" },
  { id: "thief",   name: "السارق",          emoji: "🥷", image: thiefImg,  price: 250,    currency: "gems",  bonus: "يرفع سرعة السرقة 40% ويتخطى الشرطي بنسبة 80%",            rarity: "legendary" },
  { id: "sailor",  name: "بحار",            emoji: "⛵", image: sailorImg, price: 600000, currency: "coins", bonus: "يزيد سرعة الصيد بنسبة 40%",                              rarity: "common" },
  { id: "trader",  name: "التاجر",          emoji: "💰", image: traderImg, price: 250,    currency: "gems",  bonus: "يكشف لك أسعار السمك المستقبلية خلال 10 ساعات القادمة",    rarity: "epic" },
  { id: "police",  name: "شرطي",            emoji: "👮", image: policeImg, price: 250,    currency: "gems",  bonus: "يقبض على السارق ويحمي ذهبك",                              rarity: "rare" },
  { id: "fixer_1", name: "مصلح صغير",       emoji: "🔧", image: fixer1Img, price: 500000,  currency: "coins", bonus: "يصلح فوراً السفن من المستوى 1 إلى 10",  rarity: "common" },
  { id: "fixer_2", name: "مصلح متوسط",      emoji: "🛠️", image: fixer2Img, price: 1000000, currency: "coins", bonus: "يصلح فوراً السفن من المستوى 11 إلى 20", rarity: "rare" },
  { id: "fixer_3", name: "مصلح أسطوري",     emoji: "⚒️", image: fixer3Img, price: 60,      currency: "gems",  bonus: "يصلح كل سفنك الـ3 فوراً (أي مستوى)",   rarity: "legendary" },
];
