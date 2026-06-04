import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getStage } from "@/lib/dragon";

/**
 * Shore dragon — grounded on the harbor stone, NOT floating.
 * - Hard contact shadow under the body
 * - Slight perspective tilt
 * - Stage 1-2 = egg in a nest, Stage 3+ = adult dragon breathing & moving
 */
export function DragonShoreCreature() {
  const [stage, setStage] = useState<number>(1);

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
  const stageImg = getStage(stage).image;

  return (
    <>
      <style>{`
        @keyframes dsc-rock { 0%,100%{transform:rotate(-5deg)} 50%{transform:rotate(5deg)} }
        @keyframes dsc-breath { 0%,100%{transform:scaleY(1) translateY(0)} 50%{transform:scaleY(1.04) translateY(-2px)} }
        @keyframes dsc-head { 0%,100%{transform:rotate(-6deg) translateX(-1px)} 50%{transform:rotate(5deg) translateX(2px)} }
        @keyframes dsc-shadow { 0%,100%{transform:scaleX(1) scaleY(1);opacity:.75} 50%{transform:scaleX(.92) scaleY(.85);opacity:.55} }
        @keyframes dsc-ember { 0%{opacity:0;transform:translateY(0) scale(.5)} 25%{opacity:1} 100%{opacity:0;transform:translateY(-50px) scale(.2)} }
        @keyframes dsc-fire { 0%{opacity:0;transform:translate(0,0) scale(.4)} 25%{opacity:1} 80%{opacity:.6;transform:translate(-40px,-6px) scale(1.6)} 100%{opacity:0;transform:translate(-65px,-10px) scale(2.1)} }
      `}</style>

      <Link
        to="/dragon"
        aria-label={isEgg ? "بيضة التنين" : "تنيني"}
        className="absolute z-20 active:scale-95 transition-transform"
        style={{
          left: "3%",
          bottom: "10%",
          width: "38%",
          maxWidth: "230px",
          aspectRatio: "1 / 1",
          pointerEvents: "auto",
          perspective: 600,
        }}
      >
        {/* Hard contact shadow on the ground — sells "standing on it" */}
        <span
          className="absolute"
          style={{
            left: "12%",
            right: "12%",
            bottom: "2%",
            height: "12%",
            background:
              "radial-gradient(ellipse at center, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0) 75%)",
            filter: "blur(3px)",
            animation: "dsc-shadow 3.2s ease-in-out infinite",
            transformOrigin: "50% 100%",
          }}
        />

        {/* Warm ground glow (heat under the dragon) */}
        <span
          className="absolute pointer-events-none"
          style={{
            left: "5%",
            right: "5%",
            bottom: "1%",
            height: "18%",
            background:
              "radial-gradient(ellipse at center bottom, rgba(255,150,40,0.55), rgba(220,60,20,0.2) 45%, transparent 75%)",
            filter: "blur(6px)",
            mixBlendMode: "screen",
          }}
        />

        {/* Nest of stones (only when egg) — visually rests it on the ground */}
        {isEgg && (
          <span
            className="absolute"
            style={{
              left: "18%",
              right: "18%",
              bottom: "6%",
              height: "16%",
              background:
                "radial-gradient(ellipse at 30% 30%, #6b5942 0%, #2d2418 70%), radial-gradient(ellipse at 70% 40%, #5a4a36 0%, #2d2418 70%)",
              borderRadius: "50% 50% 45% 55% / 60% 60% 40% 40%",
              boxShadow: "inset 0 -6px 12px rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.5)",
            }}
          />
        )}

        {/* Body */}
        <div
          className="absolute"
          style={{
            left: "8%",
            right: "8%",
            top: 0,
            bottom: isEgg ? "14%" : "8%",
            transformOrigin: "50% 100%",
            // slight tilt so it feels like a real object on the ground
            transform: "rotateX(6deg)",
            animation: isEgg
              ? "dsc-rock 2.4s ease-in-out infinite"
              : "dsc-breath 3.2s ease-in-out infinite",
          }}
        >
          <img
            src={isEgg ? dragonEggImg : dragonAdultImg}
            alt=""
            draggable={false}
            className="w-full h-full object-contain object-bottom"
            style={{
              animation: isEgg ? undefined : "dsc-head 4.8s ease-in-out infinite",
              transformOrigin: "55% 75%",
              filter:
                "drop-shadow(0 4px 4px rgba(0,0,0,0.85)) drop-shadow(0 0 12px rgba(255,120,40,0.45))",
            }}
          />

          {!isEgg && (
            <span
              className="absolute"
              style={{
                left: "2%",
                top: "32%",
                width: "32%",
                height: "14%",
                background:
                  "radial-gradient(ellipse at right center, rgba(255,235,120,1) 0%, rgba(255,130,40,0.95) 40%, rgba(180,30,10,0) 75%)",
                filter: "blur(2px)",
                animation: "dsc-fire 3.8s ease-out infinite",
                animationDelay: "1.2s",
                transformOrigin: "100% 50%",
              }}
            />
          )}

          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="absolute rounded-full"
              style={{
                left: `${28 + i * 7}%`,
                top: "32%",
                width: 4,
                height: 4,
                background: "rgba(255,180,70,0.95)",
                boxShadow: "0 0 8px rgba(255,140,30,0.95)",
                animation: `dsc-ember ${2.2 + i * 0.35}s ease-out infinite`,
                animationDelay: `${i * 0.55}s`,
              }}
            />
          ))}
        </div>
      </Link>
    </>
  );
}
