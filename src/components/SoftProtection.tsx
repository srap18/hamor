import { useEffect } from "react";
import { reportCheat } from "@/lib/rate-limit";

/**
 * Lightweight, mobile-safe frontend deterrent.
 *
 * - Disables right-click context menu on DESKTOP only (mobile long-press is left alone).
 * - Detects DevTools open via window outer/inner size delta (desktop only).
 * - Zero impact on touch devices, no polling on mobile, no CPU cost.
 *
 * NOTE: This is intentionally a SOFT deterrent — a determined attacker can bypass it.
 * The real protection is server-side (RLS, rl_guard, verify_session_integrity).
 */
export function SoftProtection() {
  // Anti-script layer: userscripts (Tampermonkey) hook window.fetch / XHR to
  // replay game RPCs in bursts. We keep a pristine copy of the native network
  // APIs from a same-origin iframe and restore them whenever they get patched.
  useEffect(() => {
    if (typeof window === "undefined") return;

    let frame: HTMLIFrameElement | null = null;
    const getPristine = () => {
      try {
        if (!frame || !frame.isConnected) {
          frame = document.createElement("iframe");
          frame.style.display = "none";
          document.documentElement.appendChild(frame);
        }
        return (frame.contentWindow ?? null) as any;
      } catch {
        return null;
      }
    };

    const isNative = (fn: unknown) => {
      try {
        return typeof fn === "function" && /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(fn));
      } catch {
        return false;
      }
    };

    let reported = false;
    const restore = () => {
      try {
        const hookedFetch = !isNative(window.fetch);
        const hookedXhr =
          !isNative(XMLHttpRequest.prototype.open) || !isNative(XMLHttpRequest.prototype.send);
        if (!hookedFetch && !hookedXhr) return;

        const w = getPristine();
        if (w) {
          if (hookedFetch && typeof w.fetch === "function") {
            window.fetch = w.fetch.bind(window);
          }
          if (hookedXhr && w.XMLHttpRequest) {
            XMLHttpRequest.prototype.open = w.XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.send = w.XMLHttpRequest.prototype.send;
          }
        }
        if (!reported) {
          reported = true;
          reportCheat("network_api_hooked", { fetch: hookedFetch, xhr: hookedXhr });
        }
      } catch {}
    };

    restore();
    const guardTimer = window.setInterval(restore, 2000);

    const isTouch = matchMedia?.("(pointer: coarse)").matches ?? "ontouchstart" in window;
    if (isTouch) return () => window.clearInterval(guardTimer); // Skip desktop-only bits on mobile


    // 1) Disable right-click
    const onCtx = (e: MouseEvent) => { e.preventDefault(); };
    document.addEventListener("contextmenu", onCtx);

    // 2) Block common devtools shortcuts (best-effort; doesn't block menu-bar open)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F12") { e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && ["I", "J", "C", "i", "j", "c"].includes(e.key)) {
        e.preventDefault();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKey);

    // 3) DevTools detection via window size delta (runs once per 4s, negligible cost)
    let flagged = false;
    const detect = () => {
      try {
        const wDiff = window.outerWidth - window.innerWidth;
        const hDiff = window.outerHeight - window.innerHeight;
        // Threshold: docked devtools usually creates >160px delta on one axis
        const open = wDiff > 200 || hDiff > 200;
        if (open && !flagged) {
          flagged = true;
          reportCheat("devtools_opened", { wDiff, hDiff });
        } else if (!open) {
          flagged = false;
        }
      } catch {}
    };
    const interval = window.setInterval(detect, 4000);

    return () => {
      document.removeEventListener("contextmenu", onCtx);
      document.removeEventListener("keydown", onKey);
      window.clearInterval(interval);
    };
  }, []);

  return null;
}
