import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const DEVICE_KEY = "oc_device_id";
const SESSION_KEY = "oc_session_token";

function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID() + "-" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "fallback-" + Math.random().toString(36).slice(2);
  }
}

function getOrCreateSessionToken(): string {
  try {
    let t = localStorage.getItem(SESSION_KEY);
    if (!t) {
      t = crypto.randomUUID() + "-" + Date.now().toString(36);
      localStorage.setItem(SESSION_KEY, t);
    }
    return t;
  } catch {
    return crypto.randomUUID();
  }
}

export type SecurityBlock =
  | { kind: "device_taken"; message: string }
  | { kind: "kicked"; message: string };

/**
 * Enforces:
 *  - One active session per account (kicks older sessions)
 *  - One account per device (admins exempt — enforced server-side)
 */
export function useSecurityEnforcement(): SecurityBlock | null {
  const { user } = useAuth();
  const [block, setBlock] = useState<SecurityBlock | null>(null);

  useEffect(() => {
    if (!user) { setBlock(null); return; }
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const localToken = getOrCreateSessionToken();

    (async () => {
      const deviceId = getOrCreateDeviceId();

      // 1) Device binding check (non-blocking on failure to avoid lockouts)
      const { error: devErr } = await (supabase as any).rpc("register_device", { _device_id: deviceId });
      if (cancelled) return;
      if (devErr) {
        const msg = devErr.message || "";
        // Only hard-block on explicit ban; ignore "already bound" to avoid locking real users out
        if (msg.includes("device banned") || msg.includes("account banned")) {
          setBlock({ kind: "device_taken", message: "هذا الحساب أو الجهاز محظور نهائياً من الدخول" });
          return;
        }
        // Otherwise continue silently — protection is best-effort
      }

      // 2) Claim active session (kicks any other session)
      const { error: sessErr } = await (supabase as any).rpc("claim_session", { _token: localToken });
      if (cancelled) return;
      if (sessErr) {
        const msg = sessErr.message || "";
        if (msg.includes("banned")) {
          setBlock({ kind: "kicked", message: "هذا الحساب محظور نهائياً من الدخول" });
        }
        // Ignore other claim errors — don't block the user
        return;
      }

      // 3) Subscribe to profile changes — if active_session_id changes, we got kicked
      channel = supabase
        .channel(`security:${user.id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
          (payload) => {
            const remote = (payload.new as { active_session_id?: string | null }).active_session_id;
            if (remote && remote !== localToken) {
              setBlock({ kind: "kicked", message: "تم تسجيل الدخول من جهاز/متصفح آخر — انتهت هذه الجلسة" });
              supabase.auth.signOut();
            }
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [user?.id]);

  return block;
}
