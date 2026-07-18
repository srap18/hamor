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
  pearls?: number;
  pearl_level?: number;
};

/**
 * Cost of pearls required to upgrade FROM the given level to level+1. Null = max.
 * New balanced curve (matches server `dragon_pearl_upgrade_cost`):
 *   L 1–29   → 3   pearls
 *   L 30–59  → 6
 *   L 60–89  → 9
 *   L 90–119 → 12
 *   L 120–149→ 15
 * Total 1→150 ≈ 1347 pearls (~9 months at 5 arena wins/day).
 */
export function pearlUpgradeCost(fromLevel: number): number | null {
  const n = fromLevel;
  if (n == null || n < 1 || n >= 150) return null;
  if (n <= 29)  return 3;
  if (n <= 59)  return 6;
  if (n <= 89)  return 9;
  if (n <= 119) return 12;
  return 15;
}


/** Effective dragon level — strictly derived from boss damage (DP).
 *  pearl_level is capped by the DP-derived level so nobody can be
 *  over-leveled relative to the damage they actually dealt. */
export function effectiveLevel(d: Dragon): number {
  return overallLevel(d);
}

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
  // Each transition expressed in "nuke equivalents" (1 nuke on the boss = 1,000 DP).
  // 1→2: 50 nukes, 2→3: 100, 3→4: 200, 4→5: 300, 5→6: 350, 6→7: 400, 7→8: 500,
  // 8→9: 700, 9→10: 1000, 10→11: 1500, 11→12: 2500, 12→13: 4000, 13→14: 7000, 14→15: 12000
  { level: 1,  name: "بيضة",            icon: "🥚", dpRequired: 0,           image: dragonStage1  },
  { level: 2,  name: "فقس",             icon: "🐣", dpRequired: 50000,       image: dragonStage2  },
  { level: 3,  name: "تنين صغير",        icon: "🐉", dpRequired: 150000,      image: dragonStage3  },
  { level: 4,  name: "ناشئ",            icon: "🔥", dpRequired: 350000,      image: dragonStage4  },
  { level: 5,  name: "محارب",           icon: "⚡", dpRequired: 650000,      image: dragonStage5  },
  { level: 6,  name: "نخبة",            icon: "🌪️", dpRequired: 1000000,     image: dragonStage6  },
  { level: 7,  name: "ملكي",            icon: "👑", dpRequired: 1400000,     image: dragonStage7  },
  { level: 8,  name: "أسطوري",          icon: "🌌", dpRequired: 1900000,     image: dragonStage8  },
  { level: 9,  name: "كوني",            icon: "☄️", dpRequired: 2600000,     image: dragonStage9  },
  { level: 10, name: "خرافي",            icon: "🔱", dpRequired: 3600000,     image: dragonStage10 },
  { level: 11, name: "تنين النار الذهبي", icon: "🜂", dpRequired: 5100000,     image: dragonStage11 },
  { level: 12, name: "ملك التنانين",     icon: "♛", dpRequired: 7600000,     image: dragonStage12 },
  { level: 13, name: "تنين الرونا",      icon: "🜔", dpRequired: 11600000,    image: dragonStage13 },
  { level: 14, name: "تنين الكون",       icon: "✦", dpRequired: 18600000,    image: dragonStage14 },
  { level: 15, name: "سيد التنانين",     icon: "☼", dpRequired: 30600000,    image: dragonStage15 },
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

/** Overall level 0..150. Level 0 = fresh egg with no bonuses. */
export function overallLevel(d: Dragon): number {
  const formIdx = Math.max(1, Math.min(MAX_FORMS, d.stage));
  // Fresh egg → level 0 (no perks yet)
  if (formIdx === 1 && d.dp <= 0) return 0;
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
// Long-term curve — matches server `dragon_attack_bonus_pct` / `dragon_defense_bonus_pct`:
//   attackPct(L)  = 500 × (L/150)^1.85     → cap +500% at level 150
//   defensePct(L) = 250 × (L/150)^1.85     → cap +250% at level 150
// Progression is gradual and accelerates in the late game.
//   L 30  → ~40% / ~20%
//   L 60  → ~100% / ~50%
//   L 90  → ~200% / ~100%
//   L 120 → ~330% / ~165%
//   L 150 → +500% / +250%
// ──────────────────────────────────────────────────────────────────────────

export const DRAGON_ATTACK_CAP_PCT = 500;   // +500% at level 150
export const DRAGON_DEFENSE_CAP_PCT = 250;  // +250% at level 150
export const DRAGON_CURVE_EXPONENT = 1.85;

/** Bonus % (0..500) added on top of base attack at the given dragon level. */
export function dragonAttackBonusPct(level: number): number {
  const lvl = Math.max(0, Math.min(MAX_LEVEL, Math.floor(level || 0)));
  if (lvl <= 0) return 0;
  if (lvl >= MAX_LEVEL) return DRAGON_ATTACK_CAP_PCT;
  return Math.floor(DRAGON_ATTACK_CAP_PCT * Math.pow(lvl / MAX_LEVEL, DRAGON_CURVE_EXPONENT));
}

/** Bonus % (0..250) added on top of base defense at the given dragon level. */
export function dragonDefenseBonusPct(level: number): number {
  const lvl = Math.max(0, Math.min(MAX_LEVEL, Math.floor(level || 0)));
  if (lvl <= 0) return 0;
  if (lvl >= MAX_LEVEL) return DRAGON_DEFENSE_CAP_PCT;
  return Math.floor(DRAGON_DEFENSE_CAP_PCT * Math.pow(lvl / MAX_LEVEL, DRAGON_CURVE_EXPONENT));
}

/** Attack multiplier (1 + bonus%). Level 150 → ×6.00. */
export function dragonAttackMultiplier(level: number): number {
  return 1 + dragonAttackBonusPct(level) / 100;
}
/** Defense multiplier (1 + bonus%). Level 150 → ×3.50. */
export function dragonDefenseMultiplier(level: number): number {
  return 1 + dragonDefenseBonusPct(level) / 100;
}

/** @deprecated kept for backwards compatibility. Use dragonAttackMultiplier. */
export function dragonMultiplier(level: number): number {
  return dragonAttackMultiplier(level);
}

export type DragonBonus = {
  tier: number;       // 1..30 (cosmetic banding of 5 levels each)
  kind: "pct";
  attackPct: number;  // +% attack
  defensePct: number; // +% defense
  label: string;      // e.g. "+40% / +20%"
};

export function dragonBonusForLevel(level: number): DragonBonus {
  const lvl = Math.max(0, Math.min(MAX_LEVEL, Math.floor(level)));
  const tier = lvl === 0 ? 0 : Math.ceil(lvl / 5); // 0..30
  const atk = dragonAttackBonusPct(lvl);
  const def = dragonDefenseBonusPct(lvl);
  return { tier, kind: "pct", attackPct: atk, defensePct: def, label: `+${atk}% / +${def}%` };
}

/** Apply the dragon attack bonus to a base weapon damage. */
export function applyDragonAttack(baseDamage: number, level: number): number {
  return Math.max(0, Math.round(baseDamage * dragonAttackMultiplier(level)));
}

/** Apply the dragon defense bonus to a base defense / HP value. */
export function applyDragonDefense(baseDefense: number, level: number): number {
  return Math.max(0, Math.round(baseDefense * dragonDefenseMultiplier(level)));
}

/** Tier table for UI (30 rows × 5 levels). Shows +% at the top level of each band. */
export function dragonTierTable(): Array<{
  tier: number;
  fromLevel: number;
  toLevel: number;
  kind: "pct";
  attackPct: number;
  defensePct: number;
  value: number;      // backwards-compat: attack multiplier
  label: string;
}> {
  const rows = [];
  const totalTiers = Math.ceil(MAX_LEVEL / 5); // 30
  for (let t = 1; t <= totalTiers; t++) {
    const fromLevel = (t - 1) * 5 + 1;
    const toLevel = Math.min(MAX_LEVEL, t * 5);
    const atk = dragonAttackBonusPct(toLevel);
    const def = dragonDefenseBonusPct(toLevel);
    rows.push({
      tier: t,
      fromLevel,
      toLevel,
      kind: "pct" as const,
      attackPct: atk,
      defensePct: def,
      value: 1 + atk / 100,
      label: `+${atk}% هجوم / +${def}% دفاع`,
    });
  }
  return rows;
}


