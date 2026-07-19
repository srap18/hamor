import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

export type BannerOptions = {
  kind?: "purchase" | "catch" | "info";
  title: string;
  subtitle?: string;
  emoji?: string;
  image?: string;
  count?: number;
  duration?: number;
};

function BannerUI({ opts, onDone }: { opts: BannerOptions; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const dur = Math.min(opts.duration ?? 2200, 3000);
  useEffect(() => {
    setOpen(true);
    const t = setTimeout(() => setOpen(false), dur);
    const t2 = setTimeout(() => onDone(), dur + 350);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [onDone, dur]);

  const isCatch = opts.kind === "catch";
  const isPurchase = opts.kind === "purchase";
  const tone = isCatch
    ? "from-cyan-500/95 via-sky-600/95 to-blue-700/95 border-cyan-200"
    : isPurchase
    ? "from-amber-400/95 via-amber-500/95 to-orange-600/95 border-amber-100"
    : "from-slate-700/95 to-slate-900/95 border-white/30";
  const label = isCatch ? "🎣 صيدة جديدة" : isPurchase ? "🛒 تم الشراء" : "";

  return (
    <div
      dir="rtl"
      onClick={() => setOpen(false)}
      className={`fixed left-1/2 top-20 z-[9998] -translate-x-1/2 pointer-events-auto cursor-pointer transition-all duration-300 ${
        open ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"
      }`}
    >
      <div
        className={`flex items-center gap-3 rounded-2xl border-2 bg-gradient-to-r ${tone} px-4 py-3 shadow-2xl backdrop-blur-md min-w-[260px] max-w-[92vw]`}
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/20 text-3xl shadow-inner overflow-hidden">
          {opts.image ? (
            <img src={opts.image} alt="" className="h-12 w-12 object-cover" />
          ) : (
            <span>{opts.emoji ?? "✨"}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          {label && <div className="text-[10px] font-black text-white/85 tracking-wide">{label}</div>}
          <div className="text-sm font-black text-white truncate drop-shadow">{opts.title}</div>
          {opts.subtitle && (
            <div className="text-[11px] font-bold text-white/90 truncate">{opts.subtitle}</div>
          )}
        </div>
        {typeof opts.count === "number" && (
          <div className="shrink-0 rounded-lg bg-white/25 px-2.5 py-1 text-base font-black text-white shadow-inner">
            ×{opts.count}
          </div>
        )}
      </div>
    </div>
  );
}

export function showBanner(opts: BannerOptions): void {
  if (typeof window === "undefined") return;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const cleanup = () => {
    setTimeout(() => { root.unmount(); host.remove(); }, 50);
  };
  root.render(<BannerUI opts={opts} onDone={cleanup} />);
}
