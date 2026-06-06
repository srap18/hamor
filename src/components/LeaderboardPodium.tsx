import { ReactNode } from "react";

export type PodiumItem = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  avatarEmoji?: string | null;
  subtitle?: ReactNode;
  value: ReactNode;
  isMe?: boolean;
  onClick?: () => void;
};

type Slot = {
  rank: 1 | 2 | 3;
  heightClass: string;
  ringColor: string;
  bgGradient: string;
  borderColor: string;
  badge: string;
  badgeBg: string;
  textColor: string;
  shadow: string;
};

const SLOTS: Record<1 | 2 | 3, Slot> = {
  1: {
    rank: 1,
    heightClass: "pt-2 pb-3",
    ringColor: "ring-amber-300",
    bgGradient: "from-amber-500 via-yellow-400 to-amber-600",
    borderColor: "border-amber-300",
    badge: "👑",
    badgeBg: "bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 border-amber-200",
    textColor: "text-amber-950",
    shadow: "shadow-[0_0_22px_rgba(251,191,36,0.7)]",
  },
  2: {
    rank: 2,
    heightClass: "pt-5 pb-3",
    ringColor: "ring-slate-200",
    bgGradient: "from-slate-400 via-slate-200 to-slate-500",
    borderColor: "border-slate-200",
    badge: "2",
    badgeBg: "bg-gradient-to-b from-slate-100 to-slate-300 text-slate-900 border-slate-100",
    textColor: "text-slate-900",
    shadow: "shadow-[0_0_16px_rgba(203,213,225,0.55)]",
  },
  3: {
    rank: 3,
    heightClass: "pt-7 pb-3",
    ringColor: "ring-orange-300",
    bgGradient: "from-orange-500 via-amber-500 to-orange-700",
    borderColor: "border-orange-300",
    badge: "3",
    badgeBg: "bg-gradient-to-b from-orange-300 to-orange-500 text-amber-950 border-orange-200",
    textColor: "text-amber-950",
    shadow: "shadow-[0_0_16px_rgba(249,115,22,0.55)]",
  },
};

function PodiumCard({ item, slot }: { item: PodiumItem; slot: Slot }) {
  const Wrapper: any = item.onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={item.onClick}
      className={`relative flex-1 min-w-0 ${slot.heightClass} pb-5 active:scale-[0.98] transition`}
    >
      {/* Medal banner top */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
        <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-black ${slot.badgeBg} ${slot.shadow}`}>
          {slot.badge}
        </div>
      </div>

      {/* Banner / shield shape (clipped) */}
      <div
        className={`relative bg-gradient-to-b ${slot.bgGradient} border-2 ${slot.borderColor} ${slot.shadow} px-2 pt-5 pb-6`}
        style={{
          clipPath: "polygon(0 0, 100% 0, 100% 82%, 50% 100%, 0 82%)",
        }}
      >
        {/* Avatar */}
        <div className="flex justify-center mb-1">
          <div className={`w-14 h-14 rounded-full overflow-hidden ring-2 ${slot.ringColor} bg-gradient-to-b from-sky-400 to-sky-700 flex items-center justify-center text-2xl shadow-lg`}>
            {item.avatarUrl ? (
              <img src={item.avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span>{item.avatarEmoji || "🧑‍✈️"}</span>
            )}
          </div>
        </div>

        {/* Name */}
        <div className={`text-center text-[11px] font-black truncate ${slot.textColor} px-1`}>
          {item.name}{item.isMe ? " (أنت)" : ""}
        </div>

        {/* Subtitle */}
        {item.subtitle && (
          <div className={`text-center text-[9px] font-bold opacity-80 ${slot.textColor} truncate px-1`}>
            {item.subtitle}
          </div>
        )}
      </div>

      {/* Value — rendered OUTSIDE the clipped shield so coins/gems/xp never get cut off */}
      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 z-30 w-[92%] flex justify-center pointer-events-none">
        <div className={`px-2 py-0.5 rounded-md bg-black/70 text-amber-200 text-[11px] font-black tabular-nums inline-flex items-center gap-1 shadow-lg border border-amber-300/40 whitespace-nowrap`}>
          {item.value}
        </div>
      </div>
    </Wrapper>
  );
}

export function LeaderboardPodium({ items }: { items: PodiumItem[] }) {
  if (!items || items.length < 3) return null;
  const [first, second, third] = items;
  return (
    <div className="mb-3 px-1 pt-3">
      <div className="flex items-end gap-2">
        {/* 2nd */}
        <PodiumCard item={second} slot={SLOTS[2]} />
        {/* 1st (center, tallest) */}
        <PodiumCard item={first} slot={SLOTS[1]} />
        {/* 3rd */}
        <PodiumCard item={third} slot={SLOTS[3]} />
      </div>
    </div>
  );
}
