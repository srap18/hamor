import { useEffect, useRef, useState } from "react";
import { isLowEndDevice, isLowBandwidth } from "@/lib/perf-mode";

/**
 * Seamless looping background video.
 *
 * Always plays the video (no static-image fallback) so the scene stays alive.
 * - Pauses when tab is hidden to save battery, resumes on return.
 * - Uses two crossfading videos so the loop has no visible seam.
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
  const [videoVisible, setVideoVisible] = useState(false);

  // On weak phones / slow networks: skip the dual-video crossfade + rAF loop
  // entirely. Rendering only the poster still-image saves a huge amount of
  // CPU/GPU/battery without changing layout.
  const lite = isLowEndDevice || isLowBandwidth;

  useEffect(() => {
    setVideoVisible(false);
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;

    // Reveal as soon as the first frame is decoded — don't wait for "playing".
    const revealOnFrame = () => setVideoVisible(true);
    a.addEventListener("loadeddata", revealOnFrame, { once: true });
    if ("requestVideoFrameCallback" in a) {
      try { (a as any).requestVideoFrameCallback(() => setVideoVisible(true)); } catch {}
    }
    if (a.readyState >= 2) setVideoVisible(true);

    let raf = 0;
    let bOffset = false;
    let FADE = 1.6;

    const applyRate = () => {
      try { a.playbackRate = playbackRate; b.playbackRate = playbackRate; } catch {}
    };
    const offsetB = () => {
      const dur = a.duration;
      if (!dur || !isFinite(dur)) return;
      // Continuous crossfade: FADE = dur/2 so the two videos are always
      // blending. At A's loop boundary, B is at mid-clip and fully visible,
      // completely hiding any restart jump in the source content.
      FADE = dur / 2;
      try { b.currentTime = dur / 2; } catch {}
      bOffset = true;
    };
    const onLoaded = () => { offsetB(); applyRate(); a.play().catch(() => {}); };
    a.addEventListener("loadedmetadata", onLoaded);
    b.addEventListener("loadedmetadata", () => { offsetB(); applyRate(); });
    b.addEventListener("seeked", () => { applyRate(); b.play().catch(() => {}); }, { once: true });
    const onPlaying = () => { applyRate(); setVideoVisible(true); };
    a.addEventListener("playing", onPlaying);
    b.addEventListener("playing", onPlaying);

    applyRate();
    a.play().catch(() => {});
    b.play().catch(() => {});

    let lastFrame = 0;
    const FADE_FRAME_MS = 50; // throttle crossfade to ~20fps to save CPU/GPU
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      if (ts - lastFrame < FADE_FRAME_MS) return;
      lastFrame = ts;
      const dur = a.duration || 0;
      if (dur > 0 && bOffset) {
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
        const total = wa + wb;
        if (total > 0.001) {
          a.style.opacity = String(wa / total);
          b.style.opacity = String(wb / total);
        } else {
          a.style.opacity = "1";
          b.style.opacity = "0";
        }
      } else {
        a.style.opacity = "1";
        b.style.opacity = "0";
      }
    };
    raf = requestAnimationFrame(tick);

    const onVis = () => {
      if (document.visibilityState === "visible") {
        applyRate();
        a.play().catch(() => {});
        b.play().catch(() => {});
        if (!raf) raf = requestAnimationFrame(tick);
      } else {
        try { a.pause(); b.pause(); } catch {}
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("playing", onPlaying);
      b.removeEventListener("playing", onPlaying);
      document.removeEventListener("visibilitychange", onVis);
      if (raf) cancelAnimationFrame(raf);
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
        ref={aRef}
        src={src}
        poster={poster}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className={className}
        style={style}
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
        style={{ ...style, opacity: 0 }}
      />
    </>
  );
}
