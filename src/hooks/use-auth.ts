import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type Profile = {
  id: string;
  display_name: string;
  avatar_emoji: string;
  level: number;
  xp: number;
  coins: number;
  gems: number;
  rubies: number;
  tribe_id: string | null;
  online_at: string;
  avatar_url?: string | null;
  avatar_frame?: string | null;
  name_frame?: string | null;
  bubble_frame?: string | null;
  profile_frame?: string | null;
  protection_until?: string | null;
};

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  return { session, user: session?.user as User | undefined, loading };
}

export function useProfile() {
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(authLoading);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (!cancelled) {
        setProfile(data as Profile | null);
        setLoading(false);
      }
    };
    load();

    // Bump online_at every minute
    const ping = setInterval(() => {
      supabase.from("profiles").update({ online_at: new Date().toISOString() }).eq("id", user.id);
    }, 60_000);
    // Initial ping
    supabase.from("profiles").update({ online_at: new Date().toISOString() }).eq("id", user.id);

    // Subscribe to my own profile changes (unique channel per effect run to
    // avoid Supabase "cannot add postgres_changes after subscribe()" on remounts)
    const ch = supabase
      .channel(`profile:${user.id}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        (payload) => setProfile(payload.new as Profile))
      .subscribe();


    return () => {
      cancelled = true;
      clearInterval(ping);
      supabase.removeChannel(ch);
    };
  }, [user, authLoading]);

  // Lightweight global refresh: any code can dispatch `profile:refresh` to
  // force a re-fetch (used as a safety net after purchases in case realtime
  // is lagging or disabled).
  useEffect(() => {
    if (!user) return;
    const onRefresh = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (data) setProfile(data as Profile);
    };
    window.addEventListener("profile:refresh", onRefresh);
    return () => window.removeEventListener("profile:refresh", onRefresh);
  }, [user]);

  return { profile, loading };
}

/** Trigger a one-shot refetch of the current user's profile (use after writes). */
export function refreshProfile() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("profile:refresh"));
}
