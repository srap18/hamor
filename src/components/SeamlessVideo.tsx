import { useEffect, useRef, useState } from "react";
import { isLowBandwidth, isLowPerfMode } from "@/lib/perf-mode";

/**
 * Seamless looping background video — bandwidth/CPU aware.
 *
 * - On low-bandwidth / save-data: skips the video entirely, shows the poster only.
 * - On low-end devices: shows ONE video element instead of two (half the bandwidth,
 *   no RAF crossfade loop).
 * - When the tab is hidden: pauses the RAF and the videos.
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
  const [videoFailed, setVideoFailed] = useState(false);

  // On weak networks (or saveData), skip video entirely — poster only.
  const skipVideo = isLowBandwidth;
  // On low-end CPU/RAM, use single video instead of dual-video crossfade.
  const singleVideo = isLowPerfMode && !skipVideo;

  useEffect(() => {
    if (skipVideo) return;
    setVideoVisible(false);
    setVideoFailed(false);
    const a = aRef.current;
    const b = bRef.current;
    if (!a) return;

    let raf = 0;
    let bOffset = false;
    let FADE = 1.6;

    const applyRate = () => {
      try {
        a.playbackRate = playbackRate;
        if (b) b.playbackRate = playbackRate;
      } catch {}
    };
    const offsetB = () => {
      if (!b) return;
      const dur = a.duration;
      if (!dur || !isFinite(dur)) return;
      FADE = Math.max(0.8, Math.min(2.5, dur * 0.35));
      try { b.currentTime = dur / 2; } catch {}
      bOffset = true;
    };
    const onLoaded = () => {
      offsetB();
      applyRate();
      a.play().catch(() => {});
    };
    a.addEventListener("loadedmetadata", onLoaded);
    if (b) {
      b.addEventListener("loadedmetadata", () => { offsetB(); applyRate(); });
      b.addEventListener("seeked", () => { applyRate(); b.play().catch(() => {}); }, { once: true });
    }
    const onPlaying = () => { applyRate(); setVideoVisible(true); };
    a.addEventListener("playing", onPlaying);
    if (b) b.addEventListener("playing", onPlaying);
    const onError = () => setVideoFailed(true);
    a.addEventListener("error", onError);
    if (b) b.addEventListener("error", onError);

    applyRate();
    a.play().catch(() => {});
    if (b) b.play().catch(() => {});

    const onVis = () => {
      if (document.visibilityState === "visible") {
        applyRate();
        a.play().catch(() => {});
        if (b) b.play().catch(() => {});
        if (!raf && b) raf = requestAnimationFrame(tick);
      } else {
        // Pause and stop RAF when tab is hidden — saves CPU/battery.
        try { a.pause(); b?.pause(); } catch {}
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
      }
    };
    document.addEventListener("visibilitychange", onVis);

    const tick = () => {
      if (!b) { raf = 0; return; }
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
      raf = requestAnimationFrame(tick);
    };
    if (b) raf = requestAnimationFrame(tick);

    return () => {
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("playing", onPlaying);
      if (b) b.removeEventListener("playing", onPlaying);
      a.removeEventListener("error", onError);
      if (b) b.removeEventListener("error", onError);
      document.removeEventListener("visibilitychange", onVis);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [src, playbackRate, skipVideo]);

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
            opacity: !skipVideo && videoVisible && !videoFailed ? 0 : 1,
            transition: "opacity 0.6s ease",
          }}
        />
      )}
      {!skipVideo && (
        <>
          <video
            ref={aRef}
            src={src}
            poster={poster}
            autoPlay
            loop
            muted
            playsInline
            // metadata-only fetch; the player streams as it plays so we don't
            // pre-download multi-MB on weak networks.
            preload="metadata"
            className={className}
            style={{ ...style, opacity: videoFailed ? 0 : 1, display: videoFailed ? "none" : undefined }}
          />
          {!singleVideo && (
            <video
              ref={bRef}
              src={src}
              poster={poster}
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              className={className}
              style={{ ...style, opacity: 0, display: videoFailed ? "none" : undefined }}
            />
          )}
        </>
      )}
    </>
  );
}
