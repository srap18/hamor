import { useEffect, useRef, useState } from "react";

/**
 * Lightweight looping background video.
 *
 * Single video element (no dual-decoder crossfade) for smooth playback.
 * Keeps opacity/transform fixed so the background never appears to zoom at the
 * loop seam.
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

    v.style.opacity = "1";

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
        disablePictureInPicture
        disableRemotePlayback
        className={className}
        style={{ ...style, opacity: 1, transform: "translateZ(0)", backfaceVisibility: "hidden" }}
      />
    </>
  );
}
