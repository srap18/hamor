// Curated ad-bomb videos. Hardcoded list so attackers can only pick from
// pre-approved clips (prevents NSFW uploads). Add/replace via this file.
//
// Use transparent / well-cropped MP4s. They render with mix-blend-screen
// over the harbor scene at ~80% opacity.
export type AdVideo = {
  key: string;
  label: string;
  emoji: string;
  src: string;
};

export const AD_VIDEOS: AdVideo[] = [
  {
    key: "rickroll",
    label: "ريك رول 🕺",
    emoji: "🎤",
    src: "https://cdn.pixabay.com/video/2023/10/13/184763-873187948_large.mp4",
  },
  {
    key: "dance",
    label: "رقصة احتفال 💃",
    emoji: "💃",
    src: "https://cdn.pixabay.com/video/2022/03/22/111481-690209744_large.mp4",
  },
  {
    key: "money",
    label: "مطر فلوس 💸",
    emoji: "💸",
    src: "https://cdn.pixabay.com/video/2020/09/08/49375-457948203_large.mp4",
  },
];

export const getAdVideo = (key: string): AdVideo | undefined =>
  AD_VIDEOS.find((v) => v.key === key);
