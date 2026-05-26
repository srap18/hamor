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
          <div
            className="absolute inset-0 rounded-full animate-pulse"
            style={{
              background: isNuke
                ? "radial-gradient(circle, #fff 0%, #fef08a 30%, #fb923c 60%, transparent 80%)"
                : "radial-gradient(circle, #fff 0%, #fde047 35%, #f97316 65%, transparent 85%)",
            }}
          />
          <div className={`absolute inset-0 rounded-full border-white/90 ${isNuke ? "animate-shockwave-nuke" : "animate-shockwave"}`} />
          {(isNuke || isLarge) && (
            <div
              className={`absolute inset-0 rounded-full border-orange-300/70 ${isNuke ? "animate-shockwave-nuke" : "animate-shockwave"}`}
              style={{ animationDelay: "0.15s" }}
            />
          )}
          {debris.map((d) => (
            <div
              key={d.key}
              className="absolute left-1/2 top-1/2 w-2 h-2 rounded-full bg-amber-300 animate-debris"
              style={{
                ["--dx" as never]: `${d.dx}px`,
                ["--dy" as never]: `${d.dy}px`,
                boxShadow: "0 0 8px rgba(255,180,80,0.9)",
              }}
            />
          ))}
          {isNuke && (
            <div className="absolute left-1/2 bottom-1/2 text-8xl animate-mushroom" style={{ filter: "drop-shadow(0 0 20px rgba(0,0,0,0.6))" }}>
              ☁️
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center animate-pulse" style={{ fontSize: boomSize * 0.4 }}>
            💥
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
