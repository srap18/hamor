// Dragon system constants and helpers
import dragonStage1 from "@/assets/dragon-stage-1.png";
import dragonStage2 from "@/assets/dragon-stage-2.png";
import dragonStage3 from "@/assets/dragon-stage-3.png";
import dragonStage4 from "@/assets/dragon-stage-4.png";
import dragonStage5 from "@/assets/dragon-stage-5.png";
import dragonStage6 from "@/assets/dragon-stage-6.png";
import dragonStage7 from "@/assets/dragon-stage-7.png";
import dragonStage8 from "@/assets/dragon-stage-8.png";
import dragonStage9 from "@/assets/dragon-stage-9.png";
import dragonStage10 from "@/assets/dragon-stage-10.png";
import dragonStage11 from "@/assets/dragon-stage-11.png";
import dragonStage12 from "@/assets/dragon-stage-12.png";
import dragonStage13 from "@/assets/dragon-stage-13.png";
import dragonStage14 from "@/assets/dragon-stage-14.png";
import dragonStage15 from "@/assets/dragon-stage-15.png";

export type Dragon = {
  user_id: string;
  name: string;
  stage: number;
  dp: number;
  total_boss_damage: number;
  pvp_wins: number;
  pvp_losses: number;
  element: string;
  hatched_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DragonStage = {
  level: number;        // form index 1..15
  name: string;
  icon: string;
  dpRequired: number;   // DP to ENTER this form (= reach overall level (level-1)*10 + 1)
  image: string;
};

// 15 forms × 10 sub-levels = 150 overall levels.
// Each form spans 10 levels; entering a new form happens every 10 levels.
export const DRAGON_STAGES: DragonStage[] = [
  { level: 1,  name: "بيضة",            icon: "🥚", dpRequired: 0,        image: dragonStage1  },
  { level: 2,  name: "فقس",             icon: "🐣", dpRequired: 100,      image: dragonStage2  },
  { level: 3,  name: "تنين صغير",        icon: "🐉", dpRequired: 300,      image: dragonStage3  },
  { level: 4,  name: "ناشئ",            icon: "🔥", dpRequired: 800,      image: dragonStage4  },
  { level: 5,  name: "محارب",           icon: "⚡", dpRequired: 2000,     image: dragonStage5  },
  { level: 6,  name: "نخبة",            icon: "🌪️", dpRequired: 5000,     image: dragonStage6  },
  { level: 7,  name: "ملكي",            icon: "👑", dpRequired: 12000,    image: dragonStage7  },
  { level: 8,  name: "أسطوري",          icon: "🌌", dpRequired: 25000,    image: dragonStage8  },
  { level: 9,  name: "كوني",            icon: "☄️", dpRequired: 50000,    image: dragonStage9  },
  { level: 10, name: "إلهي",            icon: "🔱", dpRequired: 100000,   image: dragonStage10 },
  { level: 11, name: "تنين النار الذهبي", icon: "🜂", dpRequired: 200000,   image: dragonStage11 },
  { level: 12, name: "ملك التنانين",     icon: "♛", dpRequired: 400000,   image: dragonStage12 },
  { level: 13, name: "تنين الرونا",      icon: "🜔", dpRequired: 800000,   image: dragonStage13 },
  { level: 14, name: "تنين الكون",       icon: "✦", dpRequired: 1600000,  image: dragonStage14 },
  { level: 15, name: "إله التنانين",     icon: "☼", dpRequired: 3500000,  image: dragonStage15 },
];

export const MAX_FORMS = DRAGON_STAGES.length;     // 15
export const LEVELS_PER_FORM = 10;
export const MAX_LEVEL = MAX_FORMS * LEVELS_PER_FORM; // 150

export function getStage(stage: number): DragonStage {
  return DRAGON_STAGES[Math.max(0, Math.min(DRAGON_STAGES.length - 1, stage - 1))];
}

export function getNextStage(stage: number): DragonStage | null {
  return DRAGON_STAGES[stage] ?? null;
}

export function dpProgress(d: Dragon): { current: number; next: number; pct: number } {
  const next = getNextStage(d.stage);
  if (!next) return { current: d.dp, next: d.dp, pct: 100 };
  const curBase = getStage(d.stage).dpRequired;
  const span = Math.max(1, next.dpRequired - curBase);
  const rel = Math.max(0, d.dp - curBase);
  return { current: d.dp, next: next.dpRequired, pct: Math.min(100, (rel / span) * 100) };
}

/** Overall level 1..150 derived from form (stage) + dp progress inside that form. */
export function overallLevel(d: Dragon): number {
  const formIdx = Math.max(1, Math.min(MAX_FORMS, d.stage));
  const next = getNextStage(formIdx);
  if (!next) return MAX_LEVEL;
  const base = getStage(formIdx).dpRequired;
  const span = Math.max(1, next.dpRequired - base);
  const rel = Math.max(0, d.dp - base);
  const sub = Math.min(LEVELS_PER_FORM, Math.floor((rel / span) * LEVELS_PER_FORM));
  return (formIdx - 1) * LEVELS_PER_FORM + Math.max(1, sub + 1);
}

// ──────────────────────────────────────────────────────────────────────────
// Dragon combat bonuses (apply to weapon damage & ship defense)
//
// Tiers of 5 overall levels:
//   Tier 1  (levels 1-5)    → flat +200 to base value
//   Tier 2  (levels 6-10)   → ×1.5
//   Tier 3  (levels 11-15)  → ×2.0
//   Tier 4  (levels 16-20)  → ×2.5
//   …
//   Tier n  (n ≥ 2)         → ×(1.0 + 0.5·(n−1))
//   Tier 30 (levels 146-150) → ×15.5  (max)
// ──────────────────────────────────────────────────────────────────────────

export type DragonBonus =
  | { tier: 1; kind: "flat"; value: number; label: string }
  | { tier: number; kind: "mult"; value: number; label: string };

export function dragonBonusForLevel(level: number): DragonBonus {
  const lvl = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  const tier = Math.ceil(lvl / 5); // 1..30
  if (tier <= 1) {
    return { tier: 1, kind: "flat", value: 200, label: "+200 ضرر" };
  }
  const mult = 1 + 0.5 * (tier - 1); // tier 2 → 1.5, tier 30 → 15.5
  return { tier, kind: "mult", value: mult, label: `×${mult.toFixed(1)}` };
}

/** Apply the dragon attack bonus to a base weapon damage. */
export function applyDragonAttack(baseDamage: number, level: number): number {
  const b = dragonBonusForLevel(level);
  if (b.kind === "flat") return Math.max(0, Math.round(baseDamage + b.value));
  return Math.max(0, Math.round(baseDamage * b.value));
}

/** Apply the dragon defense bonus to a base defense / HP value. */
export function applyDragonDefense(baseDefense: number, level: number): number {
  const b = dragonBonusForLevel(level);
  if (b.kind === "flat") return Math.max(0, Math.round(baseDefense + b.value));
  return Math.max(0, Math.round(baseDefense * b.value));
}

/** Full tier table for UI display (30 tiers covering 150 levels). */
export function dragonTierTable(): Array<{
  tier: number;
  fromLevel: number;
  toLevel: number;
  kind: "flat" | "mult";
  value: number;
  label: string;
}> {
  const rows = [];
  const totalTiers = Math.ceil(MAX_LEVEL / 5); // 30
  for (let t = 1; t <= totalTiers; t++) {
    const fromLevel = (t - 1) * 5 + 1;
    const toLevel = Math.min(MAX_LEVEL, t * 5);
    if (t === 1) {
      rows.push({ tier: t, fromLevel, toLevel, kind: "flat" as const, value: 200, label: "+200" });
    } else {
      const mult = 1 + 0.5 * (t - 1);
      rows.push({ tier: t, fromLevel, toLevel, kind: "mult" as const, value: mult, label: `×${mult.toFixed(1)}` });
    }
  }
  return rows;
}
