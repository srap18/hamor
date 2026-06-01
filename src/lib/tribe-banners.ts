import b1 from "@/assets/tribe-banner-1.png.asset.json";
import b2 from "@/assets/tribe-banner-2.png.asset.json";
import b3 from "@/assets/tribe-banner-3.png.asset.json";
import b4 from "@/assets/tribe-banner-4.png.asset.json";
import b5 from "@/assets/tribe-banner-5.png.asset.json";
import b6 from "@/assets/tribe-banner-6.png.asset.json";
import b7 from "@/assets/tribe-banner-7.png.asset.json";
import b8 from "@/assets/tribe-banner-8.png.asset.json";
import b9 from "@/assets/tribe-banner-9.png.asset.json";
import b10 from "@/assets/tribe-banner-10.png.asset.json";

import e1 from "@/assets/tribe-emblem-1.png.asset.json";
import e2 from "@/assets/tribe-emblem-2.png.asset.json";
import e3 from "@/assets/tribe-emblem-3.png.asset.json";
import e4 from "@/assets/tribe-emblem-4.png.asset.json";
import e5 from "@/assets/tribe-emblem-5.png.asset.json";
import e6 from "@/assets/tribe-emblem-6.png.asset.json";
import e7 from "@/assets/tribe-emblem-7.png.asset.json";
import e8 from "@/assets/tribe-emblem-8.png.asset.json";
import e9 from "@/assets/tribe-emblem-9.png.asset.json";
import e10 from "@/assets/tribe-emblem-10.png.asset.json";

import f1 from "@/assets/tribe-frame-1.png.asset.json";
import f2 from "@/assets/tribe-frame-2.png.asset.json";
import f3 from "@/assets/tribe-frame-3.png.asset.json";
import f4 from "@/assets/tribe-frame-4.png.asset.json";
import f5 from "@/assets/tribe-frame-5.png.asset.json";
import f6 from "@/assets/tribe-frame-6.png.asset.json";
import f7 from "@/assets/tribe-frame-7.png.asset.json";
import f8 from "@/assets/tribe-frame-8.png.asset.json";
import f9 from "@/assets/tribe-frame-9.png.asset.json";
import f10 from "@/assets/tribe-frame-10.png.asset.json";

export type TribeBannerTier = {
  level: number;
  name: string;
  url: string;
  emblemUrl: string;
  frameUrl: string;
  glow: string;
};

export const TRIBE_BANNER_TIERS: TribeBannerTier[] = [
  { level: 1,  name: "خشبية",   url: b1.url,  emblemUrl: e1.url,  frameUrl: f1.url,  glow: "amber-900/40" },
  { level: 2,  name: "حديدية",  url: b2.url,  emblemUrl: e2.url,  frameUrl: f2.url,  glow: "slate-400/40" },
  { level: 3,  name: "برونزية", url: b3.url,  emblemUrl: e3.url,  frameUrl: f3.url,  glow: "orange-500/40" },
  { level: 4,  name: "فضية",    url: b4.url,  emblemUrl: e4.url,  frameUrl: f4.url,  glow: "sky-300/40" },
  { level: 5,  name: "ذهبية",   url: b5.url,  emblemUrl: e5.url,  frameUrl: f5.url,  glow: "amber-400/60" },
  { level: 6,  name: "ياقوتية زرقاء", url: b6.url, emblemUrl: e6.url, frameUrl: f6.url, glow: "blue-400/60" },
  { level: 7,  name: "زمردية",  url: b7.url,  emblemUrl: e7.url,  frameUrl: f7.url,  glow: "emerald-400/60" },
  { level: 8,  name: "ياقوتية حمراء", url: b8.url, emblemUrl: e8.url, frameUrl: f8.url, glow: "rose-500/70" },
  { level: 9,  name: "ماسية",   url: b9.url,  emblemUrl: e9.url,  frameUrl: f9.url,  glow: "cyan-200/70" },
  { level: 10, name: "كونية",   url: b10.url, emblemUrl: e10.url, frameUrl: f10.url, glow: "fuchsia-400/80" },
];

export function getTribeBanner(level: number | null | undefined): TribeBannerTier {
  const lv = Math.max(1, Math.min(10, Math.floor(level || 1)));
  return TRIBE_BANNER_TIERS[lv - 1];
}
