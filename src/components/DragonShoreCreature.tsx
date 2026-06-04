import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { getStage } from "@/lib/dragon";

/**
 * Shore dragon — LIVE creature feel.
 * Multi-layer CSS animation: body breathing, wing flap (shadow + scale),
 * head bob, blinking glowing eyes, periodic BIG fire breath, smoke puffs,
 * ground heat shimmer, ember particles. No video — works for all 10 stages.
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
  // Intensity tier — stage 3 = mild, stage 10 = god-tier
  const tier = Math.max(0, stage - 2); // 0..8
  const k = tier / 8; // 0..1
  const fireInterval = 7 - k * 5; // 7s -> 2s
  const wingSpeed = 1.1 - k * 0.55; // 1.1s -> 0.55s
  const breathSpeed = 2.6 - k * 1.2; // 2.6s -> 1.4s
  const fireScale = 1 + k * 1.3; // 1 -> 2.3
  const emberCount = 5 + tier * 2; // 5 -> 21
  const smokeCount = 3 + Math.floor(tier / 2); // 3 -> 7
  const shakeStrength = 2 + tier; // 2 -> 10 px
  const glowAlpha = 0.45 + k * 0.5;
  // Aura color shifts from orange -> white-hot -> arcane blue at top stages
  const auraInner = stage >= 9 ? "rgba(180,220,255,1)" : stage >= 7 ? "rgba(255,255,220,1)" : "rgba(255,255,200,1)";
  const auraMid = stage >= 9 ? "rgba(120,170,255,0.9)" : stage >= 7 ? "rgba(255,220,80,1)" : "rgba(255,200,60,1)";
  const auraOuter = stage >= 9 ? "rgba(60,80,200,0.9)" : stage >= 7 ? "rgba(255,140,40,0.9)" : "rgba(255,90,20,0.9)";

  return (
    <>
      <style>{`
        @keyframes dsc-rock { 0%,100%{transform:rotate(-5deg)} 50%{transform:rotate(5deg)} }
        @keyframes dsc-breath {
          0%,100%{transform:rotateX(6deg) scaleY(1) translateY(0)}
          40%{transform:rotateX(6deg) scaleY(1.05) translateY(-3px)}
          60%{transform:rotateX(6deg) scaleY(1.05) translateY(-3px)}
        }
        @keyframes dsc-head {
          0%,100%{transform:rotate(-7deg) translateX(-2px)}
          30%{transform:rotate(4deg) translateX(2px)}
          55%{transform:rotate(-3deg) translateX(0)}
          80%{transform:rotate(6deg) translateX(3px)}
        }
        @keyframes dsc-wing-flap {
          0%,100%{transform:scaleX(1) scaleY(1);opacity:.35}
          50%{transform:scaleX(1.18) scaleY(.9);opacity:.55}
        }
        @keyframes dsc-shadow {
          0%,100%{transform:scaleX(1) scaleY(1);opacity:.78}
          50%{transform:scaleX(.88) scaleY(.82);opacity:.5}
        }
        @keyframes dsc-ember {
          0%{opacity:0;transform:translateY(0) translateX(0) scale(.5)}
          20%{opacity:1}
          100%{opacity:0;transform:translateY(-70px) translateX(-30px) scale(.15)}
        }
        @keyframes dsc-smoke {
          0%{opacity:0;transform:translate(0,0) scale(.4)}
          20%{opacity:.7}
          100%{opacity:0;transform:translate(-55px,-50px) scale(2.6)}
        }
        @keyframes dsc-fire-burst {
          0%,70%{opacity:0;transform:translate(0,0) scaleX(.2) scaleY(.4)}
          74%{opacity:1;transform:translate(-15px,-2px) scaleX(.9) scaleY(1)}
          82%{opacity:1;transform:translate(-55px,-8px) scaleX(2.2) scaleY(1.4)}
          92%{opacity:.7;transform:translate(-90px,-12px) scaleX(3) scaleY(1.6)}
          100%{opacity:0;transform:translate(-115px,-16px) scaleX(3.4) scaleY(1.7)}
        }
        @keyframes dsc-fire-core {
          0%,70%{opacity:0}
          75%,90%{opacity:1}
          100%{opacity:0}
        }
        @keyframes dsc-eye-blink {
          0%,46%,54%,100%{opacity:1;transform:scaleY(1)}
          48%,52%{opacity:.3;transform:scaleY(.1)}
        }
        @keyframes dsc-eye-glow {
          0%,100%{box-shadow:0 0 6px 2px rgba(255,180,40,.9),0 0 14px 4px rgba(255,90,20,.6)}
          50%{box-shadow:0 0 10px 3px rgba(255,220,80,1),0 0 22px 7px rgba(255,120,30,.85)}
        }
        @keyframes dsc-heat-shimmer {
          0%,100%{transform:translateY(0) scaleY(1);opacity:.45}
          50%{transform:translateY(-2px) scaleY(1.1);opacity:.7}
        }
        @keyframes dsc-roar-shake {
          0%,72%,100%{transform:rotateX(6deg) translateX(0)}
          76%{transform:rotateX(6deg) translateX(calc(var(--shake, 3px) * -1))}
          80%{transform:rotateX(6deg) translateX(var(--shake, 3px))}
          84%{transform:rotateX(6deg) translateX(calc(var(--shake, 3px) * -0.7))}
          88%{transform:rotateX(6deg) translateX(calc(var(--shake, 3px) * 0.7))}
        }
        @keyframes dsc-aura-pulse {
          0%,100%{opacity:.35;transform:scale(.9)}
          50%{opacity:.85;transform:scale(1.1)}
        }
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
          ["--shake" as any]: `${shakeStrength}px`,
        }}
      >
        {/* Hard contact shadow on the ground */}
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

        {/* Heat shimmer band on the ground */}
        {!isEgg && (
          <span
            className="absolute pointer-events-none"
            style={{
              left: "10%",
              right: "10%",
              bottom: "5%",
              height: "10%",
              background:
                "radial-gradient(ellipse at center, rgba(255,170,60,0.5), rgba(255,80,20,0.15) 55%, transparent 80%)",
              filter: "blur(5px)",
              mixBlendMode: "screen",
              animation: "dsc-heat-shimmer 1.8s ease-in-out infinite",
            }}
          />
        )}

        {/* Warm ground glow */}
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

        {/* Nest of stones (only when egg) */}
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

        {/* Aura ring — grows & glows for high tiers */}
        {!isEgg && tier >= 2 && (
          <span
            className="absolute pointer-events-none rounded-full"
            style={{
              left: "50%",
              top: "55%",
              width: `${60 + tier * 8}%`,
              height: `${60 + tier * 8}%`,
              transform: "translate(-50%, -50%)",
              background: `radial-gradient(circle, ${auraInner.replace("1)", `${0.15 + k * 0.25})`)} 0%, ${auraMid.replace(/[\d.]+\)$/, `${0.1 + k * 0.2})`)} 40%, transparent 75%)`,
              filter: `blur(${4 + tier}px)`,
              mixBlendMode: "screen",
              animation: `dsc-aura-pulse ${2.8 - k * 1}s ease-in-out infinite`,
            }}
          />
        )}

        {/* Wing flap silhouette behind body (fake wings via blurred ellipses) */}
        {!isEgg && (
          <>
            <span
              className="absolute pointer-events-none"
              style={{
                left: "-8%",
                top: "18%",
                width: `${55 + tier * 2}%`,
                height: `${45 + tier * 2}%`,
                background:
                  "radial-gradient(ellipse at 80% 60%, rgba(80,30,15,0.9) 0%, rgba(40,10,5,0.55) 55%, rgba(0,0,0,0) 80%)",
                filter: `blur(${4 + k * 2}px)`,
                transformOrigin: "85% 70%",
                animation: `dsc-wing-flap ${wingSpeed}s ease-in-out infinite`,
              }}
            />
            <span
              className="absolute pointer-events-none"
              style={{
                right: "-6%",
                top: "20%",
                width: `${50 + tier * 2}%`,
                height: `${42 + tier * 2}%`,
                background:
                  "radial-gradient(ellipse at 20% 60%, rgba(80,30,15,0.85) 0%, rgba(40,10,5,0.5) 55%, rgba(0,0,0,0) 80%)",
                filter: `blur(${4 + k * 2}px)`,
                transformOrigin: "15% 70%",
                animation: `dsc-wing-flap ${wingSpeed}s ease-in-out infinite`,
                animationDelay: "-0.05s",
              }}
            />
          </>
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
            transform: "rotateX(6deg)",
            animation: isEgg
              ? "dsc-rock 2.4s ease-in-out infinite"
              : `dsc-breath ${breathSpeed}s ease-in-out infinite, dsc-roar-shake ${fireInterval}s ease-in-out infinite`,
          }}
        >
          <img
            src={stageImg}
            alt=""
            draggable={false}
            className="w-full h-full object-contain object-bottom"
            style={{
              animation: isEgg ? undefined : `dsc-head ${4.2 - k * 1.5}s ease-in-out infinite`,
              transformOrigin: "55% 75%",
              filter: `drop-shadow(0 4px 4px rgba(0,0,0,0.85)) drop-shadow(0 0 ${12 + tier * 3}px ${auraOuter.replace(/[\d.]+\)$/, `${glowAlpha})`)})`,
            }}
          />

          {!isEgg && (
            <>
              {/* Glowing blinking eyes */}
              <span
                className="absolute rounded-full"
                style={{
                  left: "44%",
                  top: "26%",
                  width: 5,
                  height: 5,
                  background: "rgba(255,230,120,1)",
                  animation:
                    "dsc-eye-glow 1.8s ease-in-out infinite, dsc-eye-blink 5s ease-in-out infinite",
                }}
              />
              <span
                className="absolute rounded-full"
                style={{
                  left: "52%",
                  top: "26%",
                  width: 5,
                  height: 5,
                  background: "rgba(255,230,120,1)",
                  animation:
                    "dsc-eye-glow 1.8s ease-in-out infinite, dsc-eye-blink 5s ease-in-out infinite",
                  animationDelay: "0s, .12s",
                }}
              />

              {/* Smoke puffs from nostrils (count scales with stage) */}
              {Array.from({ length: smokeCount }).map((_, i) => (
                <span
                  key={`s${i}`}
                  className="absolute rounded-full"
                  style={{
                    left: "26%",
                    top: "34%",
                    width: 14 + tier,
                    height: 14 + tier,
                    background:
                      "radial-gradient(circle, rgba(220,220,220,0.85), rgba(140,140,140,0.4) 55%, transparent 80%)",
                    filter: "blur(3px)",
                    animation: `dsc-smoke ${3.2 + i * 0.4 - k * 1.2}s ease-out infinite`,
                    animationDelay: `${i * (1.1 - k * 0.5)}s`,
                  }}
                />
              ))}

              {/* BIG periodic fire breath — core (scales width + interval) */}
              <span
                className="absolute"
                style={{
                  left: "8%",
                  top: "34%",
                  width: `${30 * fireScale}%`,
                  height: `${12 * (1 + k * 0.5)}%`,
                  background: `radial-gradient(ellipse at right center, ${auraInner} 0%, ${auraMid} 25%, ${auraOuter} 55%, rgba(140,20,5,0) 85%)`,
                  filter: "blur(1.5px)",
                  transformOrigin: "100% 50%",
                  animation: `dsc-fire-burst ${fireInterval}s ease-out infinite, dsc-fire-core ${fireInterval}s linear infinite`,
                  mixBlendMode: "screen",
                }}
              />
              {/* Fire outer flare */}
              <span
                className="absolute"
                style={{
                  left: "2%",
                  top: "30%",
                  width: `${38 * fireScale}%`,
                  height: `${20 * (1 + k * 0.5)}%`,
                  background: `radial-gradient(ellipse at right center, ${auraMid.replace(/[\d.]+\)$/, "0.85)")} 0%, ${auraOuter.replace(/[\d.]+\)$/, "0.55)")} 40%, rgba(120,20,5,0) 80%)`,
                  filter: `blur(${5 + tier * 0.5}px)`,
                  transformOrigin: "100% 50%",
                  animation: `dsc-fire-burst ${fireInterval}s ease-out infinite`,
                  mixBlendMode: "screen",
                }}
              />

              {/* Constant tiny breath flame */}
              <span
                className="absolute"
                style={{
                  left: "18%",
                  top: "33%",
                  width: `${18 + k * 10}%`,
                  height: `${9 + k * 4}%`,
                  background:
                    "radial-gradient(ellipse at right center, rgba(255,235,120,0.9) 0%, rgba(255,130,40,0.7) 45%, rgba(180,30,10,0) 80%)",
                  filter: "blur(2px)",
                  transformOrigin: "100% 50%",
                  animation: `dsc-fire-burst ${3.8 - k * 1.5}s ease-out infinite`,
                  animationDelay: "1.2s",
                  mixBlendMode: "screen",
                }}
              />

              {/* Embers floating up (count scales) */}
              {Array.from({ length: emberCount }).map((_, i) => (
                <span
                  key={`e${i}`}
                  className="absolute rounded-full"
                  style={{
                    left: `${20 + (i * 35) / Math.max(1, emberCount)}%`,
                    top: `${32 + (i % 3) * 2}%`,
                    width: 4 + Math.floor(k * 3),
                    height: 4 + Math.floor(k * 3),
                    background: stage >= 9 ? "rgba(180,220,255,0.95)" : "rgba(255,180,70,0.95)",
                    boxShadow: stage >= 9
                      ? "0 0 10px rgba(120,170,255,0.95)"
                      : "0 0 8px rgba(255,140,30,0.95)",
                    animation: `dsc-ember ${1.8 + i * 0.22}s ease-out infinite`,
                    animationDelay: `${i * 0.28}s`,
                  }}
                />
              ))}
            </>
          )}
        </div>
      </Link>
    </>
  );
}
