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

/* ─────────────── Global session singleton ─────────────── */
let sessionCache: Session | null = null;
let sessionInitialized = false;
let sessionLoadingFlag = true;
const sessionSubs = new Set<() => void>();
const notifySession = () => sessionSubs.forEach((fn) => { try { fn(); } catch {} });

function ensureSessionBootstrap() {
  if (sessionInitialized) return;
  sessionInitialized = true;
  supabase.auth.onAuthStateChange((_e, s) => {
    sessionCache = s;
    sessionLoadingFlag = false;
    notifySession();
    // When the user changes, drop the cached profile so we refetch
    if (s?.user?.id !== profileCache?.id) {
      profileCache = null;
      notifyProfile();
    }
  });
  supabase.auth.getSession().then(({ data }) => {
    sessionCache = data.session;
    sessionLoadingFlag = false;
    notifySession();
  });
}

export function useAuth() {
  ensureSessionBootstrap();
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((x) => x + 1);
    sessionSubs.add(fn);
    return () => { sessionSubs.delete(fn); };
  }, []);
  return {
    session: sessionCache,
    user: sessionCache?.user as User | undefined,
    loading: sessionLoadingFlag,
  };
}

/* ─────────────── Global profile singleton ─────────────── */
let profileCache: Profile | null = null;
let profileLoadingFlag = false;
let profileChannelUserId: string | null = null;
let profilePingTimer: ReturnType<typeof setInterval> | null = null;
const profileSubs = new Set<() => void>();
const notifyProfile = () => profileSubs.forEach((fn) => { try { fn(); } catch {} });

async function fetchProfileNow(userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (data) {
    profileCache = data as Profile;
    profileLoadingFlag = false;
    notifyProfile();
  }
}

function ensureProfileBootstrap(userId: string) {
  if (profileChannelUserId === userId) return;
  // Tear down old channel/ping for previous user
  if (profileChannelUserId) {
    if (profilePingTimer) { clearInterval(profilePingTimer); profilePingTimer = null; }
    // realtime channels are auto-cleaned when we swap; not strictly removing
  }
  profileChannelUserId = userId;
  if (!profileCache || profileCache.id !== userId) {
    profileLoadingFlag = true;
    notifyProfile();
  }
  fetchProfileNow(userId);

  // Ping online_at every minute, plus one initial
  supabase.rpc("update_my_online_at" as never);
  profilePingTimer = setInterval(() => {
    supabase.rpc("update_my_online_at" as never);
  }, 60_000);

  // Realtime subscription
  supabase
    .channel(`profile:${userId}:${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
      (payload) => {
        profileCache = payload.new as Profile;
        notifyProfile();
      },
    )
    .subscribe();
}

export function useProfile() {
  const { user, loading: authLoading } = useAuth();
  const [, force] = useState(0);

  useEffect(() => {
    const fn = () => force((x) => x + 1);
    profileSubs.add(fn);
    return () => { profileSubs.delete(fn); };
  }, []);

  useEffect(() => {
    if (user?.id) ensureProfileBootstrap(user.id);
  }, [user?.id]);

  const loading = !!user && (profileLoadingFlag && !profileCache);
  return {
    profile: user ? profileCache : null,
    loading: user ? loading : authLoading,
  };
}

/** Trigger a one-shot refetch of the current user's profile (use after writes). */
export function refreshProfile() {
  if (profileChannelUserId) fetchProfileNow(profileChannelUserId);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("profile:refresh"));
}

// Listen to the legacy event in case any code still dispatches it
if (typeof window !== "undefined") {
  window.addEventListener("profile:refresh", () => {
    if (profileChannelUserId) fetchProfileNow(profileChannelUserId);
  });
}
