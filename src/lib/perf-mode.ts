// Auto-detect low-power devices and enable a "lite" render mode to reduce heat.
// Sets `data-perf-lite="1"` on <html> when detected. Components can read
// `isPerfLite()` to skip heavy background videos, particles, and blurs.

let cached: boolean | null = null;

export function isPerfLite(): boolean {
  if (cached !== null) return cached;
  if (typeof window === "undefined") return false;
  try {
    const nav: any = navigator;
    const saveData = !!nav?.connection?.saveData;
    const lowMem = typeof nav?.deviceMemory === "number" && nav.deviceMemory <= 3;
    const lowCores = typeof nav?.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 4;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    const userForced = localStorage.getItem("perf:lite") === "1";
    cached = userForced || saveData || reduced || (lowMem && lowCores);
  } catch {
    cached = false;
  }
  if (cached) {
    try { document.documentElement.setAttribute("data-perf-lite", "1"); } catch { /* noop */ }
  }
  return cached;
}

// Force perf lite manually (settings toggle).
export function setPerfLite(on: boolean) {
  try {
    localStorage.setItem("perf:lite", on ? "1" : "0");
    cached = on;
    if (on) document.documentElement.setAttribute("data-perf-lite", "1");
    else document.documentElement.removeAttribute("data-perf-lite");
  } catch { /* noop */ }
}
