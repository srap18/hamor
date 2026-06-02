import { supabase } from "@/integrations/supabase/client";

// Offset (server - client) in ms, refreshed on demand.
let offsetMs = 0;
let lastSync = 0;
let pending: Promise<void> | null = null;

export async function syncServerTime(force = false): Promise<void> {
  const now = Date.now();
  if (!force && lastSync && now - lastSync < 5 * 60_000) return;
  if (pending) return pending;
  pending = (async () => {
    try {
      const { data } = await (supabase as any).rpc("get_server_time");
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.server_now) {
        offsetMs = new Date(row.server_now).getTime() - Date.now();
        lastSync = Date.now();
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
  return new Date(Date.now() + offsetMs);
}

/** UTC date (YYYY-MM-DD) according to the server clock. */
export function serverTodayKey(): string {
  return serverNow().toISOString().slice(0, 10);
}
