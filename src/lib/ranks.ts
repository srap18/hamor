// Pirate level rank tiers (1..1000) — purely cosmetic mapping
export type Rank = { min: number; max: number; name: string; emoji: string; gradient: string };

export const RANKS: Rank[] = [
  { min: 1,   max: 100,  name: "مبتدئ",            emoji: "🪝", gradient: "from-slate-500 to-slate-700" },
  { min: 101, max: 250,  name: "بحّار",             emoji: "⛵", gradient: "from-cyan-500 to-blue-700" },
  { min: 251, max: 400,  name: "قبطان",            emoji: "🧭", gradient: "from-emerald-500 to-teal-700" },
  { min: 401, max: 600,  name: "أمير البحر",       emoji: "🗡️", gradient: "from-indigo-500 to-violet-700" },
  { min: 601, max: 800,  name: "ملك البحار",       emoji: "👑", gradient: "from-amber-500 to-orange-700" },
  { min: 801, max: 950,  name: "أسطورة",          emoji: "🌟", gradient: "from-pink-500 to-fuchsia-700" },
  { min: 951, max: 1000, name: "إمبراطور القراصنة", emoji: "🏴‍☠️", gradient: "from-yellow-400 via-rose-500 to-purple-700" },
];

export function rankFor(level: number): Rank {
  const lv = Math.max(1, Math.min(1000, Math.floor(level || 1)));
  return RANKS.find(r => lv >= r.min && lv <= r.max) ?? RANKS[0];
}

export const MAX_LEVEL = 1000;

export const SKILLS = [
  { id: "str",   name: "القوة",  emoji: "⚔️", desc: "ضرر إضافي عند الهجوم" },
  { id: "def",   name: "الدفاع", emoji: "🛡️", desc: "تقليل الضرر الوارد" },
  { id: "luck",  name: "الحظ",   emoji: "🍀", desc: "فرصة الجوائز النادرة" },
  { id: "fish",  name: "الصيد",  emoji: "🎣", desc: "رفع معدل الصيد" },
  { id: "speed", name: "السرعة", emoji: "💨", desc: "تسريع الرحلات والكولداون" },
] as const;
export type SkillId = (typeof SKILLS)[number]["id"];
