import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FISH } from "@/lib/fish";

type ActiveCombo = { combo_id: string; name: string; fish_id: string; qty: number; chance_pct: number };

/** Small pill shown when the player's fleet currently matches an active combo recipe. */
export function FleetComboBadge() {
  const [combos, setCombos] = useState<ActiveCombo[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await (supabase as any).rpc("my_active_fleet_combos");
      if (alive) setCombos((data ?? []) as ActiveCombo[]);
    };
    void load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (combos.length === 0) return null;
  const c = combos[0];
  const fish = FISH[c.fish_id];

  return (
    <div
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 max-w-[190px]"
      title={`${c.name} — ${fish?.name ?? c.fish_id} ×${c.qty}`}
      style={{
        background: "linear-gradient(180deg, rgba(250,204,21,0.28), rgba(120,53,15,0.55))",
        border: "1px solid rgba(253,224,71,0.6)",
      }}
    >
      <span className="text-sm leading-none">🌟</span>
      {fish?.img ? (
        <img src={fish.img} alt={fish.name} loading="lazy" className="w-5 h-5 object-contain" />
      ) : null}
      <span className="text-[11px] font-black truncate" style={{ color: "#ffe9a8" }}>
        {c.name}
      </span>
    </div>
  );
}
