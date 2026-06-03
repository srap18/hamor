import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AnimatedDragon } from "@/components/AnimatedDragon";

/**
 * Shore dragon — fully animated SVG. No static image.
 * Egg stage shows a rocking glowing egg; adult shows the animated dragon.
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

  return (
    <>
      <style>{`
        @keyframes dsc-rock { 0%,100%{transform:rotate(-6deg)} 50%{transform:rotate(6deg)} }
        @keyframes dsc-egg-glow { 0%,100%{filter:drop-shadow(0 0 10px rgba(255,140,40,.6))} 50%{filter:drop-shadow(0 0 22px rgba(255,200,60,.95))} }
        @keyframes dsc-shadow { 0%,100%{transform:scaleX(1);opacity:.75} 50%{transform:scaleX(.88);opacity:.55} }
        @keyframes dsc-ember { 0%{opacity:0;transform:translateY(0) scale(.5)} 30%{opacity:1} 100%{opacity:0;transform:translateY(-55px) scale(.2)} }
      `}</style>

      <Link
        to="/dragon"
        aria-label={isEgg ? "بيضة التنين" : "تنيني"}
        className="absolute z-20 active:scale-95 transition-transform"
        style={{
          left: "3%",
          bottom: "10%",
          width: "40%",
          maxWidth: "240px",
          aspectRatio: "1 / 1",
          pointerEvents: "auto",
        }}
      >
        {/* Contact shadow */}
        <span className="absolute" style={{
          left: "12%", right: "12%", bottom: "3%", height: "11%",
          background: "radial-gradient(ellipse at center, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.5) 40%, transparent 75%)",
          filter: "blur(3px)", animation: "dsc-shadow 3.2s ease-in-out infinite",
          transformOrigin: "50% 100%",
        }} />
        {/* Warm ground heat */}
        <span className="absolute pointer-events-none" style={{
          left: "5%", right: "5%", bottom: "2%", height: "18%",
          background: "radial-gradient(ellipse at center bottom, rgba(255,150,40,0.55), rgba(220,60,20,0.2) 45%, transparent 75%)",
          filter: "blur(6px)", mixBlendMode: "screen",
        }} />

        {/* Embers */}
        {[0,1,2,3,4].map((i) => (
          <span key={i} className="absolute rounded-full" style={{
            left: `${25 + i*10}%`, bottom: "12%",
            width: 4, height: 4,
            background: "rgba(255,180,70,0.95)",
            boxShadow: "0 0 8px rgba(255,140,30,0.95)",
            animation: `dsc-ember ${2.2 + i*0.35}s ease-out infinite`,
            animationDelay: `${i * 0.5}s`,
          }} />
        ))}

        <div className="absolute inset-0 flex items-end justify-center pb-[8%]">
          {isEgg ? (
            <div style={{
              animation: "dsc-rock 2.4s ease-in-out infinite, dsc-egg-glow 1.8s ease-in-out infinite",
              transformOrigin: "50% 95%",
              fontSize: "120px",
              lineHeight: 1,
            }}>
              🥚
            </div>
          ) : (
            <AnimatedDragon size={220} variant="shore" breathing />
          )}
        </div>
      </Link>
    </>
  );
}
