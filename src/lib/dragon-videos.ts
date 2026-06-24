// Dragon evolution video mapping — one clip per dragon form (1..15).
//
// We bind the dragon's `stage` (1..15 from src/lib/dragon.ts) directly to a
// clip so the video is stable: it only swaps when the dragon promotes to the
// next form, never on every DP tick.
//
// Stage bands (matches the levels the product gave us):
//   stage 1-2   → egg          → clips 3, 4
//   stage 3-8   → small dragon → clips 13, 5, 2, 6, 11, 14
//   stage 9-12  → teen dragon  → clips 7, 8, 9, 10
//   stage 13-15 → mature       → clips 1, 15, 12

import v1 from "@/assets/dragon-evo/dragon-evo-1.mp4.asset.json";
import v2 from "@/assets/dragon-evo/dragon-evo-2.mp4.asset.json";
import v3 from "@/assets/dragon-evo/dragon-evo-3.mp4.asset.json";
import v4 from "@/assets/dragon-evo/dragon-evo-4.mp4.asset.json";
import v5 from "@/assets/dragon-evo/dragon-evo-5.mp4.asset.json";
import v6 from "@/assets/dragon-evo/dragon-evo-6.mp4.asset.json";
import v7 from "@/assets/dragon-evo/dragon-evo-7.mp4.asset.json";
import v8 from "@/assets/dragon-evo/dragon-evo-8.mp4.asset.json";
import v9 from "@/assets/dragon-evo/dragon-evo-9.mp4.asset.json";
import v10 from "@/assets/dragon-evo/dragon-evo-10.mp4.asset.json";
import v11 from "@/assets/dragon-evo/dragon-evo-11.mp4.asset.json";
import v12 from "@/assets/dragon-evo/dragon-evo-12.mp4.asset.json";
import v13 from "@/assets/dragon-evo/dragon-evo-13.mp4.asset.json";
import v14 from "@/assets/dragon-evo/dragon-evo-14.mp4.asset.json";
import v15 from "@/assets/dragon-evo/dragon-evo-15.mp4.asset.json";

const ALL = [v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15];

export type DragonEvoStage = "egg" | "small" | "teen" | "mature";

// One entry per dragon form (index = stage 1..15). clipIndex is 1-based into ALL.
const STAGE_TO_CLIP: Array<{ clipIndex: number; stage: DragonEvoStage }> = [
  { clipIndex: 3,  stage: "egg"    }, // form 1 — بيضة (مستويات 1-10)
  { clipIndex: 4,  stage: "small"  }, // form 2 — فقس (تغيّر واضح عند المستوى 11)
  { clipIndex: 13, stage: "small"  }, // form 3
  { clipIndex: 5,  stage: "small"  }, // form 4
  { clipIndex: 2,  stage: "small"  }, // form 5
  { clipIndex: 6,  stage: "small"  }, // form 6
  { clipIndex: 11, stage: "small"  }, // form 7
  { clipIndex: 14, stage: "small"  }, // form 8
  { clipIndex: 7,  stage: "teen"   }, // form 9
  { clipIndex: 8,  stage: "teen"   }, // form 10
  { clipIndex: 9,  stage: "teen"   }, // form 11
  { clipIndex: 10, stage: "teen"   }, // form 12
  { clipIndex: 1,  stage: "mature" }, // form 13
  { clipIndex: 15, stage: "mature" }, // form 14
  { clipIndex: 12, stage: "mature" }, // form 15
];



/** Returns the fixed clip for a dragon form (stage 1..15). */
export function getDragonVideoForStage(stage: number): {
  url: string;
  stage: DragonEvoStage;
  clipIndex: number;
} {
  const s = Math.max(1, Math.min(STAGE_TO_CLIP.length, Math.floor(stage || 1)));
  const entry = STAGE_TO_CLIP[s - 1];
  return { url: ALL[entry.clipIndex - 1].url, stage: entry.stage, clipIndex: entry.clipIndex };
}

/** Back-compat: convert an overall level (1..150) to a form (1..15) and look up. */
export function getDragonVideoForLevel(level: number) {
  const lvl = Math.max(1, Math.min(150, Math.floor(level || 1)));
  const form = Math.min(15, Math.max(1, Math.ceil(lvl / 10)));
  return getDragonVideoForStage(form);
}
