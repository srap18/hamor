import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

// Module-level cache: role rarely changes; avoid re-querying on every page mount.
type Entry = { value: boolean; ts: number; promise?: Promise<boolean> };
const CACHE = new Map<string, Entry>();
const TTL_MS = 5 * 60_000;

async function fetchIsAdmin(userId: string): Promise<boolean> {
  const now = Date.now();
  const hit = CACHE.get(userId);
  if (hit && now - hit.ts < TTL_MS) return hit.value;
  if (hit?.promise) return hit.promise;
  const p = (async () => {
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["admin", "moderator"]);
    const val = !error && !!data && data.length > 0;
    CACHE.set(userId, { value: val, ts: Date.now() });
    return val;
  })();
  CACHE.set(userId, { value: hit?.value ?? false, ts: hit?.ts ?? 0, promise: p });
  return p;
}

export function useIsAdmin() {
  const { user, loading: authLoading } = useAuth();
  const cached = user ? CACHE.get(user.id) : undefined;
  const [isAdmin, setIsAdmin] = useState<boolean | null>(cached ? cached.value : null);
  const [loading, setLoading] = useState<boolean>(!cached);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setIsAdmin(false); setLoading(false); return; }
    let cancelled = false;
    fetchIsAdmin(user.id).then((val) => {
      if (cancelled) return;
      setIsAdmin(val);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [user, authLoading]);

  return { isAdmin: !!isAdmin, loading: loading && authLoading };
}

export async function logAudit(action: string, target_user_id: string | null, details: Record<string, unknown> = {}) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return;
  await supabase.from("admin_audit").insert({
    admin_id: userData.user.id,
    action,
    target_user_id,
    details: details as never,
  });
}
