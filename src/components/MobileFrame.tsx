import { ReactNode, useEffect } from "react";

/**
 * Wraps the entire app in a phone-shaped frame on desktop/tablet,
 * and renders full-screen on real mobile devices.
 *
 * Trick: `transform: translateZ(0)` on the frame creates a containing
 * block so descendants with `position: fixed` are scoped to the frame
 * instead of the viewport.
 */
export function MobileFrame({ children }: { children: ReactNode }) {
  useEffect(() => {
    const setAppHeight = () => {
      // Always use the visible viewport height. Using screen.height in
      // standalone mode pushed fixed bottom-0 UI below the Android nav bar.
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty(
        "--app-height",
        `${Math.floor(viewportHeight)}px`,
      );
    };

    setAppHeight();
    window.addEventListener("resize", setAppHeight);
    window.addEventListener("orientationchange", setAppHeight);
    window.visualViewport?.addEventListener("resize", setAppHeight);
    return () => {
      window.removeEventListener("resize", setAppHeight);
      window.removeEventListener("orientationchange", setAppHeight);
      window.visualViewport?.removeEventListener("resize", setAppHeight);
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
