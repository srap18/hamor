import { useCallback, useEffect, useState } from "react";

/**
 * Local UI preferences (banners / toasts toggles).
 *
 * All of them are stored as "<key>" = "1" meaning HIDDEN (absent = shown),
 * which is the format the banner components already read.
 *
 * Why this module exists:
 *  - the settings toggles used to read localStorage once on mount, so any
 *    change made elsewhere (e.g. the "إيقاف" button inside the VIP banner,
 *    or another tab) left the switch showing a stale value — the user
 *    switched it off and it looked like it turned itself back on.
 *  - the "force update" cache wipe cleared these keys too, resetting every
 *    toggle after each update.
 */

export const PREF_KEYS = [
  "death-banner-hidden",
  "attack-banner-hidden",
  "lucky-banner-hidden",
  "vip-login-hidden",
  "toasts-hidden",
  "death-banner-min",
  // sound + performance prefs (owned by sound.ts / bg-motion.ts / power-saver.ts)
  "sfx_on",
  "music_on",
  "bg-motion-paused",
  "power-saver",
] as const;

export type PrefKey = (typeof PREF_KEYS)[number];

/** localStorage key -> window event other components listen to. */
const EVENTS: Record<string, string> = {
  "death-banner-hidden": "death-banner-pref",
  "attack-banner-hidden": "attack-banner-pref",
  "lucky-banner-hidden": "lucky-banner-pref",
  "vip-login-hidden": "vip-login-pref",
  "toasts-hidden": "toasts-pref",
};

/** true when the related banner/toast is ENABLED (i.e. not hidden). */
export function getPrefEnabled(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "1";
  } catch {
    return true;
  }
}

export function setPrefEnabled(key: string, enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(key, "0");
    else localStorage.setItem(key, "1");
  } catch {
    /* noop */
  }
  const evt = EVENTS[key];
  try {
    if (evt) window.dispatchEvent(new Event(evt));
    window.dispatchEvent(new Event("ui-pref-changed"));
  } catch {
    /* noop */
  }
}

/**
 * React hook that always reflects the real stored value: it re-reads on the
 * dedicated pref event, on cross-tab storage events, and when the tab becomes
 * visible again. Prevents "I turned it off and it turned itself back on".
 */
export function useUiPref(key: string): [boolean, (v: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => getPrefEnabled(key));

  useEffect(() => {
    const read = () => setEnabled(getPrefEnabled(key));
    read();
    const evt = EVENTS[key];
    if (evt) window.addEventListener(evt, read);
    window.addEventListener("ui-pref-changed", read);
    window.addEventListener("storage", read);
    document.addEventListener("visibilitychange", read);
    return () => {
      if (evt) window.removeEventListener(evt, read);
      window.removeEventListener("ui-pref-changed", read);
      window.removeEventListener("storage", read);
      document.removeEventListener("visibilitychange", read);
    };
  }, [key]);

  const set = useCallback(
    (v: boolean) => {
      setPrefEnabled(key, v);
      setEnabled(getPrefEnabled(key));
    },
    [key],
  );

  return [enabled, set];
}

/**
 * Imperative live subscription to a pref (for non-React refs / listeners).
 * Calls `cb(hidden)` immediately and on every change (same tab, other tab,
 * or after the tab regains visibility). Returns an unsubscribe function.
 */
export function subscribePrefHidden(key: string, cb: (hidden: boolean) => void): () => void {
  const read = () => cb(!getPrefEnabled(key));
  read();
  const evt = EVENTS[key];
  if (evt) window.addEventListener(evt, read);
  window.addEventListener("ui-pref-changed", read);
  window.addEventListener("storage", read);
  document.addEventListener("visibilitychange", read);
  return () => {
    if (evt) window.removeEventListener(evt, read);
    window.removeEventListener("ui-pref-changed", read);
    window.removeEventListener("storage", read);
    document.removeEventListener("visibilitychange", read);
  };
}
