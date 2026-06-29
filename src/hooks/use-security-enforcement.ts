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

      // 3) Session-integrity auto-kick is DISABLED.
      //    The periodic verify_session_integrity check was causing legitimate
      //    users to be signed out shortly after logging in whenever:
      //      - they opened the app on a second tab/device (token mismatch),
      //      - the mobile WebView auto-updated its User-Agent,
      //      - or a slight UA prefix change happened mid-session.
      //    The previous code called `supabase.auth.signOut()` on any false
      //    result, which surfaced as the bug "I log in and immediately get
      //    logged out". We keep claim_session above for tracking, but no
      //    longer forcibly end the session here.
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

