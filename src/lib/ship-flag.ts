// User-selectable ship mast flag. Persisted to profiles.ship_flag so visitors
// see the same flag the owner chose. Also cached in localStorage for instant
// reads on the owner's own client.

import { supabase } from "@/integrations/supabase/client";

export type ShipFlagId =
  | "off"
  | "pirate-skull"
  | "pirate-red"
  | "crown-gold"
  | "anchor-navy"
  | "tribe";

const KEY = "ship-flag-id-v1";

export const SHIP_FLAGS: { id: ShipFlagId; name: string }[] = [
  { id: "off", name: "بدون علم" },
  { id: "pirate-skull", name: "🏴‍☠️ جمجمة" },
  { id: "pirate-red", name: "🚩 قرصان أحمر" },
  { id: "crown-gold", name: "👑 تاج ذهبي" },
  { id: "anchor-navy", name: "⚓ مرساة" },
  { id: "tribe", name: "🛡️ علم القبيلة" },
];

export function isShipFlagId(v: string | null | undefined): v is ShipFlagId {
  return !!v && SHIP_FLAGS.some(f => f.id === v);
}

export function getShipFlag(): ShipFlagId {
  try {
    const v = localStorage.getItem(KEY) as ShipFlagId | null;
    if (isShipFlagId(v)) return v;
  } catch { /* noop */ }
  return "pirate-skull";
}

export function setShipFlag(id: ShipFlagId) {
  try {
    localStorage.setItem(KEY, id);
    window.dispatchEvent(new Event("ship-flag-pref"));
  } catch { /* noop */ }
  // Persist to profile so other players see the same flag in visitor view
  (async () => {
    try {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) return;
      await (supabase as any).from("profiles").update({ ship_flag: id }).eq("id", uid);
    } catch { /* noop */ }
  })();
}
