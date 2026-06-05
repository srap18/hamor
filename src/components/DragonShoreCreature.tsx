import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { getStage } from "@/lib/dragon";

/**
 * Shore dragon — the player's actual dragon form sitting on the beach.
 * Egg stages (1–2) show the egg art; stage 3+ shows the evolving dragon
 * form (one of 15 art tiers from src/lib/dragon.ts).
 * Breathes fire on a regular 7-second cycle.
 */
export function DragonShoreCreature() {
  const [stage, setStage] = useState<number>(1);
  const [showSoon, setShowSoon] = useState(false);
  const [breathing, setBreathing] = useState(false);

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

  // Regular 7s fire-breath cycle — only when out of the egg
  useEffect(() => {
    if (stage <= 2) return;
    const tick = () => {
      setBreathing(true);
      setTimeout(() => setBreathing(false), 1400);
    };
    const id = setInterval(tick, 7000);
    const kickoff = setTimeout(tick, 1200); // first breath shortly after mount
    return () => { clearInterval(id); clearTimeout(kickoff); };
  }, [stage]);

  const isEgg = stage <= 2;
  const img = getStage(stage).image;

  return (
    <>
      <style>{`
        @keyframes dsc-rock { 0%,100%{transform:rotate(-4deg)} 50%{transform:rotate(4deg)} }
        @keyframes dsc-breathe { 0%,100%{transform:translateY(0) scale(1)} 50%{transform:translateY(-2px) scale(1.02)} }
        @keyframes dsc-shadow { 0%,100%{transform:scaleX(1);opacity:.7} 50%{transform:scaleX(.92);opacity:.55} }
        @keyframes dsc-head-rear { 0%{transform:translateY(0) rotate(0)} 40%{transform:translateY(-4px) rotate(-3deg)} 70%{transform:translateY(-1px) rotate(2deg)} 100%{transform:translateY(0) rotate(0)} }
        @keyframes dsc-flame {
          0%   { opacity: 0; transform: translateX(0) scaleX(0.2) scaleY(0.6); filter: blur(2px); }
          15%  { opacity: 1; transform: translateX(8%) scaleX(0.6) scaleY(0.9); filter: blur(1px); }
          50%  { opacity: 1; transform: translateX(38%) scaleX(1.4) scaleY(1.15); filter: blur(0.5px); }
          80%  { opacity: 0.85; transform: translateX(55%) scaleX(1.6) scaleY(1.0); filter: blur(1.5px); }
          100% { opacity: 0; transform: translateX(70%) scaleX(1.8) scaleY(0.8); filter: blur(4px); }
        }
        @keyframes dsc-smoke {
          0%   { opacity: 0; transform: translateX(40%) translateY(0) scale(0.6); }
          40%  { opacity: 0.55; transform: translateX(60%) translateY(-10%) scale(1); }
          100% { opacity: 0; transform: translateX(85%) translateY(-30%) scale(1.5); }
        }
        @keyframes dsc-flame-glow {
          0%, 100% { box-shadow: none; }
          15%, 80% { box-shadow: 0 0 60px 20px rgba(255,140,40,0.55); }
        }
      `}</style>

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
              left: "8%",
              right: "8%",
              bottom: "1%",
              height: "13%",
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
            left: "-15%",
            right: "15%",
            bottom: "-2%",
            height: "20%",
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
            left: "16%",
            right: "16%",
            bottom: "3%",
            height: "6%",
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
              left: "20%",
              right: "20%",
              bottom: "4%",
              height: "3%",
              background:
                "radial-gradient(circle at 15% 50%, rgba(50,30,15,0.65) 0%, transparent 38%), radial-gradient(circle at 38% 50%, rgba(50,30,15,0.65) 0%, transparent 38%), radial-gradient(circle at 62% 50%, rgba(50,30,15,0.65) 0%, transparent 38%), radial-gradient(circle at 85% 50%, rgba(50,30,15,0.65) 0%, transparent 38%)",
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
              "radial-gradient(ellipse 98% 98% at 50% 48%, #000 78%, rgba(0,0,0,0.8) 92%, transparent 100%)",
            maskImage:
              "radial-gradient(ellipse 98% 98% at 50% 48%, #000 78%, rgba(0,0,0,0.8) 92%, transparent 100%)",
          }}
        >
          {/* Base dragon */}
          <img
            src={img}
            alt=""
            draggable={false}
            className="absolute inset-0 w-full h-full object-contain object-bottom"
            style={{
              filter:
                "drop-shadow(0 3px 3px rgba(0,0,0,0.65)) drop-shadow(0 10px 18px rgba(0,0,0,0.45)) saturate(0.78) brightness(0.86) contrast(1.05)",
              animation: breathing ? "dsc-head-rear 1.4s ease-out" : undefined,
              transformOrigin: "50% 70%",
            }}
          />
          {/* Cool ambient overlay */}
          <img
            src={img}
            alt=""
            draggable={false}
            aria-hidden
            className="absolute inset-0 w-full h-full object-contain object-bottom pointer-events-none"
            style={{
              mixBlendMode: "overlay",
              opacity: 0.45,
              filter: "brightness(0.9) sepia(1) hue-rotate(200deg) saturate(2)",
            }}
          />
          {/* Warm rim light */}
          <img
            src={img}
            alt=""
            draggable={false}
            aria-hidden
            className="absolute inset-0 w-full h-full object-contain object-bottom pointer-events-none"
            style={{
              mixBlendMode: "soft-light",
              opacity: 0.45,
              filter: "brightness(1.15) sepia(0.7) hue-rotate(-15deg) saturate(1.3)",
            }}
          />
          {/* Fire-breath warm bath on body when breathing */}
          {breathing && !isEgg && (
            <img
              src={img}
              alt=""
              draggable={false}
              aria-hidden
              className="absolute inset-0 w-full h-full object-contain object-bottom pointer-events-none"
              style={{
                mixBlendMode: "screen",
                opacity: 0.55,
                filter: "brightness(1.3) sepia(0.9) hue-rotate(-25deg) saturate(2)",
              }}
            />
          )}
        </div>

        {/* Atmospheric mist */}
        <span
          className="absolute pointer-events-none"
          style={{
            left: "0%",
            right: "0%",
            bottom: "5%",
            height: "32%",
            background:
              "linear-gradient(to top, rgba(120,140,200,0.35) 0%, rgba(120,140,200,0.18) 40%, transparent 100%)",
            filter: "blur(6px)",
            mixBlendMode: "screen",
          }}
        />

        {/* Fire-breath plume — emitted forward from the dragon's mouth */}
        {!isEgg && breathing && (
          <>
            <span
              key={`flame-${Date.now()}`}
              className="absolute pointer-events-none"
              style={{
                left: "55%",
                top: "20%",
                width: "60%",
                height: "22%",
                transformOrigin: "0% 50%",
                background:
                  "radial-gradient(ellipse at 10% 50%, rgba(255,255,220,1) 0%, rgba(255,200,60,0.95) 18%, rgba(255,120,30,0.85) 42%, rgba(220,40,20,0.55) 72%, rgba(120,10,0,0) 100%)",
                borderRadius: "60% 50% 50% 60% / 60% 50% 50% 60%",
                animation: "dsc-flame 1.4s ease-out forwards",
                mixBlendMode: "screen",
                filter: "drop-shadow(0 0 14px rgba(255,140,40,0.9))",
              }}
            />
            <span
              key={`smoke-${Date.now()}`}
              className="absolute pointer-events-none"
              style={{
                left: "60%",
                top: "16%",
                width: "45%",
                height: "26%",
                background:
                  "radial-gradient(ellipse at 30% 60%, rgba(180,170,160,0.55) 0%, rgba(140,130,120,0.25) 50%, transparent 100%)",
                borderRadius: "50%",
                animation: "dsc-smoke 1.6s ease-out forwards 0.5s",
                mixBlendMode: "screen",
                filter: "blur(4px)",
              }}
            />
            <span
              className="absolute pointer-events-none rounded-full"
              style={{
                left: "60%",
                top: "26%",
                width: "10%",
                height: "10%",
                animation: "dsc-flame-glow 1.4s ease-out",
              }}
            />
          </>
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
