import { useEffect, useRef } from "react";

/**
 * Looping background video. Single <video> element — no crossfade.
 * Pauses when tab is hidden to save battery, resumes on return.
 *
 * Android compat notes:
 * - `muted` MUST be a boolean attribute at first mount for Chrome/Android to
 *   allow autoplay. React sets it correctly on the prop, but some third-party
 *   HTML processors or CSP proxies strip it — reapply defensively via setAttribute.
 * - `.play()` can reject silently on Android when the browser hasn't decoded
 *   enough of the video yet or when Data Saver/low battery blocks autoplay.
 *   Retry on `loadeddata`, `canplay`, and the first user gesture.
 */
export function SeamlessVideo({
  src,
  poster,
  className,
  style,
  playbackRate = 0.6,
}: {
  src: string;
  poster?: string;
  className?: string;
  style?: React.CSSProperties;
  playbackRate?: number;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;

    // Reapply the attributes Android autoplay policy requires. React handles
    // them, but on some Android WebViews the attribute is missing at first paint.
    try {
      v.muted = true;
      v.defaultMuted = true;
      v.setAttribute("muted", "");
      v.setAttribute("playsinline", "");
      v.setAttribute("webkit-playsinline", "");
      v.setAttribute("autoplay", "");
      v.setAttribute("preload", "auto");
    } catch { /* noop */ }

    const tryPlay = () => {
      try { v.playbackRate = playbackRate; } catch { /* noop */ }
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => { /* will retry on next event */ });
    };

    tryPlay();

    const onLoaded = () => tryPlay();
    const onCanPlay = () => tryPlay();
    const onGesture = () => {
      tryPlay();
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("touchstart", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
    const onVis = () => {
      if (document.visibilityState === "visible") tryPlay();
      else { try { v.pause(); } catch { /* noop */ } }
    };

    v.addEventListener("loadeddata", onLoaded);
    v.addEventListener("canplay", onCanPlay);
    window.addEventListener("pointerdown", onGesture, { once: true });
    window.addEventListener("touchstart", onGesture, { once: true, passive: true });
    window.addEventListener("keydown", onGesture, { once: true });
    document.addEventListener("visibilitychange", onVis);

    return () => {
      v.removeEventListener("loadeddata", onLoaded);
      v.removeEventListener("canplay", onCanPlay);
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("touchstart", onGesture);
      window.removeEventListener("keydown", onGesture);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [src, playbackRate]);

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      autoPlay
      loop
      muted
      defaultMuted
      playsInline
      // @ts-expect-error legacy iOS/Android attribute
      webkit-playsinline=""
      preload="auto"
      disablePictureInPicture
      disableRemotePlayback
      className={className}
      style={style}
    />
  );
}
