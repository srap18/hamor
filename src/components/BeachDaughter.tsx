import { useEffect, useRef, useState } from "react";
import { useDaughter } from "@/hooks/use-daughter";
import { outfitImage } from "@/lib/daughter";
import { DaughterModal } from "@/components/DaughterModal";

type ShipLite = { id: number; dockLeft: number; fishing: boolean; sail: number };

type Mood = "walk" | "look" | "twirl" | "sit" | "wave" | "pull" | "laugh" | "idle";

interface Props {
  ships?: ShipLite[];
}

/**
 * Lifelike beach companion that LIVES inside the scene — not glued to the
 * screen. She wanders on her own, never blocks taps on the ships, and only
 * her own silhouette is clickable.
 *
 * Limbs/head/smile are faked with composed CSS transforms (no sprite sheet):
 *  - leg-like skewX swing while walking
 *  - head/torso bob + sway
 *  - arm-like rotate during waving / pulling
 *  - subtle breathing scale and a "laugh" bounce
 */
export function BeachDaughter({ ships = [] }: Props) {
  const { daughter } = useDaughter();

  const [pos, setPos] = useState(20);
  const [duration, setDuration] = useState(2.5);
  const [facing, setFacing] = useState<1 | -1>(1);
  const [mood, setMood] = useState<Mood>("walk");
  const [open, setOpen] = useState(false);

  const moodTimerRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const escortingRef = useRef(false);
  const wasFishingRef = useRef<Set<number>>(new Set());

  const moveTo = (target: number, paceSecPerPct: number) => {
    const clamped = Math.max(4, Math.min(96, target));
    setPos((cur) => {
      setFacing(clamped >= cur ? 1 : -1);
      const distance = Math.abs(clamped - cur);
      setDuration(Math.max(0.4, distance * paceSecPerPct));
      return clamped;
    });
  };

  const setMoodFor = (m: Mood, ms: number, then?: () => void) => {
    setMood(m);
    if (moodTimerRef.current) clearTimeout(moodTimerRef.current);
    moodTimerRef.current = window.setTimeout(() => {
      then?.();
    }, ms);
  };

  // Ship returning → run to it and play "pulling to shore" mime
  useEffect(() => {
    const prev = wasFishingRef.current;
    const next = new Set<number>();
    for (const s of ships) if (s.fishing || s.sail > 0.1) next.add(s.id);

    for (const id of prev) {
      if (!next.has(id)) {
        const ship = ships.find((s) => s.id === id);
        if (!ship) continue;
        escortingRef.current = true;
        moveTo(ship.dockLeft, 0.035);
        setMoodFor("walk", 0, () => {
          setMoodFor("pull", 5000, () => {
            setMoodFor("laugh", 1500, () => {
              escortingRef.current = false;
              setMood("idle");
            });
          });
        });
      }
    }
    wasFishingRef.current = next;
  }, [ships]);

  // Idle behavior scheduler — richer randomization
  useEffect(() => {
    const tick = () => {
      idleTimerRef.current = window.setTimeout(() => {
        if (!escortingRef.current) {
          const r = Math.random();
          if (r < 0.18) {
            setMoodFor("look", 1800, () => setMood("idle"));
          } else if (r < 0.30) {
            setMoodFor("twirl", 1100, () => setMood("idle"));
          } else if (r < 0.42) {
            setMoodFor("sit", 2800, () => setMood("idle"));
          } else if (r < 0.55) {
            setMoodFor("wave", 1800, () => setMood("idle"));
          } else if (r < 0.68) {
            setMoodFor("laugh", 1600, () => setMood("idle"));
          } else {
            setMood("walk");
            const target = pos + (Math.random() * 60 - 30);
            const pace = 0.09 + Math.random() * 0.13;
            moveTo(target, pace);
            setTimeout(() => { if (!escortingRef.current) setMood("idle"); }, pace * Math.abs(target - pos) * 1000 + 100);
          }
        }
        tick();
      }, 2500 + Math.random() * 2200);
    };
    tick();
    return () => { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => { if (moodTimerRef.current) clearTimeout(moodTimerRef.current); };
  }, []);

  if (!daughter) return null;

  const img = outfitImage(daughter.outfit);
  const baseSize = 64 + (daughter.stage - 1) * 16;

  // Pick mood-specific animation class for the body parts
  let bodyAnim = "";
  let extraTilt = "";
  switch (mood) {
    case "walk":   bodyAnim = "animate-[bdyWalk_0.55s_ease-in-out_infinite]"; break;
    case "look":   bodyAnim = "animate-[bdyLook_2.4s_ease-in-out_infinite]"; break;
    case "twirl":  bodyAnim = "animate-[bdyTwirl_1.1s_ease-in-out]"; break;
    case "wave":   bodyAnim = "animate-[bdyWave_0.65s_ease-in-out_infinite]"; break;
    case "pull":   bodyAnim = "animate-[bdyPull_0.55s_ease-in-out_infinite]"; break;
    case "laugh":  bodyAnim = "animate-[bdyLaugh_0.45s_ease-in-out_infinite]"; break;
    case "sit":    bodyAnim = "animate-[bdyBreathe_3s_ease-in-out_infinite]"; extraTilt = ` translateY(${baseSize * 0.18}px) scaleY(0.78)`; break;
    case "idle":   bodyAnim = "animate-[bdyBreathe_3.4s_ease-in-out_infinite]"; break;
  }

  return (
    <>
      {/* She lives inside the scene: tiny absolute slot at the very bottom,
          pointer-events:none so taps pass through to the ships. Only her
          silhouette is clickable. z-index sits BELOW ships. */}
      <div
        aria-hidden
        className="fixed left-0 right-0 pointer-events-none"
        style={{ bottom: "5.5rem", height: baseSize * 1.6, zIndex: 5 }}
      >
        {/* contact shadow */}
        <div
          className="absolute"
          style={{
            left: `${pos}%`,
            bottom: 2,
            width: baseSize * 0.65,
            height: 8,
            transform: "translateX(-50%)",
            transition: `left ${duration}s cubic-bezier(0.45, 0, 0.55, 1)`,
            background: "radial-gradient(ellipse at center, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.15) 55%, transparent 80%)",
            filter: "blur(3px)",
          }}
        />

        {/* daughter wrapper — only her button captures pointer events */}
        <div
          className="absolute"
          style={{
            left: `${pos}%`,
            bottom: 0,
            transform: "translateX(-50%)",
            transition: `left ${duration}s cubic-bezier(0.45, 0, 0.55, 1)`,
            width: baseSize,
            height: baseSize * 1.45,
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(true); }}
            className="w-full h-full pointer-events-auto"
            style={{
              transformOrigin: "bottom center",
              transform: `scaleX(${facing})${extraTilt}`,
              transition: "transform 0.3s ease-out",
              background: "transparent",
              border: "none",
              padding: 0,
            }}
            aria-label="افتح ابنتك"
          >
            {/* Body container with breathing + walk bob */}
            <div className={`w-full h-full ${bodyAnim}`} style={{ transformOrigin: "bottom center" }}>
              <img
                src={img}
                alt={daughter.name}
                draggable={false}
                className="w-full h-full object-contain object-bottom"
                style={{
                  pointerEvents: "none",
                  filter: "drop-shadow(0 5px 6px rgba(0,0,0,0.45))",
                  transformOrigin: "bottom center",
                }}
              />
            </div>
          </button>
        </div>
      </div>

      <DaughterModal open={open} onOpenChange={setOpen} />

      <style>{`
        /* Walk: bob up/down + leg-like skew swing + slight head/torso tilt */
        @keyframes bdyWalk {
          0%   { transform: translateY(0)    skewX(-3deg) rotate(-2deg); }
          25%  { transform: translateY(-3px) skewX(0deg)  rotate(0deg); }
          50%  { transform: translateY(-1px) skewX(3deg)  rotate(2deg); }
          75%  { transform: translateY(-3px) skewX(0deg)  rotate(0deg); }
          100% { transform: translateY(0)    skewX(-3deg) rotate(-2deg); }
        }
        /* Look around: head/torso turns side to side */
        @keyframes bdyLook {
          0%,100% { transform: rotate(-4deg) translateX(-1px); }
          50%     { transform: rotate(4deg)  translateX(1px); }
        }
        /* Twirl: full spin */
        @keyframes bdyTwirl {
          0%   { transform: rotateY(0deg)   scale(1); }
          50%  { transform: rotateY(180deg) scale(1.05); }
          100% { transform: rotateY(360deg) scale(1); }
        }
        /* Wave: rotating around bottom — like swinging an arm */
        @keyframes bdyWave {
          0%,100% { transform: rotate(-3deg) translateY(0); }
          50%     { transform: rotate(5deg)  translateY(-2px); }
        }
        /* Pull: lean back and forth like hauling a rope */
        @keyframes bdyPull {
          0%,100% { transform: translateX(0)  rotate(-6deg) scaleY(1); }
          50%     { transform: translateX(5px) rotate(4deg) scaleY(0.97); }
        }
        /* Laugh: quick bouncy giggle */
        @keyframes bdyLaugh {
          0%,100% { transform: translateY(0)    rotate(-2deg) scale(1); }
          30%     { transform: translateY(-4px) rotate(2deg)  scale(1.04); }
          60%     { transform: translateY(-1px) rotate(-1deg) scale(1.02); }
        }
        /* Idle breathing */
        @keyframes bdyBreathe {
          0%,100% { transform: translateY(0)    scaleY(1); }
          50%     { transform: translateY(-1px) scaleY(1.015); }
        }
      `}</style>
    </>
  );
}
