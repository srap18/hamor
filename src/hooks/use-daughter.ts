import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getMyDaughter, type Daughter } from "@/lib/daughter";

// Module-level cache so re-mounts across navigation don't re-fetch.
const CACHE = new Map<string, { value: Daughter | null; ts: number }>();
const TTL_MS = 60_000;

export function useDaughter() {
  const { user } = useAuth();
  const cached = user ? CACHE.get(user.id) : undefined;
  const [daughter, setDaughter] = useState<Daughter | null>(cached?.value ?? null);
  const [loading, setLoading] = useState(!cached);

  const refresh = useCallback(async () => {
    const d = await getMyDaughter();
    if (user) CACHE.set(user.id, { value: d, ts: Date.now() });
    setDaughter(d);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!user) { setDaughter(null); setLoading(false); return; }
    const hit = CACHE.get(user.id);
    if (hit && Date.now() - hit.ts < TTL_MS) {
      setDaughter(hit.value);
      setLoading(false);
    } else {
      refresh();
    }
    const ch = supabase
      .channel(`daughter:${user.id}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "player_daughter", filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (payload.new) {
            const d = payload.new as Daughter;
            CACHE.set(user.id, { value: d, ts: Date.now() });
            setDaughter(d);
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, refresh]);

  return { daughter, loading, refresh };
}
