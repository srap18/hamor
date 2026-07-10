// Strong device fingerprint that survives localStorage clearing, incognito,
// re-installs, and account switching on the same physical device.
//
// Returns:
//  - hash: composite SHA-256 of all signals (primary key)
//  - signals: raw components (server does weighted fuzzy matching if hash miss)

const CACHE_KEY = "hamor_hdid_v3";
const SIGNALS_CACHE_KEY = "hamor_hdid_signals_v3";

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
    return canvas.toDataURL().slice(-140);
  } catch { return "ec"; }
}

function webglSignal(): { vendor: string; renderer: string; params: string } {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") || c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return { vendor: "nw", renderer: "nw", params: "nw" };
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
    const renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const params = [
      gl.getParameter(gl.MAX_TEXTURE_SIZE),
      gl.getParameter(gl.MAX_VIEWPORT_DIMS),
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
      (gl.getSupportedExtensions() || []).sort().join(","),
    ].join("|");
    return { vendor, renderer, params };
  } catch { return { vendor: "ew", renderer: "ew", params: "ew" }; }
}

async function audioSignal(): Promise<string> {
  try {
    const AC = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    if (!AC) return "na";
    const ctx = new AC(1, 44100, 44100);
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 10000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -50; comp.knee.value = 40; comp.ratio.value = 12;
    comp.attack.value = 0; comp.release.value = 0.25;
    osc.connect(comp); comp.connect(ctx.destination);
    osc.start(0);
    const buf = await ctx.startRendering();
    const data = buf.getChannelData(0);
    let sum = 0;
    for (let i = 4500; i < 5000; i++) sum += Math.abs(data[i] || 0);
    return sum.toFixed(8);
  } catch { return "ea"; }
}

function fontsSignal(): string {
  try {
    const testFonts = [
      "Arial","Arial Black","Comic Sans MS","Courier New","Georgia","Impact",
      "Times New Roman","Trebuchet MS","Verdana","Tahoma","Helvetica",
      "Cambria","Calibri","Consolas","Segoe UI","Roboto","Noto Sans","SF Pro",
      "Al Bayan","Geeza Pro","Damascus","Baghdad","Traditional Arabic",
    ];
    const baseFonts = ["monospace","sans-serif","serif"];
    const testString = "mmmmmmmmmmlliحمور0O&1";
    const testSize = "72px";
    const span = document.createElement("span");
    span.style.position = "absolute"; span.style.left = "-9999px";
    span.style.fontSize = testSize;
    span.textContent = testString;
    document.body.appendChild(span);
    const baseSizes: Record<string,{w:number;h:number}> = {};
    for (const b of baseFonts) {
      span.style.fontFamily = b;
      baseSizes[b] = { w: span.offsetWidth, h: span.offsetHeight };
    }
    const detected: string[] = [];
    for (const f of testFonts) {
      let d = false;
      for (const b of baseFonts) {
        span.style.fontFamily = `'${f}',${b}`;
        if (span.offsetWidth !== baseSizes[b].w || span.offsetHeight !== baseSizes[b].h) {
          d = true; break;
        }
      }
      if (d) detected.push(f);
    }
    document.body.removeChild(span);
    return detected.sort().join(",");
  } catch { return "ef"; }
}

async function mediaDevicesSignal(): Promise<string> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return "nm";
    const devs = await navigator.mediaDevices.enumerateDevices();
    const counts = { audioinput: 0, audiooutput: 0, videoinput: 0 };
    for (const d of devs) counts[d.kind as keyof typeof counts] = (counts[d.kind as keyof typeof counts] || 0) + 1;
    return `a${counts.audioinput}o${counts.audiooutput}v${counts.videoinput}`;
  } catch { return "em"; }
}

export interface DeviceSignals {
  ua: string;
  platform: string;
  lang: string;
  langs: string;
  cores: string;
  memory: string;
  touch: string;
  screen: string;
  dpr: string;
  tz: string;
  tzOffset: string;
  canvas: string;
  webglVendor: string;
  webglRenderer: string;
  webglParams: string;
  audio: string;
  fonts: string;
  media: string;
}

async function collectSignals(): Promise<DeviceSignals> {
  const nav: any = typeof navigator !== "undefined" ? navigator : {};
  const scr: any = typeof screen !== "undefined" ? screen : {};
  const webgl = webglSignal();
  const [audio, media] = await Promise.all([audioSignal(), mediaDevicesSignal()]);
  return {
    ua: String(nav.userAgent || ""),
    platform: String(nav.platform || ""),
    lang: String(nav.language || ""),
    langs: (nav.languages || []).join(","),
    cores: String(nav.hardwareConcurrency ?? ""),
    memory: String(nav.deviceMemory ?? ""),
    touch: String(nav.maxTouchPoints ?? ""),
    screen: `${scr.width}x${scr.height}x${scr.colorDepth}x${scr.pixelDepth}`,
    dpr: String(window.devicePixelRatio ?? ""),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    tzOffset: String(new Date().getTimezoneOffset()),
    canvas: canvasSignal(),
    webglVendor: webgl.vendor,
    webglRenderer: webgl.renderer,
    webglParams: webgl.params,
    audio,
    fonts: fontsSignal(),
    media,
  };
}

function signalsToString(s: DeviceSignals): string {
  return Object.keys(s).sort().map((k) => `${k}=${(s as any)[k]}`).join("|");
}

/**
 * Legacy shim — returns just the hardware hash (composite SHA-256).
 * Prefer getDeviceFingerprint() when you also need the raw signals.
 */
export async function getHardwareFingerprint(): Promise<string> {
  const r = await getDeviceFingerprint();
  return r.hash;
}

/**
 * Returns { hash, signals }. Cached in localStorage for speed.
 */
export async function getDeviceFingerprint(): Promise<{ hash: string; signals: DeviceSignals }> {
  try {
    const cachedHash = localStorage.getItem(CACHE_KEY);
    const cachedSigs = localStorage.getItem(SIGNALS_CACHE_KEY);
    if (cachedHash && cachedHash.length >= 32 && cachedSigs) {
      return { hash: cachedHash, signals: JSON.parse(cachedSigs) };
    }
  } catch {}
  let signals: DeviceSignals;
  try { signals = await collectSignals(); }
  catch { signals = {} as DeviceSignals; }
  const hash = await sha256Hex(signalsToString(signals));
  try {
    localStorage.setItem(CACHE_KEY, hash);
    localStorage.setItem(SIGNALS_CACHE_KEY, JSON.stringify(signals));
  } catch {}
  return { hash, signals };
}
