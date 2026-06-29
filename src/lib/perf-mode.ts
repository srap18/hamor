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
  // Lite mode was removed because it caused stuck/hanging UI for some users.
  // Force-clear any previously stored preference and always report disabled.
  try { localStorage.removeItem(LITE_KEY); } catch { /* noop */ }
  return false;
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
  // Only mark as low-end for genuinely weak devices, otherwise animated
  // backgrounds get disabled on normal mid-range phones (4 cores / 3GB).
  const lowDevice = cores <= 2 && mem <= 1;
  return { lowNet, lowDevice };
}

const cached = read();
const userLite = readUserLite();

function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIPad = /iPad|Macintosh/.test(ua) && typeof document !== "undefined" && "ontouchend" in document;
  return /iPhone|iPod/.test(ua) || isIPad;
}

/** True when network is slow or save-data is on. */
export const isLowBandwidth = cached.lowNet;
/** True when CPU/memory is constrained. */
export const isLowEndDevice = cached.lowDevice;
/** True on iOS — Safari struggles with looping video bg + many CSS-animated blurred layers (overheating). */
export const isIOSDevice = detectIOS();
/** Any kind of weakness OR user opted into Lite Mode — disable heavy media. */
export const isLowPerfMode = cached.lowNet || cached.lowDevice || userLite;
/** Heavy continuous GPU effects (video bg, blurred particles, many animated images) should be skipped. */
export const isHeavyFxDisabled = isLowPerfMode || isIOSDevice;
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
