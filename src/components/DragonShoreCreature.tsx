import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { getStage } from "@/lib/dragon";
import { useDragonUnlocked } from "@/lib/dragon-access";
import nestImg from "@/assets/dragon-nest-only.png";
import hatchVideo from "@/assets/dragon-hatch.mp4.asset.json";

type Props = {
  /** If provided, show this user's dragon (read-only). Otherwise shows the current user's. */
  userId?: string;
  /** When false, disables the "coming soon" popup (e.g. visiting another player). */
  interactive?: boolean;
};

const HATCH_KEY = (uid: string) => `dragon-hatched-v1:${uid}`;

export function DragonShoreCreature({ userId, interactive = true }: Props = {}) {
  const [stage, setStage] = useState<number>(1);
  const [uid, setUid] = useState<string | null>(null);
  const [hatched, setHatched] = useState<boolean>(false);
  const [playingHatch, setPlayingHatch] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      let u = userId;
      if (!u) {
        const { data: au } = await supabase.auth.getUser();
        u = au.user?.id;
      }
      if (!u) return;
      if (alive) setUid(u);
      if (alive) {
        try {
          setHatched(localStorage.getItem(HATCH_KEY(u)) === "1");
        } catch {}
      }
      const { data } = await supabase.from("dragons").select("stage").eq("user_id", u).maybeSingle();
      if (alive && data?.stage) setStage(data.stage);
    };
    load();
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", load);
    };
  }, [userId]);

  // Hatch readiness: stage >= 3 means the dragon has earned enough DP to break the shell.
  const canHatch = stage >= 3 && !hatched;
  const showEgg = stage < 3 || !hatched;

  const creatureImg = getStage(showEgg ? 1 : stage).image;
  const stageMode = showEgg ? "egg" : "adult";

  const navigate = useNavigate();
  const unlocked = useDragonUnlocked();

  const handleTap = () => {
    if (!interactive) return;
    if (canHatch) {
      setPlayingHatch(true);
      requestAnimationFrame(() => {
        videoRef.current?.play().catch(() => {});
      });
      return;
    }
    if (unlocked) {
      navigate({ to: "/dragon" });
    }
  };

  const finishHatch = () => {
    setPlayingHatch(false);
    if (uid) {
      try { localStorage.setItem(HATCH_KEY(uid), "1"); } catch {}
      setHatched(true);
    }
  };

  return (
    <>
      {/* SVG filter — turns near-white pixels in the video into transparent alpha
          while keeping the dragon's colors fully opaque. */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id="dsc-key-white" colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      -1.6 -1.6 -1.6 0 3.7"
            />
          </filter>
        </defs>
      </svg>
      <style>{`
        @keyframes dsc-rock { 0%,100%{transform:rotate(-3deg)} 50%{transform:rotate(3deg)} }
        @keyframes dsc-breathe { 0%,100%{transform:translateY(0) scale(1)} 50%{transform:translateY(-1.6%) scale(1.018)} }
        @keyframes dsc-shadow { 0%,100%{transform:scaleX(1);opacity:.76} 50%{transform:scaleX(.94);opacity:.6} }
        @keyframes dsc-hatch-pulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 0 rgba(251,191,36,0.7), 0 0 24px rgba(251,146,60,0.6); }
          50%      { transform: translate(-50%, -50%) scale(1.08); box-shadow: 0 0 0 14px rgba(251,191,36,0), 0 0 36px rgba(251,146,60,0.9); }
        }
      `}</style>
      <div
        className="absolute z-20"
        style={{
          left: "6%",
          bottom: "6%",
          width: "54%",
          maxWidth: "360px",
          aspectRatio: "1 / 1",
          pointerEvents: "none",
        }}
      >
        <span
          className="absolute pointer-events-none"
          style={{
            left: "-6%",
            right: "6%",
            bottom: "-2%",
            height: "14%",
            background:
              "radial-gradient(ellipse at 55% 50%, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.32) 48%, rgba(0,0,0,0) 84%)",
            filter: "blur(10px)",
            transform: "skewX(-14deg)",
          }}
        />

        <img
          src={nestImg}
          alt=""
          draggable={false}
          className="absolute pointer-events-none"
          style={{
            left: "0%",
            right: "0%",
            bottom: "0%",
            width: "100%",
            height: "78%",
            objectFit: "contain",
            objectPosition: "bottom center",
            filter: "drop-shadow(0 10px 16px rgba(0,0,0,0.6))",
            zIndex: 1,
          }}
        />

        <button
          type="button"
          onClick={handleTap}
          aria-label={canHatch ? "اضغط لفقس التنين" : stageMode === "egg" ? "بيضة التنين" : "تنيني"}
          className="absolute bg-transparent border-0 p-0 active:scale-95 transition-transform"
          style={{
            left: "50%",
            bottom: "18%",
            width: "38%",
            height: "38%",
            transform: "translateX(-50%)",
            zIndex: 2,
            pointerEvents: "auto",
          }}
        >
          <div
            className="relative h-full w-full"
            style={{
              animation:
                stageMode === "egg"
                  ? "dsc-rock 2.8s ease-in-out infinite"
                  : stageMode === "adult"
                    ? "dsc-breathe 4s ease-in-out infinite"
                    : undefined,
              transformOrigin: "50% 95%",
            }}
          >
            {stageMode === "adult" ? (
              <div
                className="absolute inset-0 h-full w-full"
                style={{
                  mixBlendMode: "multiply",
                  filter:
                    "drop-shadow(0 6px 10px rgba(0,0,0,0.58)) drop-shadow(0 18px 28px rgba(0,0,0,0.36)) saturate(1.05) contrast(1.05)",
                }}
              >
                <video
                  src={hatchVideo.url}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="absolute inset-0 h-full w-full"
                  style={{
                    objectFit: "contain",
                    objectPosition: "bottom center",
                    mixBlendMode: "multiply",
                  }}
                />
              </div>
            ) : (
              <img
                src={creatureImg}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full object-contain object-bottom"
                style={{
                  filter: "drop-shadow(0 5px 10px rgba(0,0,0,0.58))",
                }}
              />
            )}

            {canHatch && (
              <span
                aria-hidden
                className="absolute pointer-events-none"
                style={{
                  left: "50%",
                  top: "50%",
                  width: "56%",
                  height: "56%",
                  borderRadius: "9999px",
                  background:
                    "radial-gradient(circle, rgba(251,191,36,0.55) 0%, rgba(251,146,60,0.25) 55%, rgba(251,146,60,0) 75%)",
                  animation: "dsc-hatch-pulse 1.6s ease-in-out infinite",
                }}
              />
            )}
          </div>
        </button>

        {canHatch && (
          <div
            className="absolute pointer-events-none text-center"
            style={{
              left: "50%",
              bottom: "60%",
              transform: "translateX(-50%)",
              zIndex: 3,
            }}
          >
            <div
              className="rounded-full bg-gradient-to-r from-amber-500 to-orange-600 px-3 py-1 text-xs font-black text-white shadow-lg"
              style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
            >
              اضغط للفقس!
            </div>
          </div>
        )}
      </div>

      {playingHatch && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          onClick={finishHatch}
          dir="rtl"
          style={{ pointerEvents: "auto" }}
        >
          {/* White backdrop so multiply blend keys out the video's white bg */}
          <div className="absolute inset-0 bg-white" />
          <video
            ref={videoRef}
            src={hatchVideo.url}
            autoPlay
            playsInline
            muted
            onEnded={finishHatch}
            className="relative max-h-full max-w-full"
            style={{ mixBlendMode: "multiply" }}
          />
          <button
            type="button"
            onClick={finishHatch}
            className="absolute top-4 right-4 z-10 rounded-full bg-black/60 px-4 py-2 text-sm font-bold text-white"
          >
            تخطي
          </button>
        </div>
      )}
    </>
  );
}
