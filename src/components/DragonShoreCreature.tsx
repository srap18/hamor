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
          left: "18%",
          bottom: "16%",
          width: "22%",
          maxWidth: "150px",
          aspectRatio: "1 / 1",
          pointerEvents: "auto",
        }}
      >
        {/* Ground shadow */}
        <span
          className="absolute pointer-events-none"
          style={{
            left: "15%",
            right: "15%",
            bottom: "3%",
            height: "10%",
            background:
              "radial-gradient(ellipse at center, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.35) 45%, rgba(0,0,0,0) 80%)",
            filter: "blur(3px)",
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
            filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.7))",
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
