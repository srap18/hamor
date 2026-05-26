// Unified ship art — single source of truth (src/lib/ships.ts).
import { getShipByMarketLevel } from "@/lib/ships";

type Props = {
  level: number;
  size?: number;
  grayscale?: boolean;
  className?: string;
};

export function tierOf(level: number) {
  return Math.min(6, Math.max(1, Math.ceil(level / 5)));
}

export function shipImageForLevel(level: number) {
  return getShipByMarketLevel(level).image;
}

export default function ShipArt({ level, size = 96, grayscale, className }: Props) {
  const src = shipImageForLevel(level);
  return (
    <img
      src={src}
      alt={`Ship level ${level}`}
      width={size}
      height={size}
      loading="lazy"
      className={className}
      style={{
        width: size,
        height: "auto",
        objectFit: "contain",
        filter: grayscale ? "grayscale(1) opacity(0.55)" : "drop-shadow(0 8px 16px rgba(0,0,0,0.5))",
        display: "block",
      }}
    />
  );
}
