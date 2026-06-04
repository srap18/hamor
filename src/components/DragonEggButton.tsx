import { useState } from "react";
import dragonEggImg from "@/assets/dragon-egg.png";

type Props = {
  /** Position style — defaults to top-right corner */
  className?: string;
};

/**
 * Floating dragon egg button. Currently shows a "coming soon" popup
 * instead of opening the dragon page.
 */
export function DragonEggButton({ className }: Props) {
  const [showSoon, setShowSoon] = useState(false);
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
        src={dragonEggImg}
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
        <div className="bg-gradient-to-br from-amber-900/90 to-rose-950/90 border-2 border-amber-400/60 rounded-2xl p-6 max-w-xs text-center shadow-2xl">
          <div className="text-5xl mb-3">🥚🔥</div>
          <div className="text-amber-100 text-xl font-extrabold mb-2">قريبًا</div>
          <div className="text-amber-200/80 text-sm">التنين على وشك أن يفقس... ترقّبوا!</div>
        </div>
      </div>
    )}
    </>
  );
}
