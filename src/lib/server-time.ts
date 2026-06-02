import { supabase } from "@/integrations/supabase/client";

// Server clock anchored to monotonic performance.now(), so changing the
// phone/device clock after sync cannot advance game timers.
let offsetMs = 0;
let anchorServerMs = 0;
let anchorPerfMs = 0;
let hasTrustedServerClock = false;
let lastSync = 0;
let pending: Promise<void> | null = null;
let installed = false;

// Keep references to the originals so we can compute real wall time
// internally without recursing through our patched versions.
const _origDateNow: () => number =
  typeof Date !== "undefined" ? Date.now.bind(Date) : () => 0;
const _OrigDate: DateConstructor = Date;

const perfNow = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : _origDateNow();

export async function syncServerTime(force = false): Promise<void> {
  const now = perfNow();
  if (!force && lastSync && now - lastSync < 5 * 60_000) return;
  if (pending) return pending;
  pending = (async () => {
    try {
      const t0 = perfNow();
      const { data } = await (supabase as any).rpc("get_server_time");
      const t1 = perfNow();
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.server_now) {
        // Account for round-trip — assume server time is mid-flight.
        const serverMs = new _OrigDate(row.server_now).getTime();
        anchorServerMs = serverMs + (t1 - t0) / 2;
        anchorPerfMs = t1;
        offsetMs = anchorServerMs - _origDateNow();
        hasTrustedServerClock = true;
        lastSync = perfNow();
      }
    } catch {
      /* fallback to client time */
    } finally {
      pending = null;
    }
  })();
  return pending;
}

export function serverNow(): Date {
  return new _OrigDate(serverNowMs());
}

export function serverNowMs(): number {
  if (hasTrustedServerClock) {
    return anchorServerMs + (perfNow() - anchorPerfMs);
  }
  return _origDateNow() + offsetMs;
}

export function isServerClockSynced(): boolean {
  return hasTrustedServerClock;
}

/** UTC date (YYYY-MM-DD) according to the server clock. */
export function serverTodayKey(): string {
  return serverNow().toISOString().slice(0, 10);
}

/**
 * Globally patch Date.now() and the zero-arg Date constructor so the entire
 * app uses server-corrected time. This neutralises phone-clock tampering for
 * every UI timer comparison without having to touch every call site.
 *
 * Safe to call on the client only. Idempotent.
 */
export function installServerClock(): void {
  if (installed) return;
  if (typeof globalThis === "undefined") return;
  installed = true;

  // Patch Date.now()
  try {
    (Date as any).now = () => serverNowMs();
  } catch {}

  // Patch `new Date()` (no args) to return server-corrected time. Args still
  // work normally so parsing ISO strings, ms, etc. is unaffected.
  try {
    const Patched: any = function (this: any, ...args: any[]) {
      if (!(this instanceof Patched)) {
        // Called without `new`
        return _OrigDate(...(args as []));
      }
      if (args.length === 0) {
        return new _OrigDate(serverNowMs());
      }
      // @ts-ignore - spread into Date ctor
      return new _OrigDate(...args);
    };
    Patched.prototype = _OrigDate.prototype;
    Object.setPrototypeOf(Patched, _OrigDate);
    Patched.now = () => serverNowMs();
    Patched.parse = _OrigDate.parse.bind(_OrigDate);
    Patched.UTC = _OrigDate.UTC.bind(_OrigDate);
    (globalThis as any).Date = Patched;
  } catch {}

  // Periodically resync (every 2 minutes) and force sync now.
  syncServerTime(true);
  try {
    setInterval(() => { syncServerTime(true); }, 2 * 60_000);
  } catch {}
}
