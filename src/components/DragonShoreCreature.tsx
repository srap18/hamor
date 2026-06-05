import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { getStage } from "@/lib/dragon";
import nestImg from "@/assets/dragon-nest-only.png";

type Props = {
  /** If provided, show this user's dragon (read-only). Otherwise shows the current user's. */
  userId?: string;
  /** When false, disables the "coming soon" popup (e.g. visiting another player). */
  interactive?: boolean;
};

export function DragonShoreCreature({ userId, interactive = true }: Props = {}) {
  const [stage, setStage] = useState<number>(1);
  const [showSoon, setShowSoon] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      let uid = userId;
      if (!uid) {
        const { data: u } = await supabase.auth.getUser();
        uid = u.user?.id;
      }
      if (!uid) return;
      const { data } = await supabase.from("dragons").select("stage").eq("user_id", uid).maybeSingle();
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


  const stageMode = stage <= 1 ? "egg" : stage <= 2 ? "hatching" : "adult";
  const creatureImg = getStage(stage).image;


  return (
    <>
      <style>{`
        @keyframes dsc-rock { 0%,100%{transform:rotate(-3deg)} 50%{transform:rotate(3deg)} }
        @keyframes dsc-breathe { 0%,100%{transform:translateY(0) scale(1)} 50%{transform:translateY(-1.6%) scale(1.018)} }
        @keyframes dsc-shadow { 0%,100%{transform:scaleX(1);opacity:.76} 50%{transform:scaleX(.94);opacity:.6} }
      `}</style>
      <button
        type="button"
        onClick={() => {
          if (!interactive) return;
          setShowSoon(true);
          setTimeout(() => setShowSoon(false), 2200);
        }}

        aria-label={stageMode === "egg" ? "بيضة التنين" : "تنيني"}
        className="absolute z-20 active:scale-95 transition-transform"
        style={{
          left: "6%",
          bottom: "6%",
          width: "54%",
          maxWidth: "360px",
          aspectRatio: "1 / 1",
          pointerEvents: "auto",
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

        {/* Static nest sitting on the shore (larger, full width) */}
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

        {/* Dragon / egg sits inside the nest opening.
            Outer wrapper centers; inner wrapper animates (so the keyframe
            transform doesn't overwrite translateX(-50%)). */}
        <div
          className="absolute"
          style={{
            left: "50%",
            bottom: "34%",
            width: "44%",
            height: "44%",
            transform: "translateX(-50%)",
            zIndex: 2,
          }}
        >
          <div
            className="relative h-full w-full"
            style={{
              animation: stageMode === "egg" ? "dsc-rock 2.8s ease-in-out infinite" : stageMode === "adult" ? "dsc-breathe 4s ease-in-out infinite" : undefined,
              transformOrigin: "50% 95%",
            }}
          >
            <img
              src={creatureImg}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full object-contain object-bottom"
              style={{
                filter:
                  stageMode === "adult"
                    ? "drop-shadow(0 6px 10px rgba(0,0,0,0.58)) drop-shadow(0 18px 28px rgba(0,0,0,0.36)) saturate(1.03)"
                    : "drop-shadow(0 5px 10px rgba(0,0,0,0.58))",
              }}
            />
          </div>
        </div>
      </button>




      {showSoon && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
          onClick={() => setShowSoon(false)}
          dir="rtl"
        >
          <div className="rounded-3xl border-4 border-amber-400/80 bg-gradient-to-br from-amber-900/95 to-rose-950/95 px-10 py-8 text-center shadow-2xl">
            <div
              className="bg-gradient-to-b from-amber-200 via-amber-400 to-orange-600 bg-clip-text text-6xl font-black text-transparent"
              style={{ textShadow: "0 0 30px rgba(251,146,60,0.8)" }}
            >
              قريبًا!!
            </div>
          </div>
        </div>
      )}
    </>
  );
}

