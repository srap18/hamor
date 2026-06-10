import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type MyFishingEvent = { competition_id: string; title: string; ends_at: string } | null;

/** Returns the user's currently-active fishing-event subscription (or null). */
export function useMyFishingEvent(): { event: MyFishingEvent; loading: boolean; refetch: () => void } {
  const { user, loading: authLoading } = useAuth();
  const [event, setEvent] = useState<MyFishingEvent>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setEvent(null); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any).rpc("get_my_fishing_event");
      if (cancelled) return;
      const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
      setEvent(row);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, authLoading, tick]);

  // Auto-clear when ends_at passes
  useEffect(() => {
    if (!event) return;
    const ms = new Date(event.ends_at).getTime() - Date.now();
    if (ms <= 0) { setEvent(null); return; }
    const t = setTimeout(() => setEvent(null), ms + 1000);
    return () => clearTimeout(t);
  }, [event]);

  return { event, loading, refetch: () => setTick(x => x + 1) };
}

/** Returns a Set of user_ids currently subscribed to an active fishing event. */
export function useActiveFishingEventUserIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await (supabase as any).rpc("active_fishing_event_user_ids");
      if (cancelled) return;
      setIds(new Set((data ?? []).map((r: { user_id: string }) => r.user_id)));
    };
    load();
    const i = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);
  return ids;
}
