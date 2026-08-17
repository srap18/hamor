import React from "react";

type Role = "owner" | "moderator" | "founder";

const GRADIENTS: Record<Role, { from: string; to: string; shadow: string; border: string }> = {
  owner: {
    from: "#fbf5b7",
    to: "#b48811",
    shadow: "rgba(244, 196, 48, 0.55)",
    border: "rgba(255, 248, 184, 0.65)",
  },
  moderator: {
    from: "#e2e8f0",
    to: "#475569",
    shadow: "rgba(148, 163, 184, 0.45)",
    border: "rgba(255, 255, 255, 0.55)",
  },
  founder: {
    from: "#fdba74",
    to: "#7c2d12",
    shadow: "rgba(251, 146, 60, 0.45)",
    border: "rgba(255, 215, 170, 0.55)",
  },
};

const ICONS: Record<Role, React.ReactNode> = {
  owner: (
    <path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5M19 19C19 19.6 18.6 20 18 20H6C5.4 20 5 19.6 5 19V18H19V19Z" />
  ),
  moderator: (
    <path d="M12 1L3 5V11C3 16.55 6.84 21.74 12 23C17.16 21.74 21 16.55 21 11V5L12 1ZM12 11.99V20.92C8.13 19.7 5 15.65 5 11V6.3L12 3.19V11.99Z" />
  ),
  founder: (
    <path d="M12 2C10.5 3 8.5 4 6 4C6 8 8 12 12 14C16 12 18 8 18 4C15.5 4 13.5 3 12 2ZM12 16C8 13 4 9 4 4C4 4 4 4 4 4V22H20V4C20 9 16 13 12 16ZM12 19C14 18 16 17 17 16V19H12Z" />
  ),
};

const LABELS: Record<Role, string> = {
  owner: "القائد",
  moderator: "المشرف",
  founder: "المؤسس",
};

export function TribeRoleBadge({ role, showLabel = false, size = "md" }: { role: Role; showLabel?: boolean; size?: "sm" | "md" | "lg" }) {
  const g = GRADIENTS[role];
  const dims = size === "sm" ? 16 : size === "md" ? 20 : 24;
  const labelClass = size === "sm" ? "text-[10px]" : size === "md" ? "text-xs" : "text-sm";

  return (
    <span className="inline-flex items-center gap-1 align-middle" title={LABELS[role]}>
      <span
        className="relative inline-flex items-center justify-center rounded-full"
        style={{
          width: dims,
          height: dims,
          background: `linear-gradient(180deg, ${g.from} 0%, ${g.to} 100%)`,
          boxShadow: `0 0 10px ${g.shadow}, inset 0 1px 1px rgba(255,255,255,0.5)`,
          border: `1px solid ${g.border}`,
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="relative z-10"
          style={{
            width: dims * 0.6,
            height: dims * 0.6,
            color: role === "owner" ? "#5c4002" : role === "founder" ? "#3f1606" : "#0f172a",
            filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.25))",
          }}
        >
          {ICONS[role]}
        </svg>
        <span
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background: "linear-gradient(135deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 55%)",
          }}
        />
      </span>
      {showLabel && (
        <span
          className={`font-bold ${labelClass} ${
            role === "owner" ? "text-amber-300" : role === "founder" ? "text-orange-300" : "text-slate-300"
          }`}
        >
          {LABELS[role]}
        </span>
      )}
    </span>
  );
}
