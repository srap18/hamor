// Dragon evolution video mapping by overall level (1..150).
//
// Bands (provided by product):
//   1-2     → eggs            (videos 3, 4)
//   3-30    → small dragon    (videos 13, 5, 2, 6, 11, 14)
//   31-70   → teen dragon     (videos 7, 8, 9, 10)
//   71-150  → mature dragon   (videos 1, 15, 12)

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

type Band = {
  stage: DragonEvoStage;
  fromLevel: number;
  toLevel: number;
  /** 1-based indices into ALL */
  clips: number[];
};

const BANDS: Band[] = [
  { stage: "egg",    fromLevel: 1,  toLevel: 2,   clips: [3, 4] },
  { stage: "small",  fromLevel: 3,  toLevel: 30,  clips: [13, 5, 2, 6, 11, 14] },
  { stage: "teen",   fromLevel: 31, toLevel: 70,  clips: [7, 8, 9, 10] },
  { stage: "mature", fromLevel: 71, toLevel: 150, clips: [1, 15, 12] },
];

export function getDragonVideoForLevel(level: number): {
  url: string;
  stage: DragonEvoStage;
  clipIndex: number; // 1..15
} {
  const lvl = Math.max(1, Math.min(150, Math.floor(level || 1)));
  const band = BANDS.find((b) => lvl >= b.fromLevel && lvl <= b.toLevel) ?? BANDS[0];
  const span = band.toLevel - band.fromLevel + 1;
  const rel = lvl - band.fromLevel;
  // Distribute the band's levels evenly across its clips so every clip is used.
  const idx = Math.min(band.clips.length - 1, Math.floor((rel / span) * band.clips.length));
  const clipIndex = band.clips[idx];
  return { url: ALL[clipIndex - 1].url, stage: band.stage, clipIndex };
}
