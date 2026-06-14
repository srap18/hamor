/**
 * Platform detection helpers.
 *
 * Used to disable in-app payments inside the Android Capacitor build
 * (Google Play forbids third-party payment SDKs for digital goods).
 * The web browser and the iOS build keep working with the existing
 * payment provider — only Android is gated.
 */

declare global {
  interface Window {
    Capacitor?: {
      getPlatform?: () => string;
      isNativePlatform?: () => boolean;
    };
  }
}

/** True only when running inside the Android Capacitor app. */
export function isAndroidApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const cap = window.Capacitor;
    if (cap?.getPlatform?.() === "android") return true;
    // Fallback: Capacitor global present + Android UA.
    if (cap && /Android/i.test(navigator.userAgent)) return true;
  } catch {
    /* noop */
  }
  return false;
}

/** True only when running inside the iOS Capacitor app. */
export function isIosApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.Capacitor?.getPlatform?.() === "ios";
  } catch {
    return false;
  }
}

/** True inside any native Capacitor build (Android or iOS). */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !!window.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}
