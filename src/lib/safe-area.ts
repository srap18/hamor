/**
 * Safe-area fallback for Android WebViews.
 *
 * Many Android WebViews (especially edge-to-edge builds on Android 15+) report
 * `env(safe-area-inset-top)` as 0 even though the status bar / display cutout
 * overlaps the page. That pushed HUD icons (notifications, discovered fish…)
 * under the status bar. We measure the real inset via a probe element and,
 * when the browser reports nothing, fall back to a measured/estimated status
 * bar height exposed as `--fallback-safe-*` CSS variables.
 *
 * No-ops on iOS / desktop / browsers that report real insets.
 */
import { isAndroidApp } from "@/lib/platform";

let installed = false;

function readEnvInsets() {
  const probe = document.createElement("div");
  probe.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "width:0",
    "height:0",
    "visibility:hidden",
    "pointer-events:none",
    "padding-top:env(safe-area-inset-top, 0px)",
    "padding-bottom:env(safe-area-inset-bottom, 0px)",
    "padding-left:env(safe-area-inset-left, 0px)",
    "padding-right:env(safe-area-inset-right, 0px)",
  ].join(";");
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const insets = {
    top: parseFloat(cs.paddingTop) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
    right: parseFloat(cs.paddingRight) || 0,
  };
  probe.remove();
  return insets;
}

function apply() {
  try {
    const root = document.documentElement;
    const env = readEnvInsets();

    let top = 0;
    let bottom = 0;

    if (isAndroidApp() && env.top < 4) {
      // Estimate the status bar height from the gap between the physical
      // screen and the layout viewport when it looks plausible, otherwise use
      // the Android default of 24dp (a touch more for tall/cutout screens).
      const dpr = window.devicePixelRatio || 1;
      const screenH = (window.screen?.height || 0);
      const gap = Math.round(screenH - window.innerHeight);
      const plausible = gap > 12 && gap < 80 ? gap : 0;
      const fallback = plausible || (dpr >= 2.5 ? 30 : 24);
      top = fallback;
    }

    if (isAndroidApp() && env.bottom < 4) {
      // Gesture-navigation pill area — small, keeps buttons tappable.
      bottom = 8;
    }

    root.style.setProperty("--fallback-safe-top", `${Math.round(top)}px`);
    root.style.setProperty("--fallback-safe-bottom", `${Math.round(bottom)}px`);
    // Horizontal: keep a tiny gutter so round-corner screens never clip icons.
    const side = isAndroidApp() ? Math.max(env.left, env.right, 4) : 0;
    root.style.setProperty("--fallback-safe-left", `${Math.round(side)}px`);
    root.style.setProperty("--fallback-safe-right", `${Math.round(side)}px`);
  } catch {
    /* noop */
  }
}

export function installSafeAreaFallback(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  window.setTimeout(apply, 600);
}
