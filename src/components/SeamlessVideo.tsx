import { useEffect, useRef, useState } from "react";

/**
 * Lightweight looping background video.
 *
 * Single video element (no dual-decoder crossfade) for smooth playback.
 * Masks the loop seam with a brief opacity dip near the end + slow continuous
 * CSS pan, so the restart is not perceivable without the cost of two decoders.
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
  const vRef = useRef<HTMLVideoElement | null>(null);
  const [videoVisible, setVideoVisible] = useState(false);

  useEffect(() => {
    setVideoVisible(false);
    const v = vRef.current;
    if (!v) return;

    const reveal = () => setVideoVisible(true);
    v.addEventListener("loadeddata", reveal, { once: true });
    v.addEventListener("playing", reveal);
    if (v.readyState >= 2) reveal();

    const applyRate = () => { try { v.playbackRate = playbackRate; } catch {} };
    applyRate();
    v.play().catch(() => {});

    // Seam-hider: fade slightly to black ~0.4s before the end, recover after
    // the loop restarts. Throttled to avoid touching DOM on every timeupdate.
    const FADE_WINDOW = 0.45;
    let lastT = 0;
    let lastOpacity = "1";
    const setOpacity = (val: string) => {
      if (val !== lastOpacity) {
        v.style.opacity = val;
        lastOpacity = val;
      }
    };
    const onTime = () => {
      const dur = v.duration;
      if (!dur || !isFinite(dur)) return;
      const t = v.currentTime;
      if (lastT > dur - FADE_WINDOW && t < FADE_WINDOW) {
        setOpacity(String(Math.min(1, t / FADE_WINDOW)));
      } else {
        const remaining = dur - t;
        if (remaining < FADE_WINDOW) {
          setOpacity(String(Math.max(0.55, remaining / FADE_WINDOW)));
        } else {
          setOpacity("1");
        }
      }
      lastT = t;
    };
    v.addEventListener("timeupdate", onTime);

    const onVis = () => {
      if (document.visibilityState === "visible") {
        applyRate();
        v.play().catch(() => {});
      } else {
        try { v.pause(); } catch {}
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      v.removeEventListener("playing", reveal);
      v.removeEventListener("timeupdate", onTime);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [src, playbackRate]);

  return (
    <>
      {poster && (
        <img
          src={poster}
          alt=""
          aria-hidden
          className={className}
          draggable={false}
          loading="eager"
          decoding="async"
          style={{
            ...style,
            opacity: videoVisible ? 0 : 1,
            transition: "opacity 0.25s ease",
          }}
        />
      )}
      <video
        ref={vRef}
        src={src}
        poster={poster}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className={className}
        style={{ ...style, transition: "opacity 0.15s linear" }}
      />
    </>
  );
}
