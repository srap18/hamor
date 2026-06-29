import { useEffect, useState } from "react";

const KEY = "bg-motion-paused";
const CLASS = "bg-motion-paused";
const EVENT = "bg-motion-pref";

export function getBgMotionPaused(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setBgMotionPaused(paused: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (paused) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {}
  syncBgMotionClass();
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {}
}

export function syncBgMotionClass(): void {
  if (typeof document === "undefined") return;
  try {
    const root = document.documentElement;
    if (getBgMotionPaused()) root.classList.add(CLASS);
    else root.classList.remove(CLASS);
  } catch {}
}

export function useBgMotionPaused(): boolean {
  const [paused, setPaused] = useState(getBgMotionPaused);

  useEffect(() => {
    const apply = () => {
      syncBgMotionClass();
      setPaused(getBgMotionPaused());
    };
    apply();
    window.addEventListener(EVENT, apply);
    window.addEventListener("storage", apply);
    return () => {
      window.removeEventListener(EVENT, apply);
      window.removeEventListener("storage", apply);
    };
  }, []);

  return paused;
}
