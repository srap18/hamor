import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/** Notifications are hidden for brand-new accounts (below level 6). */
export const NOTIF_MIN_LEVEL = 6;

export function useNotifEligible(): boolean {
  const { user } = useAuth();
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!user) { setEligible(false); return; }
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("level")
        .eq("id", user.id)
        .maybeSingle();
      if (!cancelled) setEligible(Number((data as any)?.level ?? 0) >= NOTIF_MIN_LEVEL);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  return eligible;
}
