// Shared per-user cache for get_fish_stock_summary() — one of the top RPCs by
// call count (7.4M). Multiple screens (index, inventory, fish-market) each
// re-issued the same RPC on mount and again after every catch/sell event.
// With a short TTL + shared inflight promise, remounts and cross-screen reads
// coalesce to a single request; explicit invalidation still refreshes instantly
// after mutations (via the existing `fish-stock-changed` window event).
import { supabase } from "@/integrations/supabase/client";

export type FishStockRow = { fish_id: string; qty: number; oldest_caught_at?: string };

type Entry = { data: FishStockRow[]; ts: number; promise?: Promise<FishStockRow[]> };
const CACHE = new Map<string, Entry>();
const TTL_MS = 3_000;

function normalize(rows: unknown): FishStockRow[] {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const row = r as { fish_id: string; qty: number | string; oldest_caught_at?: string };
    const q = typeof row.qty === "string" ? parseInt(row.qty, 10) : row.qty;
    return { fish_id: row.fish_id, qty: Number.isFinite(q) ? (q as number) : 0, oldest_caught_at: row.oldest_caught_at };
  });
}

export async function getFishStockSummary(userId: string, opts?: { force?: boolean }): Promise<FishStockRow[]> {
  const now = Date.now();
  const hit = CACHE.get(userId);
  if (!opts?.force && hit && now - hit.ts < TTL_MS) return hit.data;
  if (hit?.promise) return hit.promise;
  const p = (async () => {
    const { data, error } = await supabase.rpc("get_fish_stock_summary" as never);
    if (error) throw error;
    const rows = normalize(data);
    CACHE.set(userId, { data: rows, ts: Date.now() });
    return rows;
  })();
  CACHE.set(userId, { data: hit?.data ?? [], ts: hit?.ts ?? 0, promise: p });
  try {
    return await p;
  } catch {
    return hit?.data ?? [];
  }
}

export function invalidateFishStock(userId?: string) {
  if (userId) CACHE.delete(userId);
  else CACHE.clear();
}

// Listen once for the existing app-wide invalidation signal.
if (typeof window !== "undefined") {
  window.addEventListener("fish-stock-changed", () => invalidateFishStock());
}
