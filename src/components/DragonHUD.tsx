import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import dragonEgg from "@/assets/dragon-egg.png";
import dragonAdult from "@/assets/dragon-adult.png";
import bossImg from "@/assets/world-boss.png";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase.rpc.bind(supabase) as unknown as (n: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }>;

export function DragonHUD() {
  const [stage, setStage] = useState(1);
  const [bossAlive, setBossAlive] = useState(false);
  const [hasFreeRockets, setHasFreeRockets] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: d }, { data: b }, { data: dr }] = await Promise.all([
        supabase.from("dragons").select("stage").eq("user_id", user.id).maybeSingle(),
        rpc("get_active_boss"),
        rpc("daily_rockets_status"),
      ]);
      if (d) setStage(d.stage);
      if (b && !b.defeated_at) setBossAlive(true);
      if (dr?.available) setHasFreeRockets(true);
    })();
  }, []);

  return (
    <div className="flex gap-2">
      <Link to="/dragon" className="relative">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-800/60 to-rose-900/60 border-2 border-amber-400/60 flex items-center justify-center overflow-hidden shadow-lg backdrop-blur"
          style={{ boxShadow: "0 0 18px rgba(251,146,60,0.5)" }}>
          <img src={stage >= 3 ? dragonAdult : dragonEgg} alt="حالة تنينك الأليف — your pet dragon status" loading="lazy"
            className="w-12 h-12 object-contain"
            style={{ animation: "dragon-pulse 2.5s ease-in-out infinite" }} />
        </div>
        {hasFreeRockets && (
          <span className="absolute -top-1 -end-1 bg-emerald-500 text-stone-900 text-[9px] font-extrabold rounded-full px-1.5 py-0.5 border border-emerald-200 animate-bounce">🎁</span>
        )}
      </Link>
      {bossAlive && (
        <Link to="/boss" className="relative">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-900/70 to-black border-2 border-rose-400/70 flex items-center justify-center overflow-hidden shadow-lg backdrop-blur"
            style={{ boxShadow: "0 0 18px rgba(244,63,94,0.6)" }}>
            <img src={bossImg} alt="تحدي الزعيم النشط — active boss challenge" loading="lazy"
              className="w-14 h-14 object-contain"
              style={{ animation: "boss-pulse 1.5s ease-in-out infinite" }} />
          </div>
          <span className="absolute -top-1 -end-1 bg-rose-500 text-white text-[9px] font-extrabold rounded-full px-1.5 py-0.5 border border-rose-200 animate-pulse">حي</span>
        </Link>
      )}
      <style>{`
        @keyframes dragon-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.08)} }
        @keyframes boss-pulse { 0%,100%{transform:scale(1);filter:drop-shadow(0 0 4px rgba(244,63,94,0.7))} 50%{transform:scale(1.12);filter:drop-shadow(0 0 12px rgba(244,63,94,1))} }
      `}</style>
    </div>
  );
}
