import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import dragonEggImg from "@/assets/dragon-egg.png";
import dragonAdultImg from "@/assets/dragon-adult.png";

/**
 * Single entry point to the dragon system, anchored on a stone pedestal
 * at the spot of the old harbor fountain (bottom-left of the scene).
 *
 * Stage 1-2  → egg (rocking, glowing)
 * Stage 3+   → adult dragon (breathing, head turn, fire puff)
 *
 * No floating icons elsewhere — tap THIS to open /dragon.
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
      if (!alive) return;
      if (data?.stage) setStage(data.stage);
    })();
    return () => { alive = false; };
  }, []);

  const isEgg = stage <= 2;
  const img = isEgg ? dragonEggImg : dragonAdultImg;

  return (
    <>
      {/* Global keyframes — guaranteed to apply */}
      <style>{`
        @keyframes dsc-egg-rock {
          0%, 100% { transform: rotate(-6deg) translateY(0); }
          50%      { transform: rotate(6deg) translateY(-3px); }
        }
        @keyframes dsc-breath {
          0%, 100% { transform: scale(1) translateY(0); }
          50%      { transform: scale(1.05) translateY(-3px); }
        }
        @keyframes dsc-head {
          0%, 100% { transform: rotate(-4deg); }
          50%      { transform: rotate(4deg); }
        }
        @keyframes dsc-aura {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50%      { opacity: 1;    transform: scale(1.18); }
        }
        @keyframes dsc-fire {
          0%   { opacity: 0; transform: translate(0,0) scale(0.4); }
          20%  { opacity: 1; }
          80%  { opacity: 0.7; transform: translate(-34px,-8px) scale(1.5); }
          100% { opacity: 0; transform: translate(-60px,-12px) scale(2); }
        }
        @keyframes dsc-ember {
          0%   { opacity: 0; transform: translateY(0) scale(0.6); }
          25%  { opacity: 1; }
          100% { opacity: 0; transform: translateY(-44px) scale(0.2); }
        }
        @keyframes dsc-pedestal-glow {
          0%, 100% { box-shadow: 0 0 12px rgba(255,140,40,0.5), inset 0 -4px 8px rgba(0,0,0,0.6); }
          50%      { box-shadow: 0 0 22px rgba(255,170,60,0.85), inset 0 -4px 8px rgba(0,0,0,0.6); }
        }
      `}</style>

      <Link
        to="/dragon"
        aria-label={isEgg ? "بيضة التنين" : "تنيني"}
        className="absolute z-20 active:scale-95 transition-transform"
        style={{
          left: "4%",
          bottom: "14%",
          width: "34%",
          maxWidth: "210px",
          aspectRatio: "1 / 1.15",
          pointerEvents: "auto",
        }}
      >
        {/* Stone pedestal — anchors the creature to the ground */}
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={{
            bottom: 0,
            width: "82%",
            height: "20%",
            background:
              "radial-gradient(ellipse at center top, #6b5942 0%, #3d3122 55%, #1c160e 100%)",
            borderRadius: "50% / 35%",
            border: "2px solid rgba(140,110,70,0.7)",
            animation: "dsc-pedestal-glow 3s ease-in-out infinite",
          }}
        >
          {/* stone cracks */}
          <span
            className="absolute inset-x-3 top-1"
            style={{
              height: 2,
              background: "linear-gradient(90deg, transparent, rgba(0,0,0,0.5), transparent)",
              borderRadius: 2,
            }}
          />
        </div>

        {/* Aura behind creature */}
        <span
          className="absolute rounded-full"
          style={{
            left: "10%",
            right: "10%",
            bottom: "8%",
            height: "32%",
            background:
              "radial-gradient(ellipse at center, rgba(255,170,60,0.7), rgba(220,60,20,0.3) 50%, transparent 75%)",
            filter: "blur(8px)",
            animation: "dsc-aura 2.6s ease-in-out infinite",
          }}
        />

        {/* Creature — egg or adult dragon */}
        <div
          className="absolute"
          style={{
            left: "10%",
            right: "10%",
            bottom: "18%",
            top: 0,
            transformOrigin: "50% 90%",
            animation: isEgg
              ? "dsc-egg-rock 2.2s ease-in-out infinite"
              : "dsc-breath 3.2s ease-in-out infinite",
          }}
        >
          <img
            src={img}
            alt=""
            draggable={false}
            className="w-full h-full object-contain"
            style={{
              animation: isEgg ? undefined : "dsc-head 4.4s ease-in-out infinite",
              transformOrigin: "55% 65%",
              filter:
                "drop-shadow(0 8px 12px rgba(0,0,0,0.7)) drop-shadow(0 0 16px rgba(255,120,40,0.6))",
            }}
          />

          {/* Fire breath — only when hatched */}
          {!isEgg && (
            <span
              className="absolute"
              style={{
                left: "4%",
                top: "28%",
                width: "34%",
                height: "16%",
                background:
                  "radial-gradient(ellipse at right center, rgba(255,235,120,1) 0%, rgba(255,130,40,0.95) 40%, rgba(180,30,10,0) 75%)",
                filter: "blur(2px)",
                animation: "dsc-fire 3.8s ease-out infinite",
                animationDelay: "1s",
                transformOrigin: "100% 50%",
              }}
            />
          )}

          {/* Embers always rising */}
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="absolute rounded-full"
              style={{
                left: `${22 + i * 8}%`,
                top: "28%",
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
