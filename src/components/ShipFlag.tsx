import { useEffect, useState } from "react";
import { getShipFlag, type ShipFlagId } from "@/lib/ship-flag";

// Tiny SVG flag that waves on the ship's mast. Honors user preference
// (off / pirate / luxury / tribe) read from localStorage.
export function ShipFlag({ tribeEmblem }: { tribeEmblem?: string | null }) {
  const [id, setId] = useState<ShipFlagId>(() => getShipFlag());

  useEffect(() => {
    const sync = () => setId(getShipFlag());
    window.addEventListener("ship-flag-pref", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("ship-flag-pref", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (id === "off") return null;

  return (
    <div
      className="absolute pointer-events-none animate-flag-wave origin-left"
      style={{ left: "50%", top: "-4%", width: "16%", height: "13%" }}
    >
      <FlagArt id={id} tribeEmblem={tribeEmblem} />
    </div>
  );
}

function FlagArt({ id, tribeEmblem }: { id: ShipFlagId; tribeEmblem?: string | null }) {
  // Tattered swallow-tail flag silhouette shared by all designs.
  const clip = "polygon(0 0, 100% 0, 88% 50%, 100% 100%, 0 100%)";
  const shadow = "drop-shadow(0 2px 2px rgba(0,0,0,0.55))";

  if (id === "tribe" && tribeEmblem) {
    return (
      <div className="w-full h-full relative" style={{ filter: shadow }}>
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(180deg, #7c1d1d 0%, #4a0a0a 100%)",
            clipPath: clip,
            border: "1px solid rgba(0,0,0,0.4)",
          }}
        />
        <img
          src={tribeEmblem}
          alt=""
          className="absolute left-[18%] top-[15%] w-[55%] h-[70%] object-contain"
          draggable={false}
          style={{ clipPath: clip }}
        />
      </div>
    );
  }

  if (id === "pirate-red") {
    return (
      <div
        className="w-full h-full"
        style={{
          background: "linear-gradient(180deg, #dc2626 0%, #7f1d1d 100%)",
          clipPath: clip,
          filter: shadow,
          border: "1px solid rgba(0,0,0,0.4)",
        }}
      />
    );
  }

  if (id === "crown-gold") {
    return (
      <svg viewBox="0 0 100 70" className="w-full h-full" style={{ filter: shadow }}>
        <defs>
          <linearGradient id="lux" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fef3c7" />
            <stop offset="55%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#78350f" />
          </linearGradient>
        </defs>
        <polygon
          points="0,0 100,0 88,35 100,70 0,70"
          fill="url(#lux)"
          stroke="rgba(0,0,0,0.45)"
          strokeWidth="1"
        />
        {/* simple crown glyph */}
        <path
          d="M28,42 L34,26 L42,38 L50,22 L58,38 L66,26 L72,42 Z M28,46 L72,46 L72,52 L28,52 Z"
          fill="#1f1300"
          opacity="0.85"
        />
      </svg>
    );
  }

  if (id === "anchor-navy") {
    return (
      <svg viewBox="0 0 100 70" className="w-full h-full" style={{ filter: shadow }}>
        <polygon
          points="0,0 100,0 88,35 100,70 0,70"
          fill="#0c2a4a"
          stroke="rgba(0,0,0,0.5)"
          strokeWidth="1"
        />
        {/* anchor */}
        <g fill="#e0f2fe">
          <circle cx="48" cy="20" r="4" />
          <rect x="46" y="22" width="4" height="28" />
          <rect x="38" y="26" width="20" height="3" />
          <path d="M30,42 Q48,60 66,42 L62,42 Q48,54 34,42 Z" />
        </g>
      </svg>
    );
  }

  // default: pirate-skull (Jolly Roger)
  return (
    <svg viewBox="0 0 100 70" className="w-full h-full" style={{ filter: shadow }}>
      <polygon
        points="0,0 100,0 88,35 100,70 0,70"
        fill="#0a0a0a"
        stroke="rgba(255,255,255,0.15)"
        strokeWidth="1"
      />
      <g fill="#f4f4f5">
        {/* skull */}
        <ellipse cx="46" cy="28" rx="14" ry="12" />
        <rect x="40" y="36" width="12" height="6" rx="1" />
        <circle cx="41" cy="27" r="3" fill="#0a0a0a" />
        <circle cx="51" cy="27" r="3" fill="#0a0a0a" />
        {/* crossed bones */}
        <rect x="22" y="48" width="48" height="3" transform="rotate(20 46 50)" />
        <rect x="22" y="48" width="48" height="3" transform="rotate(-20 46 50)" />
        <circle cx="22" cy="44" r="3" />
        <circle cx="70" cy="44" r="3" />
        <circle cx="22" cy="56" r="3" />
        <circle cx="70" cy="56" r="3" />
      </g>
    </svg>
  );
}
