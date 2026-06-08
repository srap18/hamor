// Detects weak devices / slow networks so heavy media can degrade gracefully.
// Pure read of browser hints — no listeners, no React.

type Nav = Navigator & {
  connection?: {
    saveData?: boolean;
    effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
    downlink?: number;
  };
  deviceMemory?: number;
};

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

/** True when network is slow or save-data is on. */
export const isLowBandwidth = cached.lowNet;
/** True when CPU/memory is constrained. */
export const isLowEndDevice = cached.lowDevice;
/** Any kind of weakness — use to disable heavy media/animations. */
export const isLowPerfMode = cached.lowNet || cached.lowDevice;

// Side-effect: tag the document root so CSS can disable expensive
// continuous animations on weak devices (see styles.css `.low-perf`).
if (typeof document !== "undefined" && isLowPerfMode) {
  try { document.documentElement.classList.add("low-perf"); } catch {}
}
