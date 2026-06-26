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
  | { kind: "kicked"; message: string }
  | { kind: "duplicate_tab"; message: string };

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

    // ===== Duplicate-tab guard DISABLED =====
    // Caused false positives on mobile Safari (BFCache keeps old BroadcastChannel alive
    // after refresh / app switch), locking users out of the game.






    (async () => {
      // Device binding disabled — multi-account per device is allowed


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

      // 3) Subscribe to profile changes — when our row updates we re-verify
      //    session integrity via SECURITY DEFINER RPC (active_session_id is no
      //    longer readable directly to prevent cross-user session fingerprinting).
      const recheck = async () => {
        if (cancelled) return;
        try {
          const { data } = await (supabase as any).rpc("verify_session_integrity", { _token: localToken });
          if (data === false && !cancelled) {
            setBlock({ kind: "kicked", message: "تم تسجيل الدخول من جهاز/متصفح آخر — انتهت هذه الجلسة" });
            await supabase.auth.signOut();
          }
        } catch {}
      };
      channel = supabase
        .channel(`security:${user.id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
          () => { void recheck(); },
        )
        .subscribe();

      // 4) Periodic session integrity check (every 60s).
      //    Server compares IP/UA fingerprint and clears the session if hijack suspected.
      const integrityTick = async () => {
        if (cancelled) return;
        try {
          const { data } = await (supabase as any).rpc("verify_session_integrity", { _token: localToken });
          if (data === false && !cancelled) {
            setBlock({ kind: "kicked", message: "تم رصد تغيّر مشبوه في الجلسة — تم إنهاؤها لحماية الحساب" });
            await supabase.auth.signOut();
          }
        } catch {}
      };
      const interval = setInterval(integrityTick, 60_000);
      // Initial check after 5s so the IP/UA had time to be stored
      const initial = setTimeout(integrityTick, 5_000);
      (channel as any).__cleanup = () => { clearInterval(interval); clearTimeout(initial); };
    })();

    return () => {
      cancelled = true;

      if (channel) {
        try { (channel as any).__cleanup?.(); } catch {}
        supabase.removeChannel(channel);
      }
    };
  }, [user?.id]);

  return block;
}

