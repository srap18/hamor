import { ReactNode, useEffect, useRef } from "react";

/**
 * Wraps the entire app in a phone-shaped frame on desktop/tablet,
 * and renders full-screen on real mobile devices.
 *
 * Trick: `transform: translateZ(0)` on the frame creates a containing
 * block so descendants with `position: fixed` are scoped to the frame
 * instead of the viewport.
 */
export function MobileFrame({ children }: { children: ReactNode }) {
  const stableHeightRef = useRef<number>(0);

  useEffect(() => {
    const setAppHeight = () => {
      const viewport = window.visualViewport;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportOffsetTop = viewport?.offsetTop ?? 0;
      const active = document.activeElement;
      const isEditing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLElement && active.isContentEditable;
      const previousStable = stableHeightRef.current || window.innerHeight || viewportHeight;
      const rawInset = Math.max(0, previousStable - viewportHeight - viewportOffsetTop);
      const wasKeyboardOpen = document.documentElement.classList.contains("keyboard-open");
      const keyboardOpen = rawInset > 80 && (isEditing || wasKeyboardOpen);

      if (!keyboardOpen) {
        stableHeightRef.current = Math.floor(viewportHeight);
      }

      const appHeight = keyboardOpen ? previousStable : viewportHeight;
      const keyboardInset = keyboardOpen ? rawInset : 0;

      document.documentElement.style.setProperty(
        "--app-height",
        `${Math.floor(appHeight)}px`,
      );
      document.documentElement.style.setProperty("--keyboard-inset", `${Math.floor(keyboardInset)}px`);
      document.documentElement.classList.toggle("keyboard-open", keyboardInset > 0);
      if (keyboardInset > 0) window.scrollTo(0, 0);
    };

    setAppHeight();
    window.addEventListener("resize", setAppHeight);
    window.addEventListener("scroll", setAppHeight, { passive: true });
    window.addEventListener("focusin", setAppHeight);
    window.addEventListener("focusout", setAppHeight);
    window.addEventListener("orientationchange", setAppHeight);
    window.visualViewport?.addEventListener("resize", setAppHeight);
    window.visualViewport?.addEventListener("scroll", setAppHeight);
    return () => {
      window.removeEventListener("resize", setAppHeight);
      window.removeEventListener("scroll", setAppHeight);
      window.removeEventListener("focusin", setAppHeight);
      window.removeEventListener("focusout", setAppHeight);
      window.removeEventListener("orientationchange", setAppHeight);
      window.visualViewport?.removeEventListener("resize", setAppHeight);
      window.visualViewport?.removeEventListener("scroll", setAppHeight);
    };
  }, []);

  return (
    <div className="mobile-frame-root">
      <div className="mobile-frame-stage">
        <div className="mobile-frame-device">
          <div className="mobile-frame-notch" aria-hidden />
          <div className="mobile-frame-screen">{children}</div>
        </div>
      </div>
    </div>
  );
}
