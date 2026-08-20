// Curated ad-bomb videos. Hardcoded list so attackers can only pick from
// pre-approved clips (prevents NSFW uploads).
import doomAdAsset from "@/assets/doom-annihilator-ad.mp4.asset.json";

export type AdVideo = {
  key: string;
  label: string;
  emoji: string;
  src: string;
  /** Not selectable in the ad-bomb picker (used by a specific weapon). */
  hidden?: boolean;
};

export const AD_VIDEOS: AdVideo[] = [

  {
    key: "jack_sparrow",
    label: "جاك سبارو 🏴‍☠️",
    emoji: "🏴‍☠️",
    src: "/ads/jack-sparrow.mp4",
  },
  {
    key: "luffy_king",
    label: "لوفي ملك القراصنة ☠️",
    emoji: "☠️",
    src: "/ads/luffy-king.mp4",
  },
  {
    key: "luffy_fakhama",
    label: "فخامة لوفي 🔥",
    emoji: "🔥",
    src: "/ads/luffy-fakhama.mp4",
  },
  {
    key: "luffy_sata_khaf_alanam",
    label: "وإذا سطا خاف الأنام 👑",
    emoji: "👑",
    src: "/__l5e/assets-v1/ff8d99d4-a6ff-4a3c-baf4-070dbe3be36f/luffy-pirate-king.mp4",
  },
  {
    key: "doom_annihilator",
    label: "صاعقة الفناء ☄️",
    emoji: "☄️",
    src: doomAdAsset.url,
    hidden: true,
  },
];

export const getAdVideo = (key: string): AdVideo | undefined =>
  AD_VIDEOS.find((v) => v.key === key);

