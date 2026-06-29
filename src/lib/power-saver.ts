import { useEffect, useState } from "react";

const KEY = "power-saver";
const CLASS = "power-saver";
const EVENT = "power-saver-pref";

export function getPowerSaver(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function setPowerSaver(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {}
  syncPowerSaverClass();
  try { window.dispatchEvent(new Event(EVENT)); } catch {}
}

export function syncPowerSaverClass(): void {
  if (typeof document === "undefined") return;
  try {
    const root = document.documentElement;
    if (getPowerSaver()) root.classList.add(CLASS);
    else root.classList.remove(CLASS);
  } catch {}
}

export function usePowerSaver(): boolean {
  const [on, setOn] = useState(getPowerSaver);
  useEffect(() => {
    const apply = () => { syncPowerSaverClass(); setOn(getPowerSaver()); };
    apply();
    window.addEventListener(EVENT, apply);
    window.addEventListener("storage", apply);
    return () => {
      window.removeEventListener(EVENT, apply);
      window.removeEventListener("storage", apply);
    };
  }, []);
  return on;
}
