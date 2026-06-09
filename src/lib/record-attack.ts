import { supabase } from "@/integrations/supabase/client";

/**
 * Best-effort `record_attack` RPC with exponential backoff retries.
 *
 * Why this exists: attack history + the defender's notifications are written
 * by this RPC server-side. If the call drops (slow/spotty network) the victim
 * never sees they were attacked. We retry up to N times so transient network
 * errors don't silently lose the notification.
 *
 * Always resolves — never throws. Returns true on success.
 */
export async function recordAttackWithRetry(
  args: {
    _defender_id: string;
    _target_ship_id: string;
    _damage: number;
    _damage_dealt: number;
    _attacker_won: boolean;
    _xp_gain: number;
  },
  opts: { retries?: number; onFinalFail?: (err: unknown) => void } = {},
): Promise<boolean> {
  const retries = opts.retries ?? 3;
  let lastErr: unknown = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const { error } = await (supabase as any).rpc("record_attack", args);
      if (!error) return true;
      lastErr = error;
    } catch (e) {
      lastErr = e;
    }
    // Exponential backoff: 400ms, 1200ms, 2800ms
    if (i < retries) {
      const delay = 400 * Math.pow(2, i) - 400;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  console.error("[record_attack] failed after retries", lastErr);
  opts.onFinalFail?.(lastErr);
  return false;
}
