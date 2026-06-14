/**
 * Native app shell wiring (Capacitor only).
 *
 * - Adds `native-app`, `platform-android` / `platform-ios` classes on <html>
 *   so CSS can target the native build (safe-area padding, disabled text
 *   selection, no pull-to-refresh, etc).
 * - Hooks the Android hardware back button to close modals / go back inside
 *   the SPA instead of exiting the app.
 *
 * Safe to call on the web — it no-ops.
 */
import { isAndroidApp, isIosApp, isNativeApp } from "@/lib/platform";

let installed = false;

export function installNativeShell(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  // 1) Tag the root element so CSS can react.
  try {
    const root = document.documentElement;
    if (isNativeApp()) root.classList.add("native-app");
    if (isAndroidApp()) root.classList.add("platform-android");
    if (isIosApp()) root.classList.add("platform-ios");
  } catch {
    /* noop */
  }

  if (!isNativeApp()) return;

  // 2) Disable iOS rubber-band / pull-to-refresh at the body level.
  try {
    document.body.style.overscrollBehavior = "none";
    (document.body.style as any).webkitOverflowScrolling = "auto";
  } catch {
    /* noop */
  }

  // 3) Android hardware back button — let modals/dialogs handle it first.
  try {
    const plugins = window.Capacitor?.Plugins as Record<string, any> | undefined;
    const App = plugins?.App;
    if (App && typeof App.addListener === "function" && isAndroidApp()) {
      App.addListener("backButton", (ev: { canGoBack: boolean }) => {
        // Dispatch a CustomEvent first — open modals can preventDefault to
        // consume the back press (e.g. close themselves instead of navigating).
        const evt = new CustomEvent("native-back", { cancelable: true });
        const consumed = !window.dispatchEvent(evt);
        if (consumed) return;

        // If a top-level modal/dialog is open, click its "close" button.
        const openDialog = document.querySelector<HTMLElement>(
          '[role="dialog"][data-state="open"], .fixed.inset-0[class*="z-"]',
        );
        if (openDialog) {
          const closer = openDialog.querySelector<HTMLElement>(
            '[data-close], [aria-label="close" i], [aria-label="إغلاق"]',
          );
          if (closer) {
            closer.click();
            return;
          }
        }

        // Otherwise: history back, or minimize app if no history.
        if (window.history.length > 1) {
          window.history.back();
        } else {
          App.exitApp?.();
        }
      });
    }
  } catch (e) {
    console.warn("[native-shell] back-button wiring failed", e);
  }
}
