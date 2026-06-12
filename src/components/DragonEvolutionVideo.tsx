import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { getDragonVideoForStage } from "@/lib/dragon-videos";
import dragonEgg from "@/assets/dragon-egg.png";

type Props = {
  /** Dragon form 1..15 — drives which clip plays. Stable: only changes on promotion. */
  stage: number;
  className?: string;
  style?: CSSProperties;
  loop?: boolean;
};

/**
 * Plays the clip bound to the dragon's current form (1..15) and removes the
 * solid background via an adaptive canvas chroma key (auto-detected from the
 * four corner pixels of the first frame), so green/black/white backgrounds all
 * become transparent.
 */
export function DragonEvolutionVideo({ stage, className, style, loop = true }: Props) {
  const { url, stage: stageKind } = useMemo(() => getDragonVideoForStage(stage), [stage]);
  const isStaticEgg = stageKind === "egg";
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const keyColorRef = useRef<{ r: number; g: number; b: number } | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [canvasDisabled, setCanvasDisabled] = useState(false);

  useEffect(() => {
    if (isStaticEgg) return;
    // Reset on clip change so the new background is re-detected.
    keyColorRef.current = null;
    setCanvasReady(false);
    setCanvasDisabled(false);
  }, [url, isStaticEgg]);

  useEffect(() => {
    if (isStaticEgg) return;
    if (canvasDisabled) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!video || !canvas || !ctx) return;

    let raf = 0;
    let cancelled = false;

    const sampleBgFromCorners = (data: Uint8ClampedArray, w: number, h: number) => {
      // Average a small patch in each corner, then average those four.
      const patch = 6;
      const sampleAt = (sx: number, sy: number) => {
        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        for (let y = sy; y < sy + patch; y++) {
          for (let x = sx; x < sx + patch; x++) {
            const i = (y * w + x) * 4;
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            n++;
          }
        }
        return { r: r / n, g: g / n, b: b / n };
      };
      const corners = [
        sampleAt(0, 0),
        sampleAt(w - patch, 0),
        sampleAt(0, h - patch),
        sampleAt(w - patch, h - patch),
      ];
      // Use the median-ish: average of the two closest corners to reject any
      // corner that happens to contain part of the dragon.
      const dist = (a: (typeof corners)[0], b: (typeof corners)[0]) =>
        Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
      let best = { i: 0, j: 1, d: Infinity };
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          const d = dist(corners[i], corners[j]);
          if (d < best.d) best = { i, j, d };
        }
      }
      const a = corners[best.i];
      const b = corners[best.j];
      return { r: (a.r + b.r) / 2, g: (a.g + b.g) / 2, b: (a.b + b.b) / 2 };
    };

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

          if (!keyColorRef.current) {
            keyColorRef.current = sampleBgFromCorners(px, width, height);
          }
          const key = keyColorRef.current;

          // Tolerance: tight enough to keep dragon edges, loose enough to wipe
          // gradient backgrounds. Soft edge over a small range.
          const HARD = 70; // distance <= HARD → fully transparent
          const SOFT = 130; // distance >= SOFT → fully opaque
          for (let i = 0; i < px.length; i += 4) {
            const dr = px[i] - key.r;
            const dg = px[i + 1] - key.g;
            const db = px[i + 2] - key.b;
            const d = Math.sqrt(dr * dr + dg * dg + db * db);
            if (d <= HARD) {
              px[i + 3] = 0;
            } else if (d < SOFT) {
              const t = (d - HARD) / (SOFT - HARD);
              px[i + 3] = Math.round(px[i + 3] * t);
            }
            // De-spill green when the background is green-dominant.
            if (key.g > key.r + 20 && key.g > key.b + 20) {
              const cap = Math.max(px[i], px[i + 2]);
              if (px[i + 1] > cap) px[i + 1] = cap;
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
  }, [url, canvasDisabled, isStaticEgg]);

  if (isStaticEgg) {
    return (
      <span
        className={className}
        style={{ ...style, display: "block", position: "relative" }}
        data-dragon-stage={stageKind}
      >
        <img
          src={dragonEgg}
          alt="بيضة التنين"
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ objectFit: "contain", objectPosition: "bottom center" }}
        />
      </span>
    );
  }

  return (
    <span
      className={className}
      style={{ ...style, display: "block", position: "relative" }}
      data-dragon-stage={stageKind}
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
          mixBlendMode: canvasDisabled ? "multiply" : undefined,
          // Hide the raw video as soon as the keyed canvas has its first frame.
          opacity: canvasDisabled ? 1 : canvasReady ? 0 : 0,
        }}
      />
      {!canvasDisabled && (
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{
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
