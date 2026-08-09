import { createServerFn } from "@tanstack/react-start";

/**
 * Anti-guessing (brute-force) guard for sign-in.
 *
 * Design goal: attackers can't guess passwords / scan accounts, while normal
 * players feel nothing. A real player who mistypes gets 5 free tries with zero
 * delay; only after that does a short, growing cooldown kick in. No captcha,
 * no email lockout that could be abused to lock a victim out of their own
 * account (throttling is keyed per email+device, plus a device-wide cap that
 * stops one machine from scanning many emails).
 */

const FREE_TRIES = 5;
const WINDOW_MIN = 30; // failures older than this are forgotten
const DEVICE_SCAN_WINDOW_MIN = 15;
const DEVICE_SCAN_MAX_EMAILS = 8;
const DEVICE_SCAN_LOCK_SEC = 600;

function cooldownSeconds(fails: number): number {
  if (fails <= FREE_TRIES) return 0;
  const over = fails - FREE_TRIES;
  if (over <= 3) return 15;
  if (over <= 6) return 60;
  if (over <= 10) return 180;
  return 600;
}




const norm = (input: { email?: string | null; device?: string | null }) => ({
  email: (input?.email ?? "").trim().toLowerCase().slice(0, 255),
  device: (input?.device ?? "").trim().slice(0, 200),
});

/** Called BEFORE signInWithPassword. Returns a wait time when throttled. */
export const loginGuardCheck = createServerFn({ method: "POST" })
  .inputValidator(norm)
  .handler(async ({ data }): Promise<{ blocked: boolean; retryAfterSec: number }> => {
    if (!data.email) return { blocked: false, retryAfterSec: 0 };
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const nowMs = Date.now();

    const { data: row } = await sb
      .from("login_attempts")
      .select("fails, last_fail_at, locked_until")
      .eq("email", data.email)
      .eq("device", data.device)
      .maybeSingle();

    if (row?.locked_until) {
      const left = Math.ceil((new Date(row.locked_until).getTime() - nowMs) / 1000);
      if (left > 0) return { blocked: true, retryAfterSec: left };
    }

    // Device-wide scan detection: one device failing across many different
    // emails in a short window is credential stuffing, never a real player.
    if (data.device) {
      const since = new Date(nowMs - DEVICE_SCAN_WINDOW_MIN * 60_000).toISOString();
      const { data: rows } = await sb
        .from("login_attempts")
        .select("email")
        .eq("device", data.device)
        .gte("last_fail_at", since)
        .limit(50);
      const distinct = new Set((rows ?? []).map((r: { email: string }) => r.email));
      if (distinct.size > DEVICE_SCAN_MAX_EMAILS) {
        return { blocked: true, retryAfterSec: DEVICE_SCAN_LOCK_SEC };
      }
    }

    return { blocked: false, retryAfterSec: 0 };
  });

/** Called AFTER signInWithPassword with the outcome. */
export const loginGuardRecord = createServerFn({ method: "POST" })
  .inputValidator((input: { email?: string | null; device?: string | null; success?: boolean }) => ({
    ...norm(input),
    success: !!input?.success,
  }))
  .handler(async ({ data }): Promise<{ retryAfterSec: number }> => {
    if (!data.email) return { retryAfterSec: 0 };
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    if (data.success) {
      await sb.from("login_attempts").delete().eq("email", data.email).eq("device", data.device);
      return { retryAfterSec: 0 };
    }

    const nowMs = Date.now();
    const { data: row } = await sb
      .from("login_attempts")
      .select("fails, last_fail_at")
      .eq("email", data.email)
      .eq("device", data.device)
      .maybeSingle();

    const stale = !row || nowMs - new Date(row.last_fail_at).getTime() > WINDOW_MIN * 60_000;
    const fails = stale ? 1 : (row!.fails ?? 0) + 1;
    const wait = cooldownSeconds(fails);

    await sb.from("login_attempts").upsert(
      {
        email: data.email,
        device: data.device,
        fails,
        last_fail_at: new Date(nowMs).toISOString(),
        ...(stale ? { first_fail_at: new Date(nowMs).toISOString() } : {}),
        locked_until: wait > 0 ? new Date(nowMs + wait * 1000).toISOString() : null,
      },
      { onConflict: "email,device" },
    );

    return { retryAfterSec: wait };
  });
