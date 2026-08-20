/**
 * Multi-account fast switching (max 2 accounts — matches the 2-slots-per-device rule).
 *
 * Security model:
 *  - Only the *refresh* token is persisted (never the access token, never a password).
 *    Switching always goes through `refreshSession`, which rotates the token on the
 *    server, so a token copied out of storage is invalidated by the next switch.
 *  - Stored entries expire locally after MAX_AGE_MS and are dropped.
 *  - The session returned by the server must belong to the requested user id,
 *    otherwise the switch is rejected (guards tampered storage / swapped rows).
 *  - Switching re-runs the server-side ban preflight + device slot check; a hard
 *    "blocked" verdict reverts to the previous session.
 *  - "Forget" performs a global sign-out so the refresh token is revoked server-side.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

const KEY = "oc_accounts_v1";
export const MAX_ACCOUNTS = 2;
/** Stored refresh tokens are dropped after 14 days of not being used. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type StoredAccount = {
  userId: string;
  email: string | null;
  username: string | null;
  emoji: string | null;
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
    const now = Date.now();
    return (arr as any[])
      .filter(
        (a) =>
          a &&
          typeof a.userId === "string" &&
          typeof a.refresh_token === "string" &&
          a.refresh_token.length > 10 &&
          typeof a.savedAt === "number" &&
          now - a.savedAt < MAX_AGE_MS,
      )
      .map((a) => ({
        userId: a.userId,
        email: typeof a.email === "string" ? a.email : null,
        username: typeof a.username === "string" ? a.username : null,
        emoji: typeof a.emoji === "string" ? a.emoji : null,
        refresh_token: a.refresh_token,
        savedAt: a.savedAt,
      })) as StoredAccount[];
  } catch {
    return [];
  }
}

function write(list: StoredAccount[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ACCOUNTS)));
  } catch {
    /* quota — ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent("accounts:changed"));
  } catch {}
}

export function listAccounts(): StoredAccount[] {
  return read().sort((a, b) => b.savedAt - a.savedAt);
}

export function removeAccount(userId: string) {
  write(read().filter((a) => a.userId !== userId));
}

export function clearAccounts() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent("accounts:changed"));
  } catch {}
}

/** Persist (or refresh) the refresh token of the currently signed-in account. */
export function rememberSession(
  session: Session | null,
  meta?: { username?: string | null; emoji?: string | null },
) {
  if (!session?.refresh_token || !session.user?.id) return;
  const list = read();
  const existing = list.find((a) => a.userId === session.user.id);
  const entry: StoredAccount = {
    userId: session.user.id,
    email: session.user.email ?? existing?.email ?? null,
    username: meta?.username ?? existing?.username ?? null,
    emoji: meta?.emoji ?? existing?.emoji ?? null,
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
    const { data } = await supabase
      .from("profiles")
      .select("display_name, avatar_emoji")
      .eq("id", userId)
      .maybeSingle();
    if (!data) return;
    const list = read();
    const idx = list.findIndex((a) => a.userId === userId);
    if (idx < 0) return;
    list[idx] = {
      ...list[idx],
      username: (data as any).display_name ?? null,
      emoji: (data as any).avatar_emoji ?? null,
    };
    write(list);
  } catch {
    /* best effort */
  }
}

async function securityCheck(
  userId: string,
  email: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { getDeviceFingerprint } = await import("@/lib/device-fingerprint");
    const fp = await getDeviceFingerprint();
    const deviceId =
      (typeof localStorage !== "undefined" ? localStorage.getItem("hamor_device_id") : null) || "";

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
    // (Bans are still enforced server-side on every protected call.)
    return { ok: true };
  }
}

export type SwitchResult = { ok: true } | { ok: false; reason: string; needsLogin?: boolean };

async function restore(current: Session | null) {
  if (current?.refresh_token) {
    const restored = await supabase.auth
      .refreshSession({ refresh_token: current.refresh_token })
      .catch(() => null);
    if (restored?.data?.session?.user?.id === current.user.id) {
      rememberSession(restored.data.session);
    }
  } else {
    await supabase.auth.signOut({ scope: "local" }).catch(() => null);
  }
}

/** Switch the active session to another stored account. */
export async function switchToAccount(userId: string): Promise<SwitchResult> {
  const target = read().find((a) => a.userId === userId);
  if (!target) return { ok: false, reason: "الحساب غير محفوظ", needsLogin: true };

  const { data: curData } = await supabase.auth.getSession();
  const current = curData.session;
  if (current) rememberSession(current);
  if (current?.user?.id === userId) return { ok: true };

  // Rotating refresh: the stored token is consumed and replaced on the server.
  const res = await supabase.auth
    .refreshSession({ refresh_token: target.refresh_token })
    .catch(() => null);
  const session = res?.data?.session ?? null;

  if (!session) {
    removeAccount(userId);
    await restore(current);
    return {
      ok: false,
      reason: "انتهت صلاحية الجلسة — سجل الدخول لهذا الحساب مرة واحدة",
      needsLogin: true,
    };
  }

  // The server must have handed us exactly the account we asked for.
  if (session.user?.id !== userId) {
    removeAccount(userId);
    await restore(current);
    return {
      ok: false,
      reason: "تعذر التحقق من هوية الحساب — سجل الدخول يدويًا",
      needsLogin: true,
    };
  }

  const check = await securityCheck(userId, session.user.email || target.email);
  if (!check.ok) {
    // Keep the entry saved — a temporary block is not a reason to lose the row.
    rememberSession(session, { username: target.username, emoji: target.emoji });
    await restore(current);
    return { ok: false, reason: check.reason || "تعذر التبديل" };
  }

  rememberSession(session, { username: target.username, emoji: target.emoji });
  return { ok: true };
}

const PENDING_KEY = "oc_pending_add_from";

/**
 * Enter add-account mode without signing out the current account.
 *
 * Even a `scope: "local"` sign-out revokes the current refresh token on the
 * auth server. That made the saved first account unusable as soon as the user
 * tapped "add account". The login page deliberately stays open while this
 * marker exists, and a successful second sign-in simply replaces the active
 * browser session while the first account's saved refresh token remains valid.
 */
export async function beginAddAccount(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    rememberSession(data.session);
    try {
      localStorage.setItem(PENDING_KEY, data.session.user.id);
    } catch {}
  }
}

/** The account the user came from when tapping "add account" (if any). */
export function pendingAddOrigin(): StoredAccount | null {
  try {
    const id = localStorage.getItem(PENDING_KEY);
    if (!id) return null;
    return read().find((a) => a.userId === id) ?? null;
  } catch {
    return null;
  }
}

export function clearPendingAdd() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {}
}

/**
 * Cancel "add account" and restore the session the user came from.
 * No security re-check: this is exactly the session that was active a moment ago.
 */
export async function cancelAddAccount(): Promise<{ ok: boolean }> {
  const origin = pendingAddOrigin();
  clearPendingAdd();
  if (!origin) return { ok: false };

  // The normal add-account path keeps the origin active, so returning should
  // not rotate its refresh token or make any network request.
  const { data: current } = await supabase.auth.getSession();
  if (current.session?.user?.id === origin.userId) {
    rememberSession(current.session, { username: origin.username, emoji: origin.emoji });
    return { ok: true };
  }

  const res = await supabase.auth
    .refreshSession({ refresh_token: origin.refresh_token })
    .catch(() => null);
  const session = res?.data?.session ?? null;
  if (!session || session.user?.id !== origin.userId) {
    removeAccount(origin.userId);
    return { ok: false };
  }
  rememberSession(session, { username: origin.username, emoji: origin.emoji });
  return { ok: true };
}

/** Full sign-out of one account: revoke the refresh token server-side + forget it. */
export async function forgetAndSignOut(userId: string) {
  const target = read().find((a) => a.userId === userId);
  removeAccount(userId);
  const { data } = await supabase.auth.getSession();
  const activeId = data.session?.user?.id;
  if (activeId === userId || !target) {
    // Global scope revokes every refresh token of this user.
    await supabase.auth.signOut().catch(() => null);
    return;
  }
  // Not the active account: revoke its tokens without disturbing the current session.
  const current = data.session;
  const res = await supabase.auth
    .refreshSession({ refresh_token: target.refresh_token })
    .catch(() => null);
  if (res?.data?.session?.user?.id === userId) {
    await supabase.auth.signOut().catch(() => null);
  }
  await restore(current);
}
