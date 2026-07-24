import { ReactNode } from "react";

// Seasonal 3D-style frames — pure CSS/SVG (no image assets), rendered around any child (avatar).
// Frames are strictly tied to the current season and are not stored in inventory.

export type SeasonFrame = {
  tier: number;              // 0..10 (0 = none)
  name: string;              // Arabic display
  englishName: string;
  threshold: number;         // damage needed
  gradient: string;          // conic/linear gradient
  glowColor: string;         // outer glow
  particleColors: string[];  // orbiting dots
  aura: string;              // extra outer aura color
  crown?: string;            // top emblem for top tiers
};

export const SEASON_FRAMES: SeasonFrame[] = [
  { tier: 1,  name: "إطار النار",         englishName: "Fire",         threshold: 100_000_000,
    gradient: "conic-gradient(from 0deg, #ff3d00, #ffab00, #ff6f00, #ff3d00)",
    glowColor: "rgba(255,90,0,0.8)", particleColors: ["#ffb703","#ff5722","#ffea00"], aura: "rgba(255,80,0,0.4)" },
  { tier: 2,  name: "إطار البرق",         englishName: "Lightning",    threshold: 200_000_000,
    gradient: "conic-gradient(from 90deg, #00e5ff, #ffffff, #00b0ff, #00e5ff)",
    glowColor: "rgba(0,229,255,0.85)", particleColors: ["#e0f7fa","#00b0ff","#ffffff"], aura: "rgba(0,180,255,0.45)" },
  { tier: 3,  name: "إطار الأمواج",       englishName: "Wave",         threshold: 300_000_000,
    gradient: "conic-gradient(from 45deg, #006064, #26c6da, #01579b, #006064)",
    glowColor: "rgba(38,198,218,0.8)", particleColors: ["#4dd0e1","#0288d1","#b2ebf2"], aura: "rgba(0,150,180,0.4)" },
  { tier: 4,  name: "إطار الجمجمة",       englishName: "Skull",        threshold: 400_000_000,
    gradient: "conic-gradient(from 180deg, #212121, #cfd8dc, #37474f, #212121)",
    glowColor: "rgba(207,216,220,0.75)", particleColors: ["#eceff1","#90a4ae","#ffffff"], aura: "rgba(120,120,140,0.4)", crown: "💀" },
  { tier: 5,  name: "إطار التنين",        englishName: "Dragon",       threshold: 500_000_000,
    gradient: "conic-gradient(from 0deg, #b71c1c, #ff6f00, #4a148c, #b71c1c)",
    glowColor: "rgba(255,60,60,0.85)", particleColors: ["#ff5722","#ba68c8","#ffab00"], aura: "rgba(180,20,20,0.5)", crown: "🐲" },
  { tier: 6,  name: "إطار البركان",       englishName: "Volcano",      threshold: 600_000_000,
    gradient: "conic-gradient(from 270deg, #3e2723, #ff6f00, #b71c1c, #3e2723)",
    glowColor: "rgba(255,110,0,0.9)", particleColors: ["#ff9800","#ff5722","#ffea00"], aura: "rgba(210,80,0,0.55)", crown: "🌋" },
  { tier: 7,  name: "إطار الماس",         englishName: "Diamond",      threshold: 700_000_000,
    gradient: "conic-gradient(from 0deg, #b3e5fc, #ffffff, #81d4fa, #e1f5fe, #b3e5fc)",
    glowColor: "rgba(179,229,252,0.95)", particleColors: ["#ffffff","#b3e5fc","#e1f5fe"], aura: "rgba(140,200,255,0.55)", crown: "💎" },
  { tier: 8,  name: "إطار التاج",         englishName: "Crown",        threshold: 800_000_000,
    gradient: "conic-gradient(from 90deg, #ffd54f, #ff8f00, #fff59d, #ffd54f)",
    glowColor: "rgba(255,193,7,0.95)", particleColors: ["#fff59d","#ffca28","#ffd54f"], aura: "rgba(255,180,0,0.55)", crown: "👑" },
  { tier: 9,  name: "الطاقة الأسطورية",   englishName: "Legendary",    threshold: 900_000_000,
    gradient: "conic-gradient(from 0deg, #7c4dff, #ff4081, #00e5ff, #ffea00, #7c4dff)",
    glowColor: "rgba(255,64,129,0.95)", particleColors: ["#ffea00","#7c4dff","#00e5ff","#ff4081"], aura: "rgba(200,50,200,0.6)", crown: "✨" },
  { tier: 10, name: "ملك القراصنة",       englishName: "Pirate King",  threshold: 1_000_000_000,
    gradient: "conic-gradient(from 0deg, #ffd700, #ff2d00, #ffd700, #ff8f00, #ffd700)",
    glowColor: "rgba(255,215,0,1)", particleColors: ["#ffd700","#ffea00","#ff6f00","#ffffff"], aura: "rgba(255,180,0,0.75)", crown: "🏴‍☠️👑" },
];

export function frameForDamage(damage: number | bigint): SeasonFrame | null {
  const d = typeof damage === "bigint" ? Number(damage) : Number(damage || 0);
  let best: SeasonFrame | null = null;
  for (const f of SEASON_FRAMES) if (d >= f.threshold) best = f;
  return best;
}

/**
 * SeasonFrameRing — renders a rotating 3D-style ring around `children`.
 * size = outer diameter in px. children is centered.
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

  const ringThickness = Math.max(4, Math.round(size * 0.09));
  const innerSize = size - ringThickness * 2;
  const particleSize = Math.max(4, Math.round(size * 0.06));
  const particleCount = frame.tier >= 8 ? 8 : frame.tier >= 5 ? 6 : 4;

  return (
    <div
      style={{
        width: size,
        height: size,
        filter: `drop-shadow(0 0 ${intense ? 22 : 14}px ${frame.glowColor})`,
      }}
      className="relative flex items-center justify-center"
    >
      {/* Outer aura pulse */}
      <div
        className="absolute inset-0 rounded-full animate-pulse"
        style={{
          background: `radial-gradient(circle, ${frame.aura} 0%, transparent 70%)`,
          animationDuration: "2.4s",
        }}
      />

      {/* Rotating conic ring */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: frame.gradient,
          animation: `season-spin ${frame.tier >= 8 ? 6 : 9}s linear infinite`,
          maskImage: `radial-gradient(circle, transparent ${(innerSize / size) * 50}%, black ${(innerSize / size) * 50 + 1}%)`,
          WebkitMaskImage: `radial-gradient(circle, transparent ${(innerSize / size) * 50}%, black ${(innerSize / size) * 50 + 1}%)`,
        }}
      />

      {/* Counter-rotating shine ring */}
      <div
        className="absolute inset-0 rounded-full opacity-70 mix-blend-screen"
        style={{
          background: `conic-gradient(from 180deg, transparent 0deg, ${frame.glowColor} 20deg, transparent 60deg, transparent 360deg)`,
          animation: `season-spin-rev ${frame.tier >= 8 ? 3.5 : 5}s linear infinite`,
          maskImage: `radial-gradient(circle, transparent ${(innerSize / size) * 50}%, black ${(innerSize / size) * 50 + 1}%)`,
          WebkitMaskImage: `radial-gradient(circle, transparent ${(innerSize / size) * 50}%, black ${(innerSize / size) * 50 + 1}%)`,
        }}
      />

      {/* Orbiting particles */}
      {Array.from({ length: particleCount }).map((_, i) => {
        const color = frame.particleColors[i % frame.particleColors.length];
        const delay = (i / particleCount) * -6;
        return (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: particleSize,
              height: particleSize,
              left: `calc(50% - ${particleSize / 2}px)`,
              top: `calc(50% - ${particleSize / 2}px)`,
              background: color,
              boxShadow: `0 0 ${particleSize * 2}px ${color}`,
              animation: `season-orbit-${i % 3} ${6 + (i % 3)}s linear infinite`,
              animationDelay: `${delay}s`,
              transformOrigin: `${size / 2}px ${size / 2}px`,
            }}
          />
        );
      })}

      {/* Inner content */}
      <div
        className="relative z-10 rounded-full overflow-hidden bg-black/40"
        style={{ width: innerSize, height: innerSize }}
      >
        {children}
      </div>

      {/* Crown emblem */}
      {showCrown && frame.crown && (
        <div
          className="absolute -top-2 left-1/2 -translate-x-1/2 z-20 text-center"
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

// Global keyframes — injected once
if (typeof document !== "undefined" && !document.getElementById("season-frames-kf")) {
  const style = document.createElement("style");
  style.id = "season-frames-kf";
  style.textContent = `
@keyframes season-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes season-spin-rev { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
@keyframes season-bob { 0%,100% { transform: translate(-50%, 0) rotate(-4deg); } 50% { transform: translate(-50%, -4px) rotate(4deg); } }
@keyframes season-orbit-0 { from { transform: rotate(0deg) translateX(46%) rotate(0deg); } to { transform: rotate(360deg) translateX(46%) rotate(-360deg); } }
@keyframes season-orbit-1 { from { transform: rotate(120deg) translateX(50%) rotate(-120deg); } to { transform: rotate(480deg) translateX(50%) rotate(-480deg); } }
@keyframes season-orbit-2 { from { transform: rotate(240deg) translateX(42%) rotate(-240deg); } to { transform: rotate(600deg) translateX(42%) rotate(-600deg); } }
`;
  document.head.appendChild(style);
}
