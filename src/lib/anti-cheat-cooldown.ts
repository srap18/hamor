/**
 * Anti-cheat client cooldown.
 * Enforces an 8s delay between finishing a repair (or crew-repair /
 * instant-repair) and launching a rocket / stealing, to stop "repair → burst
 * attack" macros from firing multiple actions in the same second.
 *
 * The server has its own protections; this layer just makes the naive
 * client-side spam attack impossible from the game UI.
 */

const KEY = "__ac_lastRepairAt";
export const REPAIR_ATTACK_COOLDOWN_MS = 8000;

function now() {
  return Date.now();
}

export function markRepairDone(): void {
  try {
    (globalThis as any)[KEY] = now();
    sessionStorage.setItem(KEY, String(now()));
  } catch {}
}

export function repairCooldownRemaining(): number {
  try {
    const mem = Number((globalThis as any)[KEY] ?? 0);
    const ss = Number(sessionStorage.getItem(KEY) ?? 0);
    const last = Math.max(mem, ss);
    if (!last) return 0;
    return Math.max(0, REPAIR_ATTACK_COOLDOWN_MS - (now() - last));
  } catch {
    return 0;
  }
}

/** Returns true if an attack is allowed, false otherwise (and shows a flash). */
export function checkAttackAfterRepair(flash?: (m: string) => void): boolean {
  const rem = repairCooldownRemaining();
  if (rem <= 0) return true;
  const s = Math.ceil(rem / 1000);
  flash?.(`⏳ انتظر ${s} ثواني بعد الإصلاح قبل الهجوم`);
  return false;
}
