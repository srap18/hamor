import { useEffect, useState } from "react";
import { getShipFlag, isShipFlagId, type ShipFlagId } from "@/lib/ship-flag";

// 3D-styled animated flag that waves on the ship's mast.
// If `flagId` is provided (e.g. when viewing another player), it wins.
// Otherwise the local user's saved preference is used.
export function ShipFlag({ flagId, tribeEmblem }: { flagId?: string | null; tribeEmblem?: string | null }) {
  const override = isShipFlagId(flagId) ? flagId : null;
  const [localId, setLocalId] = useState<ShipFlagId>(() => getShipFlag());

  useEffect(() => {
    if (override) return;
    const sync = () => setLocalId(getShipFlag());
    window.addEventListener("ship-flag-pref", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("ship-flag-pref", sync);
      window.removeEventListener("storage", sync);
    };
  }, [override]);

  const id: ShipFlagId = override ?? localId;


  if (id === "off") return null;

  return (
    <div
      className="absolute pointer-events-none z-30"
      style={{ left: "50%", top: "-22%", width: "22%", height: "18%" }}
    >
      {/* Mast / pole */}
      <div
        className="absolute"
        style={{
          left: "-3%",
          top: "-20%",
          width: "5%",
          height: "140%",
          background:
            "linear-gradient(90deg, #3b2410 0%, #a87338 35%, #f4d28a 50%, #a87338 65%, #3b2410 100%)",
          borderRadius: "2px",
          boxShadow: "0 2px 3px rgba(0,0,0,0.6)",
        }}
      />
      {/* Pole top knob */}
      <div
        className="absolute rounded-full"
        style={{
          left: "-5%",
          top: "-30%",
          width: "9%",
          height: "9%",
          background:
            "radial-gradient(circle at 35% 30%, #fff5c0 0%, #f0b53a 45%, #6b3a0a 100%)",
          boxShadow: "0 0 6px rgba(255,200,80,0.7)",
        }}
      />
      {/* Flag canvas with 3D wave */}
      <div
        className="absolute inset-0 animate-flag-wave"
        style={{ transformOrigin: "left center" }}
      >
        <FlagArt id={id} tribeEmblem={tribeEmblem} />
        {/* Shadow folds overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            clipPath: "polygon(0 0, 100% 0, 88% 50%, 100% 100%, 0 100%)",
            background:
              "linear-gradient(90deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 15%, rgba(255,255,255,0.18) 35%, rgba(0,0,0,0.3) 55%, rgba(255,255,255,0.12) 75%, rgba(0,0,0,0.35) 100%)",
            mixBlendMode: "overlay",
          }}
        />
        {/* Shimmer sweep */}
        <div
          className="absolute inset-0 overflow-hidden pointer-events-none"
          style={{ clipPath: "polygon(0 0, 100% 0, 88% 50%, 100% 100%, 0 100%)" }}
        >
          <div
            className="absolute top-0 h-full"
            style={{
              left: 0,
              width: "35%",
              background:
                "linear-gradient(100deg, transparent 0%, rgba(255,255,255,0.45) 50%, transparent 100%)",
              animation: "flag-shimmer 3.5s ease-in-out infinite",
              filter: "blur(2px)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function FlagArt({ id, tribeEmblem }: { id: ShipFlagId; tribeEmblem?: string | null }) {
  const clip = "polygon(0 0, 100% 0, 88% 50%, 100% 100%, 0 100%)";
  const shadow = "drop-shadow(0 3px 4px rgba(0,0,0,0.7)) drop-shadow(0 0 2px rgba(0,0,0,0.4))";

  if (id === "tribe" && tribeEmblem) {
    return (
      <div className="w-full h-full relative" style={{ filter: shadow }}>
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, #a32626 0%, #7c1d1d 50%, #4a0a0a 100%)",
            clipPath: clip,
            border: "1px solid rgba(0,0,0,0.5)",
          }}
        />
        <img
          src={tribeEmblem}
          alt=""
          className="absolute left-[18%] top-[15%] w-[55%] h-[70%] object-contain"
          draggable={false}
          style={{ clipPath: clip, filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.7))" }}
        />
      </div>
    );
  }

  if (id === "pirate-red") {
    return (
      <div
        className="w-full h-full"
        style={{
          background:
            "linear-gradient(180deg, #ef4444 0%, #b91c1c 50%, #7f1d1d 100%)",
          clipPath: clip,
          filter: shadow,
          border: "1px solid rgba(0,0,0,0.5)",
        }}
      />
    );
  }

  if (id === "crown-gold") {
    return (
      <svg viewBox="0 0 100 70" className="w-full h-full" style={{ filter: shadow }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="lux" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff7d6" />
            <stop offset="35%" stopColor="#fbbf24" />
            <stop offset="70%" stopColor="#b45309" />
            <stop offset="100%" stopColor="#451a03" />
          </linearGradient>
          <radialGradient id="luxGlow" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.5)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>
        <polygon points="0,0 100,0 88,35 100,70 0,70" fill="url(#lux)" stroke="rgba(0,0,0,0.55)" strokeWidth="1.2" />
        <polygon points="0,0 100,0 88,35 100,70 0,70" fill="url(#luxGlow)" />
        <path
          d="M26,44 L33,24 L42,38 L50,20 L58,38 L67,24 L74,44 Z M26,48 L74,48 L74,55 L26,55 Z"
          fill="#1f1300"
          opacity="0.92"
        />
        {/* crown jewels */}
        <circle cx="33" cy="24" r="2" fill="#dc2626" />
        <circle cx="50" cy="20" r="2.2" fill="#059669" />
        <circle cx="67" cy="24" r="2" fill="#2563eb" />
      </svg>
    );
  }

  if (id === "anchor-navy") {
    return (
      <svg viewBox="0 0 100 70" className="w-full h-full" style={{ filter: shadow }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="navyG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1e40af" />
            <stop offset="55%" stopColor="#0c2a4a" />
            <stop offset="100%" stopColor="#020617" />
          </linearGradient>
        </defs>
        <polygon points="0,0 100,0 88,35 100,70 0,70" fill="url(#navyG)" stroke="rgba(0,0,0,0.55)" strokeWidth="1.2" />
        <g fill="#e0f2fe" stroke="#0c2a4a" strokeWidth="0.4">
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
    <svg viewBox="0 0 100 70" className="w-full h-full" style={{ filter: shadow }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="jollyG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a2a2a" />
          <stop offset="50%" stopColor="#0a0a0a" />
          <stop offset="100%" stopColor="#000" />
        </linearGradient>
      </defs>
      <polygon points="0,0 100,0 88,35 100,70 0,70" fill="url(#jollyG)" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
      <g fill="#f4f4f5" stroke="#1f1f1f" strokeWidth="0.35">
        <ellipse cx="46" cy="28" rx="14" ry="12" />
        <rect x="40" y="36" width="12" height="6" rx="1" />
        <circle cx="41" cy="27" r="3" fill="#0a0a0a" />
        <circle cx="51" cy="27" r="3" fill="#0a0a0a" />
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
