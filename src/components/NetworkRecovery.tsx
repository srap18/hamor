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
    // Full recovery is expensive (realtime reconnect + refetch of every query).
    // It must only run when the connection was really lost or the tab was
    // hidden long enough for the socket to die — never on every focus event,
    // which on mobile fires constantly and freezes the app.
    const MIN_GAP_MS = 30_000;
    const LONG_HIDE_MS = 60_000;

    const recover = async (reason: string, force = false) => {
      const now = Date.now();
      if (!force && now - lastRecoverRef.current < MIN_GAP_MS) return;
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
      // Only refetch what is actually mounted; a blanket invalidate refetched
      // every cached query at once and stalled the UI.
      try { await queryClient.invalidateQueries({ refetchType: "active" }); } catch {}
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

      // Only a real disconnect or a long background pause justifies a refresh.
      if (wasOfflineRef.current || hiddenFor > LONG_HIDE_MS) {
        wasOfflineRef.current = false;
        recover("visible-after-long-hide");
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [queryClient, router]);


  return null;
}
