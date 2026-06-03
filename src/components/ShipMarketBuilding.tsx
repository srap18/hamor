import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { sound } from "@/lib/sound";
import { serverNowMs } from "@/lib/server-time";
import t1 from "@/assets/buildings/shipyard-t1.png";
import t2 from "@/assets/buildings/shipyard-t2.png";
import t3 from "@/assets/buildings/shipyard-t3.png";
import t4 from "@/assets/buildings/shipyard-t4.png";
import t5 from "@/assets/buildings/shipyard-t5.png";
import burnedImg from "@/assets/buildings/shipyard-burned.png";

/**
 * Animated in-world Ship Market building.
 *
 * - Tier image is picked from the player's market level (1..30):
 *     L1-6   → wooden dock
 *     L7-12  → stone harbor
 *     L13-18 → ornate copper-domed shipyard
 *     L19-24 → royal sapphire fortress
 *     L25-30 → legendary golden palace
 * - When `burnedUntil` is in the future, the burned ruins image replaces
 *   the building and animated smoke/embers float above it.
 * - Click navigates to /ship-market.
 */
function tierImage(level: number): string {
  const lvl = Math.max(1, Math.min(30, Math.floor(level || 1)));
  if (lvl <= 6) return t1;
  if (lvl <= 12) return t2;
  if (lvl <= 18) return t3;
  if (lvl <= 24) return t4;
  return t5;
}

export function ShipMarketBuilding({
  level,
  burnedUntil,
  style,
}: {
  level: number;
  burnedUntil?: string | null;
  style?: React.CSSProperties;
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

  // Pre-baked smoke specs (stable across renders)
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
    <Link
      to="/ship-market"
      onClick={() => sound.play("click")}
      aria-label="سوق السفن"
      className="absolute z-[14] group active:scale-95"
      style={{ ...style }}
    >
      <div className="relative w-full h-full">
        {/* Subtle reflection on the water below the structure */}
        <div
          aria-hidden
          className="absolute left-[12%] right-[12%] -bottom-[6%] h-[16%] rounded-[50%] blur-md opacity-60 pointer-events-none"
          style={{
            background: isBurned
              ? "radial-gradient(ellipse, rgba(220,40,10,0.55), rgba(0,0,0,0) 70%)"
              : "radial-gradient(ellipse, rgba(120,220,255,0.55), rgba(0,0,0,0) 70%)",
          }}
        />

        {/* Building image */}
        <img
          src={img}
          alt=""
          loading="lazy"
          draggable={false}
          className="w-full h-full object-contain select-none drop-shadow-[0_8px_18px_rgba(0,0,0,0.55)] animate-float-soft"
          style={{
            filter: isBurned
              ? "saturate(0.6) brightness(0.85) contrast(1.1)"
              : `drop-shadow(0 0 ${6 + clampedLevel}px rgba(252,191,73,${0.18 + clampedLevel * 0.012}))`,
          }}
        />

        {/* Burned smoke columns */}
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
            {/* Glowing embers tint */}
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

        {/* Level badge */}
        <div
          className={`absolute -top-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md text-[10px] font-black border shadow-lg whitespace-nowrap ${
            isBurned
              ? "bg-gradient-to-b from-red-900 to-black border-red-400/70 text-red-100"
              : "bg-gradient-to-b from-amber-700 to-amber-950 border-amber-300 text-amber-100"
          }`}
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}
        >
          {isBurned ? "🔥 محترق" : `⚓ سوق السفن · L${clampedLevel}/30`}
        </div>
      </div>
    </Link>
  );
}
