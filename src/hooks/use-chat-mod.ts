import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

// Module-level cache: chat-mod status barely changes; avoid re-querying per mount.
type Entry = { value: boolean; ts: number; promise?: Promise<boolean> };
const CACHE = new Map<string, Entry>();
const TTL_MS = 5 * 60_000;

async function fetchIsChatMod(userId: string): Promise<boolean> {
  const now = Date.now();
  const hit = CACHE.get(userId);
  if (hit && now - hit.ts < TTL_MS) return hit.value;
  if (hit?.promise) return hit.promise;
  const p = (async () => {
    const { data } = await supabase
      .from("chat_moderators" as never)
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    const val = !!data;
    CACHE.set(userId, { value: val, ts: Date.now() });
    return val;
  })();
  CACHE.set(userId, { value: hit?.value ?? false, ts: hit?.ts ?? 0, promise: p });
  return p;
}

export function useIsChatMod() {
  const { user, loading: authLoading } = useAuth();
  const cached = user ? CACHE.get(user.id) : undefined;
  const [isChatMod, setIsChatMod] = useState<boolean>(cached?.value ?? false);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setIsChatMod(false); setLoading(false); return; }
    let cancelled = false;
    fetchIsChatMod(user.id).then((val) => {
      if (cancelled) return;
      setIsChatMod(val);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [user, authLoading]);

  return { isChatMod, loading: loading || authLoading };
}
