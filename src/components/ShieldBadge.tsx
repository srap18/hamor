import { useEffect, useState } from "react";
import { useProfile } from "@/hooks/use-auth";

function fmt(ms: number) {
  if (ms <= 0) return "";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}ي ${h}س`;
  if (h > 0) return `${h}س ${m}د`;
  return `${m}د`;
}

export function ShieldBadge() {
  const { profile } = useProfile();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const until = profile?.protection_until ? new Date(profile.protection_until).getTime() : 0;
  const remain = until - now;
  if (remain <= 0) return null;
  return (
    <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border-2 border-emerald-300 bg-gradient-to-b from-emerald-700 to-emerald-900 shadow text-[10px] font-black text-emerald-50">
      🛡️ <span className="tabular-nums">{fmt(remain)}</span>
    </div>
  );
}
