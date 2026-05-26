import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getShipByMarketLevel } from "@/lib/ships";
import { sound } from "@/lib/sound";

interface ShipRow {
  id: string;
  template_id: number | null;
  acquired_at: string;
  status?: "idle" | "fishing" | "damaged";
  progress?: number;
  max?: number;
}

interface CrewRow {
  item_id: string;
  assigned_ship_id?: number | null;
}

const rarityColors: Record<string, string> = {
  Starter: "border-gray-400 bg-gray-900/40",
  Common: "border-gray-400 bg-gray-800/40",
  Uncommon: "border-emerald-400 bg-emerald-900/30",
  Rare: "border-sky-400 bg-sky-900/30",
  Epic: "border-purple-400 bg-purple-900/30",
  "Epic+": "border-fuchsia-400 bg-fuchsia-900/30",
  Legendary: "border-amber-400 bg-amber-900/30",
  Mythic: "border-rose-400 bg-rose-900/30",
};

export function MyShipsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [ships, setShips] = useState<ShipRow[]>([]);
  const [crewMap, setCrewMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !user) return;
    (async () => {
      setLoading(true);
      const [{ data: owned }, { data: crews }] = await Promise.all([
        supabase
          .from("ships_owned")
          .select("id, template_id, acquired_at")
          .eq("user_id", user.id)
          .order("acquired_at", { ascending: true }),
        supabase
          .from("inventory")
          .select("item_id, meta")
          .eq("user_id", user.id)
          .eq("item_type", "crew"),
      ]);

      setShips((owned ?? []) as ShipRow[]);

      const map = new Map<string, number>();
      (crews ?? []).forEach((c: any) => {
        map.set(c.item_id, (map.get(c.item_id) ?? 0) + 1);
      });
      setCrewMap(map);
      setLoading(false);
    })();
  }, [open, user]);

  if (!open) return null;

  const total = ships.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-3xl border-4 border-amber-400/80 bg-gradient-to-b from-[#3a1f0a] via-[#1f1207] to-[#0f0703] shadow-[0_0_60px_rgba(252,191,73,0.4)] overflow-hidden max-h-[80vh] flex flex-col"
      >
        {/* Ornate corners */}
        <div className="absolute top-1 left-1 text-amber-300 text-lg">⚜</div>
        <div className="absolute top-1 right-1 text-amber-300 text-lg">⚜</div>
        <div className="absolute bottom-1 left-1 text-amber-300 text-lg">⚜</div>
        <div className="absolute bottom-1 right-1 text-amber-300 text-lg">⚜</div>

        {/* Header */}
        <div className="px-5 pt-4 pb-3 text-center border-b border-amber-400/30 bg-gradient-to-b from-amber-900/40 to-transparent shrink-0">
          <div className="text-amber-300 text-[11px] tracking-widest">⚓ أسطولك ⚓</div>
          <h2 className="text-amber-100 text-xl font-black mt-1 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
            سفينتي
          </h2>
          <div className="text-amber-200/80 text-[11px] mt-1">
            عدد السفن: {total}
          </div>
        </div>

        {/* Ships list */}
        <div className="overflow-y-auto p-3 space-y-2">
          {loading && (
            <div className="text-center text-amber-300/70 text-sm py-8 animate-pulse">جاري التحميل...</div>
          )}
          {!loading && ships.length === 0 && (
            <div className="text-center text-amber-300/70 text-sm py-8">
              لا تملك سفن بعد! اذهب لسوق السفن واشتري سفنتك الأولى.
            </div>
          )}
          {ships.map((ship, idx) => {
            const def = getShipByMarketLevel(ship.template_id ?? 1);
            const rarityClass = rarityColors[def.rarity] || rarityColors.Common;
            return (
              <div
                key={ship.id}
                className={`relative rounded-xl border-2 p-2 flex items-center gap-3 ${rarityClass}`}
              >
                {/* Rank */}
                <div className="absolute top-1 left-1 text-[9px] font-black text-amber-300/70 bg-black/40 rounded px-1">
                  #{idx + 1}
                </div>

                {/* Ship image */}
                <div className="w-20 h-20 rounded-lg bg-gradient-to-b from-amber-900/60 to-black/60 border border-amber-700/40 flex items-center justify-center overflow-hidden shrink-0">
                  <img
                    src={def.image}
                    alt={def.title}
                    className="w-full h-full object-contain drop-shadow"
                    draggable={false}
                  />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 text-right">
                  <div className="text-amber-100 font-black text-sm truncate drop-shadow">
                    {def.title}
                  </div>
                  <div className="text-[10px] text-amber-300/80 mt-0.5">
                    {def.name} • {def.rarity}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1 justify-end">
                    <span className="text-[9px] bg-black/40 border border-amber-700/40 rounded px-1.5 py-0.5 text-amber-200">
                      🛡️ {def.armor}
                    </span>
                    <span className="text-[9px] bg-black/40 border border-amber-700/40 rounded px-1.5 py-0.5 text-amber-200">
                      ⚡ {def.speed}
                    </span>
                    <span className="text-[9px] bg-black/40 border border-amber-700/40 rounded px-1.5 py-0.5 text-amber-200">
                      📦 {def.storage.toLocaleString()}
                    </span>
                  </div>
                  <div className="text-[9px] text-amber-400/60 mt-1 truncate">
                    {def.flavor}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Close */}
        <div className="px-4 pb-4 pt-2 shrink-0 border-t border-amber-400/20">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-gradient-to-b from-amber-300 to-amber-600 border-2 border-amber-200 text-amber-950 font-black text-sm active:scale-95 shadow-lg"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
