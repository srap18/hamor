import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { getStage } from "@/lib/dragon";
import shoreDragonVideo from "@/assets/shore-dragon.mp4.asset.json";

/**
 * Shore dragon — the player's actual dragon form sitting on the beach.
 * Egg stages (1–2) show the still egg art.
 * Non-egg stages show a looping live-action style video of the dragon
 * (breathing, blinking, wings shifting, fire puff) blended onto the scene.
 * For higher evolution forms (11+) we layer the stage portrait on top so the
 * player still sees their upgraded form.
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
  const showAdvancedForm = stage >= 11;
  const stageImg = getStage(stage).image;

  return (
    <>
      <style>{`
        @keyframes dsc-rock { 0%,100%{transform:rotate(-4deg)} 50%{transform:rotate(4deg)} }
        @keyframes dsc-shadow { 0%,100%{transform:scaleX(1);opacity:.7} 50%{transform:scaleX(.92);opacity:.55} }
      `}</style>
      {/* SVG filter that keys out white/near-white pixels to transparent */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id="dsc-chroma-white" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      -1 -1 -1 0 2.85"
            />
          </filter>
        </defs>
      </svg>

      <button
        type="button"
        onClick={() => { setShowSoon(true); setTimeout(() => setShowSoon(false), 2200); }}
        aria-label={isEgg ? "بيضة التنين" : "تنيني"}
        className="absolute z-20 active:scale-95 transition-transform"
        style={{
          left: "14%",
          bottom: "9%",
          width: "32%",
          maxWidth: "220px",
          aspectRatio: "1 / 1",
          pointerEvents: "auto",
        }}
      >
        {/* Sand depression */}
        {!isEgg && (
          <span
            className="absolute pointer-events-none"
            style={{
              left: "8%", right: "8%", bottom: "1%", height: "13%",
              background:
                "radial-gradient(ellipse at center, rgba(40,25,15,0.55) 0%, rgba(40,25,15,0.25) 50%, transparent 80%)",
              filter: "blur(4px)",
            }}
          />
        )}
        {/* Long cast shadow */}
        <span
          className="absolute pointer-events-none"
          style={{
            left: "-15%", right: "15%", bottom: "-2%", height: "20%",
            background:
              "radial-gradient(ellipse at 70% 50%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.28) 45%, rgba(0,0,0,0) 82%)",
            filter: "blur(9px)",
            transform: "skewX(-20deg)",
          }}
        />
        {/* Contact ground shadow */}
        <span
          className="absolute pointer-events-none"
          style={{
            left: "16%", right: "16%", bottom: "3%", height: "6%",
            background:
              "radial-gradient(ellipse at center, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.62) 38%, rgba(0,0,0,0) 78%)",
            filter: "blur(1.5px)",
            animation: "dsc-shadow 3s ease-in-out infinite",
          }}
        />
        {/* Claw imprints */}
        {!isEgg && (
          <span
            className="absolute pointer-events-none"
            style={{
              left: "20%", right: "20%", bottom: "4%", height: "3%",
              background:
                "radial-gradient(circle at 15% 50%, rgba(50,30,15,0.65) 0%, transparent 38%), radial-gradient(circle at 38% 50%, rgba(50,30,15,0.65) 0%, transparent 38%), radial-gradient(circle at 62% 50%, rgba(50,30,15,0.65) 0%, transparent 38%), radial-gradient(circle at 85% 50%, rgba(50,30,15,0.65) 0%, transparent 38%)",
              filter: "blur(1px)",
            }}
          />
        )}

        <div
          className="relative w-full h-full"
          style={{
            animation: isEgg ? "dsc-rock 2.6s ease-in-out infinite" : undefined,
            transformOrigin: "50% 100%",
            WebkitMaskImage:
              "radial-gradient(ellipse 98% 98% at 50% 48%, #000 78%, rgba(0,0,0,0.8) 92%, transparent 100%)",
            maskImage:
              "radial-gradient(ellipse 98% 98% at 50% 48%, #000 78%, rgba(0,0,0,0.8) 92%, transparent 100%)",
          }}
        >
          {isEgg ? (
            <img
              src={stageImg}
              alt=""
              draggable={false}
              className="absolute inset-0 w-full h-full object-contain object-bottom"
              style={{
                filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.55))",
              }}
            />
          ) : showAdvancedForm ? (
            <img
              src={stageImg}
              alt=""
              draggable={false}
              className="absolute inset-0 w-full h-full object-contain object-bottom"
              style={{
                filter:
                  "drop-shadow(0 3px 3px rgba(0,0,0,0.7)) drop-shadow(0 12px 22px rgba(0,0,0,0.5)) saturate(0.92) brightness(0.92) contrast(1.05)",
              }}
            />
          ) : (
            <>
              {/* Live-action style dragon video — white BG keyed out via SVG chroma filter */}
              <video
                src={shoreDragonVideo.url}
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                className="absolute inset-0 w-full h-full object-contain object-bottom"
                style={{
                  filter:
                    "url(#dsc-chroma-white) drop-shadow(0 3px 3px rgba(0,0,0,0.6)) drop-shadow(0 10px 18px rgba(0,0,0,0.45)) saturate(0.95) brightness(0.95) contrast(1.06)",
                  WebkitFilter:
                    "url(#dsc-chroma-white) drop-shadow(0 3px 3px rgba(0,0,0,0.6)) drop-shadow(0 10px 18px rgba(0,0,0,0.45)) saturate(0.95) brightness(0.95) contrast(1.06)",
                }}
              />
              {/* Cool ambient overlay matching scene lighting */}
              <video
                src={shoreDragonVideo.url}
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                aria-hidden
                className="absolute inset-0 w-full h-full object-contain object-bottom pointer-events-none"
                style={{
                  mixBlendMode: "overlay",
                  opacity: 0.35,
                  filter: "url(#dsc-chroma-white) brightness(0.9) sepia(1) hue-rotate(200deg) saturate(2)",
                  WebkitFilter: "url(#dsc-chroma-white) brightness(0.9) sepia(1) hue-rotate(200deg) saturate(2)",
                }}
              />
            </>
          )}
        </div>

        {/* Atmospheric mist */}
        {!isEgg && (
          <span
            className="absolute pointer-events-none"
            style={{
              left: "0%", right: "0%", bottom: "5%", height: "32%",
              background:
                "linear-gradient(to top, rgba(120,140,200,0.30) 0%, rgba(120,140,200,0.15) 40%, transparent 100%)",
              filter: "blur(6px)",
              mixBlendMode: "screen",
            }}
          />
        )}
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
