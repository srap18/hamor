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

function userAgent() {
  if (typeof navigator === "undefined") return "";
  try {
    return navigator.userAgent || "";
  } catch {
    return "";
  }
}

/**
 * Capacitor normally exposes `window.Capacitor` before React starts. A few
 * released iOS shells load the remote web bundle before that global becomes
 * visible, though, which previously misclassified the app as Safari and opened
 * the web checkout inside WKWebView. Native WKWebView can be distinguished from
 * Safari by the iOS user agent not containing the Safari token.
 */
function isIosWebView(): boolean {
  const ua = userAgent();
  if (!/iPhone|iPad|iPod/i.test(ua)) return false;
  return !/Safari/i.test(ua);
}

/** True only when running inside the Android Capacitor app. */
export function isAndroidApp(): boolean {
  const c = cap();
  if (!c) return false;
  if (c.getPlatform?.() === "android") return true;
  if (c.isNativePlatform?.() && /Android/i.test(userAgent())) return true;
  return false;
}

/** True only when running inside the iOS Capacitor app. */
export function isIosApp(): boolean {
  const c = cap();
  if (c?.getPlatform?.() === "ios") return true;
  if (c?.isNativePlatform?.() && /iPhone|iPad|iPod/i.test(userAgent())) return true;
  return isIosWebView();
}

/** True inside any native Capacitor build (Android or iOS). */
export function isNativeApp(): boolean {
  const c = cap();
  if (c) {
    try {
      if (c.isNativePlatform?.()) return true;
    } catch {
      /* noop */
    }
  }
  return isAndroidApp() || isIosApp();
}

/** True if running on the regular web (browser / PWA on the web). */
export function isWeb(): boolean {
  return !isNativeApp();
}
