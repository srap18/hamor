// Aggressive client-side update: wipes every cache layer that can pin an old
// build (service workers, Cache Storage, app caches in web storage, IndexedDB)
// while preserving the Supabase auth session, then hard-reloads a clean URL.

import { PREF_KEYS } from "@/lib/ui-prefs";

const KEEP_PREFIXES = ["sb-", "supabase."];
// User settings must survive an update — otherwise every toggle the player
// switched off comes back on after "تحديث اللعبة".
// Identity-critical keys must survive too: wiping the device id makes the
// device-slot gate treat the player as a brand-new device and sign them out,
// and wiping the saved accounts list loses fast account switching.
const KEEP_EXACT = new Set<string>([
  ...PREF_KEYS,
  "app-lang",
  "hamor_device_id",
  "oc_accounts_v1",
  "oc_pending_add_from",
]);


function shouldKeep(key: string) {
  return KEEP_EXACT.has(key) || KEEP_PREFIXES.some((p) => key.startsWith(p));
}


function clearWebStorage(store: Storage | undefined) {
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && !shouldKeep(k)) keys.push(k);
    }
    keys.forEach((k) => { try { store.removeItem(k); } catch { /* noop */ } });
  } catch { /* noop */ }
}

async function withTimeout<T>(p: Promise<T>, ms: number) {
  return Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]);
}

export async function forceUpdateApp() {
  // 1) Service workers: stop them from serving a stale shell.
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await withTimeout(
        Promise.all(regs.map(async (r) => {
          try { await r.update(); } catch { /* noop */ }
          try { await r.unregister(); } catch { /* noop */ }
        })),
        4000,
      );
    }
  } catch { /* noop */ }

  // 2) Cache Storage (precached assets / offline shell).
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await withTimeout(Promise.all(keys.map((k) => caches.delete(k))), 4000);
    }
  } catch { /* noop */ }

  // 3) App-level caches in web storage (keep the auth session).
  clearWebStorage(typeof localStorage !== "undefined" ? localStorage : undefined);
  clearWebStorage(typeof sessionStorage !== "undefined" ? sessionStorage : undefined);

  // 4) IndexedDB caches (query/asset stores), never the auth DB.
  try {
    const idb = indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> };
    if (typeof idb.databases === "function") {
      const dbs = await withTimeout(idb.databases(), 2000) as { name?: string }[] | undefined;
      (dbs ?? []).forEach((d) => {
        if (d?.name && !shouldKeep(d.name)) {
          try { indexedDB.deleteDatabase(d.name); } catch { /* noop */ }
        }
      });
    }
  } catch { /* noop */ }

  // 5) Warm the new build behind a cache-busting request so the reload can't
  //    be answered from an HTTP cache.
  const stamp = Date.now().toString(36);
  try {
    await withTimeout(
      fetch(`/?__v=${stamp}`, { cache: "reload", credentials: "same-origin" }).then(() => undefined),
      4000,
    );
  } catch { /* noop */ }

  // 6) Hard reload on a clean URL (drop old busting params so they don't pile up).
  const u = new URL(window.location.href);
  u.searchParams.delete("__v");
  u.searchParams.set("__v", stamp);
  window.location.replace(u.toString());
  // Safety net if replace() is swallowed by a WebView.
  setTimeout(() => { try { window.location.reload(); } catch { /* noop */ } }, 1200);
}
