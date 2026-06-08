import { useEffect, useRef } from "react";

/**
 * Looping background video. Single <video> element — no crossfade.
 * Pauses when tab is hidden to save battery, resumes on return.
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
    try { v.playbackRate = playbackRate; } catch {}
    v.play().catch(() => {});

    const onVis = () => {
      if (document.visibilityState === "visible") {
        try { v.playbackRate = playbackRate; } catch {}
        v.play().catch(() => {});
      } else {
        try { v.pause(); } catch {}
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [src, playbackRate]);

  return (
    <video
      ref={ref}
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
  );
}
