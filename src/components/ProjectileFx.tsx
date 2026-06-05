import { useEffect, useRef, useState } from "react";
import explosionReal from "@/assets/fx/explosion-real.png";
import nukeReal from "@/assets/fx/nuke-real.png";
import smokeReal from "@/assets/fx/smoke-real.png";



export type FxState = {
  id: number;
  emoji: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  phase: "fly" | "boom";
  friendly?: boolean;
  weaponId?: string;
};

type Puff = { id: number; x: number; y: number; size: number };

export function ProjectileFx({ fx }: { fx: FxState }) {
  const [pos, setPos] = useState({ x: fx.fromX, y: fx.fromY });
  const [puffs, setPuffs] = useState<Puff[]>([]);
  const startRef = useRef<number>(performance.now());

  const isNuke = fx.weaponId === "nuke";
  const isLarge = fx.weaponId === "rocket_large";
  const isMed = fx.weaponId === "rocket_medium";

  const flightMs = isNuke ? 1100 : 850;
  const rocketSize = isNuke ? 64 : isLarge ? 52 : isMed ? 44 : 36;
  const boomSize = isNuke ? 340 : isLarge ? 240 : isMed ? 180 : 140;

  const angle = Math.atan2(fx.toY - fx.fromY, fx.toX - fx.fromX) * 180 / Math.PI;

  const trailColor = isNuke
    ? "rgba(180,255,120,0.95)"
    : isLarge
    ? "rgba(255,120,40,0.95)"
    : isMed
    ? "rgba(255,190,80,0.9)"
    : "rgba(255,230,140,0.9)";

  // Animate rocket flight
  useEffect(() => {
    const r = requestAnimationFrame(() => setPos({ x: fx.toX, y: fx.toY }));
    return () => cancelAnimationFrame(r);
  }, [fx.id, fx.toX, fx.toY]);

  // Emit smoke puffs along the flight path
  useEffect(() => {
    if (fx.phase !== "fly" || fx.friendly) return;
    let pid = 0;
    const interval = setInterval(() => {
      const t = Math.min(1, (performance.now() - startRef.current) / flightMs);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = fx.fromX + (fx.toX - fx.fromX) * ease + (Math.random() - 0.5) * 6;
      const y = fx.fromY + (fx.toY - fx.fromY) * ease + (Math.random() - 0.5) * 6;
      const size = rocketSize * (0.55 + Math.random() * 0.4);
      setPuffs((p) => [...p, { id: ++pid, x, y, size }].slice(-24));
    }, 40);
    return () => clearInterval(interval);
  }, [fx.id, fx.phase, fx.friendly, fx.fromX, fx.fromY, fx.toX, fx.toY, flightMs, rocketSize]);

  // Debris with 3D arc
  const debrisCount = isNuke ? 18 : isLarge ? 12 : 8;
  const debris = Array.from({ length: debrisCount }, (_, i) => {
    const ang = (i / debrisCount) * Math.PI * 2 + Math.random() * 0.4;
    const dist = (isNuke ? 180 : isLarge ? 130 : 90) + Math.random() * 50;
    return { dx: Math.cos(ang) * dist, dy: Math.sin(ang) * dist - 30, key: i };
  });

  // Smoke ring puffs around blast
  const smokeRing = Array.from({ length: isNuke ? 12 : 8 }, (_, i) => {
    const ang = (i / (isNuke ? 12 : 8)) * Math.PI * 2;
    const d = boomSize * 0.4;
    return { dx: Math.cos(ang) * d, dy: Math.sin(ang) * d * 0.6, key: i };
  });

  return (
    <div className="fixed inset-0 pointer-events-none z-[70]" style={{ perspective: "1200px" }}>
      {/* Realistic smoke trail puffs (image-based) */}
      {fx.phase === "fly" && !fx.friendly && puffs.map((p) => (
        <img
          key={p.id}
          src={smokeReal}
          alt=""
          aria-hidden
          className="absolute animate-smoke-trail-fade select-none"
          style={{
            left: p.x - p.size / 2,
            top: p.y - p.size / 2,
            width: p.size,
            height: p.size,
            opacity: 0.85,
            mixBlendMode: "normal",
            objectFit: "contain",
          }}
        />
      ))}



      {fx.phase === "fly" && (
        <div
          className="absolute"
          style={{
            left: pos.x - rocketSize / 2,
            top: pos.y - rocketSize / 2,
            width: rocketSize,
            height: rocketSize,
            transition: `left ${flightMs}ms cubic-bezier(.45,.05,.55,1), top ${flightMs}ms cubic-bezier(.45,.05,.55,1)`,
            filter: fx.friendly
              ? "drop-shadow(0 0 12px rgba(120,255,180,0.9))"
              : `drop-shadow(0 4px 8px rgba(0,0,0,0.6)) drop-shadow(0 0 18px ${trailColor})`,
            transform: fx.friendly ? "none" : `rotate(${angle}deg)`,
            transformStyle: "preserve-3d",
          }}
        >
          {!fx.friendly ? (
            <>
              {/* Thrust plume - wide outer */}
              <div
                className="absolute top-1/2 -translate-y-1/2 rounded-full blur-[8px] animate-rocket-thrust"
                style={{
                  right: "85%",
                  width: rocketSize * 1.8,
                  height: rocketSize * 0.7,
                  background: `radial-gradient(ellipse, ${trailColor} 0%, rgba(255,140,40,0.7) 35%, transparent 80%)`,
                  transformOrigin: "right center",
                }}
              />
              {/* Thrust core - hot white */}
              <div
                className="absolute top-1/2 -translate-y-1/2 rounded-full blur-[2px] animate-rocket-thrust"
                style={{
                  right: "88%",
                  width: rocketSize * 0.9,
                  height: rocketSize * 0.32,
                  background: `linear-gradient(to left, #ffffff 0%, #fff3a0 30%, ${trailColor} 80%, transparent)`,
                  transformOrigin: "right center",
                }}
              />
              {/* 3D missile body */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="relative"
                  style={{
                    width: rocketSize * 0.95,
                    height: rocketSize * 0.34,
                  }}
                >
                  {/* body shadow underside */}
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      background:
                        "linear-gradient(to bottom, #f5f5f5 0%, #d0d0d0 40%, #4a4a4a 75%, #1a1a1a 100%)",
                      boxShadow:
                        "inset 0 -3px 6px rgba(0,0,0,0.6), inset 0 2px 3px rgba(255,255,255,0.7)",
                    }}
                  />
                  {/* nose cone */}
                  <div
                    className="absolute top-0 bottom-0"
                    style={{
                      right: -rocketSize * 0.18,
                      width: rocketSize * 0.28,
                      background: isNuke
                        ? "linear-gradient(to right, #8b1a1a, #dc2626)"
                        : "linear-gradient(to right, #b91c1c, #ef4444)",
                      clipPath: "polygon(0 0, 100% 50%, 0 100%)",
                      boxShadow: "inset -2px 0 3px rgba(0,0,0,0.5)",
                    }}
                  />
                  {/* stripe */}
                  <div
                    className="absolute left-[35%] top-0 bottom-0"
                    style={{
                      width: rocketSize * 0.06,
                      background: isNuke ? "#65a30d" : "#dc2626",
                    }}
                  />
                  {/* top fin */}
                  <div
                    className="absolute left-0"
                    style={{
                      top: -rocketSize * 0.14,
                      width: rocketSize * 0.22,
                      height: rocketSize * 0.18,
                      background: "linear-gradient(to bottom, #6b7280, #374151)",
                      clipPath: "polygon(0 100%, 100% 100%, 100% 30%)",
                    }}
                  />
                  {/* bottom fin */}
                  <div
                    className="absolute left-0"
                    style={{
                      bottom: -rocketSize * 0.14,
                      width: rocketSize * 0.22,
                      height: rocketSize * 0.18,
                      background: "linear-gradient(to top, #6b7280, #374151)",
                      clipPath: "polygon(0 0, 100% 0, 100% 70%)",
                    }}
                  />
                  {/* nuke skull marker */}
                  {isNuke && (
                    <div
                      className="absolute left-[45%] top-1/2 -translate-y-1/2 text-[10px]"
                      style={{ filter: "drop-shadow(0 0 2px #000)" }}
                    >
                      ☠
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ fontSize: rocketSize * 0.85 }}
            >
              {fx.emoji}
            </div>
          )}
        </div>
      )}

      {fx.phase === "boom" && !fx.friendly && (
        <div className={isNuke ? "animate-screen-shake-nuke" : "animate-screen-shake"}>
          {/* Brief realistic muzzle flash */}
          <div
            className="absolute rounded-full animate-flash-bang pointer-events-none"
            style={{
              left: fx.toX - boomSize * 1.2,
              top: fx.toY - boomSize * 1.2,
              width: boomSize * 2.4,
              height: boomSize * 2.4,
              background:
                "radial-gradient(circle, rgba(255,245,210,0.85) 0%, rgba(255,180,80,0.35) 28%, transparent 60%)",
              mixBlendMode: "screen",
            }}
          />

          {/* Outer realistic smoke puffs flying outward */}
          {smokeRing.map((s) => (
            <img
              key={`sm-${s.key}`}
              src={smokeReal}
              alt=""
              aria-hidden
              className="absolute animate-smoke-rise-real select-none"
              style={{
                left: fx.toX - boomSize * 0.35,
                top: fx.toY - boomSize * 0.35,
                width: boomSize * 0.7,
                height: boomSize * 0.7,
                objectFit: "contain",
                ["--dx" as never]: `${s.dx}px`,
                ["--dy" as never]: `${s.dy}px`,
                ["--rot" as never]: `${Math.random() * 360}deg`,
                animationDelay: `${0.05 + Math.random() * 0.25}s`,
                opacity: 0.95,
              }}
            />
          ))}

          {/* Core realistic explosion render */}
          <img
            src={isNuke ? nukeReal : explosionReal}
            alt=""
            aria-hidden
            className={`absolute select-none ${isNuke ? "animate-explosion-real-nuke" : "animate-explosion-real"}`}
            style={{
              left: fx.toX - boomSize * (isNuke ? 1.0 : 0.85),
              top: fx.toY - boomSize * (isNuke ? 1.4 : 0.95),
              width: boomSize * (isNuke ? 2.0 : 1.7),
              height: boomSize * (isNuke ? 2.2 : 1.7),
              objectFit: "contain",
              transformOrigin: isNuke ? "50% 80%" : "50% 60%",
              filter: "drop-shadow(0 8px 18px rgba(0,0,0,0.55))",
            }}
          />

          {/* Subtle expanding shock ring for impact feedback */}
          <div
            className="absolute rounded-full border-white/40 animate-image-shock pointer-events-none"
            style={{
              left: fx.toX - boomSize * 0.5,
              top: fx.toY - boomSize * 0.5,
              width: boomSize,
              height: boomSize,
              boxShadow: "0 0 24px rgba(255,200,120,0.4)",
            }}
          />
        </div>
      )}



      {fx.phase === "boom" && fx.friendly && (
        <div className="absolute" style={{ left: fx.toX - 60, top: fx.toY - 60, width: 120, height: 120 }}>
          <div className="absolute inset-0 rounded-full bg-emerald-300/40 animate-ping" />
          <div className="absolute inset-6 rounded-full bg-emerald-200/60 animate-pulse" />
          <div className="absolute inset-0 flex items-center justify-center text-5xl animate-pulse">✨</div>
        </div>
      )}
    </div>
  );
}
