import { useEffect, useRef, useState } from "react";

/**
 * Floating, collapsible, draggable repair-burned-bg button.
 * Position is persisted per-key via localStorage.
 */
export function DraggableRepairBgButton({
  storageKey,
  onRepair,
  label = "إصلاح الخلفية",
}: {
  storageKey: string;
  onRepair: () => Promise<void> | void;
  label?: string;
}) {
  const SIZE = 44;
  const MARGIN = 6;
  const [open, setOpen] = useState(true);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const moved = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  // initial position
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p?.x === "number" && typeof p?.y === "number") {
          setPos(clamp(p.x, p.y));
          return;
        }
      }
    } catch {}
    const w = window.innerWidth;
    const h = window.innerHeight;
    setPos({ x: Math.max(MARGIN, w / 2 - 90), y: Math.max(MARGIN, h - 180) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function clamp(x: number, y: number) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const elW = open ? 220 : SIZE;
    const elH = open ? 52 : SIZE;
    return {
      x: Math.max(MARGIN, Math.min(w - elW - MARGIN, x)),
      y: Math.max(MARGIN, Math.min(h - elH - MARGIN, y)),
    };
  }

  function savePos(p: { x: number; y: number }) {
    try { localStorage.setItem(storageKey, JSON.stringify(p)); } catch {}
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!pos) return;
    dragging.current = true;
    moved.current = false;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const nx = e.clientX - offset.current.x;
    const ny = e.clientY - offset.current.y;
    const c = clamp(nx, ny);
    if (Math.abs(nx - (pos?.x ?? 0)) + Math.abs(ny - (pos?.y ?? 0)) > 4) moved.current = true;
    setPos(c);
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!dragging.current) return;
    dragging.current = false;
    if (pos) savePos(pos);
    if (moved.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  if (!pos) return null;

  return (
    <div
      className="fixed z-40 touch-none select-none"
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {open ? (
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              if (moved.current) { e.preventDefault(); return; }
              onRepair();
            }}
            className="px-4 py-2 rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200 text-white text-sm font-extrabold shadow-2xl active:scale-95 flex items-center gap-1.5 animate-pulse"
          >
            🛠️ {label} <span className="text-cyan-200">💎100</span>
          </button>
          <button
            onClick={(e) => {
              if (moved.current) { e.preventDefault(); return; }
              setOpen(false);
            }}
            aria-label="طي"
            className="w-8 h-8 rounded-full bg-stone-900/90 border border-emerald-300/50 text-emerald-100 text-sm font-black shadow-lg active:scale-95"
          >×</button>
        </div>
      ) : (
        <button
          onClick={(e) => {
            if (moved.current) { e.preventDefault(); return; }
            setOpen(true);
          }}
          aria-label="فتح إصلاح الخلفية"
          className="w-11 h-11 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200 text-white text-lg shadow-2xl active:scale-95 flex items-center justify-center animate-pulse"
        >🛠️</button>
      )}
    </div>
  );
}
