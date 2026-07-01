import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Floating, collapsible, draggable repair-burned-bg button.
 * Position is persisted per-key via localStorage.
 *
 * Uses a `fixed inset-0` wrapper to discover the containing block
 * (MobileFrame uses `transform` which scopes `position: fixed` to
 * the frame), then positions the button in that container's pixel
 * coordinates so drag math always matches what you see.
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
  const BOTTOM_RESERVED = 140; // keep clear of bottom nav
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(true);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [bounds, setBounds] = useState<{ w: number; h: number } | null>(null);
  const dragging = useRef(false);
  const moved = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  // Measure container after mount + on resize
  useLayoutEffect(() => {
    const measure = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setBounds({ w: r.width, h: r.height });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  // Initial position (default near bottom-center) once we know container size
  useEffect(() => {
    if (!bounds) return;
    if (pos) {
      setPos((p) => (p ? clamp(p.x, p.y, bounds) : p));
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p?.x === "number" && typeof p?.y === "number") {
          setPos(clamp(p.x, p.y, bounds));
          return;
        }
      }
    } catch {}
    setPos({
      x: Math.max(MARGIN, bounds.w / 2 - 100),
      y: Math.max(MARGIN, bounds.h - BOTTOM_RESERVED - 60),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, storageKey]);

  function clamp(x: number, y: number, b: { w: number; h: number }) {
    const r = btnRef.current?.getBoundingClientRect();
    const elW = r?.width ?? (open ? 240 : SIZE);
    const elH = r?.height ?? (open ? 52 : SIZE);
    return {
      x: Math.max(MARGIN, Math.min(b.w - elW - MARGIN, x)),
      y: Math.max(MARGIN, Math.min(b.h - elH - BOTTOM_RESERVED, y)),
    };
  }

  function savePos(p: { x: number; y: number }) {
    try { localStorage.setItem(storageKey, JSON.stringify(p)); } catch {}
  }

  const startPt = useRef({ x: 0, y: 0 });
  function onPointerDown(e: React.PointerEvent) {
    if (!pos || !bounds || !wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    dragging.current = true;
    moved.current = false;
    startPt.current = { x: e.clientX, y: e.clientY };
    offset.current = { x: e.clientX - r.left - pos.x, y: e.clientY - r.top - pos.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current || !bounds || !wrapRef.current) return;
    // Real drag only if user moved > 12px from the initial tap point
    // (small finger jitter on tap must NOT count as a drag, otherwise
    // the click handler swallows the tap and the button feels dead).
    const dx = e.clientX - startPt.current.x;
    const dy = e.clientY - startPt.current.y;
    if (Math.hypot(dx, dy) < 12) return;
    moved.current = true;
    const r = wrapRef.current.getBoundingClientRect();
    const nx = e.clientX - r.left - offset.current.x;
    const ny = e.clientY - r.top - offset.current.y;
    setPos(clamp(nx, ny, bounds));
  }
  function onPointerUp() {
    if (!dragging.current) return;
    dragging.current = false;
    if (pos && moved.current) savePos(pos);
  }

  return (
    <div ref={wrapRef} className="fixed inset-0 z-40 pointer-events-none">
      {pos && (
        <div
          ref={btnRef}
          className="absolute pointer-events-auto touch-none select-none"
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
                  if (moved.current) { e.preventDefault(); moved.current = false; return; }
                  onRepair();
                }}
                className="px-4 py-2 rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200 text-white text-sm font-extrabold shadow-2xl active:scale-95 flex items-center gap-1.5 animate-pulse"
              >
                🛠️ {label} <span className="text-cyan-200">💎100</span>
              </button>
              <button
                onClick={(e) => {
                  if (moved.current) { e.preventDefault(); moved.current = false; return; }
                  setOpen(false);
                }}
                aria-label="طي"
                className="w-8 h-8 rounded-full bg-stone-900/90 border border-emerald-300/50 text-emerald-100 text-sm font-black shadow-lg active:scale-95"
              >×</button>
            </div>
          ) : (
            <button
              onClick={(e) => {
                if (moved.current) { e.preventDefault(); moved.current = false; return; }
                setOpen(true);
              }}
              aria-label="فتح إصلاح الخلفية"
              className="w-11 h-11 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200 text-white text-lg shadow-2xl active:scale-95 flex items-center justify-center animate-pulse"
            >🛠️</button>
          )}
        </div>
      )}
    </div>
  );
}
