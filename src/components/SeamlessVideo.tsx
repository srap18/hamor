import { useEffect, useRef, useState } from "react";

/**
 * Seamless looping background video.
 * Uses two stacked <video> elements offset by half the duration and
 * crossfades between them so the loop seam is never visible. Also slows the
 * playback rate by default so the short clip feels less repetitive.
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
    // Crossfade window — sized as a fraction of the clip length so even very
    // short loops fully hide the seam.
    let FADE = 1.6;

    const applyRate = () => {
      try { a.playbackRate = playbackRate; b.playbackRate = playbackRate; } catch {}
    };
    const offsetB = () => {
      const dur = a.duration;
      if (!dur || !isFinite(dur)) return;
      FADE = Math.max(0.8, Math.min(2.5, dur * 0.35));
      try { b.currentTime = dur / 2; } catch {}
    };
    const onLoaded = () => {
      offsetB();
      applyRate();
      setVideoReady(true);
      a.play().catch(() => {});
    };
    a.addEventListener("loadedmetadata", onLoaded);
    b.addEventListener("loadedmetadata", () => { offsetB(); applyRate(); });
    b.addEventListener("seeked", () => { applyRate(); b.play().catch(() => {}); }, { once: true });
    const onCanPlay = () => { applyRate(); setVideoReady(true); };
    a.addEventListener("canplay", onCanPlay);
    const onError = () => setVideoFailed(true);
    a.addEventListener("error", onError);
    b.addEventListener("error", onError);

    // Retry play on visibility change (some mobile browsers pause when tab hidden)
    const onVis = () => {
      if (document.visibilityState === "visible") {
        applyRate();
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
        const da = Math.min(ta, dur - ta);
        const db = Math.min(tb, dur - tb);
        const ease = (x: number) => {
          const t = Math.max(0, Math.min(1, x));
          return t * t * (3 - 2 * t);
        };
        const wa = ease(da / FADE);
        const wb = ease(db / FADE);
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
      cancelAnimationFrame(raf);
    };
  }, [src, playbackRate]);

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
            ...style,
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
        style={{ ...style, opacity: videoFailed ? 0 : 1, display: videoFailed ? "none" : undefined }}
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
        style={{ ...style, opacity: 0, display: videoFailed ? "none" : undefined }}
      />
    </>
  );
}
