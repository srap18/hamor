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
      // On error keep whatever we already have (cached / previous state).
      if (fish.error && ship.error) return false;
      const fishLv = Number((fish.data as any)?.level ?? 0);
      const shipLv = Number((ship.data as any)?.level ?? 0);
      const ok = Math.max(fishLv, shipLv) >= NOTIF_MIN_LEVEL;
      if (cancelled) return true;
      setEligible(ok);
      try {
        if (ok) window.localStorage.setItem(cacheKey(user.id), "1");
        else window.localStorage.removeItem(cacheKey(user.id));
      } catch { /* noop */ }
      return true;
    };

    (async () => {
      // Retry a couple of times on transient failures.
      for (let i = 0; i < 3; i++) {
        const done = await check();
        if (done || cancelled) return;
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  return eligible;
}
