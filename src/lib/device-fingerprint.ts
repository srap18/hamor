// Strong device fingerprint that survives localStorage clearing, incognito,
// re-installs, and account switching on the same physical device.
//
// We hash a set of stable hardware + browser signals into a single ID.
// Cached in localStorage for speed only — recomputed on demand if missing.

const CACHE_KEY = "hamor_hdid_v2";

async function sha256Hex(input: string): Promise<string> {
  try {
    const buf = new TextEncoder().encode(input);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    let h = 0;
    for (let i = 0; i < input.length; i++) {
      h = ((h << 5) - h + input.charCodeAt(i)) | 0;
    }
    return "fb" + Math.abs(h).toString(16).padStart(8, "0").repeat(4);
  }
}

function canvasSignal(): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 240; canvas.height = 60;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "nc";
    ctx.textBaseline = "top";
    ctx.font = "16px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 100, 40);
    ctx.fillStyle = "#069";
    ctx.fillText("Hamor⚓Fingerprint😀", 2, 10);
    ctx.fillStyle = "rgba(102,204,0,0.7)";
    ctx.fillText("Hamor⚓Fingerprint😀", 4, 17);
    return canvas.toDataURL().slice(-120);
  } catch { return "ec"; }
}

function webglSignal(): string {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") || c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "nw";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return `${vendor}|${renderer}`;
  } catch { return "ew"; }
}

function collectSignals(): string {
  const nav: any = typeof navigator !== "undefined" ? navigator : {};
  const scr: any = typeof screen !== "undefined" ? screen : {};
  const parts = [
    nav.userAgent || "",
    nav.platform || "",
    nav.language || "",
    (nav.languages || []).join(","),
    String(nav.hardwareConcurrency ?? ""),
    String(nav.deviceMemory ?? ""),
    String(nav.maxTouchPoints ?? ""),
    `${scr.width}x${scr.height}x${scr.colorDepth}x${scr.pixelDepth}`,
    String(window.devicePixelRatio ?? ""),
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    String(new Date().getTimezoneOffset()),
    canvasSignal(),
    webglSignal(),
  ];
  return parts.join("|");
}

/**
 * Returns a strong hardware/browser fingerprint (~64 hex chars).
 * Same physical device → same ID even after clearing storage or new account.
 */
export async function getHardwareFingerprint(): Promise<string> {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached && cached.length >= 32) return cached;
  } catch {}
  let hex = "";
  try {
    hex = await sha256Hex(collectSignals());
  } catch { hex = ""; }
  if (hex) {
    try { localStorage.setItem(CACHE_KEY, hex); } catch {}
  }
  return hex;
}
