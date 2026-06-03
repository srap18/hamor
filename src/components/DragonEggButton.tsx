import { Link } from "@tanstack/react-router";
import dragonEggImg from "@/assets/dragon-egg.png";

type Props = {
  /** Position style — defaults to top-right corner */
  className?: string;
};

/**
 * Floating dragon egg button that opens the /dragon page.
 * Designed to sit in the upper area of any screen (same spot as the
 * glowing dragon visual the user showed in their reference screenshot).
 */
export function DragonEggButton({ className }: Props) {
  return (
    <Link
      to="/dragon"
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
    </Link>
  );
}
