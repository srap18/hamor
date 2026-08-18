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
