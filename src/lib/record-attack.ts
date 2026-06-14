import { supabase } from "@/integrations/supabase/client";

/**
 * Best-effort `record_attack` RPC with exponential backoff retries.
 *
 * Why this exists: attack history + the defender's notifications are written
 * by this RPC server-side. If the call drops (slow/spotty network) the victim
 * never sees they were attacked. We retry on transient errors only.
 *
 * Permanent server-side rejections (protected defender, market level, etc.)
 * are NOT retried and do NOT raise an alarming toast — they are expected
 * game-state outcomes, not failures.
 *
 * Always resolves — never throws. Returns true on success.
 */

// Server errors that are NOT transient — retrying won't help and they are
// normal game-state outcomes (the defender turned on protection, the player
// doesn't meet PvP requirements, etc.). We swallow these silently.
const PERMANENT_ERROR_PATTERNS = [
  "defender_protected",
  "invalid defender",
  "not authenticated",
  "attacker market level",
  "defender market level",
  "attacker needs pvp fleet",
  "bad damage",
  "ship_is_fishing",
];

function isPermanent(err: unknown): boolean {
  const msg = String((err as any)?.message || err || "").toLowerCase();
  return PERMANENT_ERROR_PATTERNS.some((p) => msg.includes(p.toLowerCase()));
}

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
      // Don't retry permanent errors — they will never succeed.
      if (isPermanent(error)) {
        console.warn("[record_attack] permanent reject:", (error as any)?.message);
        return false;
      }
    } catch (e) {
      lastErr = e;
    }
    if (i < retries) {
      const delay = 400 * Math.pow(2, i) - 400;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  console.error("[record_attack] failed after retries", lastErr);
  // Only surface to the user if it's a real transient failure.
  if (!isPermanent(lastErr)) opts.onFinalFail?.(lastErr);
  return false;
}
