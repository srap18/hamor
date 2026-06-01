import celestialColosseumBg from "@/assets/bg-celestial-colosseum.png";
import celestialColosseumBurnedBg from "@/assets/bg-celestial-colosseum-burned.png";
import eiffelNightBg from "@/assets/bg-eiffel-night.png";
import eiffelNightBurnedBg from "@/assets/bg-eiffel-night-burned.png";
import crystalKingdomBg from "@/assets/bg-crystal-kingdom.png.asset.json";
import crystalKingdomBurnedBg from "@/assets/bg-crystal-kingdom-burned.png.asset.json";
import celestialColosseumVideo from "@/assets/bg-celestial-colosseum.mp4.asset.json";
import celestialColosseumBurnedVideo from "@/assets/bg-celestial-colosseum-burned.mp4.asset.json";
import eiffelNightVideo from "@/assets/bg-eiffel-night.mp4.asset.json";
import eiffelNightBurnedVideo from "@/assets/bg-eiffel-night-burned.mp4.asset.json";

export type SceneBg = {
  id: string;
  name: string;
  burnedName: string;
  price: number;
  currency?: "coins" | "gems";
  rarity: "common" | "rare" | "epic" | "legendary";
  image: string;
  burnedImage: string;
  video?: string;
  burnedVideo?: string;
  animated?: boolean;
  objectPosition?: string;
  seaSide: "left" | "right";
  waterTop: number;
  waterLeft: number;
  waterRight: number;
  shipSlots?: { top: number; left: number; scale: number }[];
  motion?: {
    scale?: number;
    x?: string;
    y?: string;
    duration?: string;
  };
};

// Unified ship slots — same layout for every background so all 30 ships
// share the exact same on-screen positions, scale, and motion behavior.
// Ships float centered horizontally and slightly above the lower third
// to stay clearly visible without overlapping the bottom UI.
// Stacked vertically along the shore — same horizontal position, evenly
// spaced top-to-bottom, identical scale. Matches the reference layout
// where docked ships form a clean vertical column at the marina.
const UNIFIED_SHIP_SLOTS = [
  { top: 46, left: 44, scale: 0.9 },
  { top: 52, left: 38, scale: 1.4 },
  { top: 63, left: 44, scale: 1.4 },
] as const;

const CELESTIAL_SLOTS = UNIFIED_SHIP_SLOTS;
const EIFFEL_SLOTS = UNIFIED_SHIP_SLOTS;

export const BACKGROUNDS: SceneBg[] = [
  {
    id: "celestial_colosseum",
    name: "الكولوسيوم السماوي ✨",
    burnedName: "الكولوسيوم السماوي المحترق 🔥",
    price: 0,
    rarity: "legendary",
    image: celestialColosseumBg,
    burnedImage: celestialColosseumBurnedBg,
    video: celestialColosseumVideo.url,
    burnedVideo: celestialColosseumBurnedVideo.url,
    animated: true,
    objectPosition: "center center",
    seaSide: "right",
    waterTop: 48,
    waterLeft: 40,
    waterRight: 95,
    shipSlots: [...CELESTIAL_SLOTS],
    motion: { scale: 1.18, x: "-1.2%", y: "-1%", duration: "8s" },
  },
  {
    id: "eiffel_night",
    name: "برج الليل الباريسي ✨",
    burnedName: "برج الليل الباريسي المحترق 🔥",
    price: 10000,
    currency: "gems",
    rarity: "legendary",
    image: eiffelNightBg,
    burnedImage: eiffelNightBurnedBg,
    video: eiffelNightVideo.url,
    burnedVideo: eiffelNightBurnedVideo.url,
    animated: true,
    objectPosition: "center center",
    seaSide: "right",
    waterTop: 44,
    waterLeft: 42,
    waterRight: 96,
    shipSlots: [...EIFFEL_SLOTS],
    motion: { scale: 1.18, x: "-1%", y: "-0.6%", duration: "8s" },
  },
  {
    id: "crystal_kingdom",
    name: "مملكة البلور الذهبية ✨",
    burnedName: "مملكة البلور المحترقة 🔥",
    price: 10000,
    currency: "gems",
    rarity: "legendary",
    image: crystalKingdomBg.url,
    burnedImage: crystalKingdomBurnedBg.url,
    animated: true,
    objectPosition: "center center",
    seaSide: "right",
    waterTop: 45,
    waterLeft: 40,
    waterRight: 96,
    shipSlots: [...UNIFIED_SHIP_SLOTS],
    motion: { scale: 1.18, x: "-1.2%", y: "-0.8%", duration: "9s" },
  },
];

const STORE_KEY = "ocean.bg.selected";
const OWNED_KEY = "ocean.bg.owned";
const DEFAULT_BG_ID = BACKGROUNDS[0].id;

export function getSelectedBgId(): string {
  if (typeof window === "undefined") return DEFAULT_BG_ID;
  return window.localStorage.getItem(STORE_KEY) || DEFAULT_BG_ID;
}

export function setSelectedBgId(id: string) {
  if (typeof window === "undefined") return;
  const safeId = BACKGROUNDS.some((b) => b.id === id) ? id : DEFAULT_BG_ID;
  window.localStorage.setItem(STORE_KEY, safeId);
  import("@/integrations/supabase/client").then(({ supabase }) => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
      if (uid) supabase.from("profiles").update({ selected_bg_id: safeId }).eq("id", uid).then(() => {});
    });
  });
}

export function getOwnedBgIds(): string[] {
  if (typeof window === "undefined") return [DEFAULT_BG_ID];
  try {
    const raw = window.localStorage.getItem(OWNED_KEY);
    if (!raw) return [DEFAULT_BG_ID];
    const arr = JSON.parse(raw);
    const valid = Array.isArray(arr) ? arr.filter((id): id is string => BACKGROUNDS.some((b) => b.id === id)) : [];
    return Array.from(new Set([DEFAULT_BG_ID, ...valid]));
  } catch {
    return [DEFAULT_BG_ID];
  }
}

export function setOwnedBgIds(ids: string[]) {
  if (typeof window === "undefined") return;
  const valid = ids.filter((id) => BACKGROUNDS.some((b) => b.id === id));
  window.localStorage.setItem(OWNED_KEY, JSON.stringify(Array.from(new Set([DEFAULT_BG_ID, ...valid]))));
}

export function bgById(id: string): SceneBg {
  return BACKGROUNDS.find((b) => b.id === id) || BACKGROUNDS[0];
}

export function isBgBurned(burnedUntil?: string | null) {
  if (!burnedUntil) return false;
  const until = new Date(burnedUntil).getTime();
  return Number.isFinite(until) && until > Date.now();
}

export function getSceneVisual(bgId: string, burnedUntil?: string | null) {
  const bg = bgById(bgId);
  const burned = isBgBurned(burnedUntil);
  return {
    ...bg,
    displayName: burned ? bg.burnedName : bg.name,
    displayImage: burned ? bg.burnedImage : bg.image,
    displayVideo: burned ? bg.burnedVideo : bg.video,
    burned,
  };
}
