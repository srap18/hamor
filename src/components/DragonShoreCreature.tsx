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
        @keyframes dsc-shadow { 0%,100%{transform:scaleX(1);opacity:.65} 50%{transform:scaleX(.9);opacity:.5} }
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
        {/* Soft ambient shadow — wider, lighter for grounding */}
        <span
          className="absolute pointer-events-none"
          style={{
            left: "6%",
            right: "6%",
            bottom: "-1%",
            height: "14%",
            background:
              "radial-gradient(ellipse at center, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 72%)",
            filter: "blur(6px)",
          }}
        />
        {/* Contact ground shadow — tight, dark ellipse directly under feet */}
        <span
          className="absolute pointer-events-none"
          style={{
            left: "18%",
            right: "18%",
            bottom: "2%",
            height: "7%",
            background:
              "radial-gradient(ellipse at center, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.55) 40%, rgba(0,0,0,0) 78%)",
            filter: "blur(2px)",
            animation: "dsc-shadow 3s ease-in-out infinite",
          }}
        />

        <img
          src={img}
          alt=""
          draggable={false}
          className="relative w-full h-full object-contain object-bottom"
          style={{
            animation: isEgg ? "dsc-rock 2.6s ease-in-out infinite" : "dsc-breathe 2.8s ease-in-out infinite",
            transformOrigin: "50% 100%",
            filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.55)) drop-shadow(0 6px 12px rgba(0,0,0,0.35)) saturate(0.9) brightness(0.93) contrast(1.04)",
          }}
        />
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
