import { useEffect, useState } from "react";
import { serverNowMs } from "@/lib/server-time";

// Shared 1-second ticker. ONE setInterval for the whole app, multiplexed to all
// subscribers via useSyncExternalStore-style pattern. This replaces N separate
// `setInterval(() => setNow(serverNowMs()), 1000)` calls that each caused
// independent React re-renders.

type Listener = (now: number) => void;
const listeners = new Set<Listener>();
let currentNow = 0;
let interval: ReturnType<typeof setInterval> | null = null;

function ensureRunning() {
  if (interval) return;
  currentNow = serverNowMs();
  interval = setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    currentNow = serverNowMs();
    // Snapshot listeners to avoid mutation during iteration.
    for (const fn of Array.from(listeners)) fn(currentNow);
  }, 1000);
}

function stopIfIdle() {
  if (listeners.size === 0 && interval) {
    clearInterval(interval);
    interval = null;
  }
}

/**
 * Subscribe to a shared 1-second `serverNowMs()` tick. Returns the current ms.
 * Use this instead of `useEffect(() => setInterval(..., 1000))` everywhere a
 * component just needs to recompute "time remaining" labels every second.
 */
export function useServerTick(): number {
  const [now, setNow] = useState<number>(() => {
    if (currentNow === 0) currentNow = serverNowMs();
    return currentNow;
  });
  useEffect(() => {
    const fn: Listener = (t) => setNow(t);
    listeners.add(fn);
    ensureRunning();
    // Refresh immediately on subscribe so the new consumer doesn't wait up to 1s.
    setNow(serverNowMs());
    return () => {
      listeners.delete(fn);
      stopIfIdle();
    };
  }, []);
  return now;
}
