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
  active_session_id?: string | null;
};

/* ─────────────── Single-tab session enforcement ─────────────── */
function getTabSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let sid = sessionStorage.getItem("tab_sid");
    if (!sid) {
      sid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem("tab_sid", sid);
    }
    return sid;
  } catch { return `t-${Date.now()}-${Math.random()}`; }
}

let kickedAlready = false;
async function kickThisTab() {
  if (kickedAlready) return;
  kickedAlready = true;
  try { await supabase.auth.signOut(); } catch {}
  if (typeof window !== "undefined") {
    try { sessionStorage.removeItem("tab_sid"); } catch {}
    alert("تم فتح حسابك في مكان آخر. تم تسجيل خروجك من هذه الصفحة.");
    window.location.href = "/login";
  }
}


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
    sessionCache = s;
    sessionLoadingFlag = false;
    globalThis.clearTimeout(loadingTimeout);
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
    globalThis.clearTimeout(loadingTimeout);
    notifySession();
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
    // Single-tab enforcement: if the server's active_session_id is set and
    // does not match this tab's sid, this tab is the old one — kick it.
    const mySid = getTabSessionId();
    const serverSid = (data as Profile).active_session_id;
    if (serverSid && serverSid !== mySid) { kickThisTab(); }
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

  // Ping online_at every 30 seconds, plus one initial; refresh on visibility/focus; mark offline on hide/unload
  const ping = () => { (supabase as any).rpc("update_my_online_at"); };
  const offline = () => { (supabase as any).rpc("mark_me_offline"); };
  ping();
  profilePingTimer = setInterval(ping, 30_000);
  if (typeof window !== "undefined") {
    const onVis = () => { if (document.visibilityState === "visible") ping(); else offline(); };
    const onHide = () => { offline(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", ping);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
  }

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
