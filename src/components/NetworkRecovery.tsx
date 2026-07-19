import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { syncServerTime } from "@/lib/server-time";

/**
 * Auto-recovers the app when the network drops and comes back.
 * Without this, returning to a page after a brief disconnect can leave
 * realtime channels dead and queries stale, making the user think they
 * have to fully close and reopen the app to get a connection back.
 */
export function NetworkRecovery() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const wasOfflineRef = useRef<boolean>(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const lastRecoverRef = useRef<number>(0);
  const hiddenSinceRef = useRef<number | null>(null);

  useEffect(() => {
    const recover = async (reason: string, force = false) => {
      const now = Date.now();
      if (!force && now - lastRecoverRef.current < 3000) return;
      lastRecoverRef.current = now;
      try { syncServerTime(true); } catch {}
      // Kick supabase realtime back up — channels die silently when the tab
      // is backgrounded, especially on mobile browsers / Android WebView.
      try {
        const rt: any = (supabase as any).realtime;
        if (rt) {
          try { rt.disconnect?.(); } catch {}
          try { rt.connect?.(); } catch {}
          // Rejoin every existing channel so subscriptions actually resume.
          try {
            const chans = rt.channels || [];
            for (const ch of chans) {
              try { ch.rejoin?.(); } catch {}
              try { ch.socket?.connect?.(); } catch {}
            }
          } catch {}
        }
      } catch {}
      try { await queryClient.invalidateQueries(); } catch {}
      try { await router.invalidate(); } catch {}
      try { console.info("[NetworkRecovery] recovered:", reason); } catch {}
    };

    const onOnline = () => {
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false;
        recover("online", true);
      }
    };
    const onOffline = () => { wasOfflineRef.current = true; };
    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        hiddenSinceRef.current = Date.now();
        return;
      }
      if (document.visibilityState !== "visible") return;
      if (!navigator.onLine) return;

      const hiddenFor = hiddenSinceRef.current
        ? Date.now() - hiddenSinceRef.current
        : 0;
      hiddenSinceRef.current = null;

      // If the tab was hidden for a long time (>60s), the WebSocket is almost
      // certainly dead and cached queries are stale — force a full refresh
      // that bypasses the 3s throttle, so the page never feels "frozen".
      if (wasOfflineRef.current || hiddenFor > 60_000) {
        wasOfflineRef.current = false;
        recover("visible-after-long-hide", true);
      } else {
        recover("visible");
      }
    };
    const onFocus = () => {
      if (navigator.onLine) recover("focus");
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [queryClient, router]);

  return null;
}
