/**
 * Android system font-size / display-size compensation.
 *
 * Samsung and some other Android skins apply the OS "font size" setting to
 * WebViews through `WebSettings.textZoom`. Every text node is then rendered
 * 115–130% larger than the CSS says, so pills, buttons and the bottom nav grow
 * wider than the screen and get clipped on both edges (reported on Galaxy A71).
 *
 * `textZoom` multiplies the *rendered* font size, not the computed style, so we
 * can detect it by measuring a probe and shrink the root font-size by the same
 * factor — the zoom then brings it back to the intended size.
 *
 * No-ops everywhere the zoom factor is ~1 (iOS, desktop, most Androids).
 */
let installed = false;

function measureZoom(): number {
  const probe = document.createElement("div");
  probe.textContent = "M";
  probe.style.cssText =
    "position:absolute;top:-9999px;left:-9999px;font-size:100px;line-height:1;" +
    "visibility:hidden;pointer-events:none;white-space:pre;";
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  if (!h || !isFinite(h)) return 1;
  return h / 100;
}

function apply() {
  try {
    const zoom = measureZoom();
    const root = document.documentElement;
    // Only correct meaningful enlargement; ignore rounding noise and any
    // shrinking (users who deliberately picked a smaller system font keep it).
    if (zoom > 1.05 && zoom < 2.2) {
      root.style.setProperty("font-size", `${(16 / zoom).toFixed(3)}px`);
      root.style.setProperty("--text-zoom", zoom.toFixed(3));
    } else {
      root.style.removeProperty("font-size");
      root.style.removeProperty("--text-zoom");
    }
  } catch {
    /* noop */
  }
}

export function installTextZoomFix(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;
  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  window.setTimeout(apply, 800);
}
