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
// Fields that change frequently and MUST NOT be served from localStorage on reload —
// stale values here make the player think they lost coins/gems/xp after a refresh.
// They are persisted as 0 and only filled in after the live DB fetch returns.
const VOLATILE_KEYS = ["coins", "gems", "rubies", "xp", "level", "weekly_xp"] as const;
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

function stripVolatile(p: Profile): Profile {
  const out = { ...p } as any;
  for (const k of VOLATILE_KEYS) out[k] = 0;
  return out as Profile;
}

function persistProfile(p: Profile | null) {
  if (typeof window === "undefined") return;
  try {
    // Persist only stable fields (name, avatar, frames…). Currencies are
    // intentionally zeroed so a hard refresh never shows yesterday's balance.
    if (p) window.localStorage.setItem(PROFILE_LS_KEY, JSON.stringify(stripVolatile(p)));
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
    // Defensive: even if an older client wrote currency values into the cache,
    // strip them before showing anything to the user.
    return stripVolatile(p);
  } catch { return null; }
}

function primeProfileForUser(userId: string) {
  if (!profileCache || profileCache.id !== userId) {
    const persisted = loadPersistedProfile(userId);
    if (persisted) profileCache = persisted;
  }
  // Always show loading until the fresh server fetch returns — the persisted
  // copy has no currency values, so we cannot display 0 as if it were real.
  profileLoadingFlag = true;
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
    // Never give up — a failed fetch would otherwise leave the UI showing
    // the zeroed persisted cache as if the player lost all their coins/gems.
    // Keep loading=true and retry with exponential backoff (capped at 10s).
    profileLoadingFlag = true;
    notifyProfile();
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
      if (persisted) profileCache = persisted;
      else profileLoadingFlag = true;
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
  // Rehydrate from localStorage instantly so name/avatar appear without a network round-trip.
  // Currency fields are stripped from the persisted copy (see stripVolatile) so the UI
  // never displays a stale coin/gem balance after a refresh.
  if (!profileCache || profileCache.id !== userId) {
    const persisted = loadPersistedProfile(userId);
    if (persisted) {
      profileCache = persisted;
    }
  }
  // Until the fresh fetch completes, treat the profile as loading so currency
  // widgets can show a skeleton instead of the zeroed cache.
  profileLoadingFlag = true;
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
        // Merge non-currency fields immediately so frame/avatar/name changes
        // feel instant, but defer currency values to the fresh refetch below.
        if (profileCache && profileCache.id === userId) {
          const merged = { ...profileCache } as any;
          for (const k of Object.keys(next) as Array<keyof Profile>) {
            if ((VOLATILE_KEYS as readonly string[]).includes(k as string)) continue;
            (merged as any)[k] = (next as any)[k];
          }
          profileCache = merged as Profile;
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
