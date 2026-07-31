import { ReactNode } from "react";

// Premium image-based seasonal frames — matches the shop's luxury frame style,
// with extra aura pulse, sweeping shine and bobbing crown to feel one tier above.

import luxNeon      from "@/assets/frames/lux-neon.webp";
import luxAurora    from "@/assets/frames/lux-aurora.webp";
import luxEmerald   from "@/assets/frames/lux-emerald.webp";
import luxObsidian  from "@/assets/frames/lux-obsidian.webp";
import luxDragon    from "@/assets/frames/lux-dragon.webp";
import luxSakura    from "@/assets/frames/lux-sakura.webp";
import luxDiamond   from "@/assets/frames/lux-diamond.webp";
import luxRoyal     from "@/assets/frames/lux-royal.webp";
import luxCelestial from "@/assets/frames/lux-celestial.webp";
import luxImperial  from "@/assets/frames/lux-imperial.webp";

export type SeasonFrame = {
  tier: number;
  name: string;
  englishName: string;
  threshold: number;
  imageUrl: string;
  animClass: string;   // premium 3D CSS animation class from styles.css
  glowColor: string;
  auraColor: string;
  crown?: string;
};

export const SEASON_FRAMES: SeasonFrame[] = [
  { tier: 1,  name: "إطار النار",        englishName: "Fire",        threshold: 100_000_000, imageUrl: luxNeon,      animClass: "frame-anim-neon",     glowColor: "rgba(255,90,0,0.85)",   auraColor: "rgba(255,80,0,0.35)",  crown: "🔥" },
  { tier: 2,  name: "إطار البرق",        englishName: "Lightning",   threshold: 200_000_000, imageUrl: luxAurora,    animClass: "frame-anim-aurora",   glowColor: "rgba(0,229,255,0.9)",   auraColor: "rgba(0,180,255,0.4)",  crown: "⚡" },
  { tier: 3,  name: "إطار الأمواج",      englishName: "Wave",        threshold: 300_000_000, imageUrl: luxEmerald,   animClass: "frame-anim-emerald",  glowColor: "rgba(0,200,140,0.9)",   auraColor: "rgba(0,180,140,0.4)",  crown: "🌊" },
  { tier: 4,  name: "إطار الجمجمة",      englishName: "Skull",       threshold: 400_000_000, imageUrl: luxObsidian,  animClass: "frame-anim-obsidian", glowColor: "rgba(200,200,220,0.8)", auraColor: "rgba(120,120,150,0.4)", crown: "💀" },
  { tier: 5,  name: "إطار التنين",       englishName: "Dragon",      threshold: 500_000_000, imageUrl: luxDragon,    animClass: "frame-anim-royal",    glowColor: "rgba(255,60,60,0.95)",  auraColor: "rgba(180,20,20,0.5)",  crown: "🐲" },
  { tier: 6,  name: "إطار البركان",      englishName: "Volcano",     threshold: 600_000_000, imageUrl: luxSakura,    animClass: "frame-anim-sakura",   glowColor: "rgba(255,110,0,0.95)",  auraColor: "rgba(210,80,0,0.55)",  crown: "🌋" },
  { tier: 7,  name: "إطار الماس",        englishName: "Diamond",     threshold: 700_000_000, imageUrl: luxDiamond,   animClass: "frame-anim-diamond",  glowColor: "rgba(179,229,252,1)",   auraColor: "rgba(140,200,255,0.55)", crown: "💎" },
  { tier: 8,  name: "إطار التاج",        englishName: "Crown",       threshold: 800_000_000, imageUrl: luxRoyal,     animClass: "frame-anim-royal",    glowColor: "rgba(255,193,7,1)",     auraColor: "rgba(255,180,0,0.55)", crown: "👑" },
  { tier: 9,  name: "الطاقة الأسطورية",  englishName: "Legendary",   threshold: 900_000_000, imageUrl: luxCelestial, animClass: "frame-anim-aurora",   glowColor: "rgba(255,64,129,1)",    auraColor: "rgba(200,50,200,0.6)", crown: "✨" },
  { tier: 10, name: "ملك القراصنة",      englishName: "Pirate King", threshold: 1_000_000_000, imageUrl: luxImperial,  animClass: "frame-anim-imperial", glowColor: "rgba(255,215,0,1)",     auraColor: "rgba(255,180,0,0.75)", crown: "🏴‍☠️👑" },
];

export function frameForDamage(damage: number | bigint): SeasonFrame | null {
  const d = typeof damage === "bigint" ? Number(damage) : Number(damage || 0);
  let best: SeasonFrame | null = null;
  for (const f of SEASON_FRAMES) if (d >= f.threshold) best = f;
  return best;
}

/**
 * SeasonFrameRing — premium image frame wrapping `children` (avatar).
 * Matches the shop's luxury frame aesthetic with extra season-only flair:
 * outer aura pulse, sweeping shine and a bobbing crown.
 */
export function SeasonFrameRing({
  frame,
  size = 96,
  children,
  showCrown = true,
  intense = false,
}: {
  frame: SeasonFrame | null;
  size?: number;
  children: ReactNode;
  showCrown?: boolean;
  intense?: boolean;
}) {
  if (!frame) {
    return (
      <div style={{ width: size, height: size }} className="relative flex items-center justify-center">
        <div className="rounded-full overflow-hidden ring-2 ring-slate-500/50" style={{ width: size * 0.82, height: size * 0.82 }}>
          {children}
        </div>
      </div>
    );
  }

  // Avatar occupies ~66% of the frame diameter (image includes decorative ring padding)
  const innerSize = Math.round(size * 0.66);

  return (
    <div
      style={{
        width: size,
        height: size,
        filter: `drop-shadow(0 0 ${intense ? 20 : 12}px ${frame.glowColor})`,
      }}
      className="relative flex items-center justify-center"
    >
      {/* Outer aura pulse */}
      <div
        className="absolute inset-0 rounded-full animate-pulse pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${frame.auraColor} 0%, transparent 68%)`,
          animationDuration: "2.4s",
        }}
      />

      {/* Avatar (inner content) */}
      <div
        className="absolute rounded-full overflow-hidden bg-black/40"
        style={{
          width: innerSize,
          height: innerSize,
          left: `calc(50% - ${innerSize / 2}px)`,
          top: `calc(50% - ${innerSize / 2}px)`,
        }}
      >
        {children}
      </div>

      {/* Premium frame image on top with luxury animation */}
      <img
        src={frame.imageUrl}
        alt=""
        aria-hidden
        draggable={false}
        className={`absolute inset-0 w-full h-full pointer-events-none select-none ${frame.animClass}`}
        style={{ objectFit: "contain" }}
      />

      {/* Sweeping shine overlay — season-only extra flair */}
      <div
        className="absolute inset-0 rounded-full pointer-events-none overflow-hidden"
        style={{ mixBlendMode: "screen" }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: `conic-gradient(from 0deg, transparent 0deg, ${frame.glowColor} 18deg, transparent 55deg, transparent 360deg)`,
            animation: `season-shine ${frame.tier >= 8 ? 3.5 : 5}s linear infinite`,
            opacity: 0.55,
            maskImage: "radial-gradient(circle, transparent 34%, black 46%, black 50%, transparent 52%)",
            WebkitMaskImage: "radial-gradient(circle, transparent 34%, black 46%, black 50%, transparent 52%)",
          }}
        />
      </div>

      {/* Crown emblem — season-only badge */}
      {showCrown && frame.crown && (
        <div
          className="absolute -top-2 left-1/2 -translate-x-1/2 z-20 text-center pointer-events-none"
          style={{
            fontSize: Math.round(size * 0.28),
            filter: `drop-shadow(0 0 8px ${frame.glowColor})`,
            animation: "season-bob 2.6s ease-in-out infinite",
          }}
        >
          {frame.crown}
        </div>
      )}
    </div>
  );
}

// Global keyframes — injected once (only season-only extras; frame-anim-* live in styles.css)
if (typeof document !== "undefined" && !document.getElementById("season-frames-kf")) {
  const style = document.createElement("style");
  style.id = "season-frames-kf";
  style.textContent = `
@keyframes season-shine { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes season-bob { 0%,100% { transform: translate(-50%, 0) rotate(-4deg); } 50% { transform: translate(-50%, -4px) rotate(4deg); } }
`;
  document.head.appendChild(style);
}
