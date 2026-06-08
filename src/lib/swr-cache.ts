// Tiny SWR-style cache: returns cached data instantly on remount, then refetches
// in the background. Survives route navigation (module-level), so coming back
// to a screen never shows an empty/loading state again.
import { useEffect, useRef, useState } from "react";

type Entry<T> = { data: T | undefined; ts: number; promise?: Promise<T> };
const cache = new Map<string, Entry<unknown>>();
const subs = new Map<string, Set<() => void>>();

function notify(key: string) {
  subs.get(key)?.forEach((fn) => { try { fn(); } catch {} });
}

export function getCached<T>(key: string): T | undefined {
  return cache.get(key)?.data as T | undefined;
}

export function setCached<T>(key: string, data: T) {
  cache.set(key, { data, ts: Date.now() });
  notify(key);
}

export function invalidateCache(prefix?: string) {
  if (!prefix) { cache.clear(); subs.forEach((_, k) => notify(k)); return; }
  for (const k of Array.from(cache.keys())) {
    if (k.startsWith(prefix)) { cache.delete(k); notify(k); }
  }
}

/**
 * useSwrCache: returns cached value instantly (no flash), refetches in background.
 * @param key Stable cache key (include user id / params).
 * @param fetcher Async function. Null/undefined key skips fetching.
 * @param staleMs Re-fetch on mount only if older than this. Default 30s.
 */
export function useSwrCache<T>(
  key: string | null | undefined,
  fetcher: () => Promise<T>,
  staleMs = 30_000,
): { data: T | undefined; refetch: () => Promise<T | undefined>; loading: boolean } {
  const [, force] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!key) return;
    const sub = () => force((x) => x + 1);
    if (!subs.has(key)) subs.set(key, new Set());
    subs.get(key)!.add(sub);
    return () => {
      const s = subs.get(key); if (s) { s.delete(sub); if (s.size === 0) subs.delete(key); }
    };
  }, [key]);

  const refetch = async (): Promise<T | undefined> => {
    if (!key) return undefined;
    const existing = cache.get(key) as Entry<T> | undefined;
    if (existing?.promise) return existing.promise;
    const p = (async () => {
      try {
        const data = await fetcherRef.current();
        cache.set(key, { data, ts: Date.now() });
        notify(key);
        return data;
      } catch (e) {
        const cur = cache.get(key) as Entry<T> | undefined;
        if (cur) cache.set(key, { ...cur, promise: undefined });
        throw e;
      }
    })();
    cache.set(key, { ...(existing ?? { data: undefined, ts: 0 }), promise: p });
    return p;
  };

  useEffect(() => {
    if (!key) return;
    const entry = cache.get(key) as Entry<T> | undefined;
    const fresh = entry && Date.now() - entry.ts < staleMs;
    if (!fresh) { refetch().catch(() => {}); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const entry = key ? (cache.get(key) as Entry<T> | undefined) : undefined;
  return { data: entry?.data, refetch, loading: !entry?.data && !!entry?.promise };
}
