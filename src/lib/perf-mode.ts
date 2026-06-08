// Detects weak devices / slow networks so heavy media can degrade gracefully.
// Pure read of browser hints + a user-toggleable "Lite Mode" stored locally.

type Nav = Navigator & {
  connection?: {
    saveData?: boolean;
    effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
    downlink?: number;
  };
  deviceMemory?: number;
};

const LITE_KEY = "lite-mode";

function readUserLite(): boolean {
  if (typeof localStorage === "undefined") return false;
  try { return localStorage.getItem(LITE_KEY) === "1"; } catch { return false; }
}

function read(): { lowNet: boolean; lowDevice: boolean } {
  if (typeof navigator === "undefined") return { lowNet: false, lowDevice: false };
  const n = navigator as Nav;
  const conn = n.connection;
  const lowNet = !!(
    conn?.saveData ||
    (conn?.effectiveType && /(^|-)2g$/.test(conn.effectiveType)) ||
    conn?.effectiveType === "3g" ||
    (typeof conn?.downlink === "number" && conn.downlink > 0 && conn.downlink < 1.5)
  );
  const cores = n.hardwareConcurrency || 8;
  const mem = n.deviceMemory || 8;
  const lowDevice = cores <= 4 || mem <= 3;
  return { lowNet, lowDevice };
}

const cached = read();
const userLite = readUserLite();

/** True when network is slow or save-data is on. */
export const isLowBandwidth = cached.lowNet;
/** True when CPU/memory is constrained. */
export const isLowEndDevice = cached.lowDevice;
/** Any kind of weakness OR user opted into Lite Mode — disable heavy media. */
export const isLowPerfMode = cached.lowNet || cached.lowDevice || userLite;
/** True only when the user explicitly enabled Lite Mode. */
export const isUserLiteMode = userLite;

export function getLiteMode(): boolean {
  return readUserLite();
}

export function setLiteMode(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(LITE_KEY, "1");
    else localStorage.removeItem(LITE_KEY);
  } catch { /* noop */ }
  // Hard reload so all module-level `isLowPerfMode` consumers pick up the change.
  if (typeof window !== "undefined") window.location.reload();
}

// Side-effect: tag the document root so CSS can disable expensive
// continuous animations on weak devices (see styles.css `.low-perf`).
if (typeof document !== "undefined" && isLowPerfMode) {
  try { document.documentElement.classList.add("low-perf"); } catch {}
}
