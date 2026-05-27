import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getMyDaughter, type Daughter } from "@/lib/daughter";

export function useDaughter() {
  const { user } = useAuth();
  const [daughter, setDaughter] = useState<Daughter | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const d = await getMyDaughter();
    setDaughter(d);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user) { setDaughter(null); setLoading(false); return; }
    refresh();
    const ch = supabase
      .channel(`daughter:${user.id}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "player_daughter", filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (payload.new) setDaughter(payload.new as Daughter);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, refresh]);

  return { daughter, loading, refresh };
}
