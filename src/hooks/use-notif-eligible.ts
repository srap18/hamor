import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Notifications (bell, global banners, toasts from the global listener) are
 * hidden for brand-new accounts until their fish-market level reaches 6.
 * Signed-out visitors are never eligible.
 *
 * Robustness: the result is cached in localStorage per user so a temporary
 * network/RLS hiccup (or a missing user_fish_market row) never permanently
 * hides the bell for an established player. Old accounts that never created a
 * fish-market row fall back to their ship-market level.
 */
export const NOTIF_MIN_LEVEL = 6;

const cacheKey = (uid: string) => `ocean.notifEligible.${uid}`;

export function useNotifEligible(): boolean {
  const { user } = useAuth();
  const [eligible, setEligible] = useState(false);

  // Restore cached value immediately so the icon doesn't flicker/disappear.
  useEffect(() => {
    if (!user) { setEligible(false); return; }
    try {
      if (window.localStorage.getItem(cacheKey(user.id)) === "1") setEligible(true);
    } catch { /* noop */ }
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!user) return;

    const check = async () => {
      const [fish, ship] = await Promise.all([
        supabase.from("user_fish_market").select("level").eq("user_id", user.id).maybeSingle(),
        supabase.from("user_market").select("level").eq("user_id", user.id).maybeSingle(),
      ]);
      let ok: boolean;
      if (fish.error && ship.error) {
        // Both level reads failed (flaky network / transient RLS hiccup).
        // Fallback: an established account (created 3+ days ago) is treated as
        // eligible so the bell never vanishes permanently for old players.
        const { data: prof } = await supabase
          .from("profiles")
          .select("created_at")
          .eq("id", user.id)
          .maybeSingle();
        const createdAt = (prof as any)?.created_at ? Date.parse((prof as any).created_at) : 0;
        if (!createdAt || Date.now() - createdAt < 3 * 86400000) return false; // genuinely new/unknown → stay hidden, retry later
        ok = true;
      } else if (fish.error || ship.error) {
        // Only one table answered. Trust it when it proves eligibility, but
        // never let a half-failed read DEMOTE an established player (a level-30
        // fish-market row + a failed ship-market read used to hide the bell).
        const lv = Number(((fish.error ? ship.data : fish.data) as any)?.level ?? 0);
        if (lv < NOTIF_MIN_LEVEL) return false; // inconclusive → keep current state, retry
        ok = true;
      } else {
        const fishLv = Number((fish.data as any)?.level ?? 0);
        const shipLv = Number((ship.data as any)?.level ?? 0);
        ok = Math.max(fishLv, shipLv) >= NOTIF_MIN_LEVEL;
      }
      if (cancelled) return true;
      setEligible(ok);
      try {
        if (ok) window.localStorage.setItem(cacheKey(user.id), "1");
        else window.localStorage.removeItem(cacheKey(user.id));
      } catch { /* noop */ }
      return true;
    };

    let running = false;
    const runWithRetries = async () => {
      if (running) return;
      running = true;
      try {
        // Retry a couple of times on transient failures.
        for (let i = 0; i < 3; i++) {
          const done = await check();
          if (done || cancelled) return;
          await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        }
      } finally {
        running = false;
      }
    };
    void runWithRetries();

    // If all retries failed (e.g. the app was opened on a dead network), try
    // again whenever the tab comes back instead of leaving the bell hidden
    // until a full reload.
    const onWake = () => { if (!cancelled) void runWithRetries(); };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
    };
  }, [user?.id]);

  return eligible;
}
