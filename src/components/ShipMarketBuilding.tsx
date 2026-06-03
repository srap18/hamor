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
    <div
      className="absolute z-[8] pointer-events-none"
      style={{ ...style }}
    >
      <Link
        to="/ship-market"
        onClick={() => sound.play("click")}
        aria-label="سوق السفن"
        className="group block w-full h-full pointer-events-auto active:scale-95 transition-transform"
      >
      <div className="relative w-full h-full">
        {/* Simple small label — just text, no frame */}
        <div
          className="absolute left-1/2 -translate-x-1/2 pointer-events-none z-10 whitespace-nowrap text-[9px] font-bold text-amber-200"
          style={{
            bottom: "6%",
            textShadow:
              "0 1px 2px rgba(0,0,0,0.95), 0 0 4px rgba(0,0,0,0.8)",
          }}
        >
          ⚓ سوق السفن
        </div>



        {/* Sandy ground shadow — anchors the building to the beach */}
        <div
          aria-hidden
          className="absolute left-[10%] right-[10%] bottom-[2%] h-[10%] rounded-[50%] blur-md pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 70%)",
          }}
        />

        {/* Building image — flipped to face the sea (right) */}
        <img
          src={img}
          alt=""
          loading="lazy"
          draggable={false}
          className="w-full h-full object-contain object-bottom select-none"
          style={{
            transform: "scaleX(-1)",
            filter: isBurned
              ? "saturate(0.6) brightness(0.85) contrast(1.1) drop-shadow(0 6px 6px rgba(0,0,0,0.5))"
              : `drop-shadow(0 6px 6px rgba(0,0,0,0.45)) drop-shadow(0 0 ${4 + clampedLevel * 0.5}px rgba(252,191,73,${0.12 + clampedLevel * 0.008}))`,
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

        {/* Subtle level pill — appears only on tap/hover so the building blends with the scene */}
        <div
          className={`absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-md text-[9px] font-bold border whitespace-nowrap opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity ${
            isBurned
              ? "bg-red-950/80 border-red-400/60 text-red-100"
              : "bg-black/60 border-amber-300/60 text-amber-100"
          }`}
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.9)" }}
        >
          {isBurned ? "🔥 محترق" : `⚓ L${clampedLevel}/30`}
        </div>
      </div>
      </Link>
    </div>
  );
}
