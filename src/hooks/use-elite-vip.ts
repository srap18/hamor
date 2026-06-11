import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

/**
 * Returns the current user's authoritative elite_vip_level (0-5).
 * The value comes directly from the profiles table (server-side managed,
 * never client-writable). Use this for UI display only — combat/shop
 * effects are computed server-side.
 */
export function useEliteVipLevel(): { level: number; loading: boolean } {
  const { user, loading: authLoading } = useAuth();
  const [level, setLevel] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLevel(0);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const computeLevel = (row: { elite_vip_level?: number | null; elite_vip_expires_at?: string | null } | null): number => {
      const lvl = Number(row?.elite_vip_level ?? 0);
      const exp = row?.elite_vip_expires_at ? new Date(row.elite_vip_expires_at).getTime() : null;
      if (lvl > 0 && exp !== null && exp <= Date.now()) return 0;
      return lvl;
    };
    (async () => {
      const { data } = await (supabase as any).rpc("get_my_elite_vip");
      if (cancelled) return;
      const r = Array.isArray(data) ? data[0] : data;
      setLevel(computeLevel(r as any));
      setLoading(false);
    })();

    // Realtime sync — if subscription webhook updates the row, the badge
    // appears immediately without a page reload.
    const channel = supabase
      .channel(`elite-vip:${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        (payload) => {
          setLevel(computeLevel(payload.new as any));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
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
