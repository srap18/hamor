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

  useEffect(() => {
    const recover = async (reason: string) => {
      // Throttle to once every 3s.
      const now = Date.now();
      if (now - lastRecoverRef.current < 3000) return;
      lastRecoverRef.current = now;
      try { syncServerTime(true); } catch {}
      // Kick supabase realtime back up.
      try {
        const rt: any = (supabase as any).realtime;
        if (rt) {
          try { rt.disconnect?.(); } catch {}
          try { rt.connect?.(); } catch {}
        }
      } catch {}
      // Refetch active queries & re-run loaders.
      try { await queryClient.invalidateQueries(); } catch {}
      try { await router.invalidate(); } catch {}
      // Best-effort debug breadcrumb.
      try { console.info("[NetworkRecovery] recovered:", reason); } catch {}
    };

    const onOnline = () => {
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false;
        recover("online");
      }
    };
    const onOffline = () => { wasOfflineRef.current = true; };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        // If browser missed the online event while tab was hidden, recover now.
        if (navigator.onLine) {
          if (wasOfflineRef.current) {
            wasOfflineRef.current = false;
            recover("visible-after-offline");
          } else {
            // Lightweight refresh on returning to tab.
            recover("visible");
          }
        }
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
