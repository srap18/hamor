import { useEffect, useState } from "react";

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

export function ProjectileFx({ fx }: { fx: FxState }) {
  const [pos, setPos] = useState({ x: fx.fromX, y: fx.fromY });
  useEffect(() => {
    const r = requestAnimationFrame(() => setPos({ x: fx.toX, y: fx.toY }));
    return () => cancelAnimationFrame(r);
  }, [fx.id]);
  const angle = Math.atan2(fx.toY - fx.fromY, fx.toX - fx.fromX) * 180 / Math.PI;

  const isNuke = fx.weaponId === "nuke";
  const isLarge = fx.weaponId === "rocket_large";
  const isMed = fx.weaponId === "rocket_medium";

  const flightMs = isNuke ? 1100 : 850;
  const rocketSize = isNuke ? 64 : isLarge ? 52 : isMed ? 44 : 36;
  const boomSize = isNuke ? 320 : isLarge ? 220 : isMed ? 170 : 130;

  const trailColor = isNuke
    ? "rgba(180,255,120,0.95)"
    : isLarge
    ? "rgba(255,90,30,0.95)"
    : isMed
    ? "rgba(255,180,60,0.9)"
    : "rgba(255,220,120,0.9)";

  const debris = Array.from({ length: isNuke ? 14 : isLarge ? 10 : 7 }, (_, i) => {
    const ang = (i / (isNuke ? 14 : isLarge ? 10 : 7)) * Math.PI * 2;
    const dist = (isNuke ? 160 : isLarge ? 110 : 75) + Math.random() * 40;
    return { dx: Math.cos(ang) * dist, dy: Math.sin(ang) * dist, key: i };
  });

  return (
    <div className="fixed inset-0 pointer-events-none z-[70]">
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
              : `drop-shadow(0 0 16px ${trailColor})`,
            transform: fx.friendly ? "none" : `rotate(${angle}deg)`,
          }}
        >
          {!fx.friendly && (
            <>
              <div
                className="absolute top-1/2 -translate-y-1/2 rounded-full blur-[6px]"
                style={{
                  right: "100%",
                  width: rocketSize * 1.4,
                  height: rocketSize * 0.55,
                  background: `radial-gradient(ellipse, ${trailColor}, transparent 75%)`,
                  opacity: 0.85,
                }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 rounded-full blur-[3px]"
                style={{
                  right: "92%",
                  width: rocketSize * 0.7,
                  height: rocketSize * 0.35,
                  background: `radial-gradient(ellipse, #fff, ${trailColor} 60%, transparent)`,
                }}
              />
            </>
          )}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              fontSize: rocketSize * 0.85,
              filter: isNuke
                ? "drop-shadow(0 0 14px #65a30d) drop-shadow(0 0 24px #000)"
                : "drop-shadow(0 0 8px rgba(0,0,0,0.6))",
            }}
          >
            {isNuke ? "☠️" : fx.emoji}
          </div>
        </div>
      )}

      {fx.phase === "boom" && !fx.friendly && (
        <div
          className="absolute"
          style={{
            left: fx.toX - boomSize / 2,
            top: fx.toY - boomSize / 2,
            width: boomSize,
            height: boomSize,
          }}
        >
          {/* Flashbang — bright white screen punch */}
          <div
            className="absolute rounded-full animate-flash-bang"
            style={{
              left: -boomSize * 0.6,
              top: -boomSize * 0.6,
              width: boomSize * 2.2,
              height: boomSize * 2.2,
              background:
                "radial-gradient(circle, #ffffff 0%, rgba(255,240,200,0.8) 25%, transparent 60%)",
              mixBlendMode: "screen",
            }}
          />

          {/* Core fireball — white hot center, yellow, orange, deep red */}
          <div
            className={`absolute inset-0 rounded-full ${isNuke ? "animate-fireball-nuke" : "animate-fireball"}`}
            style={{
              background:
                "radial-gradient(circle, #ffffff 0%, #fff3a0 18%, #ffb347 38%, #ff5a1f 60%, #8b1a00 82%, transparent 100%)",
              boxShadow:
                "0 0 80px rgba(255,160,40,0.95), 0 0 160px rgba(255,80,0,0.7)",
              filter: "blur(0.5px)",
            }}
          />

          {/* Inner blast disk */}
          <div
            className={`absolute inset-[15%] rounded-full ${isNuke ? "animate-fireball-nuke" : "animate-fireball"}`}
            style={{
              background:
                "radial-gradient(circle, #fff 0%, #ffe066 30%, #ff7a00 70%, transparent 100%)",
              mixBlendMode: "screen",
            }}
          />

          {/* Shockwave rings */}
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

          {/* Arcing debris with gravity */}
          {debris.map((d) => (
            <div
              key={d.key}
              className="absolute left-1/2 top-1/2 w-2 h-2 rounded-sm bg-amber-300 animate-debris-arc"
              style={{
                ["--dx" as never]: `${d.dx}px`,
                ["--dy" as never]: `${d.dy}px`,
                boxShadow:
                  "0 0 10px rgba(255,180,80,0.95), 0 0 18px rgba(255,90,0,0.7)",
                background:
                  "linear-gradient(135deg, #fff5b0, #ff8a1f 60%, #6b1a00)",
              }}
            />
          ))}

          {/* Lingering smoke puff */}
          <div
            className="absolute inset-[-20%] rounded-full opacity-0 animate-fireball"
            style={{
              animationDelay: "0.5s",
              animationDuration: isNuke ? "2.4s" : "1.6s",
              background:
                "radial-gradient(circle, rgba(60,45,35,0.85) 0%, rgba(30,20,15,0.55) 45%, transparent 75%)",
              filter: "blur(8px)",
            }}
          />

          {/* Nuke: mushroom stem + cap + dust ring */}
          {isNuke && (
            <>
              <div
                className="absolute left-1/2 bottom-0 animate-mushroom-stem"
                style={{
                  width: boomSize * 0.35,
                  height: boomSize * 1.1,
                  background:
                    "linear-gradient(180deg, rgba(80,60,50,0.95) 0%, rgba(50,35,28,0.85) 60%, rgba(30,20,15,0.7) 100%)",
                  filter: "blur(4px)",
                  borderRadius: "40% 40% 20% 20%",
                  transform: "translateX(-50%)",
                  transformOrigin: "bottom center",
                }}
              />
              <div
                className="absolute left-1/2 top-0 animate-mushroom-cap"
                style={{
                  width: boomSize * 1.1,
                  height: boomSize * 0.7,
                  background:
                    "radial-gradient(ellipse at 50% 60%, rgba(255,200,120,0.9) 0%, rgba(180,90,40,0.85) 35%, rgba(60,40,30,0.9) 70%, transparent 100%)",
                  filter: "blur(6px)",
                  borderRadius: "50%",
                }}
              />
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-200/60 animate-shockwave-nuke"
                style={{
                  width: boomSize * 1.6,
                  height: boomSize * 0.4,
                  animationDelay: "0.1s",
                }}
              />
            </>
          )}
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
