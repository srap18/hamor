import { useEffect, useRef, useState } from "react";

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
  // When autoplay is refused (Android WebView / Data Saver / decode failure),
  // the browser paints its own big "play" button over the scene. Detect that
  // and drop the <video> entirely so the poster image shows instead.
  const [failed, setFailed] = useState(false);
  // Some Android devices only have 1–2 hardware H.264 decoders. When an
  // ad-bomb clip is playing fullscreen, the background video steals the last
  // decoder and the ad plays audio-only (black frames). Yield the decoder:
  // show the still poster while an ad-bomb is on screen.
  const [yielded, setYielded] = useState<boolean>(
    () => typeof window !== "undefined" && !!(window as unknown as { __adBombActive?: boolean }).__adBombActive,
  );

  useEffect(() => {
    setFailed(false);
  }, [src]);

  useEffect(() => {
    const onAd = (e: Event) => setYielded(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener("ad-bomb:active", onAd as EventListener);
    return () => window.removeEventListener("ad-bomb:active", onAd as EventListener);
  }, []);

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
    const onError = () => setFailed(true);
    const onGesture = () => {
      setFailed(false);
      tryPlay();
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("touchstart", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
    const onVis = () => {
      if (document.visibilityState === "visible") tryPlay();
      else { try { v.pause(); } catch { /* noop */ } }
    };

    // If playback never actually started, fall back to the still background.
    const watchdog = window.setTimeout(() => {
      if (v.paused || v.currentTime === 0 || v.readyState < 2) setFailed(true);
    }, 4000);

    v.addEventListener("loadeddata", onLoaded);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("error", onError);
    v.addEventListener("stalled", onError);
    window.addEventListener("pointerdown", onGesture, { once: true });
    window.addEventListener("touchstart", onGesture, { once: true, passive: true });
    window.addEventListener("keydown", onGesture, { once: true });
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.clearTimeout(watchdog);
      v.removeEventListener("loadeddata", onLoaded);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("error", onError);
      v.removeEventListener("stalled", onError);
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("touchstart", onGesture);
      window.removeEventListener("keydown", onGesture);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [src, playbackRate, failed]);

  if (failed) {
    return poster ? (
      <img
        src={poster}
        alt=""
        aria-hidden
        decoding="async"
        draggable={false}
        className={className}
        style={style}
      />
    ) : null;
  }

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      autoPlay
      loop
      muted
      playsInline
      controls={false}
      disablePictureInPicture
      disableRemotePlayback
      preload="auto"
      className={className}
      style={{ ...style, pointerEvents: "none" }}
    />
  );
}
