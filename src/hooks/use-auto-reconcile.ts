/**
 * Silent background reconciliation of Paddle purchases.
 *
 * Runs on app boot (once per signed-in session) and again every 6h while
 * the tab stays open. Also re-runs when the tab regains focus if the
 * last check was more than 30 minutes ago. This catches any purchase
 * whose webhook silently failed or whose success page was never opened
 * (native app crash, user closed the browser, unreliable network, etc.).
 *
 * Fully silent — no toast, no UI. If a grant lands, a
 * `paddle-purchase-completed` event fires so the currency / VIP badges
 * refresh, matching the payment-success page behavior.
 */
import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { reconcileMyPaddlePurchases } from "@/lib/paddle-reconcile.functions";
import { getPaddleEnvironment } from "@/lib/paddle";
import { refreshProfile } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_PREFIX = "auto-reconcile-last:";
const FOCUS_MIN_GAP_MS = 30 * 60 * 1000;   // 30 min on focus
const PERIODIC_MS = 6 * 60 * 60 * 1000;    // every 6h while tab is open

export function useAutoReconcile() {
  const reconcile = useServerFn(reconcileMyPaddlePurchases);
  const runningRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const run = async (reason: string) => {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        // Read the session from local storage — never hit the auth API here.
        // This used to call auth.getUser() on every focus/visibility change,
        // which flooded the auth server from every open tab.
        const { data: s } = await supabase.auth.getSession();
        const uid = s?.session?.user?.id;
        if (!uid) return;

        const key = `${STORAGE_PREFIX}${uid}`;
        const now = Date.now();
        if (reason === "focus") {
          const last = Number(localStorage.getItem(key) || 0);
          if (last && now - last < FOCUS_MIN_GAP_MS) return;
        }

        const r = await reconcile({ data: { environment: getPaddleEnvironment() } });
        try { localStorage.setItem(key, String(now)); } catch { /* noop */ }


        // Cleanup expired cosmetics (backgrounds/frames) on every reconcile pass.
        // Runs on boot, tab focus, and every 6h — ensures expired items are
        // removed and defaults re-applied even for players who never open the shop.
        try { await (supabase.rpc as any)("cleanup_my_expired_cosmetics"); } catch { /* noop */ }

        if (!cancelled && r?.grantedCount && r.grantedCount > 0) {
          refreshProfile();
          try { window.dispatchEvent(new Event("paddle-purchase-completed")); } catch { /* noop */ }
        } else if (!cancelled) {
          // Refresh profile silently in case cleanup reset selected_bg_id/frames
          refreshProfile();
        }
      } catch (e) {
        // Silent by design — payment recovery must never spam the user.
        console.debug("[auto-reconcile] skipped", e);
      } finally {
        runningRef.current = false;
      }
    };

    // 1) Kick off shortly after mount so it doesn't fight boot work.
    const bootT = setTimeout(() => run("boot"), 4000);

    // 2) Re-run when the tab regains focus (throttled).
    const onFocus = () => run("focus");
    const onVis = () => { if (document.visibilityState === "visible") run("focus"); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    // 3) Long-tab periodic sweep.
    const periodic = window.setInterval(() => run("periodic"), PERIODIC_MS);

    return () => {
      cancelled = true;
      clearTimeout(bootT);
      window.clearInterval(periodic);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reconcile]);
}

export function AutoReconcile() {
  useAutoReconcile();
  return null;
}
