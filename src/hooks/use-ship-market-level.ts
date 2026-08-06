import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Current ship-market level of the signed-in user (1 by default).
 * Used to gate PvP-related UI (e.g. the global nuke/attack ticker) so brand
 * new accounts don't get a screen full of attack spam.
 */
export function useShipMarketLevel(): number {
  const { user } = useAuth() as any;
  const [level, setLevel] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const v = Number(window.localStorage.getItem("ocean.marketLevel"));
    return Number.isFinite(v) && v >= 1 ? v : 1;
  });

  useEffect(() => {
    if (!user) { setLevel(1); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_market")
        .select("level")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const lv = Math.max(1, Number((data as any)?.level ?? 1));
      setLevel(lv);
      try { window.localStorage.setItem("ocean.marketLevel", String(lv)); } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  return level;
}
