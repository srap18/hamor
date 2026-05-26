// Runtime overrides loaded once at app boot from Supabase.
// Mutates SHIPS in place and stores fish-market capacity overrides.
// Components re-render after boot when we bump _version.

import { supabase } from "@/integrations/supabase/client";
import { SHIPS, type ShipDef } from "@/lib/ships";

type ShipOverridePartial = Partial<Pick<ShipDef, "price" | "storage" | "fishingSeconds" | "maxHp" | "armor" | "speed" | "repairSeconds">> & {
  fishingMinutes?: number;
};

export const FM_CAP_OVERRIDES: Record<number, number> = {};
let loaded = false;
let loadingPromise: Promise<void> | null = null;

const subscribers = new Set<() => void>();
export function subscribeEconomy(cb: () => void) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
function notify() {
  for (const cb of subscribers) cb();
}

function applyShipRow(level: number, ov: ShipOverridePartial) {
  const ship = SHIPS[level - 1];
  if (!ship) return;
  if (ov.price != null) ship.price = Number(ov.price);
  if (ov.storage != null) ship.storage = Number(ov.storage);
  if (ov.maxHp != null) ship.maxHp = Number(ov.maxHp);
  if (ov.armor != null) ship.armor = Number(ov.armor);
  if (ov.speed != null) ship.speed = Number(ov.speed);
  if (ov.repairSeconds != null) ship.repairSeconds = Number(ov.repairSeconds);
  if (ov.fishingSeconds != null) ship.fishingSeconds = Number(ov.fishingSeconds);
  else if (ov.fishingMinutes != null) ship.fishingSeconds = Math.round(Number(ov.fishingMinutes) * 60);
}

export async function loadEconomyOverrides(): Promise<void> {
  if (loaded) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      const [shipsRes, esRes] = await Promise.all([
        supabase.from("ship_overrides").select("level, overrides"),
        supabase.from("economy_settings").select("key, value").eq("key", "fish_market_capacity_overrides").maybeSingle(),
      ]);
      for (const row of shipsRes.data ?? []) {
        applyShipRow(row.level as number, (row.overrides ?? {}) as ShipOverridePartial);
      }
      const fm = esRes.data?.value as Record<string, number> | null | undefined;
      if (fm) {
        for (const [k, v] of Object.entries(fm)) {
          FM_CAP_OVERRIDES[Number(k)] = Number(v);
        }
      }
      loaded = true;
      notify();
    } catch (e) {
      console.warn("[economy-overrides] load failed", e);
    } finally {
      loadingPromise = null;
    }
  })();
  return loadingPromise;
}

export function getFmCapOverride(level: number): number | undefined {
  return FM_CAP_OVERRIDES[level];
}
