import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { PROFILE_PUBLIC_COLUMNS } from "@/lib/profile-columns";

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
  const loadingTimeout = globalThis.setTimeout(() => {
    if (!sessionLoadingFlag) return;
    sessionLoadingFlag = false;
    notifySession();
  }, 4000);
  supabase.auth.onAuthStateChange((_e, s) => {
    const prevUserId = sessionCache?.user?.id ?? null;
    const nextUserId = s?.user?.id ?? null;
    sessionCache = s;
    sessionLoadingFlag = false;
    globalThis.clearTimeout(loadingTimeout);
    notifySession();
    // Only drop profile when the signed-in account actually changes.
    // Token refresh / INITIAL_SESSION must not wipe the current profile.
    if (prevUserId !== nextUserId) {
      profileCache = null;
      if (!s?.user) persistProfile(null);
      notifyProfile();
    }
    if (nextUserId) primeProfileForUser(nextUserId);
  });
  supabase.auth.getSession().then(({ data }) => {
    sessionCache = data.session;
    sessionLoadingFlag = false;
    globalThis.clearTimeout(loadingTimeout);
    notifySession();
    const userId = data.session?.user?.id;
    if (userId) primeProfileForUser(userId);
  }).catch(() => {
    sessionLoadingFlag = false;
    globalThis.clearTimeout(loadingTimeout);
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
const PROFILE_LS_KEY = "lov_profile_cache_v1";
let profileCache: Profile | null = null;
let profileLoadingFlag = false;
let profileChannelUserId: string | null = null;
let profilePingTimer: ReturnType<typeof setInterval> | null = null;
// Monotonic version of the freshest server payload we've applied. Used to drop
// stale Realtime UPDATEs (out-of-order or replayed) that would otherwise roll
// back coins/gems to an older value.
let profileFreshVersion = 0;
const profileSubs = new Set<() => void>();
const notifyProfile = () => profileSubs.forEach((fn) => { try { fn(); } catch {} });

function persistProfile(p: Profile | null) {
  if (typeof window === "undefined") return;
  try {
    // Persist the full profile including currencies so a hard refresh shows
    // the last known coins/gems/xp instantly (server refetch reconciles right after).
    if (p) window.localStorage.setItem(PROFILE_LS_KEY, JSON.stringify(p));
    else window.localStorage.removeItem(PROFILE_LS_KEY);
  } catch {}
}

function loadPersistedProfile(userId: string): Profile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROFILE_LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Profile;
    if (!p || p.id !== userId) return null;
    return p;
  } catch { return null; }
}

function primeProfileForUser(userId: string) {
  if (!profileCache || profileCache.id !== userId) {
    const persisted = loadPersistedProfile(userId);
    if (persisted) {
      profileCache = persisted;
      // Treat cached profile as "ready" so UI shows instantly; server fetch reconciles.
      profileFreshVersion = Math.max(profileFreshVersion, 1);
    }
  }
  profileLoadingFlag = !profileCache;
  notifyProfile();
  fetchProfileNow(userId);
}

async function fetchProfileNow(userId: string, attempt = 0) {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_PUBLIC_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) {
    // Keep whatever cached values we have visible; retry silently.
    const delay = Math.min(700 * (attempt + 1), 10_000);
    globalThis.setTimeout(() => fetchProfileNow(userId, attempt + 1), delay);
    return;
  }
  profileLoadingFlag = false;
  profileCache = data as Profile;
  profileFreshVersion += 1;
  persistProfile(profileCache);
  notifyProfile();
}




function ensureProfileBootstrap(userId: string) {
  if (profileChannelUserId === userId) {
    if (!profileCache || profileCache.id !== userId) {
      const persisted = loadPersistedProfile(userId);
      if (persisted) {
        profileCache = persisted;
        profileFreshVersion = Math.max(profileFreshVersion, 1);
      } else {
        profileLoadingFlag = true;
      }
      notifyProfile();
      fetchProfileNow(userId);
    }
    return;
  }
  // Tear down old channel/ping for previous user
  if (profileChannelUserId) {
    if (profilePingTimer) { clearInterval(profilePingTimer); profilePingTimer = null; }
    // realtime channels are auto-cleaned when we swap; not strictly removing
  }
  profileChannelUserId = userId;
  // Rehydrate from localStorage instantly so the full profile (name, avatar,
  // coins, gems, xp…) appears without waiting on the network. Server refetch
  // reconciles authoritatively right after.
  if (!profileCache || profileCache.id !== userId) {
    const persisted = loadPersistedProfile(userId);
    if (persisted) {
      profileCache = persisted;
      profileFreshVersion = Math.max(profileFreshVersion, 1);
    }
  }
  profileLoadingFlag = !profileCache;
  notifyProfile();
  fetchProfileNow(userId);



  // Ping online_at every 30 seconds, plus one initial; refresh on visibility/focus.
  // Do NOT mark offline on visibilitychange — mobile backgrounds the tab on every
  // screen lock / app switch and would zero out the online count for real players.
  // Only mark offline on actual page unload.
  const ping = () => { (supabase as any).rpc("update_my_online_at"); };
  const offline = () => { (supabase as any).rpc("mark_me_offline"); };
  ping();
  profilePingTimer = setInterval(ping, 30_000);
  if (typeof window !== "undefined") {
    const onVis = () => { if (document.visibilityState === "visible") ping(); };
    const onHide = () => { offline(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", ping);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
  }

  // Realtime subscription. We refetch authoritative data on every UPDATE
  // instead of trusting payload.new directly — Realtime can deliver replayed
  // or out-of-order events that would otherwise roll currencies backwards.
  supabase
    .channel(`profile:${userId}:${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
      (payload) => {
        const next = payload.new as Profile;
        // Merge all fields immediately for instant feedback; fetchProfileNow
        // will reconcile against the authoritative server value right after.
        if (profileCache && profileCache.id === userId) {
          profileCache = { ...profileCache, ...next } as Profile;
          notifyProfile();
        }
        fetchProfileNow(userId);
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

  // Keep loading=true until we've applied at least one fresh server payload —
  // otherwise the zeroed persisted cache would display 0 coins/gems as if real.
  const loading = !!user && (profileLoadingFlag || profileFreshVersion === 0);
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

/**
 * Optimistically apply a delta to the cached profile (coins/gems/rubies/xp).
 * Returns a rollback function that restores the previous values.
 * Realtime UPDATE from the server reconciles to the authoritative value after.
 */
export function applyOptimisticProfileDelta(
  delta: Partial<Pick<Profile, "coins" | "gems" | "rubies" | "xp">>,
): () => void {
  if (!profileCache) return () => {};
  const prev: Partial<Profile> = {};
  const next = { ...profileCache } as Profile;
  for (const k of Object.keys(delta) as Array<keyof typeof delta>) {
    const d = delta[k];
    if (typeof d !== "number" || !d) continue;
    (prev as any)[k] = (profileCache as any)[k];
    (next as any)[k] = Math.max(0, ((profileCache as any)[k] ?? 0) + d);
  }
  profileCache = next;
  notifyProfile();
  return () => {
    if (!profileCache) return;
    profileCache = { ...profileCache, ...prev } as Profile;
    notifyProfile();
  };
}

// Listen to the legacy event in case any code still dispatches it
if (typeof window !== "undefined") {
  window.addEventListener("profile:refresh", () => {
    if (profileChannelUserId) fetchProfileNow(profileChannelUserId);
  });
}
