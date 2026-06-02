import { supabase } from "@/integrations/supabase/client";
import stage1Img from "@/assets/daughter-stage1.png";
import stage2Img from "@/assets/daughter-stage2.png";
import stage3Img from "@/assets/daughter-stage3.png";
import outfitSailor from "@/assets/daughter-outfit-sailor.png";
import outfitSummer from "@/assets/daughter-outfit-summer.png";
import outfitCaptain from "@/assets/daughter-outfit-captain.png";
import outfitBeach from "@/assets/daughter-outfit-beach.png";
import { serverTodayKey } from "@/lib/server-time";

export type Daughter = {
  user_id: string;
  name: string;
  stage: number;
  feed_xp: number;
  total_fish_fed: number;
  last_fed_at: string | null;
  created_at: string;
  updated_at: string;
  outfit?: OutfitId;
  feed_count_today?: number;
  feed_day?: string | null;
};

export type OutfitId = "sailor" | "summer" | "captain" | "beach";

export const STAGE_IMAGES: Record<number, string> = {
  1: stage1Img,
  2: stage2Img,
  3: stage3Img,
};

export const STAGE_LABELS: Record<number, string> = {
  1: "طفلة",
  2: "بنت صغيرة",
  3: "شابة",
  4: "مراهقة",
  5: "بحّارة مبتدئة",
  6: "بحّارة ماهرة",
  7: "ربّان مساعد",
  8: "قبطانة",
  9: "أميرة البحر",
  10: "ملكة المحيط",
};

// Daily limit enforced server-side.
export const DAILY_FISH_LIMIT = 10;
export const MAX_STAGE = 10;

// Cumulative fish needed to reach each stage (mirror of DB _daughter_stage_for).
export const STAGE_FISH_THRESHOLD: Record<number, number> = {
  1: 0, 2: 100, 3: 350, 4: 800, 5: 1500,
  6: 2500, 7: 4000, 8: 7000, 9: 13000, 10: 25000,
};

// Gem cost to advance from stage N to N+1 (mirror of DB daughter_gem_cost).
export const STAGE_GEM_COST: Record<number, number> = {
  1: 80, 2: 200, 3: 500, 4: 1200, 5: 2800,
  6: 6000, 7: 13000, 8: 28000, 9: 60000,
};

export const OUTFITS: { id: OutfitId; name: string; img: string; emoji: string }[] = [
  { id: "sailor",  name: "زي بحّارة قصير",       img: outfitSailor,  emoji: "⚓" },
  { id: "summer",  name: "فستان صيفي قصير",      img: outfitSummer,  emoji: "🌼" },
  { id: "captain", name: "معطف قبطان طويل",     img: outfitCaptain, emoji: "🎩" },
  { id: "beach",   name: "لبس شاطئ كاجوال",     img: outfitBeach,   emoji: "🏖️" },
];

export function outfitImage(id?: OutfitId | null): string {
  return OUTFITS.find((o) => o.id === id)?.img || outfitSailor;
}

export function nextThreshold(stage: number) {
  if (stage >= MAX_STAGE) return null;
  return STAGE_FISH_THRESHOLD[stage + 1] ?? null;
}

export function gemCostFor(stage: number): number | null {
  return STAGE_GEM_COST[stage] ?? null;
}

export function remainingTodayFor(d: Daughter | null): number {
  if (!d) return DAILY_FISH_LIMIT;
  const today = serverTodayKey();
  const used = (d.feed_day === today) ? (d.feed_count_today ?? 0) : 0;
  return Math.max(0, DAILY_FISH_LIMIT - used);
}

export type DaughterBonuses = {
  luckPct: number;
  fishingSpeedPct: number;
  cashbackPct: number;
};

export function bonusesFor(stage: number): DaughterBonuses {
  // Smooth scale across 10 stages
  const luck = Math.round(3 + (stage - 1) * 5);          // 3 → 48
  const speed = Math.round(3 + (stage - 1) * 4);         // 3 → 39
  const cashback = Math.round(1 + (stage - 1) * 2);      // 1 → 19
  return { luckPct: luck, fishingSpeedPct: speed, cashbackPct: cashback };
}

export async function getMyDaughter(): Promise<Daughter | null> {
  const { data } = await (supabase as any).rpc("get_my_daughter");
  if (!data) return null;
  return Array.isArray(data) ? (data[0] as Daughter) : (data as Daughter);
}

export async function feedDaughter(fishStockIds: string[]) {
  return (supabase as any).rpc("feed_daughter", { _fish_stock_ids: fishStockIds });
}

export async function upgradeDaughterWithGems() {
  return (supabase as any).rpc("upgrade_daughter_with_gems");
}

export async function renameDaughter(name: string) {
  return (supabase as any).rpc("rename_daughter", { _name: name });
}

export async function setDaughterOutfit(outfit: OutfitId) {
  return (supabase as any).rpc("set_daughter_outfit", { _outfit: outfit });
}
