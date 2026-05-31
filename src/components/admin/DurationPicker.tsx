import { useEffect, useState } from "react";

/**
 * "Days + hours from now" picker. Returns an ISO string via onChange,
 * or null when both fields are 0 and `allowZero` is true.
 */
export function DurationPicker({
  label,
  days,
  hours,
  onChange,
  allowZero = false,
  zeroLabel = "بدون انتهاء",
}: {
  label: string;
  days: number;
  hours: number;
  onChange: (days: number, hours: number) => void;
  allowZero?: boolean;
  zeroLabel?: string;
}) {
  const total = days * 24 + hours;
  const target = total > 0 ? new Date(Date.now() + total * 3600_000) : null;

  return (
    <div className="block">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-1 px-2 py-2 rounded-lg bg-slate-800 border border-slate-700">
            <input
              type="number"
              min={0}
              value={days}
              onChange={(e) => onChange(Math.max(0, +e.target.value | 0), hours)}
              className="w-full bg-transparent text-center outline-none"
            />
            <span className="text-xs text-slate-400 px-1">يوم</span>
          </div>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-1 px-2 py-2 rounded-lg bg-slate-800 border border-slate-700">
            <input
              type="number"
              min={0}
              max={23}
              value={hours}
              onChange={(e) => onChange(days, Math.max(0, Math.min(23, +e.target.value | 0)))}
              className="w-full bg-transparent text-center outline-none"
            />
            <span className="text-xs text-slate-400 px-1">ساعة</span>
          </div>
        </div>
      </div>
      <div className="text-[11px] text-slate-500 mt-1">
        {target
          ? `≈ ${target.toLocaleString("ar")}`
          : allowZero
          ? zeroLabel
          : "حدد المدة"}
      </div>
    </div>
  );
}

/** Convenience hook: returns [days, hours, setDays, setHours, toIsoFromNow]. */
export function useDuration(initialDays = 0, initialHours = 0) {
  const [days, setDays] = useState(initialDays);
  const [hours, setHours] = useState(initialHours);
  const total = days * 24 + hours;
  const toIso = () => (total > 0 ? new Date(Date.now() + total * 3600_000).toISOString() : null);
  const reset = (d = 0, h = 0) => { setDays(d); setHours(h); };
  return { days, hours, setDays, setHours, toIso, reset, totalHours: total };
}

/** Format a future ISO date as "خلال 3ي 2س" countdown. */
export function formatTimeLeft(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "انتهت";
  const d = Math.floor(ms / 86400_000);
  const h = Math.floor((ms % 86400_000) / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  if (d > 0) return `${d}ي ${h}س`;
  if (h > 0) return `${h}س ${m}د`;
  return `${m}د`;
}

// Silence unused import warning when this file is built standalone
void useEffect;
