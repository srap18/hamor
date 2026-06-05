import { useEffect, useRef, useState } from "react";

/**
 * Seamless looping background video using two alternating <video> elements.
 *
 * Native `loop` often shows a tiny stall/jump at the seam. We run two decoders
 * and hand off playback ~0.3s before the active one ends, so the loop feels
 * perfectly even.
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
  const activeRef = useRef<"a" | "b">("a");
  const [active, setActive] = useState<"a" | "b">("a");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;

    const HANDOFF = 0.25; // seconds before end to start the other decoder

    const setup = (v: HTMLVideoElement) => {
      try { v.playbackRate = playbackRate; } catch {}
    };
    setup(a); setup(b);

    a.play().catch(() => {});
    const onA = () => { setReady(true); a.removeEventListener("playing", onA); };
    a.addEventListener("playing", onA);
    if (a.readyState >= 2) setReady(true);

    const tick = () => {
      const cur = activeRef.current === "a" ? a : b;
      const other = activeRef.current === "a" ? b : a;
      const dur = cur.duration;
      if (isFinite(dur) && dur > 0 && dur - cur.currentTime <= HANDOFF) {
        if (other.paused || other.currentTime > HANDOFF) {
          try { other.currentTime = 0; } catch {}
          other.play().catch(() => {});
        }
        if (dur - cur.currentTime <= 0.05) {
          activeRef.current = activeRef.current === "a" ? "b" : "a";
          setActive(activeRef.current);
          try { cur.pause(); cur.currentTime = 0; } catch {}
        }
      }
    };
    const id = window.setInterval(tick, 40);

    const onVis = () => {
      const cur = activeRef.current === "a" ? a : b;
      if (document.visibilityState === "visible") {
        setup(cur);
        cur.play().catch(() => {});
      } else {
        try { a.pause(); b.pause(); } catch {}
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [src, playbackRate]);

  const videoStyle: React.CSSProperties = {
    ...style,
    transform: "translateZ(0)",
    backfaceVisibility: "hidden",
  };

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
          style={{ ...style, opacity: ready ? 0 : 1, transition: "opacity 0.25s ease" }}
        />
      )}
      <video
        ref={aRef}
        src={src}
        poster={poster}
        autoPlay
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        className={className}
        style={{ ...videoStyle, opacity: active === "a" ? 1 : 0 }}
      />
      <video
        ref={bRef}
        src={src}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        className={className}
        style={{ ...videoStyle, opacity: active === "b" ? 1 : 0 }}
      />
    </>
  );
}
