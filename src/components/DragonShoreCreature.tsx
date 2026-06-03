import { Link } from "@tanstack/react-router";
import dragonImg from "@/assets/dragon-adult.png";

/**
 * Animated shore dragon — sits on the harbor edge where the old fountain
 * used to be (bottom-left of the scene). Covers the fountain across all
 * backgrounds with a soft glow shadow, and animates continuously:
 *  - body: slow breathing scale
 *  - head: subtle head turn (skew + rotate)
 *  - wings/aura: heat-haze glow pulse
 *  - occasional fire breath puff
 * Tapping opens the /dragon page.
 */
export function DragonShoreCreature() {
  return (
    <Link
      to="/dragon"
      aria-label="تنيني"
      className="absolute z-20 active:scale-95 transition-transform"
      style={{
        // Matches the fountain pocket in the harbor backgrounds (bottom-left).
        left: "4%",
        bottom: "16%",
        width: "32%",
        maxWidth: "190px",
        aspectRatio: "1 / 1",
        pointerEvents: "auto",
      }}
    >
      <style>{`
        @keyframes dragon-breath {
          0%, 100% { transform: scale(1) translateY(0); }
          50%      { transform: scale(1.035) translateY(-2px); }
        }
        @keyframes dragon-head {
          0%, 100% { transform: rotate(-3deg); }
          35%      { transform: rotate(2deg); }
          70%      { transform: rotate(-1deg); }
        }
        @keyframes dragon-aura {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50%      { opacity: 0.95; transform: scale(1.12); }
        }
        @keyframes dragon-fire {
          0%   { opacity: 0; transform: translate(0,0) scale(0.4); }
          15%  { opacity: 1; }
          70%  { opacity: 0.7; transform: translate(-28px,-6px) scale(1.4); }
          100% { opacity: 0; transform: translate(-50px,-10px) scale(1.8); }
        }
        @keyframes ember-rise {
          0%   { opacity: 0; transform: translateY(0) scale(0.6); }
          30%  { opacity: 1; }
          100% { opacity: 0; transform: translateY(-40px) scale(0.2); }
        }
      `}</style>

      {/* Ground glow that masks the fountain underneath on any background */}
      <span
        className="absolute rounded-full"
        style={{
          left: "-10%",
          right: "-10%",
          bottom: "-6%",
          height: "40%",
          background:
            "radial-gradient(ellipse at center, rgba(255,140,40,0.55), rgba(180,30,10,0.25) 45%, transparent 75%)",
          filter: "blur(6px)",
          animation: "dragon-aura 3.2s ease-in-out infinite",
        }}
      />

      {/* Body breathing */}
      <div
        className="absolute inset-0"
        style={{
          animation: "dragon-breath 3.4s ease-in-out infinite",
          transformOrigin: "50% 90%",
        }}
      >
        {/* Head subtle turn — applied to whole image since head occupies upper half */}
        <img
          src={dragonImg}
          alt="تنيني"
          draggable={false}
          className="w-full h-full object-contain"
          style={{
            animation: "dragon-head 5.2s ease-in-out infinite",
            transformOrigin: "55% 70%",
            filter:
              "drop-shadow(0 6px 10px rgba(0,0,0,0.6)) drop-shadow(0 0 14px rgba(255,120,40,0.55))",
          }}
        />

        {/* Fire breath puff — periodically shoots out toward the water */}
        <span
          className="absolute"
          style={{
            left: "8%",
            top: "30%",
            width: "30%",
            height: "14%",
            background:
              "radial-gradient(ellipse at right center, rgba(255,220,90,1) 0%, rgba(255,120,40,0.9) 40%, rgba(180,30,10,0) 75%)",
            filter: "blur(2px)",
            animation: "dragon-fire 4.6s ease-out infinite",
            animationDelay: "1.2s",
            transformOrigin: "100% 50%",
          }}
        />

        {/* Rising embers */}
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${20 + i * 8}%`,
              top: "20%",
              width: 4,
              height: 4,
              background: "rgba(255,170,60,0.95)",
              boxShadow: "0 0 6px rgba(255,140,30,0.9)",
              animation: `ember-rise ${2.4 + i * 0.4}s ease-out infinite`,
              animationDelay: `${i * 0.7}s`,
            }}
          />
        ))}
      </div>
    </Link>
  );
}
