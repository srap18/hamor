import { supabase } from "@/integrations/supabase/client";

/**
 * Server-side rate limit guard. Returns true if the action is allowed,
 * false if the user is going too fast (with a toast hint).
 *
 * Use BEFORE sensitive RPCs (attack, purchase, settings change).
 *   if (!(await rateLimit("attack", 800))) return;
 *   await supabase.rpc("record_attack", { ... });
 *
 * Server-side enforcement also exists for repeated abuse (logged to cheat_flags).
 */
export async function rateLimit(action: string, minIntervalMs: number): Promise<boolean> {
  try {
    const { data, error } = await (supabase as any).rpc("rl_guard", {
      _action: action,
      _min_interval_ms: minIntervalMs,
    });
    if (error) return true; // fail-open on network errors (don't block legit users)
    // data === null means OK, otherwise it's the ms remaining
    return data === null || data === undefined;
  } catch {
    return true;
  }
}

/** Fire-and-forget cheat report (server validates + logs to cheat_flags). */
export function reportCheat(kind: string, details: Record<string, unknown> = {}) {
  try {
    void (supabase as any).rpc("report_cheat", { _kind: kind, _details: details });
  } catch {}
}
