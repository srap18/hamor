import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { getStage } from "@/lib/dragon";
import shoreDragonImg from "@/assets/shore-dragon.png";

/**
 * Shore dragon — small classic chibi dragon sitting on the beach.
 * Egg stages show the egg art; stage 3+ shows the shore dragon art.
 */
export function DragonShoreCreature() {
  const [stage, setStage] = useState<number>(1);
  const [showSoon, setShowSoon] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return;
      const { data } = await supabase
        .from("dragons")
        .select("stage")
        .eq("user_id", uid)
        .maybeSingle();
      if (alive && data?.stage) setStage(data.stage);
    })();
    return () => { alive = false; };
  }, []);

  const isEgg = stage <= 2;
  const img = isEgg ? getStage(stage).image : shoreDragonImg;

  return (
    <>
      <style>{`
        @keyframes dsc-rock { 0%,100%{transform:rotate(-4deg)} 50%{transform:rotate(4deg)} }
        @keyframes dsc-breathe { 0%,100%{transform:translateY(0) scale(1)} 50%{transform:translateY(-2px) scale(1.02)} }
        @keyframes dsc-shadow { 0%,100%{transform:scaleX(1);opacity:.7} 50%{transform:scaleX(.92);opacity:.55} }
      `}</style>

      <button
        type="button"
        onClick={() => { setShowSoon(true); setTimeout(() => setShowSoon(false), 2200); }}
        aria-label={isEgg ? "بيضة التنين" : "تنيني"}
        className="absolute z-20 active:scale-95 transition-transform"
        style={{
          left: "20%",
          bottom: "13%",
          width: "20%",
          maxWidth: "140px",
          aspectRatio: "1 / 1",
          pointerEvents: "auto",
        }}
      >
        {/* Long cast shadow stretching across sand — matches scene light */}
        <span
          className="absolute pointer-events-none"
          style={{
            left: "-10%",
            right: "20%",
            bottom: "-2%",
            height: "18%",
            background:
              "radial-gradient(ellipse at 70% 50%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 45%, rgba(0,0,0,0) 80%)",
            filter: "blur(8px)",
            transform: "skewX(-18deg)",
          }}
        />
        {/* Soft ambient shadow — wider, lighter for grounding */}
        <span
          className="absolute pointer-events-none"
          style={{
            left: "6%",
            right: "6%",
            bottom: "0%",
            height: "12%",
            background:
              "radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 72%)",
            filter: "blur(5px)",
          }}
        />
        {/* Contact ground shadow — tight, dark ellipse directly under feet */}
        <span
          className="absolute pointer-events-none"
          style={{
            left: "18%",
            right: "18%",
            bottom: "3%",
            height: "6%",
            background:
              "radial-gradient(ellipse at center, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.6) 38%, rgba(0,0,0,0) 78%)",
            filter: "blur(1.5px)",
            animation: "dsc-shadow 3s ease-in-out infinite",
          }}
        />
        {/* Claw imprints in sand */}
        {!isEgg && (
          <span
            className="absolute pointer-events-none"
            style={{
              left: "22%",
              right: "22%",
              bottom: "4%",
              height: "3%",
              background:
                "radial-gradient(circle at 20% 50%, rgba(60,40,20,0.55) 0%, transparent 40%), radial-gradient(circle at 50% 50%, rgba(60,40,20,0.55) 0%, transparent 40%), radial-gradient(circle at 80% 50%, rgba(60,40,20,0.55) 0%, transparent 40%)",
              filter: "blur(1px)",
            }}
          />
        )}

        <div
          className="relative w-full h-full"
          style={{
            animation: isEgg ? "dsc-rock 2.6s ease-in-out infinite" : "dsc-breathe 2.8s ease-in-out infinite",
            transformOrigin: "50% 100%",
            WebkitMaskImage:
              "radial-gradient(ellipse 96% 96% at 50% 48%, #000 76%, rgba(0,0,0,0.85) 90%, transparent 100%)",
            maskImage:
              "radial-gradient(ellipse 96% 96% at 50% 48%, #000 76%, rgba(0,0,0,0.85) 90%, transparent 100%)",
          }}
        >
          {/* Base dragon — color-graded to match scene */}
          <img
            src={img}
            alt=""
            draggable={false}
            className="absolute inset-0 w-full h-full object-contain object-bottom"
            style={{
              filter:
                "drop-shadow(0 2px 2px rgba(0,0,0,0.6)) drop-shadow(0 8px 14px rgba(0,0,0,0.4)) saturate(0.82) brightness(0.88) contrast(1.05)",
            }}
          />
          {/* Cool ambient/sea reflection overlay on shadow side */}
          <img
            src={img}
            alt=""
            draggable={false}
            aria-hidden
            className="absolute inset-0 w-full h-full object-contain object-bottom pointer-events-none"
            style={{
              mixBlendMode: "overlay",
              opacity: 0.32,
              filter: "brightness(0.9) sepia(1) hue-rotate(170deg) saturate(1.8)",
            }}
          />
          {/* Warm rim light from scene */}
          <img
            src={img}
            alt=""
            draggable={false}
            aria-hidden
            className="absolute inset-0 w-full h-full object-contain object-bottom pointer-events-none"
            style={{
              mixBlendMode: "soft-light",
              opacity: 0.5,
              filter: "brightness(1.15) sepia(0.6) hue-rotate(-20deg) saturate(1.3)",
            }}
          />
        </div>
      </button>
      {showSoon && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowSoon(false)}
          dir="rtl"
        >
          <div className="bg-gradient-to-br from-amber-900/95 to-rose-950/95 border-4 border-amber-400/80 rounded-3xl px-10 py-8 text-center shadow-2xl">
            <div
              className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-b from-amber-200 via-amber-400 to-orange-600"
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
