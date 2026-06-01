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

function newSessionToken(): string {
  return crypto.randomUUID() + "-" + Date.now().toString(36);
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
    const localToken = newSessionToken();

    (async () => {
      const deviceId = getOrCreateDeviceId();

      // 1) Device binding check
      const { error: devErr } = await (supabase as any).rpc("register_device", { _device_id: deviceId });
      if (cancelled) return;
      if (devErr) {
        const msg = devErr.message || "";
        let friendly = "هذا الجهاز مرتبط بحساب آخر — لا يمكن استخدام أكثر من حساب على نفس الجهاز";
        if (msg.includes("device banned") || msg.includes("account banned")) {
          friendly = "هذا الحساب أو الجهاز محظور نهائياً من الدخول";
        }
        if (msg.includes("account already bound")) {
          friendly = "حسابك مسجّل على جهاز آخر — لا يمكن الدخول من جهازين";
        }
        setBlock({ kind: "device_taken", message: friendly });
        await supabase.auth.signOut();
        return;
      }

      // 2) Claim active session (kicks any other session)
      try { localStorage.setItem(SESSION_KEY, localToken); } catch {}
      const { error: sessErr } = await (supabase as any).rpc("claim_session", { _token: localToken });
      if (cancelled) return;
      if (sessErr) {
        const msg = sessErr.message || "";
        setBlock({ kind: "kicked", message: msg.includes("banned") ? "هذا الحساب محظور نهائياً من الدخول" : "فشل تأمين الجلسة — حاول مجدداً" });
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
