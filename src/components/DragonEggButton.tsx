import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import dragonEggImg from "@/assets/dragon-egg.png";
import { getStage } from "@/lib/dragon";
import { useDragonUnlocked } from "@/lib/dragon-access";

type Props = {
  /** Position style — defaults to top-right corner */
  className?: string;
  /** When false, the egg is rendered as a non-interactive visual (no clicks). */
  interactive?: boolean;
  /** Dragon stage (1..15). When provided, renders the matching dragon form image. */
  stage?: number;
};

/**
 * Floating dragon egg button. Currently shows a "coming soon" popup
 * instead of opening the dragon page. When `interactive` is false (e.g.
 * when viewing another player's harbor), the egg is purely decorative.
 */
export function DragonEggButton({ className, interactive = true, stage }: Props) {
  const [showSoon, setShowSoon] = useState(false);
  const navigate = useNavigate();
  const unlocked = useDragonUnlocked();
  const img = stage && stage >= 1 ? getStage(stage).image : dragonEggImg;
  if (!interactive) {
    return (
      <div
        className={
          className ??
          "fixed top-20 right-3 z-40 w-16 h-16 rounded-full flex items-center justify-center pointer-events-none"
        }
        style={{
          filter:
            "drop-shadow(0 0 12px rgba(251,146,60,0.7)) drop-shadow(0 0 24px rgba(220,38,38,0.5))",
        }}
        aria-hidden
      >
        <img
          src={img}
          alt=""
          className="w-full h-full object-contain"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <>
    <button
      type="button"
      onClick={() => { setShowSoon(true); setTimeout(() => setShowSoon(false), 2200); }}
      className={
        className ??
        "fixed top-20 right-3 z-40 w-16 h-16 rounded-full flex items-center justify-center active:scale-90 transition-transform"
      }
      style={{
        filter:
          "drop-shadow(0 0 12px rgba(251,146,60,0.7)) drop-shadow(0 0 24px rgba(220,38,38,0.5))",
      }}
      aria-label="افتح تنيني"
    >
      <style>{`
        @keyframes egg-pulse {
          0%, 100% { transform: scale(1) rotate(-2deg); }
          50% { transform: scale(1.06) rotate(2deg); }
        }
        @keyframes egg-glow-ring {
          0%, 100% { box-shadow: 0 0 0 2px rgba(251,191,36,0.5), 0 0 20px rgba(251,146,60,0.6); }
          50% { box-shadow: 0 0 0 3px rgba(251,191,36,0.8), 0 0 30px rgba(251,146,60,0.9); }
        }
      `}</style>
      <span
        className="absolute inset-0 rounded-full"
        style={{ animation: "egg-glow-ring 2.4s ease-in-out infinite" }}
      />
      <img
        src={img}
        alt="بيضة التنين"
        className="w-full h-full object-contain relative z-10"
        style={{ animation: "egg-pulse 3s ease-in-out infinite" }}
        draggable={false}
      />

    </button>
    {showSoon && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
        onClick={() => setShowSoon(false)}
        dir="rtl"
      >
        <div className="bg-gradient-to-br from-amber-900/95 to-rose-950/95 border-4 border-amber-400/80 rounded-3xl px-10 py-8 text-center shadow-2xl animate-in zoom-in-50 duration-300">
          <div
            className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-b from-amber-200 via-amber-400 to-orange-600"
            style={{ textShadow: "0 0 30px rgba(251,146,60,0.8)" }}
          >
            قريبًا!!
          </div>
        </div>
      </div>
    )}
    </>
  );
}
