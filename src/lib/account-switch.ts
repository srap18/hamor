/**
 * Multi-account fast switching (max 2 accounts — matches the 2-slots-per-device rule).
 *
 * Security notes:
 *  - We only reuse the Supabase session tokens that supabase-js already persists in
 *    localStorage for the signed-in user. No password is ever stored.
 *  - Switching re-runs the full server-side security stack (ban preflight + device slot
 *    check) before the new session is accepted; on any failure we revert to the previous
 *    session and drop the stored entry.
 *  - Tokens are removed on explicit sign-out, on refresh failure, and on any block.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

const KEY = "oc_accounts_v1";
export const MAX_ACCOUNTS = 2;

export type StoredAccount = {
  userId: string;
  email: string | null;
  username: string | null;
  emoji: string | null;
  access_token: string;
  refresh_token: string;
  savedAt: number;
};

function read(): StoredAccount[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (a: any) => a && typeof a.userId === "string" && typeof a.refresh_token === "string" && a.refresh_token.length > 10,
    ) as StoredAccount[];
  } catch {
    return [];
  }
}

function write(list: StoredAccount[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ACCOUNTS)));
  } catch { /* quota — ignore */ }
  try { window.dispatchEvent(new CustomEvent("accounts:changed")); } catch {}
}

export function listAccounts(): StoredAccount[] {
  return read().sort((a, b) => b.savedAt - a.savedAt);
}

export function removeAccount(userId: string) {
  write(read().filter((a) => a.userId !== userId));
}

export function clearAccounts() {
  try { localStorage.removeItem(KEY); } catch {}
  try { window.dispatchEvent(new CustomEvent("accounts:changed")); } catch {}
}

/** Persist (or refresh) the tokens of the currently signed-in account. */
export function rememberSession(session: Session | null, meta?: { username?: string | null; emoji?: string | null }) {
  if (!session?.refresh_token || !session.user?.id) return;
  const list = read();
  const existing = list.find((a) => a.userId === session.user.id);
  const entry: StoredAccount = {
    userId: session.user.id,
    email: session.user.email ?? existing?.email ?? null,
    username: meta?.username ?? existing?.username ?? null,
    emoji: meta?.emoji ?? existing?.emoji ?? null,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    savedAt: Date.now(),
  };
  const rest = list.filter((a) => a.userId !== session.user.id);
  // Newest first; when full, drop the oldest *other* account.
  write([entry, ...rest].slice(0, MAX_ACCOUNTS));
}

/** Fill in the display name once, so the switcher shows a real nickname. */
export async function refreshAccountMeta(userId: string) {
  try {
    const { data } = await supabase.from("profiles").select("display_name, avatar_emoji").eq("id", userId).maybeSingle();
    if (!data) return;
    const list = read();
    const idx = list.findIndex((a) => a.userId === userId);
    if (idx < 0) return;
    list[idx] = { ...list[idx], username: (data as any).display_name ?? null, emoji: (data as any).avatar_emoji ?? null };
    write(list);
  } catch { /* best effort */ }
}

async function securityCheck(userId: string, email: string | null): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { getDeviceFingerprint } = await import("@/lib/device-fingerprint");
    const fp = await getDeviceFingerprint();
    const deviceId = (typeof localStorage !== "undefined" ? localStorage.getItem("hamor_device_id") : null) || "";

    const { authPreflight } = await import("@/lib/auth-preflight.functions");
    const pre: any = await authPreflight({
      data: {
        email: email || "",
        deviceId,
        hardwareId: fp.hash,
        stableKey: fp.stableKey,
        noiseKey: fp.noiseKey,
        nativeId: fp.nativeId,
        signals: fp.signals as unknown as Record<string, unknown>,
        strong: fp.strong,
      },
    });
    if (pre?.blocked) return { ok: false, reason: pre.reason || "ممنوع الدخول بهذا الحساب" };

    const { deviceSlotCheck } = await import("@/lib/device-slots.functions");
    const res: any = await deviceSlotCheck({
      data: {
        hardwareHash: fp.hash,
        signals: fp.signals,
        userId,
        email,
        stableKey: fp.stableKey,
        noiseKey: fp.noiseKey,
        nativeId: fp.nativeId,
        strong: fp.strong,
      },
    });
    // Only a hard "blocked" decision stops a switch. "needs_confirmation" only
    // means this device has a free slot — it never applies to an account that is
    // already signed in on this device.
    if (res?.action === "blocked") {
      return { ok: false, reason: "هذا الحساب محظور من الدخول على هذا الجهاز" };
    }
    return { ok: true };
  } catch {
    // Infra/network hiccup must never trap the player on one account.
    return { ok: true };
  }

}

export type SwitchResult = { ok: true } | { ok: false; reason: string; needsLogin?: boolean };

/** Switch the active session to another stored account. Reloads on success. */
export async function switchToAccount(userId: string): Promise<SwitchResult> {
  const target = read().find((a) => a.userId === userId);
  if (!target) return { ok: false, reason: "الحساب غير محفوظ", needsLogin: true };

  const { data: curData } = await supabase.auth.getSession();
  const current = curData.session;
  if (current) rememberSession(current);
  if (current?.user?.id === userId) return { ok: true };

  let session = null as import("@supabase/supabase-js").Session | null;
  const first = await supabase.auth.setSession({
    access_token: target.access_token,
    refresh_token: target.refresh_token,
  });
  session = first.data?.session ?? null;
  if (!session) {
    // The stored access token may be expired; force a refresh with the refresh token.
    const retry = await supabase.auth.refreshSession({ refresh_token: target.refresh_token }).catch(() => null);
    session = retry?.data?.session ?? null;
  }
  if (!session) {
    removeAccount(userId);
    if (current) {
      await supabase.auth.setSession({ access_token: current.access_token, refresh_token: current.refresh_token }).catch(() => null);
    }
    return { ok: false, reason: "انتهت صلاحية الجلسة — سجل الدخول لهذا الحساب مرة واحدة", needsLogin: true };
  }
  const data = { session };

  const check = await securityCheck(userId, data.session.user.email || target.email);
  if (!check.ok) {
    // Keep the entry saved — a temporary block is not a reason to lose the row.
    if (current) {
      await supabase.auth.setSession({ access_token: current.access_token, refresh_token: current.refresh_token }).catch(() => null);
    } else {
      await supabase.auth.signOut({ scope: "local" }).catch(() => null);
    }
    return { ok: false, reason: check.reason || "تعذر التبديل" };
  }


  rememberSession(data.session, { username: target.username, emoji: target.emoji });
  return { ok: true };
}

const PENDING_KEY = "oc_pending_add_from";

/** Keep the current account saved, then drop the local session so /login is usable. */
export async function beginAddAccount(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    rememberSession(data.session);
    try { localStorage.setItem(PENDING_KEY, data.session.user.id); } catch {}
  }
  // scope "local" keeps the saved refresh token valid on the server.
  await supabase.auth.signOut({ scope: "local" }).catch(() => null);
}

/** The account the user came from when tapping "add account" (if any). */
export function pendingAddOrigin(): StoredAccount | null {
  try {
    const id = localStorage.getItem(PENDING_KEY);
    if (!id) return null;
    return read().find((a) => a.userId === id) ?? null;
  } catch { return null; }
}

export function clearPendingAdd() {
  try { localStorage.removeItem(PENDING_KEY); } catch {}
}

/**
 * Cancel "add account" and restore the session the user came from.
 * No security re-check: this is exactly the session that was active a moment ago.
 */
export async function cancelAddAccount(): Promise<{ ok: boolean }> {
  const origin = pendingAddOrigin();
  clearPendingAdd();
  if (!origin) return { ok: false };
  const { data, error } = await supabase.auth.setSession({
    access_token: origin.access_token,
    refresh_token: origin.refresh_token,
  });
  if (error || !data.session) {
    removeAccount(origin.userId);
    return { ok: false };
  }
  rememberSession(data.session, { username: origin.username, emoji: origin.emoji });
  return { ok: true };
}


/** Full sign-out of one account: revoke + forget. */
export async function forgetAndSignOut(userId: string) {
  removeAccount(userId);
  await supabase.auth.signOut().catch(() => null);
}
