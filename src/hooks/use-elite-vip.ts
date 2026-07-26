import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

/**
 * Returns the current user's authoritative elite_vip_level (0-5).
 * The value comes directly from the profiles table (server-side managed,
 * never client-writable). Use this for UI display only — combat/shop
 * effects are computed server-side.
 */
// Module-level cache — avoid re-running the heavy resync RPC on every mount.
const LEVEL_CACHE = new Map<string, { value: number; ts: number }>();
const LEVEL_TTL_MS = 60_000;

export function useEliteVipLevel(): { level: number; loading: boolean } {
  const { user, loading: authLoading } = useAuth();
  const cached = user ? LEVEL_CACHE.get(user.id) : undefined;
  const [level, setLevel] = useState<number>(cached?.value ?? 0);
  const [loading, setLoading] = useState<boolean>(!cached);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLevel(0);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const readLevel = (row: { elite_vip_level?: number | null } | null): number =>
      Math.max(0, Number(row?.elite_vip_level ?? 0));

    const refresh = async () => {
      const hit = LEVEL_CACHE.get(user.id);
      if (hit && Date.now() - hit.ts < LEVEL_TTL_MS) {
        if (!cancelled) { setLevel(hit.value); setLoading(false); }
        return;
      }
      const { data } = await (supabase as any).rpc("resync_my_elite_vip");
      if (cancelled) return;
      const r = Array.isArray(data) ? data[0] : data;
      const v = readLevel(r as any);
      LEVEL_CACHE.set(user.id, { value: v, ts: Date.now() });
      setLevel(v);
      setLoading(false);
    };

    // Show cached value instantly; still refresh in background if stale.
    if (cached) { setLevel(cached.value); setLoading(false); }
    refresh();

    const forceRefresh = () => {
      if (user) LEVEL_CACHE.delete(user.id);
      refresh();
    };

    // Realtime sync — if subscription webhook updates the row, re-read.
    const channel = supabase
      .channel(`elite-vip:${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        forceRefresh,
      )
      .subscribe();

    const onFocus = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onPurchase = () => { void forceRefresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("paddle-purchase-completed", onPurchase);

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("paddle-purchase-completed", onPurchase);
    };
  }, [user, authLoading]);


  return { level, loading };
}

/**
 * Fires the server-side login-broadcast RPC. Server enforces VIP >= 3
 * and a 10-minute throttle. Calling it for non-VIP users is a no-op.
 */
export async function broadcastEliteVipLogin() {
  try {
    await supabase.rpc("post_elite_vip_login_broadcast");
  } catch {
    // Silent — non-VIP users get a no-op return, throttled users too.
  }
}
