import harborBg from "@/assets/harbor-bg.jpg";
import sunsetBg from "@/assets/bg-sunset.jpg";
import tropicalBg from "@/assets/bg-tropical.jpg";
import arcticBg from "@/assets/bg-arctic.jpg";
import nightBg from "@/assets/bg-night.jpg";
import cursedBg from "@/assets/bg-cursed.jpg";
import volcanoBg from "@/assets/bg-volcano.jpg";
import royalBg from "@/assets/bg-royal.jpg";
import harborVideo from "@/assets/harbor-bg.mp4.asset.json";
import fantasyBg from "@/assets/bg-fantasy.jpg";
import fantasyVideo from "@/assets/bg-fantasy.mp4.asset.json";
import sunsetVideo from "@/assets/bg-sunset.mp4.asset.json";
import nightVideo from "@/assets/bg-night.mp4.asset.json";
import volcanoVideo from "@/assets/bg-volcano.mp4.asset.json";
import royalVideo from "@/assets/bg-royal.mp4.asset.json";
import tropicalVideo from "@/assets/bg-tropical.mp4.asset.json";
import arcticVideo from "@/assets/bg-arctic.mp4.asset.json";
import cursedVideo from "@/assets/bg-cursed.mp4.asset.json";

// Asset URLs are served from the asset's owning project preview origin.
// Assets in the current project use a relative URL (served from same origin).
const CURRENT_PROJECT_ID = "fc1f387e-db92-4515-a5c6-90044e4e7b7a";
const vurl = (a: { url: string; project_id?: string }) => {
  if (!a.project_id || a.project_id === CURRENT_PROJECT_ID) return a.url;
  return `https://id-preview--${a.project_id}.lovable.app${a.url}`;
};

export type SceneBg = {
  id: string;
  name: string;
  price: number;
  rarity: "common" | "rare" | "epic" | "legendary";
  image: string;
  video?: string;
  animated?: boolean;
  /** CSS object-position for the bg image/video. Tuned so both the island
   *  and open sea are visible side by side. */
  objectPosition?: string;
  /** Which side of the visible viewport is OPEN SEA (and which side is the
   *  shore/island). Ships dock near shore and sail toward seaSide when
   *  fishing. */
  seaSide: "left" | "right";
  /** Open-water region (% of mobile viewport) for fallback calculations. */
  waterTop: number;
  waterLeft: number;
  waterRight: number;
  /** Calibrated docked ship positions near the shore. Ships sail toward the
   *  seaSide when fishing. Index 0 = far/small, 2 = near/big. */
  shipSlots?: { top: number; left: number; scale: number }[];
};

const WIDE_WATER = { waterTop: 35, waterLeft: 8, waterRight: 92 } as const;

// Per-scene ship docking positions near the SHORE (opposite of seaSide).
// When fishing starts, ships sail across the open water toward seaSide.
// "rightSea" scenes: shore on the LEFT  → dock left:10–26, sail toward right (sea)
// "leftSea"  scenes: shore on the RIGHT → dock left:70–86, sail toward left (sea)
const SLOTS_SHORE_LEFT = [
  { top: 50, left: 14, scale: 1.20 },
  { top: 62, left: 22, scale: 1.45 },
  { top: 76, left: 28, scale: 1.70 },
] as const;
const SLOTS_SHORE_RIGHT = [
  { top: 50, left: 78, scale: 1.20 },
  { top: 62, left: 70, scale: 1.45 },
  { top: 76, left: 64, scale: 1.70 },
] as const;


export const BACKGROUNDS: SceneBg[] = [
  { id: "harbor",   name: "الميناء الكلاسيكي ✨", price: 0,        rarity: "common",    image: harborBg,   video: vurl(harborVideo),   animated: true, objectPosition: "center center", seaSide: "right", shipSlots: [...SLOTS_SHORE_LEFT],  ...WIDE_WATER },
  { id: "sunset",   name: "غروب ذهبي ✨",         price: 25000,    rarity: "rare",      image: sunsetBg,   video: vurl(sunsetVideo),   animated: true, objectPosition: "center center", seaSide: "right", shipSlots: [...SLOTS_SHORE_LEFT],  ...WIDE_WATER, waterTop: 50 },
  { id: "tropical", name: "جنه استوائيه ✨",      price: 60000,    rarity: "rare",      image: tropicalBg, video: vurl(tropicalVideo), animated: true, objectPosition: "center center", seaSide: "right", shipSlots: [...SLOTS_SHORE_LEFT],  ...WIDE_WATER, waterTop: 45 },
  { id: "arctic",   name: "بحر القطب ✨",         price: 150000,   rarity: "epic",      image: arcticBg,   video: vurl(arcticVideo),   animated: true, objectPosition: "center center", seaSide: "right", shipSlots: [...SLOTS_SHORE_LEFT],  ...WIDE_WATER, waterTop: 55 },
  { id: "night",    name: "ليل القمر ✨",         price: 280000,   rarity: "epic",      image: nightBg,    video: vurl(nightVideo),    animated: true, objectPosition: "center center", seaSide: "right", shipSlots: [...SLOTS_SHORE_LEFT],  ...WIDE_WATER, waterTop: 55 },
  { id: "cursed",   name: "الميناء الملعون ✨",   price: 500000,   rarity: "legendary", image: cursedBg,   video: vurl(cursedVideo),   animated: true, objectPosition: "center center", seaSide: "right", shipSlots: [...SLOTS_SHORE_LEFT],  ...WIDE_WATER, waterTop: 50 },
  { id: "volcano",  name: "خليج البركان ✨",      price: 1200000,  rarity: "legendary", image: volcanoBg,  video: vurl(volcanoVideo),  animated: true, objectPosition: "center center", seaSide: "right", shipSlots: [...SLOTS_SHORE_LEFT],  ...WIDE_WATER, waterTop: 55 },
  { id: "royal",    name: "ميناء الإمبراطور ✨",  price: 3500000,  rarity: "legendary", image: royalBg,    video: vurl(royalVideo),    animated: true, objectPosition: "center center", seaSide: "right", shipSlots: [...SLOTS_SHORE_LEFT],  ...WIDE_WATER, waterTop: 50 },
  { id: "fantasy",  name: "كولوسيوم الأحلام ✨",  price: 5000000,  rarity: "legendary", image: fantasyBg,  video: vurl(fantasyVideo),  animated: true, objectPosition: "center center", seaSide: "left",  shipSlots: [...SLOTS_SHORE_RIGHT], ...WIDE_WATER, waterTop: 55 },
];




const STORE_KEY = "ocean.bg.selected";
const OWNED_KEY = "ocean.bg.owned";

export function getSelectedBgId(): string {
  if (typeof window === "undefined") return "harbor";
  return window.localStorage.getItem(STORE_KEY) || "harbor";
}
export function setSelectedBgId(id: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORE_KEY, id);
  // Best-effort persist to DB so other players see this background when visiting
  import("@/integrations/supabase/client").then(({ supabase }) => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
      if (uid) supabase.from("profiles").update({ selected_bg_id: id }).eq("id", uid).then(() => {});
    });
  });
}
export function getOwnedBgIds(): string[] {
  if (typeof window === "undefined") return ["harbor"];
  try {
    const raw = window.localStorage.getItem(OWNED_KEY);
    if (!raw) return ["harbor"];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? Array.from(new Set(["harbor", ...arr])) : ["harbor"];
  } catch {
    return ["harbor"];
  }
}
export function setOwnedBgIds(ids: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(OWNED_KEY, JSON.stringify(ids));
}

export function bgById(id: string): SceneBg {
  return BACKGROUNDS.find((b) => b.id === id) || BACKGROUNDS[0];
}
