// Auto-detect low-power devices and expose flags to reduce heat & battery drain.
// Sets `html.low-perf` when in reduced mode so CSS can strip heavy animations.

function detect(): { lite: boolean; lowBw: boolean } {
  if (typeof window === "undefined") return { lite: false, lowBw: false };
  try {
    const nav: any = navigator;
    const conn = nav?.connection || {};
    const saveData = !!conn.saveData;
    const slow = ["slow-2g", "2g", "3g"].includes(String(conn.effectiveType || ""));
    const lowMem = typeof nav?.deviceMemory === "number" && nav.deviceMemory <= 3;
    const lowCores = typeof nav?.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 4;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    const forced = (() => { try { return localStorage.getItem("perf:lite") === "1"; } catch { return false; } })();
    const isIOS = /iP(hone|ad|od)/.test(nav.platform || "") || (nav.userAgent?.includes("Mac") && "ontouchend" in document);
    return {
      lite: forced || saveData || reduced || (lowMem && lowCores) || isIOS,
      lowBw: saveData || slow,
    };
  } catch {
    return { lite: false, lowBw: false };
  }
}

const detected = detect();

export const isLowPerfMode: boolean = detected.lite;
export const isHeavyFxDisabled: boolean = detected.lite;
export const isLowBandwidth: boolean = detected.lowBw;

if (typeof document !== "undefined" && detected.lite) {
  try { document.documentElement.classList.add("low-perf"); } catch { /* noop */ }
}

export function setPerfLite(on: boolean) {
  try {
    localStorage.setItem("perf:lite", on ? "1" : "0");
    if (on) document.documentElement.classList.add("low-perf");
    else document.documentElement.classList.remove("low-perf");
  } catch { /* noop */ }
}
