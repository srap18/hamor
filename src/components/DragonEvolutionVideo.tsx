import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { getDragonVideoForLevel } from "@/lib/dragon-videos";

type Props = {
  /** Overall dragon level 1..150. */
  level: number;
  className?: string;
  style?: CSSProperties;
  loop?: boolean;
  /** Optional override for the green key threshold (0..1). Higher = more aggressive. */
  chromaStrength?: number;
};

/**
 * Plays the correct dragon evolution clip for the given level and removes the
 * solid green-screen background pixel-by-pixel via a canvas chroma key. Falls
 * back to a `mix-blend-mode: multiply` rendering when canvas access is blocked
 * (e.g. cross-origin without CORS), so the dragon still appears reasonably
 * keyed.
 */
export function DragonEvolutionVideo({
  level,
  className,
  style,
  loop = true,
  chromaStrength = 1,
}: Props) {
  const { url, stage } = useMemo(() => getDragonVideoForLevel(level), [level]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [canvasDisabled, setCanvasDisabled] = useState(false);

  useEffect(() => {
    // Re-attempt canvas keying whenever the clip changes.
    setCanvasReady(false);
    setCanvasDisabled(false);
  }, [url]);

  useEffect(() => {
    if (canvasDisabled) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!video || !canvas || !ctx) return;

    let raf = 0;
    let cancelled = false;

    const draw = () => {
      if (cancelled) return;
      if (video.readyState >= 2) {
        const width = video.videoWidth || 512;
        const height = video.videoHeight || 512;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        try {
          ctx.drawImage(video, 0, 0, width, height);
          const frame = ctx.getImageData(0, 0, width, height);
          const px = frame.data;
          // Green chroma key: a pixel is "green screen" when green strongly
          // dominates red and blue. Soft edge based on how dominant it is.
          const gMin = 70;                       // ignore very dark greens
          const dom = 30 * (1 / chromaStrength); // green must exceed red/blue by this
          for (let i = 0; i < px.length; i += 4) {
            const r = px[i];
            const g = px[i + 1];
            const b = px[i + 2];
            if (g > gMin && g - r > dom && g - b > dom) {
              // Full transparency for very green pixels, soft edge otherwise.
              const overshoot = Math.min(g - r, g - b) - dom;
              const alpha = Math.max(0, 255 - overshoot * 8);
              px[i + 3] = alpha;
              // De-spill: pull green down towards the max of r/b so edges
              // don't look neon-green.
              const cap = Math.max(r, b);
              if (g > cap) px[i + 1] = cap;
            }
          }
          ctx.putImageData(frame, 0, 0);
          setCanvasReady(true);
        } catch {
          cancelled = true;
          setCanvasDisabled(true);
          return;
        }
      }
      raf = requestAnimationFrame(draw);
    };

    video.play().catch(() => {});
    raf = requestAnimationFrame(draw);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [url, canvasDisabled, chromaStrength]);

  return (
    <span
      className={className}
      style={{ ...style, display: "block", position: "relative" }}
      data-dragon-stage={stage}
    >
      <video
        ref={videoRef}
        src={url}
        autoPlay
        loop={loop}
        muted
        playsInline
        crossOrigin="anonymous"
        onError={() => setCanvasDisabled(true)}
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{
          objectFit: "contain",
          objectPosition: "bottom center",
          // Fallback when canvas keying is unavailable.
          mixBlendMode: canvasDisabled ? "multiply" : undefined,
          opacity: canvasDisabled ? 1 : canvasReady ? 0 : 1,
        }}
      />
      {!canvasDisabled && (
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{
            // Canvas is the keyed output; show it as soon as the first frame
            // is processed.
            objectFit: "contain",
            objectPosition: "bottom center",
            opacity: canvasReady ? 1 : 0,
          }}
          aria-hidden
        />
      )}
    </span>
  );
}
