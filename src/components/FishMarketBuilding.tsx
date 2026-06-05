import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { sound } from "@/lib/sound";
import { serverNowMs } from "@/lib/server-time";
import unifiedImg from "@/assets/buildings/fishmarket-t10.png";
import burnedImg from "@/assets/buildings/fishmarket-burned.png";

// Unified luxurious fish market — one shape for all levels.
function tierImage(_level: number): string {
  return unifiedImg;
}

export function FishMarketBuilding({
  level,
  burnedUntil,
  style,
  flip,
}: {
  level: number;
  burnedUntil?: string | null;
  style?: React.CSSProperties;
  flip?: boolean;
}) {
  const [now, setNow] = useState(() => serverNowMs());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNowMs()), 30_000);
    return () => clearInterval(t);
  }, []);

  const isBurned = useMemo(() => {
    if (!burnedUntil) return false;
    const ends = new Date(burnedUntil).getTime();
    return isFinite(ends) && ends > now;
  }, [burnedUntil, now]);

  const img = isBurned ? burnedImg : tierImage(level);
  const clampedLevel = Math.max(1, Math.min(30, Math.floor(level || 1)));

  // Per-tier vertical offset so every level sits flush on the ground
  // (compensates for transparent padding differences between tier images)
  const tierOffsetPct = 0;

  const smokes = useMemo(
    () =>
      Array.from({ length: 4 }, (_, i) => ({
        key: i,
        left: 18 + i * 22,
        size: 38 + (i % 3) * 12,
        dur: 6 + (i % 3) * 1.5,
        delay: -(i * 1.4),
      })),
    [],
  );

  return (
    <div className="absolute z-[8] pointer-events-none" style={{ ...style }}>
      <Link
        to="/fish-market"
        onClick={() => sound.play("click")}
        aria-label="سوق السمك"
        className="group block w-full h-full pointer-events-auto active:scale-95 transition-transform"
      >
        <div className="relative w-full h-full">
          <img
            src={img}
            alt=""
            loading="eager" decoding="async" fetchPriority="high"
            draggable={false}
            className="w-full h-full object-contain object-bottom select-none"
            style={{
              transform: `${flip ? "scaleX(-1) " : ""}translateY(${tierOffsetPct}%)`,
              filter: isBurned
                ? "saturate(0.6) brightness(0.85) contrast(1.1)"
                : undefined,
            }}
          />


          {isBurned && (
            <div className="absolute inset-0 pointer-events-none overflow-visible">
              {smokes.map((s) => (
                <div
                  key={s.key}
                  className="absolute bottom-[40%] rounded-full animate-smoke-rise"
                  style={{
                    left: `${s.left}%`,
                    width: s.size,
                    height: s.size,
                    background:
                      "radial-gradient(circle, rgba(80,80,80,0.85) 0%, rgba(40,40,40,0.5) 45%, rgba(0,0,0,0) 75%)",
                    animationDuration: `${s.dur}s`,
                    animationDelay: `${s.delay}s`,
                    filter: "blur(2px)",
                  }}
                />
              ))}
              <div
                className="absolute left-[20%] right-[20%] bottom-[20%] h-[30%] rounded-full blur-xl"
                style={{
                  background:
                    "radial-gradient(ellipse, rgba(255,90,20,0.55), rgba(255,50,0,0) 70%)",
                  animation: "pulse 1.6s ease-in-out infinite",
                }}
              />
            </div>
          )}

          <div
            className={`absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-md text-[9px] font-bold border whitespace-nowrap opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity ${
              isBurned
                ? "bg-red-950/80 border-red-400/60 text-red-100"
                : "bg-black/60 border-cyan-300/60 text-cyan-100"
            }`}
            style={{ textShadow: "0 1px 2px rgba(0,0,0,0.9)" }}
          >
            {isBurned ? "🔥 محترق" : `🐟 L${clampedLevel}/30`}
          </div>
        </div>
      </Link>
    </div>
  );
}
