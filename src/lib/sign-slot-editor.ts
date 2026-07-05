import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SignPos = { top: number; left: number; width: number };
export const DEFAULT_SIGN_POS: SignPos = { top: 62, left: 30, width: 9 };

type Cache = Record<string, SignPos>;
let cache: Cache = {};
let loaded = false;
let loading = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((fn) => { try { fn(); } catch { /* noop */ } });

async function loadAll() {
  if (loading) return;
  loading = true;
  const { data, error } = await supabase
    .from("sign_slot_layout" as never)
    .select("bg_id,top_pct,left_pct,width_pct");
  loading = false;
  loaded = true;
  if (error) { notify(); return; }
  const map: Cache = {};
  for (const r of (data ?? []) as Array<{ bg_id: string; top_pct: number; left_pct: number; width_pct: number }>) {
    map[r.bg_id] = { top: Number(r.top_pct), left: Number(r.left_pct), width: Number(r.width_pct) };
  }
  cache = map;
  notify();
}

let channelInit = false;
function ensureChannel() {
  if (channelInit) return;
  channelInit = true;
  supabase
    .channel("sign_slot_layout:all")
    .on("postgres_changes", { event: "*", schema: "public", table: "sign_slot_layout" }, () => { loadAll(); })
    .subscribe();
}
if (typeof window !== "undefined") { ensureChannel(); loadAll(); }

export function useSignPos(bgId: string | undefined): SignPos {
  useEffect(() => { ensureChannel(); if (!loaded) loadAll(); }, []);
  return useSyncExternalStore(
    (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
    () => (bgId && cache[bgId]) || DEFAULT_SIGN_POS,
    () => DEFAULT_SIGN_POS,
  );
}

export async function saveSignPos(bgId: string, pos: SignPos) {
  cache = { ...cache, [bgId]: pos };
  notify();
  await supabase.from("sign_slot_layout" as never).upsert({
    bg_id: bgId,
    top_pct: pos.top,
    left_pct: pos.left,
    width_pct: pos.width,
    updated_at: new Date().toISOString(),
  } as never);
}
