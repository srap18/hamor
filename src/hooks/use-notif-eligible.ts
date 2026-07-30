import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Notifications (bell, global banners, toasts from the global listener) are
 * hidden for brand-new accounts until their fish-market level reaches 6.
 * Signed-out visitors are never eligible.
 */
export const NOTIF_MIN_LEVEL = 6;

export function useNotifEligible(): boolean {
  const { user } = useAuth();
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!user) { setEligible(false); return; }
    (async () => {
      const { data } = await supabase
        .from("user_fish_market")
        .select("level")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) {
        setEligible(Number((data as any)?.level ?? 1) >= NOTIF_MIN_LEVEL);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  return eligible;
}
