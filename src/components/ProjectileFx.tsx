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
      {/* Smoke trail puffs */}
      {fx.phase === "fly" && !fx.friendly && puffs.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full animate-smoke-trail-fade"
          style={{
            left: p.x - p.size / 2,
            top: p.y - p.size / 2,
            width: p.size,
            height: p.size,
            background:
              "radial-gradient(circle, rgba(255,255,255,0.85) 0%, rgba(200,200,200,0.55) 35%, rgba(80,80,80,0.25) 70%, transparent 100%)",
            filter: "blur(4px)",
            mixBlendMode: "screen",
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
          <div
            className="absolute"
            style={{
              left: fx.toX - boomSize / 2,
              top: fx.toY - boomSize / 2,
              width: boomSize,
              height: boomSize,
              transformStyle: "preserve-3d",
            }}
          >
            {/* Flashbang */}
            <div
              className="absolute rounded-full animate-flash-bang"
              style={{
                left: -boomSize * 0.7,
                top: -boomSize * 0.7,
                width: boomSize * 2.4,
                height: boomSize * 2.4,
                background:
                  "radial-gradient(circle, #ffffff 0%, rgba(255,240,200,0.85) 22%, transparent 60%)",
                mixBlendMode: "screen",
              }}
            />

            {/* Lens flare horizontal */}
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-lens-flare"
              style={{
                width: boomSize * 2.6,
                height: boomSize * 0.12,
                background:
                  "linear-gradient(to right, transparent, rgba(255,255,255,0.95), rgba(255,220,140,0.8), rgba(255,255,255,0.95), transparent)",
                filter: "blur(3px)",
                mixBlendMode: "screen",
              }}
            />

            {/* Ground shockwave (perspective ring on floor) */}
            <div
              className={`absolute left-1/2 top-1/2 rounded-full border-white/90 ${isNuke ? "animate-ground-shock-nuke" : "animate-ground-shock"}`}
              style={{
                width: boomSize * 1.4,
                height: boomSize * 1.4,
                borderColor: "rgba(255,220,160,0.9)",
                boxShadow: "0 0 30px rgba(255,180,80,0.6)",
              }}
            />
            <div
              className={`absolute left-1/2 top-1/2 rounded-full border-orange-300/70 ${isNuke ? "animate-ground-shock-nuke" : "animate-ground-shock"}`}
              style={{
                width: boomSize * 1.4,
                height: boomSize * 1.4,
                animationDelay: "0.15s",
              }}
            />

            {/* Core fireball */}
            <div
              className={`absolute inset-0 rounded-full ${isNuke ? "animate-fireball-nuke" : "animate-fireball"}`}
              style={{
                background:
                  "radial-gradient(circle at 45% 40%, #ffffff 0%, #fff3a0 16%, #ffb347 36%, #ff5a1f 58%, #8b1a00 80%, transparent 100%)",
                boxShadow:
                  "0 0 100px rgba(255,160,40,0.95), 0 0 200px rgba(255,80,0,0.7), inset 0 0 60px rgba(255,255,200,0.6)",
                filter: "blur(0.5px) contrast(1.1)",
              }}
            />

            {/* Inner blast disk */}
            <div
              className={`absolute inset-[18%] rounded-full ${isNuke ? "animate-fireball-nuke" : "animate-fireball"}`}
              style={{
                background:
                  "radial-gradient(circle at 50% 45%, #fff 0%, #ffe066 28%, #ff7a00 65%, transparent 100%)",
                mixBlendMode: "screen",
                animationDelay: "0.05s",
              }}
            />

            {/* Spherical shockwave rings (camera-facing) */}
            <div className={`absolute inset-0 rounded-full border-white/90 ${isNuke ? "animate-shockwave-nuke" : "animate-shockwave"}`} />
            {(isNuke || isLarge) && (
              <div
                className={`absolute inset-0 rounded-full border-orange-300/70 ${isNuke ? "animate-shockwave-nuke" : "animate-shockwave"}`}
                style={{ animationDelay: "0.18s" }}
              />
            )}
            {isNuke && (
              <div
                className="absolute inset-0 rounded-full border-yellow-200/60 animate-shockwave-nuke"
                style={{ animationDelay: "0.36s" }}
              />
            )}

            {/* Volumetric smoke ring puffs */}
            {smokeRing.map((s) => (
              <div
                key={`sm-${s.key}`}
                className="absolute left-1/2 top-1/2 rounded-full animate-smoke-puff-3d"
                style={{
                  width: boomSize * 0.5,
                  height: boomSize * 0.5,
                  marginLeft: -boomSize * 0.25,
                  marginTop: -boomSize * 0.25,
                  ["--dx" as never]: `${s.dx}px`,
                  ["--dy" as never]: `${s.dy}px`,
                  background:
                    "radial-gradient(circle, rgba(80,60,50,0.85) 0%, rgba(40,30,25,0.6) 45%, transparent 75%)",
                  filter: "blur(10px)",
                  animationDelay: `${0.1 + Math.random() * 0.2}s`,
                }}
              />
            ))}

            {/* Arcing debris with rotation */}
            {debris.map((d) => (
              <div
                key={d.key}
                className="absolute left-1/2 top-1/2 w-2.5 h-2.5 rounded-sm animate-debris-arc"
                style={{
                  ["--dx" as never]: `${d.dx}px`,
                  ["--dy" as never]: `${d.dy}px`,
                  boxShadow:
                    "0 0 12px rgba(255,180,80,0.95), 0 0 22px rgba(255,90,0,0.7)",
                  background:
                    "linear-gradient(135deg, #fff5b0 0%, #ffb347 40%, #ff5a1f 70%, #4a1100 100%)",
                  transform: `rotate(${Math.random() * 360}deg)`,
                }}
              />
            ))}

            {/* Nuke: mushroom stem + cap + dust ring */}
            {isNuke && (
              <>
                <div
                  className="absolute left-1/2 bottom-0 animate-mushroom-stem"
                  style={{
                    width: boomSize * 0.38,
                    height: boomSize * 1.2,
                    background:
                      "linear-gradient(180deg, rgba(90,65,55,0.95) 0%, rgba(60,40,30,0.85) 50%, rgba(35,22,18,0.7) 100%)",
                    filter: "blur(5px)",
                    borderRadius: "40% 40% 20% 20%",
                    transform: "translateX(-50%)",
                    transformOrigin: "bottom center",
                    boxShadow: "inset -10px 0 20px rgba(0,0,0,0.5), inset 10px 0 20px rgba(255,180,80,0.2)",
                  }}
                />
                <div
                  className="absolute left-1/2 top-0 animate-mushroom-cap"
                  style={{
                    width: boomSize * 1.2,
                    height: boomSize * 0.75,
                    background:
                      "radial-gradient(ellipse at 50% 55%, rgba(255,210,130,0.95) 0%, rgba(200,100,45,0.9) 30%, rgba(80,50,35,0.9) 65%, rgba(30,18,12,0.7) 90%, transparent 100%)",
                    filter: "blur(7px)",
                    borderRadius: "50%",
                    boxShadow: "inset 0 -30px 60px rgba(0,0,0,0.6), 0 0 80px rgba(255,140,40,0.5)",
                  }}
                />
                <div
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-200/60 animate-shockwave-nuke"
                  style={{
                    width: boomSize * 1.8,
                    height: boomSize * 0.45,
                    animationDelay: "0.1s",
                  }}
                />
              </>
            )}
          </div>
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
