import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { serverNowMs } from "@/lib/server-time";

/**
 * Cinematic post-nuclear overlay shown on top of any scene background when
 * the player has been hit by a nuclear bomb. Lasts 7 days or until the
 * owner pays 100 gems to repair. Visible to all spectators.
 *
 * Layered effects (back → front):
 *  1. Charred wash – heavy desaturation + dark scorch tint
 *  2. Heat shimmer – subtle warping over the ground
 *  3. Crater glow – molten orange light in the middle
 *  4. Fire flicker line – flames at the horizon
 *  5. Drifting smoke columns
 *  6. Glowing embers floating upward
 *  7. Vignette + faint red/orange edge bloom
 *  8. Burned banner with countdown
 */
export function BurnedBgOverlay({
  burnedUntil,
  ownerName,
}: {
  burnedUntil: string | null | undefined;
  ownerName?: string | null;
}) {
  const [now, setNow] = useState(() => serverNowMs());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNowMs()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Smoke columns – generated once, stable positions
  const smokes = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => ({
        key: i,
        left: 10 + i * 18 + (i % 2 ? 4 : -4),
        size: 120 + (i % 3) * 60,
        dur: 8 + (i % 4) * 2,
        delay: -(i * 1.7),
        drift: (i % 2 ? 1 : -1) * (25 + i * 8),
      })),
    [],
  );

  // Embers – stable random positions
  const embers = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        key: i,
        left: Math.random() * 100,
        bottom: Math.random() * 30,
        size: 2 + Math.random() * 3,
        dur: 3 + Math.random() * 4,
        delay: -Math.random() * 5,
        dx: (Math.random() - 0.5) * 80,
      })),
    [],
  );

  if (!burnedUntil) return null;
  const endsAt = new Date(burnedUntil).getTime();
  if (!isFinite(endsAt) || endsAt <= now) return null;

  const remainingMs = endsAt - now;
  const days = Math.floor(remainingMs / (24 * 3600_000));
  const hours = Math.floor((remainingMs % (24 * 3600_000)) / 3600_000);
  const timeLabel = days > 0 ? `${days}ي ${hours}س` : `${hours}س`;

  return (
    <>
      {/* 1) Charred wash — heavy desaturate + dark scorch tint */}
      <div
        className="absolute inset-0 pointer-events-none z-[5]"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(20,5,0,0.55) 60%, rgba(60,15,0,0.65) 100%)",
          backdropFilter: "grayscale(0.85) contrast(1.15) brightness(0.55) sepia(0.35)",
          WebkitBackdropFilter: "grayscale(0.85) contrast(1.15) brightness(0.55) sepia(0.35)",
          mixBlendMode: "multiply",
        }}
      />

      {/* 2) Heat shimmer band over the lower scene */}
      <div
        className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none z-[6] animate-heat-shimmer"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, rgba(255,120,40,0.05) 50%, rgba(255,140,40,0.08) 100%)",
          mixBlendMode: "screen",
        }}
      />

      {/* 3) Crater / molten glow at scene center */}
      <div
        className="absolute inset-0 pointer-events-none z-[7]"
        style={{
          background:
            "radial-gradient(ellipse 55% 35% at 50% 72%, rgba(255,170,50,0.55) 0%, rgba(220,60,0,0.45) 30%, rgba(80,10,0,0.35) 55%, transparent 75%)",
          mixBlendMode: "screen",
        }}
      />

      {/* 4) Horizon fire line (flickering) */}
      <div
        className="absolute inset-x-0 bottom-0 h-24 pointer-events-none z-[8] animate-fire-flicker origin-bottom"
        style={{
          background:
            "radial-gradient(ellipse at 50% 100%, rgba(255,210,90,0.9) 0%, rgba(255,120,20,0.7) 25%, rgba(180,40,0,0.5) 55%, transparent 85%)",
          filter: "blur(2px)",
          mixBlendMode: "screen",
        }}
      />

      {/* 5) Smoke columns rising */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-[9]">
        {smokes.map((s) => (
          <div
            key={s.key}
            className="absolute bottom-0 rounded-full animate-smoke-column"
            style={{
              left: `${s.left}%`,
              width: s.size,
              height: s.size,
              ["--dur" as never]: `${s.dur}s`,
              ["--drift" as never]: `${s.drift}px`,
              animationDelay: `${s.delay}s`,
              background:
                "radial-gradient(circle at 50% 60%, rgba(60,45,35,0.95) 0%, rgba(35,25,20,0.7) 35%, rgba(20,15,12,0.35) 65%, transparent 80%)",
              filter: "blur(6px)",
            }}
          />
        ))}
      </div>

      {/* 6) Glowing embers floating upward */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-[10]">
        {embers.map((e) => (
          <div
            key={e.key}
            className="absolute rounded-full animate-ember-rise"
            style={{
              left: `${e.left}%`,
              bottom: `${e.bottom}%`,
              width: e.size,
              height: e.size,
              ["--dur" as never]: `${e.dur}s`,
              ["--dx" as never]: `${e.dx}px`,
              animationDelay: `${e.delay}s`,
              background:
                "radial-gradient(circle, #fff5b0 0%, #ffb347 40%, #ff5a00 70%, transparent 100%)",
              boxShadow: "0 0 8px rgba(255,140,40,0.95), 0 0 16px rgba(255,80,0,0.7)",
            }}
          />
        ))}
      </div>

      {/* 7) Vignette + faint red bloom on edges */}
      <div
        className="absolute inset-0 pointer-events-none z-[11]"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.55) 75%, rgba(40,0,0,0.85) 100%)," +
            "radial-gradient(ellipse at 50% 100%, rgba(255,80,0,0.25) 0%, transparent 50%)",
        }}
      />

      {/* 8) Burned banner with countdown */}
      <div className="absolute top-[7rem] left-1/2 -translate-x-1/2 z-30 pointer-events-none">
        <div className="bg-gradient-to-b from-red-700 to-red-950 border-2 border-orange-300 px-3 py-1 rounded-md shadow-2xl flex items-center gap-1.5">
          <span className="text-base">☢️🔥</span>
          <span className="text-[11px] font-extrabold text-orange-100 text-glow">
            {ownerName ? `خلفية ${ownerName} محترقة` : "خلفيتك محترقة"} · {timeLabel}
          </span>
        </div>
      </div>
    </>
  );
}

/** Pay 100 gems to clear the burn from your own background. */
export async function repairBurnedBg() {
  return (supabase as any).rpc("repair_burned_bg");
}

/** Burn the target player's background for 7 days. Requires a recent attack. */
export async function burnTargetBg(targetId: string) {
  return (supabase as any).rpc("burn_target_bg", { _target_id: targetId });
}
