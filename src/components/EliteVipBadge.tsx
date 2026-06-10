import { getEliteVipTier } from "@/lib/elite-vip";

type Props = {
  level: number | null | undefined;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  showLabel?: boolean;
  className?: string;
};

const SIZES = {
  xs: "w-4 h-4",
  sm: "w-6 h-6",
  md: "w-8 h-8",
  lg: "w-12 h-12",
  xl: "w-20 h-20",
} as const;

/** Renders the Elite VIP medallion badge. Returns null if user has no VIP. */
export function EliteVipBadge({ level, size = "sm", showLabel = false, className = "" }: Props) {
  const tier = getEliteVipTier(level);
  if (!tier) return null;
  return (
    <span className={`inline-flex items-center gap-1 align-middle ${className}`} title={`Elite VIP ${tier.level} — ${tier.nameAr}`}>
      <img
        src={tier.badge}
        alt={`VIP ${tier.level}`}
        loading="lazy"
        className={`${SIZES[size]} object-contain shrink-0 drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]`}
      />
      {showLabel && (
        <span className="text-xs font-bold text-amber-300">
          VIP {tier.level}
        </span>
      )}
    </span>
  );
}

/** Wraps an avatar / display name with a VIP frame (glowing ring around child). */
export function EliteVipFrame({
  level,
  children,
  className = "",
}: {
  level: number | null | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  const tier = getEliteVipTier(level);
  if (!tier) return <>{children}</>;
  return (
    <div className={`relative inline-block rounded-full ring-4 ${tier.ringClass} ${className}`}>
      {children}
    </div>
  );
}

/** Applies VIP-tier-specific name color styling to chat / nameplates. */
export function eliteVipNameClass(level: number | null | undefined): string {
  const tier = getEliteVipTier(level);
  return tier?.nameColorClass ?? "";
}
