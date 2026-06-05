// User-selectable ship mast flag. Stored in localStorage so it's a pure UI
// preference (no DB). Choices include classic pirate flags, a luxury crown
// flag, and an "off" option to hide the flag entirely.

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

export function getShipFlag(): ShipFlagId {
  try {
    const v = localStorage.getItem(KEY) as ShipFlagId | null;
    if (v && SHIP_FLAGS.some(f => f.id === v)) return v;
  } catch { /* noop */ }
  return "pirate-skull";
}

export function setShipFlag(id: ShipFlagId) {
  try {
    localStorage.setItem(KEY, id);
    window.dispatchEvent(new Event("ship-flag-pref"));
  } catch { /* noop */ }
}
