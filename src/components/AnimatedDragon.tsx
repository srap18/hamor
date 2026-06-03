/**
 * Pure-SVG animated dragon — no static images.
 * - Wings flap (separate <g> with transform animation)
 * - Body breathes
 * - Head turns + jaw opens
 * - Tail sways
 * - Fire breath puffs
 * - Eye glows
 */
type Props = {
  size?: number;          // px width
  flip?: boolean;         // face right vs left
  breathing?: boolean;    // breath fire
  variant?: "shore" | "boss";
  className?: string;
  style?: React.CSSProperties;
};

let _seed = 0;
const uid = () => `ad${++_seed}`;

export function AnimatedDragon({
  size = 220,
  flip = false,
  breathing = true,
  variant = "shore",
  className,
  style,
}: Props) {
  const id = uid();
  const isBoss = variant === "boss";
  const bodyColor = isBoss ? "#3a0a14" : "#7a2a16";
  const bodyDark = isBoss ? "#1a0408" : "#3a1208";
  const bellyColor = isBoss ? "#5c1820" : "#c97a3a";
  const wingColor = isBoss ? "#1a0810" : "#4a1808";
  const spikeColor = isBoss ? "#f43f5e" : "#fbbf24";

  return (
    <svg
      viewBox="0 0 300 240"
      width={size}
      height={size * 0.8}
      className={className}
      style={{
        overflow: "visible",
        transform: flip ? "scaleX(-1)" : undefined,
        filter: isBoss
          ? "drop-shadow(0 0 24px rgba(244,63,94,0.85)) drop-shadow(0 6px 6px rgba(0,0,0,0.8))"
          : "drop-shadow(0 0 16px rgba(255,140,40,0.7)) drop-shadow(0 6px 6px rgba(0,0,0,0.7))",
        ...style,
      }}
      aria-hidden
    >
      <defs>
        <radialGradient id={`${id}-body`} cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor={bodyColor} />
          <stop offset="100%" stopColor={bodyDark} />
        </radialGradient>
        <radialGradient id={`${id}-belly`} cx="50%" cy="60%" r="60%">
          <stop offset="0%" stopColor={bellyColor} />
          <stop offset="100%" stopColor={bodyDark} />
        </radialGradient>
        <radialGradient id={`${id}-fire`} cx="20%" cy="50%" r="80%">
          <stop offset="0%" stopColor="#fff8b0" stopOpacity="1" />
          <stop offset="35%" stopColor="#ffb020" stopOpacity="0.95" />
          <stop offset="75%" stopColor="#dc2626" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#7a1010" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-eye`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff7c8" />
          <stop offset="40%" stopColor="#ffce42" />
          <stop offset="100%" stopColor="#b8000c" />
        </radialGradient>
      </defs>

      <style>{`
        @keyframes ${id}-wing {
          0%,100% { transform: rotate(-18deg) scaleY(1); }
          50%     { transform: rotate(28deg) scaleY(0.75); }
        }
        @keyframes ${id}-wing2 {
          0%,100% { transform: rotate(-22deg) scaleY(1); }
          50%     { transform: rotate(32deg) scaleY(0.7); }
        }
        @keyframes ${id}-breath {
          0%,100% { transform: scale(1,1); }
          50%     { transform: scale(1.04,1.06); }
        }
        @keyframes ${id}-head {
          0%,100% { transform: rotate(-8deg) translate(0,0); }
          40%     { transform: rotate(6deg) translate(2px,-3px); }
          60%     { transform: rotate(10deg) translate(3px,-1px); }
        }
        @keyframes ${id}-jaw {
          0%,60%,100% { transform: rotate(0deg); }
          70%,90%     { transform: rotate(14deg); }
        }
        @keyframes ${id}-tail {
          0%,100% { transform: rotate(-12deg); }
          50%     { transform: rotate(15deg); }
        }
        @keyframes ${id}-fire {
          0%,55%,100% { opacity:0; transform: scale(0.3,0.6) translateX(0); }
          65%         { opacity:1; transform: scale(1.0,1.0) translateX(-6px); }
          85%         { opacity:.85; transform: scale(1.6,1.2) translateX(-18px); }
        }
        @keyframes ${id}-eye {
          0%,100% { opacity:1; }
          92%,96% { opacity:.3; }
        }
        @keyframes ${id}-float {
          0%,100% { transform: translate(0,0); }
          50%     { transform: translate(0,-6px); }
        }
      `}</style>

      {/* Whole-body subtle float (boss only) */}
      <g style={isBoss ? { animation: `${id}-float 3.2s ease-in-out infinite` } : undefined}>

        {/* Tail */}
        <g style={{ transformOrigin: "210px 150px", animation: `${id}-tail 2.4s ease-in-out infinite` }}>
          <path d={`M 210 150 Q 260 130 285 165 Q 270 170 255 158 Q 240 168 210 158 Z`}
            fill={`url(#${id}-body)`} stroke={bodyDark} strokeWidth="1.5" />
          {/* tail spikes */}
          <polygon points="240,135 250,118 256,135" fill={spikeColor} opacity="0.85" />
          <polygon points="260,128 270,114 274,132" fill={spikeColor} opacity="0.85" />
        </g>

        {/* Back leg */}
        <g>
          <ellipse cx="180" cy="180" rx="22" ry="14" fill={bodyDark} />
          <path d="M 168 188 L 162 200 L 175 200 L 172 188 Z" fill={spikeColor} />
          <path d="M 188 188 L 194 200 L 181 200 L 184 188 Z" fill={spikeColor} />
        </g>

        {/* Far wing (behind body) */}
        <g style={{ transformOrigin: "140px 105px", animation: `${id}-wing2 0.9s ease-in-out infinite` }}>
          <path d="M 140 105 Q 60 50 25 110 Q 70 100 100 130 Q 80 120 60 135 Q 110 140 140 120 Z"
            fill={wingColor} opacity="0.75" stroke={bodyDark} strokeWidth="1" />
        </g>

        {/* Body with breathing scale */}
        <g style={{ transformOrigin: "150px 145px", animation: `${id}-breath 2.4s ease-in-out infinite` }}>
          <ellipse cx="150" cy="145" rx="62" ry="38" fill={`url(#${id}-body)`} stroke={bodyDark} strokeWidth="1.5" />
          {/* belly */}
          <ellipse cx="150" cy="160" rx="48" ry="22" fill={`url(#${id}-belly)`} opacity="0.85" />
          {/* back spikes */}
          {[0,1,2,3,4].map((i) => (
            <polygon key={i}
              points={`${120 + i*14},110 ${126 + i*14},92 ${132 + i*14},110`}
              fill={spikeColor} opacity="0.9" />
          ))}
          {/* Front leg */}
          <ellipse cx="120" cy="180" rx="18" ry="12" fill={bodyDark} />
          <path d="M 110 188 L 105 200 L 116 200 L 114 188 Z" fill={spikeColor} />
          <path d="M 126 188 L 132 200 L 121 200 L 122 188 Z" fill={spikeColor} />
        </g>

        {/* Near wing (in front) — flaps */}
        <g style={{ transformOrigin: "150px 105px", animation: `${id}-wing 0.85s ease-in-out infinite` }}>
          <path d="M 150 105 Q 80 30 30 95 Q 70 95 95 125 Q 75 115 50 135 Q 105 145 150 120 Z"
            fill={wingColor} stroke={bodyDark} strokeWidth="1.5" />
          {/* wing membrane lines */}
          <path d="M 150 110 Q 90 70 45 100" stroke={bodyDark} strokeWidth="1" fill="none" opacity="0.6" />
          <path d="M 150 115 Q 100 100 65 130" stroke={bodyDark} strokeWidth="1" fill="none" opacity="0.6" />
        </g>

        {/* Neck */}
        <path d="M 95 130 Q 70 105 85 80 Q 105 95 110 125 Z" fill={`url(#${id}-body)`} stroke={bodyDark} strokeWidth="1.5" />

        {/* Head — turns */}
        <g style={{ transformOrigin: "85px 85px", animation: `${id}-head 4.2s ease-in-out infinite` }}>
          {/* horns */}
          <polygon points="78,55 70,30 84,52" fill={bodyDark} />
          <polygon points="92,55 100,28 96,52" fill={bodyDark} />
          {/* head */}
          <path d="M 60 85 Q 55 60 90 60 Q 110 65 105 90 Q 95 100 70 100 Z"
            fill={`url(#${id}-body)`} stroke={bodyDark} strokeWidth="1.5" />
          {/* jaw */}
          <g style={{ transformOrigin: "65px 90px", animation: `${id}-jaw 2.4s ease-in-out infinite` }}>
            <path d="M 55 90 Q 45 95 35 95 Q 50 105 70 100 Z"
              fill={bodyDark} stroke={bodyDark} strokeWidth="1" />
            {/* teeth */}
            <polygon points="48,93 46,99 50,94" fill="#fff8e0" />
            <polygon points="54,93 52,99 56,94" fill="#fff8e0" />
          </g>
          {/* fire breath */}
          {breathing && (
            <ellipse cx="20" cy="92" rx="28" ry="10"
              fill={`url(#${id}-fire)`}
              style={{ transformOrigin: "48px 92px", animation: `${id}-fire 2.4s ease-out infinite` }} />
          )}
          {/* eye glow */}
          <circle cx="82" cy="78" r="4.5" fill={`url(#${id}-eye)`}
            style={{ animation: `${id}-eye 4s ease-in-out infinite` }} />
          <circle cx="82" cy="78" r="1.8" fill="#1a0000" />
          {/* nostril */}
          <ellipse cx="62" cy="86" rx="1.8" ry="1.2" fill="#1a0000" />
        </g>
      </g>
    </svg>
  );
}
