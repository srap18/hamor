import { useEffect, useRef, useState } from "react";

/**
 * Seamless looping background video.
 * Uses two stacked <video> elements offset by half the duration and
 * crossfades between them so the loop seam is never visible.
 */
export function SeamlessVideo({
  src,
  poster,
  className,
}: {
  src: string;
  poster?: string;
  className?: string;
}) {
  const aRef = useRef<HTMLVideoElement | null>(null);
  const bRef = useRef<HTMLVideoElement | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    setVideoReady(false);
    setVideoFailed(false);
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;

    let raf = 0;
    const FADE = 0.6; // seconds of crossfade on each side of the seam

    const onLoaded = () => {
      const dur = a.duration || 5;
      // Offset B by half so its seam falls in the middle of A's playback
      try {
        b.currentTime = dur / 2;
      } catch {}
      setVideoReady(true);
    };
    a.addEventListener("loadedmetadata", onLoaded);
    const onCanPlay = () => setVideoReady(true);
    a.addEventListener("canplay", onCanPlay);
    const onError = () => setVideoFailed(true);
    a.addEventListener("error", onError);
    b.addEventListener("error", onError);

    // Fallback: if video doesn't load within 6s, give up and show poster
    const slowNetTimer = window.setTimeout(() => {
      if (a.readyState < 2) setVideoFailed(true);
    }, 6000);

    // Retry play on visibility change (some mobile browsers pause when tab hidden)
    const onVis = () => {
      if (document.visibilityState === "visible") {
        a.play().catch(() => {});
        b.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis);

    const tick = () => {
      const dur = a.duration || 5;
      if (dur > 0) {
        const ta = a.currentTime;
        const tb = b.currentTime;
        // distance from each video's own seam (start or end)
        const da = Math.min(ta, dur - ta);
        const db = Math.min(tb, dur - tb);
        // The video that's FURTHER from its seam should be more visible.
        // Use a smooth blend in the danger zone.
        const wa = Math.min(1, da / FADE);
        const wb = Math.min(1, db / FADE);
        const total = wa + wb || 1;
        a.style.opacity = String(wa / total);
        b.style.opacity = String(wb / total);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("canplay", onCanPlay);
      a.removeEventListener("error", onError);
      b.removeEventListener("error", onError);
      document.removeEventListener("visibilitychange", onVis);
      window.clearTimeout(slowNetTimer);
      cancelAnimationFrame(raf);
    };
  }, [src]);

  return (
    <>
      {/* Always-on poster image: shown immediately, hidden once video plays.
          If video fails or net is slow, the poster stays visible permanently. */}
      {poster && (
        <img
          src={poster}
          alt=""
          aria-hidden
          className={className}
          draggable={false}
          style={{
            opacity: videoReady && !videoFailed ? 0 : 1,
            transition: "opacity 0.6s ease",
          }}
        />
      )}
      <video
        ref={aRef}
        src={src}
        poster={poster}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className={className}
        style={{ opacity: videoFailed ? 0 : 1, display: videoFailed ? "none" : undefined }}
      />
      <video
        ref={bRef}
        src={src}
        poster={poster}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className={className}
        style={{ opacity: 0, display: videoFailed ? "none" : undefined }}
      />
    </>
  );
}
