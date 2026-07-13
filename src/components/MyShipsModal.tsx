import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getShipByCode, getShipByMarketLevel, getUpgradeSubImage } from "@/lib/ships";
import { sound } from "@/lib/sound";
import { sellShip } from "@/lib/economy";

interface ShipRow {
  id: string;
  template_id: number | null;
  catalog_code: string | null;
  acquired_at: string;
  in_storage: boolean;
  max_hp: number | null;
  stars: number | null;
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

const MAX_ACTIVE = 3;
const DEFAULT_STORAGE = 3;
const STORAGE_UPGRADE_COST = 10000;
const STORAGE_MAX_CAP = 20;

const ERR_MAP: Record<string, string> = {
  "ship is at sea": "السفينة في البحر — أرجعها أولاً",
  "ship on mission": "السفينة في مهمة سرقة",
  "ship under repair": "السفينة تحت الإصلاح",
  "storage full": "المخزن ممتلئ",
  "fleet full": "الأسطول النشط ممتلئ — بدّلها بسفينة",
};

export function MyShipsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [ships, setShips] = useState<ShipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pickSwap, setPickSwap] = useState<string | null>(null); // storage ship id awaiting active pick
  const [notice, setNotice] = useState<string | null>(null);
  const [maxStorage, setMaxStorage] = useState<number>(DEFAULT_STORAGE);
  const [gems, setGems] = useState<number>(0);
  const [upgrading, setUpgrading] = useState(false);

  const showNotice = (m: string) => {
    setNotice(m);
    window.setTimeout(() => setNotice(null), 2500);
  };

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("ships_owned")
      .select("id, template_id, catalog_code, acquired_at, in_storage, max_hp, stars")
      .eq("user_id", user.id)
      .order("acquired_at", { ascending: true });
    setShips((data ?? []) as ShipRow[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { if (open) reload(); }, [open, reload]);

  // NOTE: No auto-activate. The player chooses whether to keep ships in storage
  // (previously an effect forced 3-at-sea and made "move to storage" impossible).

  if (!open) return null;

  const active = ships.filter(s => !s.in_storage);
  const stored = ships.filter(s => s.in_storage);

  const callRpc = async (fn: string, args: any) => {
    const { error } = await (supabase as any).rpc(fn, args);
    if (error) {
      const msg = (error.message || "").toLowerCase();
      const friendly = Object.entries(ERR_MAP).find(([k]) => msg.includes(k))?.[1];
      showNotice(friendly || error.message);
      return false;
    }
    return true;
  };

  const moveToStorage = async (id: string) => {
    setBusyId(id);
    sound.play("click");
    if (await callRpc("ship_to_storage", { p_ship_id: id })) {
      showNotice("✅ تم النقل للمخزن");
      await reload();
    }
    setBusyId(null);
  };

  const activate = async (id: string) => {
    setBusyId(id);
    sound.play("click");
    if (await callRpc("ship_from_storage", { p_ship_id: id })) {
      showNotice("⚓ تم تفعيل السفينة");
      await reload();
    }
    setBusyId(null);
  };

  const swap = async (storageId: string, activeId: string) => {
    setBusyId(storageId);
    sound.play("click");
    if (await callRpc("swap_ship_with_storage", { p_active_id: activeId, p_storage_id: storageId })) {
      showNotice("🔄 تم التبديل");
      setPickSwap(null);
      await reload();
    }
    setBusyId(null);
  };

  const sellStored = async (ship: ShipRow) => {
    const def = ship.catalog_code ? getShipByCode(ship.catalog_code) : getShipByMarketLevel(ship.template_id ?? 1);
    const refund = Math.floor((def.price ?? 0) / 2);
    const ok = window.confirm(`بيع ${def.title}؟\nسترجع لك ${refund.toLocaleString()} ذهب.`);
    if (!ok) return;
    setBusyId(ship.id);
    sound.play("click");
    const { error } = await sellShip(ship.id, refund);
    if (error) {
      const m = (error.message || "").toLowerCase();
      const friendly = Object.entries(ERR_MAP).find(([k]) => m.includes(k))?.[1];
      showNotice(friendly || error.message || "تعذر بيع السفينة");
    } else {
      showNotice(`💰 تم البيع — +${refund.toLocaleString()} ذهب`);
      await reload();
    }
    setBusyId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-3xl border-4 border-amber-400/80 bg-gradient-to-b from-[#3a1f0a] via-[#1f1207] to-[#0f0703] shadow-[0_0_60px_rgba(252,191,73,0.4)] overflow-hidden max-h-[85vh] flex flex-col"
      >
        <div className="absolute top-1 left-1 text-amber-300 text-lg">⚜</div>
        <div className="absolute top-1 right-1 text-amber-300 text-lg">⚜</div>
        <div className="absolute bottom-1 left-1 text-amber-300 text-lg">⚜</div>
        <div className="absolute bottom-1 right-1 text-amber-300 text-lg">⚜</div>

        <div className="px-5 pt-4 pb-3 text-center border-b border-amber-400/30 bg-gradient-to-b from-amber-900/40 to-transparent shrink-0">
          <div className="text-amber-300 text-[11px] tracking-widest">⚓ أسطولك ⚓</div>
          <h2 className="text-amber-100 text-xl font-black mt-1 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">سفينتي</h2>
          <div className="text-amber-200/80 text-[11px] mt-1">
            النشط: {active.length}/{MAX_ACTIVE} • المخزن: {stored.length}/{MAX_STORAGE}
          </div>
        </div>

        {notice && (
          <div className="mx-3 mt-2 px-3 py-1.5 rounded-lg bg-stone-900/95 border border-amber-400/60 text-amber-100 text-xs font-bold text-center">
            {notice}
          </div>
        )}

        <div className="overflow-y-auto p-3 space-y-3">
          {loading && <div className="text-center text-amber-300/70 text-sm py-8 animate-pulse">جاري التحميل...</div>}

          {!loading && (
            <>
              {/* ACTIVE FLEET */}
              <SectionTitle icon="⚓" label="الأسطول النشط" hint={`${active.length}/${MAX_ACTIVE}`} />
              {active.length === 0 && (
                <div className="text-center text-amber-300/70 text-xs py-3 rounded-lg bg-stone-900/40 border border-amber-700/30">
                  لا توجد سفن نشطة
                </div>
              )}
              {active.map((ship, idx) => (
                <ShipCard
                  key={ship.id}
                  ship={ship}
                  idx={idx + 1}
                  primaryAction={
                    pickSwap ? (
                      <button
                        disabled={busyId === ship.id}
                        onClick={() => swap(pickSwap, ship.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-gradient-to-b from-sky-400 to-sky-700 border border-sky-200 text-white text-[11px] font-black active:scale-95 disabled:opacity-50"
                      >
                        🔄 بدّل بهذه
                      </button>
                    ) : (
                      <button
                        disabled={busyId === ship.id || stored.length >= MAX_STORAGE || active.length <= 1}
                        onClick={() => moveToStorage(ship.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-stone-800 border border-amber-700/50 text-amber-200 text-[11px] font-black active:scale-95 disabled:opacity-40"
                        title={active.length <= 1 ? "لا يمكن تفريغ الأسطول بالكامل" : (stored.length >= MAX_STORAGE ? "المخزن ممتلئ" : "نقل إلى المخزن")}
                      >
                        📦 للمخزن
                      </button>
                    )
                  }
                />
              ))}

              {/* STORAGE */}
              <div className="pt-1">
                <SectionTitle icon="📦" label="المخزن" hint={`${stored.length}/${MAX_STORAGE}`} />
                {stored.length === 0 && (
                  <div className="text-center text-amber-300/60 text-xs py-3 rounded-lg bg-stone-900/40 border border-amber-700/30">
                    المخزن فارغ
                  </div>
                )}
                {stored.map((ship, idx) => {
                  const canActivate = active.length < MAX_ACTIVE;
                  const isPicking = pickSwap === ship.id;
                  return (
                    <ShipCard
                      key={ship.id}
                      ship={ship}
                      idx={idx + 1}
                      dim
                      primaryAction={
                        <div className="flex flex-wrap gap-1 justify-end">
                          {canActivate ? (
                            <button
                              disabled={busyId === ship.id}
                              onClick={() => activate(ship.id)}
                              className="px-2.5 py-1.5 rounded-lg bg-gradient-to-b from-emerald-400 to-emerald-700 border border-emerald-200 text-white text-[11px] font-black active:scale-95 disabled:opacity-50"
                            >
                              ⚓ تفعيل
                            </button>
                          ) : isPicking ? (
                            <button
                              onClick={() => setPickSwap(null)}
                              className="px-2.5 py-1.5 rounded-lg bg-rose-700 border border-rose-300 text-white text-[11px] font-black active:scale-95"
                            >
                              إلغاء
                            </button>
                          ) : (
                            <button
                              disabled={busyId === ship.id}
                              onClick={() => { setPickSwap(ship.id); showNotice("اختر سفينة من الأسطول لتبديلها"); }}
                              className="px-2.5 py-1.5 rounded-lg bg-gradient-to-b from-sky-400 to-sky-700 border border-sky-200 text-white text-[11px] font-black active:scale-95 disabled:opacity-50"
                            >
                              🔄 تبديل
                            </button>
                          )}
                          <button
                            disabled={busyId === ship.id || isPicking}
                            onClick={() => sellStored(ship)}
                            className="px-2.5 py-1.5 rounded-lg bg-gradient-to-b from-amber-400 to-amber-700 border border-amber-200 text-amber-950 text-[11px] font-black active:scale-95 disabled:opacity-50"
                            title="بيع السفينة مقابل نصف سعرها"
                          >
                            💰 بيع
                          </button>
                        </div>
                      }
                    />
                  );
                })}
              </div>
            </>
          )}
        </div>

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

function SectionTitle({ icon, label, hint }: { icon: string; label: string; hint: string }) {
  return (
    <div className="flex items-center gap-2 mb-2 mt-1">
      <span className="text-lg">{icon}</span>
      <span className="text-amber-200 font-extrabold text-sm tracking-wide">{label}</span>
      <div className="flex-1 h-px bg-gradient-to-l from-transparent via-amber-500/40 to-transparent" />
      <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/40 text-amber-200">{hint}</span>
    </div>
  );
}

function ShipCard({ ship, idx, primaryAction, dim }: { ship: ShipRow; idx: number; primaryAction: React.ReactNode; dim?: boolean }) {
  const def = ship.catalog_code ? getShipByCode(ship.catalog_code) : getShipByMarketLevel(ship.template_id ?? 1);
  const image = ship.catalog_code === "upgrade-sub" ? getUpgradeSubImage(ship.stars ?? 1) : def.image;
  const storage = (ship.catalog_code === "upgrade-sub" || ship.catalog_code === "submarine") && ship.max_hp ? ship.max_hp : def.storage;
  const rarityClass = rarityColors[def.rarity] || rarityColors.Common;
  return (
    <div className={`relative rounded-xl border-2 p-2 flex items-center gap-3 mb-2 ${rarityClass} ${dim ? "opacity-80" : ""}`}>
      <div className="absolute top-1 left-1 text-[9px] font-black text-amber-300/70 bg-black/40 rounded px-1">#{idx}</div>
      <div className="w-20 h-20 rounded-lg bg-gradient-to-b from-amber-900/60 to-black/60 border border-amber-700/40 flex items-center justify-center overflow-hidden shrink-0">
        <img src={image} alt={def.title} className="w-full h-full object-contain drop-shadow" draggable={false} />
      </div>
      <div className="flex-1 min-w-0 text-right">
        <div className="text-amber-100 font-black text-sm truncate drop-shadow">{def.title}</div>
        <div className="text-[10px] text-amber-300/80 mt-0.5">{def.name} • {def.rarity}</div>
        <div className="flex flex-wrap gap-1 mt-1 justify-end">
          <span className="text-[9px] bg-black/40 border border-amber-700/40 rounded px-1.5 py-0.5 text-amber-200">🛡️ {def.armor}</span>
          <span className="text-[9px] bg-black/40 border border-amber-700/40 rounded px-1.5 py-0.5 text-amber-200">⚡ {def.speed}</span>
          <span className="text-[9px] bg-black/40 border border-amber-700/40 rounded px-1.5 py-0.5 text-amber-200">📦 {storage.toLocaleString()}</span>
        </div>
        <div className="mt-1.5 flex justify-end">{primaryAction}</div>
      </div>
    </div>
  );
}
