// Page Lifecycle Management — pauses background work when the tab is hidden,
// resumes smoothly when it becomes visible, and exposes a global "isVisible"
// signal that other modules (swr-cache, sound, etc.) can subscribe to.
//
// Goals:
//   • CPU goes 100% to the active page.
//   • Background tabs/components stop running setInterval / requestAnimationFrame.
//   • Network revalidation runs at a slower cadence in the background.
//   • Coming back to a page resumes instantly and revalidates fresh data.

import { useEffect, useRef, useState } from "react";

const isBrowser = typeof document !== "undefined";

// ---- Global visibility signal ------------------------------------------------

type Listener = (visible: boolean) => void;
const listeners = new Set<Listener>();
let _visible = isBrowser ? document.visibilityState !== "hidden" : true;

if (isBrowser) {
  document.addEventListener("visibilitychange", () => {
    const v = document.visibilityState !== "hidden";
    if (v === _visible) return;
    _visible = v;
    listeners.forEach((fn) => { try { fn(v); } catch {} });
  });
}

export function isDocumentVisible(): boolean { return _visible; }

export function onVisibilityChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useDocumentVisible(): boolean {
  const [v, setV] = useState(_visible);
  useEffect(() => onVisibilityChange(setV), []);
  return v;
}

// ---- Visibility-aware setInterval -------------------------------------------
// Pauses when hidden, resumes (and fires once immediately) when visible.
// Optional `bgMs` lets callers run at a slower cadence in the background
// instead of fully pausing (default: pause).

export function useVisibleInterval(
  fn: () => void,
  ms: number,
  opts: { bgMs?: number; runOnResume?: boolean } = {},
) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const { bgMs, runOnResume = true } = opts;

  useEffect(() => {
    if (ms <= 0) return;
    let id: ReturnType<typeof setInterval> | null = null;

    const start = (delay: number) => {
      if (id) clearInterval(id);
      id = setInterval(() => { try { fnRef.current(); } catch {} }, delay);
    };
    const stop = () => { if (id) { clearInterval(id); id = null; } };

    const apply = (visible: boolean) => {
      if (visible) {
        if (runOnResume) { try { fnRef.current(); } catch {} }
        start(ms);
      } else if (bgMs && bgMs > 0) {
        start(bgMs);
      } else {
        stop();
      }
    };

    apply(_visible);
    const off = onVisibilityChange(apply);
    return () => { off(); stop(); };
  }, [ms, bgMs, runOnResume]);
}

// ---- Visibility-aware requestAnimationFrame ---------------------------------
// Stops the rAF loop when hidden; resumes on visibility.

export function useVisibleRaf(tick: (dtMs: number) => void, enabled = true) {
  const fnRef = useRef(tick);
  fnRef.current = tick;

  useEffect(() => {
    if (!enabled || !isBrowser) return;
    let raf = 0;
    let last = performance.now();
    let running = _visible;

    const loop = (t: number) => {
      const dt = t - last;
      last = t;
      try { fnRef.current(dt); } catch {}
      if (running) raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (raf) return;
      last = performance.now();
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    };

    if (_visible) start();
    const off = onVisibilityChange((v) => { v ? start() : stop(); });
    return () => { off(); stop(); };
  }, [enabled]);
}
