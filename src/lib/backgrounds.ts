import harborBg from "@/assets/harbor-bg.jpg";
import sunsetBg from "@/assets/bg-sunset.jpg";
import tropicalBg from "@/assets/bg-tropical.jpg";
import arcticBg from "@/assets/bg-arctic.jpg";
import nightBg from "@/assets/bg-night.jpg";
import cursedBg from "@/assets/bg-cursed.jpg";
import volcanoBg from "@/assets/bg-volcano.jpg";
import royalBg from "@/assets/bg-royal.jpg";
import harborVideo from "@/assets/harbor-bg.mp4.asset.json";
import sunsetVideo from "@/assets/bg-sunset.mp4.asset.json";
import nightVideo from "@/assets/bg-night.mp4.asset.json";
import volcanoVideo from "@/assets/bg-volcano.mp4.asset.json";
import royalVideo from "@/assets/bg-royal.mp4.asset.json";
import tropicalVideo from "@/assets/bg-tropical.mp4.asset.json";
import arcticVideo from "@/assets/bg-arctic.mp4.asset.json";
import cursedVideo from "@/assets/bg-cursed.mp4.asset.json";

export type SceneBg = {
  id: string;
  name: string;
  price: number;
  rarity: "common" | "rare" | "epic" | "legendary";
  image: string;
  video?: string;
  animated?: boolean;
  /** Open-water region (% of mobile viewport) where ships are allowed to sit.
   *  Calibrated per background by visually inspecting the cropped mobile scene
   *  so ships never overlap with shore, docks, rocks, or buildings. */
  waterTop: number;     // top edge of the sea
  waterLeft: number;    // left edge of clear water
  waterRight: number;   // right edge of clear water
  shipSlots?: { top: number; left: number; scale: number }[];
};

export const BACKGROUNDS: SceneBg[] = [
  { id: "harbor",   name: "الميناء الكلاسيكي ✨", price: 0,        rarity: "common",    image: harborBg,   video: harborVideo.url,   animated: true, waterTop: 45, waterLeft: 35, waterRight: 78 },
  { id: "sunset",   name: "غروب ذهبي ✨",         price: 25000,    rarity: "rare",      image: sunsetBg,   video: sunsetVideo.url,   animated: true, waterTop: 48, waterLeft: 38, waterRight: 78 },
  { id: "tropical", name: "جنه استوائيه ✨",      price: 60000,    rarity: "rare",      image: tropicalBg, video: tropicalVideo.url, animated: true, waterTop: 42, waterLeft: 30, waterRight: 70 },
  { id: "arctic",   name: "بحر القطب ✨",         price: 150000,   rarity: "epic",      image: arcticBg,   video: arcticVideo.url,   animated: true, waterTop: 50, waterLeft: 32, waterRight: 80 },
  { id: "night",    name: "ليل القمر ✨",         price: 280000,   rarity: "epic",      image: nightBg,    video: nightVideo.url,    animated: true, waterTop: 50, waterLeft: 15, waterRight: 55 },
  { id: "cursed",   name: "الميناء الملعون ✨",   price: 500000,   rarity: "legendary", image: cursedBg,   video: cursedVideo.url,   animated: true, waterTop: 55, waterLeft: 30, waterRight: 75 },
  { id: "volcano",  name: "خليج البركان ✨",      price: 1200000,  rarity: "legendary", image: volcanoBg,  video: volcanoVideo.url,  animated: true, waterTop: 50, waterLeft: 40, waterRight: 78 },
  { id: "royal",    name: "ميناء الإمبراطور ✨",  price: 3500000,  rarity: "legendary", image: royalBg,    video: royalVideo.url,    animated: true, waterTop: 48, waterLeft: 54, waterRight: 82,
    shipSlots: [
      { top: 50, left: 58, scale: 0.77 },
      { top: 62, left: 66, scale: 0.92 },
      { top: 63, left: 70, scale: 1.07 },
    ] },
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
