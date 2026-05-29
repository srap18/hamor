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
  /** CSS object-position for the bg image/video. Tuned per scene so the
   *  visible mobile crop is dominated by OPEN WATER. */
  objectPosition?: string;
  /** Open-water region (% of mobile viewport) where ships are allowed to sit. */
  waterTop: number;
  waterLeft: number;
  waterRight: number;
  /** Three calibrated ship docking positions on visible open water (no land,
   *  no docks, no buildings, no bridges). Index 0 = far/small, 2 = near/big. */
  shipSlots?: { top: number; left: number; scale: number }[];
};

// Wide water region for fallback calculations — most scenes now use the
// rightmost crop where the entire viewport is open sea.
const WIDE_WATER = { waterTop: 35, waterLeft: 8, waterRight: 92 } as const;

// Three ship slots placed deep in OPEN WATER for each scene. Coordinates are
// percentages of the mobile viewport AFTER applying the per-scene
// objectPosition crop. Verified against each background image so no ship
// touches shore, docks, rocks, bridges, icebergs, or buildings.
// رسو السفن على يسار-وسط الماء (قريب من الميناء) بحيث تبحر يميناً نحو البحر.
// مرتبة على شكل صف مائل بسيط ومتباعدة عمودياً حتى لا تتداخل، وبعيدة عن
// حافة الشاطئ اليسرى لكي لا تبدو ملتصقة بالرمل.
const SLOTS = {
  harbor:   [{ top: 40, left: 22, scale: 1.00 }, { top: 50, left: 36, scale: 1.10 }, { top: 60, left: 50, scale: 1.05 }],
  sunset:   [{ top: 54, left: 22, scale: 1.00 }, { top: 62, left: 36, scale: 1.10 }, { top: 70, left: 50, scale: 1.05 }],
  tropical: [{ top: 50, left: 22, scale: 1.00 }, { top: 58, left: 36, scale: 1.10 }, { top: 66, left: 50, scale: 1.05 }],
  arctic:   [{ top: 60, left: 22, scale: 0.95 }, { top: 68, left: 36, scale: 1.05 }, { top: 76, left: 50, scale: 1.00 }],
  night:    [{ top: 58, left: 22, scale: 1.00 }, { top: 66, left: 36, scale: 1.10 }, { top: 74, left: 50, scale: 1.05 }],
  cursed:   [{ top: 56, left: 22, scale: 1.00 }, { top: 64, left: 36, scale: 1.10 }, { top: 72, left: 50, scale: 1.05 }],
  volcano:  [{ top: 60, left: 22, scale: 1.00 }, { top: 68, left: 36, scale: 1.10 }, { top: 76, left: 50, scale: 1.05 }],
  royal:    [{ top: 56, left: 22, scale: 1.00 }, { top: 64, left: 36, scale: 1.10 }, { top: 72, left: 50, scale: 1.05 }],
  fantasy:  [{ top: 62, left: 24, scale: 0.92 }, { top: 70, left: 38, scale: 1.00 }, { top: 78, left: 52, scale: 0.95 }],
} as const;

export const BACKGROUNDS: SceneBg[] = [
  { id: "harbor",   name: "الميناء الكلاسيكي ✨", price: 0,        rarity: "common",    image: harborBg,   video: vurl(harborVideo),   animated: true, objectPosition: "left center",   shipSlots: [...SLOTS.harbor],   ...WIDE_WATER },
  { id: "sunset",   name: "غروب ذهبي ✨",         price: 25000,    rarity: "rare",      image: sunsetBg,   video: vurl(sunsetVideo),   animated: true, objectPosition: "left center",   shipSlots: [...SLOTS.sunset],   ...WIDE_WATER, waterTop: 50 },
  { id: "tropical", name: "جنه استوائيه ✨",      price: 60000,    rarity: "rare",      image: tropicalBg, video: vurl(tropicalVideo), animated: true, objectPosition: "left center",   shipSlots: [...SLOTS.tropical], ...WIDE_WATER, waterTop: 45 },
  { id: "arctic",   name: "بحر القطب ✨",         price: 150000,   rarity: "epic",      image: arcticBg,   video: vurl(arcticVideo),   animated: true, objectPosition: "center center", shipSlots: [...SLOTS.arctic],   ...WIDE_WATER, waterTop: 55 },
  { id: "night",    name: "ليل القمر ✨",         price: 280000,   rarity: "epic",      image: nightBg,    video: vurl(nightVideo),    animated: true, objectPosition: "left center",   shipSlots: [...SLOTS.night],    ...WIDE_WATER, waterTop: 55 },
  { id: "cursed",   name: "الميناء الملعون ✨",   price: 500000,   rarity: "legendary", image: cursedBg,   video: vurl(cursedVideo),   animated: true, objectPosition: "center center", shipSlots: [...SLOTS.cursed],   ...WIDE_WATER, waterTop: 50 },
  { id: "volcano",  name: "خليج البركان ✨",      price: 1200000,  rarity: "legendary", image: volcanoBg,  video: vurl(volcanoVideo),  animated: true, objectPosition: "left center",   shipSlots: [...SLOTS.volcano],  ...WIDE_WATER, waterTop: 55 },
  { id: "royal",    name: "ميناء الإمبراطور ✨",  price: 3500000,  rarity: "legendary", image: royalBg,    video: vurl(royalVideo),    animated: true, objectPosition: "left center",   shipSlots: [...SLOTS.royal],    ...WIDE_WATER, waterTop: 50 },
  { id: "fantasy",  name: "كولوسيوم الأحلام ✨",  price: 5000000,  rarity: "legendary", image: fantasyBg,  video: vurl(fantasyVideo),  animated: true, objectPosition: "center center", shipSlots: [...SLOTS.fantasy], ...WIDE_WATER, waterTop: 55 },
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
