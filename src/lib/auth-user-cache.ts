/**
 * Auth request throttle.
 *
 * The app calls `supabase.auth.getUser()` from dozens of components, and each
 * call is a real network round-trip to the auth server. On a busy screen this
 * produced a burst of identical requests per player (tens of thousands per
 * minute across all players), which made the game feel frozen while every
 * component waited for its own copy of the same answer.
 *
 * This patch:
 *  - answers from the locally stored session whenever one exists (no network),
 *  - de-duplicates concurrent calls into a single promise,
 *  - caches the result for a short window,
 *  - clears the cache whenever the auth state actually changes.
 *
 * Behaviour for callers is unchanged: they still receive { data: { user }, error }.
 */
import { supabase } from "@/integrations/supabase/client";

const TTL_MS = 60_000;

let installed = false;

export function installAuthUserCache() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  try {
    const auth = supabase.auth as unknown as Record<string, any>;
    if (typeof auth.getUser !== "function" || auth.__hamorCached) return;

    const original = auth.getUser.bind(auth);
    let cache: { at: number; res: any } | null = null;
    let inflight: Promise<any> | null = null;

    auth.getUser = async (jwt?: string) => {
      // Explicit token lookups must never be served from cache.
      if (jwt) return original(jwt);

      const now = Date.now();
      if (cache && now - cache.at < TTL_MS) return cache.res;
      if (inflight) return inflight;

      inflight = (async () => {
        try {
          const { data } = await auth.getSession();
          const user = data?.session?.user ?? null;
          if (user) {
            const res = { data: { user }, error: null };
            cache = { at: Date.now(), res };
            return res;
          }
          const res = await original();
          cache = { at: Date.now(), res };
          return res;
        } catch (e) {
          return { data: { user: null }, error: e as any };
        } finally {
          inflight = null;
        }
      })();

      return inflight;
    };

    auth.__hamorCached = true;

    try {
      auth.onAuthStateChange(() => {
        cache = null;
      });
    } catch {
      /* noop */
    }
  } catch {
    /* never let this break boot */
  }
}
