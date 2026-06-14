/**
 * Platform detection helpers.
 *
 * Used to:
 *  - Hide third-party payment SDKs (Paddle/Stripe) inside the native app
 *    builds, since Google Play and the App Store forbid them for digital
 *    goods. Native builds use in-app purchases instead (see `src/lib/iap.ts`).
 *  - Toggle native-only UX (status bar, back button, safe areas).
 */

declare global {
  interface Window {
    Capacitor?: {
      getPlatform?: () => string;
      isNativePlatform?: () => boolean;
      Plugins?: Record<string, unknown>;
    };
  }
}

function cap() {
  if (typeof window === "undefined") return undefined;
  try {
    return window.Capacitor;
  } catch {
    return undefined;
  }
}

/** True only when running inside the Android Capacitor app. */
export function isAndroidApp(): boolean {
  const c = cap();
  if (!c) return false;
  if (c.getPlatform?.() === "android") return true;
  if (c.isNativePlatform?.() && /Android/i.test(navigator.userAgent)) return true;
  return false;
}

/** True only when running inside the iOS Capacitor app. */
export function isIosApp(): boolean {
  const c = cap();
  if (!c) return false;
  if (c.getPlatform?.() === "ios") return true;
  if (c.isNativePlatform?.() && /iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
  return false;
}

/** True inside any native Capacitor build (Android or iOS). */
export function isNativeApp(): boolean {
  const c = cap();
  if (!c) return false;
  try {
    if (c.isNativePlatform?.()) return true;
  } catch {
    /* noop */
  }
  return isAndroidApp() || isIosApp();
}

/** True if running on the regular web (browser / PWA on the web). */
export function isWeb(): boolean {
  return !isNativeApp();
}
