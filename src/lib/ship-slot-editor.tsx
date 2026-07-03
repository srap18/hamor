import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/use-admin";
import { useAuth } from "@/hooks/use-auth";
import { BACKGROUNDS } from "@/lib/backgrounds";

const SHIP_EDITOR_EMAIL = "ccx1357@gmail.com";
const GLOBAL_LAYOUT_BG_ID = "__global__";
const LAYOUT_CACHE_KEY = "ship_slot_layout_cache_v2";

export type SlotPos = { top: number; left: number; scale: number };
export type SlotOverride = { dock?: SlotPos; sea?: SlotPos };
export type OverrideMap = Record<string, Record<number, SlotOverride>>;

/* ─── module-level store ─── */
function readStoredCache(): OverrideMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LAYOUT_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistCache(next: OverrideMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAYOUT_CACHE_KEY, JSON.stringify(next));
  } catch {
    /* noop */
  }
}

let cache: OverrideMap = readStoredCache();
let loaded = Object.keys(cache).length > 0;
let fetchedOnce = false;
let loading = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((fn) => { try { fn(); } catch { /* noop */ } });
const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; };

function layoutTargetsFor(bgId: string) {
  return Array.from(new Set([GLOBAL_LAYOUT_BG_ID, bgId, ...BACKGROUNDS.map((bg) => bg.id)]));
}

async function loadAll() {
  if (loading) return;
  loading = true;
  const { data, error } = await supabase
    .from("ship_slot_layout" as any)
    .select("bg_id,slot_index,mode,top_pct,left_pct,scale");
  loading = false;
  fetchedOnce = true;
  if (error) {
    loaded = true;
    notify();
    return;
  }
  loaded = true;
  const map: OverrideMap = {};
  for (const r of (data ?? []) as any[]) {
    (map[r.bg_id] ||= {})[r.slot_index] ||= {};
    (map[r.bg_id][r.slot_index] as any)[r.mode] = {
      top: Number(r.top_pct),
      left: Number(r.left_pct),
      scale: Number(r.scale),
    };
  }
  cache = map;
  persistCache(map);
  notify();
}

let channelInit = false;
function ensureChannel() {
  if (channelInit) return;
  channelInit = true;
  supabase
    .channel("ship_slot_layout:all")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "ship_slot_layout" },
      () => { loadAll(); },
    )
    .subscribe();
}

// Kick off fetch + realtime subscription as soon as the module loads on the
// client so ship positions are ready before the first paint of the shore.
if (typeof window !== "undefined") {
  ensureChannel();
  loadAll();
}

/** Read overrides for a specific background. */
export function useShipSlotOverrides(bgId: string) {
  useEffect(() => {
    ensureChannel();
    if (!fetchedOnce) loadAll();
  }, []);
  const snap = useSyncExternalStore(
    subscribe,
    () => cache[bgId] || cache[GLOBAL_LAYOUT_BG_ID] || EMPTY,
    () => EMPTY,
  );
  return snap;
}
const EMPTY: Record<number, SlotOverride> = {};

export function useShipSlotLayoutReady() {
  useEffect(() => {
    ensureChannel();
    if (!fetchedOnce) loadAll();
  }, []);
  return useSyncExternalStore(subscribe, () => loaded, () => true);
}

/* ─── edit-mode state (admin) ─── */
let editEnabled = false;
let editMode: "dock" | "sea" = "dock";
const editSubs = new Set<() => void>();
const notifyEdit = () => editSubs.forEach((fn) => { try { fn(); } catch { /* noop */ } });

export function useShipSlotEditor() {
  const { isAdmin } = useIsAdmin();
  const { user } = useAuth();
  const allowed = isAdmin && (user?.email ?? "").toLowerCase() === SHIP_EDITOR_EMAIL;
  const enabled = useSyncExternalStore(
    (fn) => { editSubs.add(fn); return () => { editSubs.delete(fn); }; },
    () => editEnabled,
    () => false,
  );
  const mode = useSyncExternalStore(
    (fn) => { editSubs.add(fn); return () => { editSubs.delete(fn); }; },
    () => editMode,
    () => "dock" as const,
  );
  return {
    isAdmin: allowed,
    enabled,
    mode,
    setEnabled: (v: boolean) => { editEnabled = v; notifyEdit(); },
    setMode: (m: "dock" | "sea") => { editMode = m; notifyEdit(); },
  };
}

export async function saveSlot(bgId: string, slotIndex: number, mode: "dock" | "sea", pos: SlotPos) {
  // optimistic update
  const next = { ...cache };
  const targets = layoutTargetsFor(bgId);
  for (const targetBgId of targets) {
    next[targetBgId] = { ...(next[targetBgId] || {}) };
    next[targetBgId][slotIndex] = { ...(next[targetBgId][slotIndex] || {}), [mode]: pos };
  }
  cache = next;
  persistCache(next);
  notify();
  await supabase.from("ship_slot_layout" as any).upsert(targets.map((targetBgId) => ({
    bg_id: targetBgId,
    slot_index: slotIndex,
    mode,
    top_pct: pos.top,
    left_pct: pos.left,
    scale: pos.scale,
    updated_at: new Date().toISOString(),
  })));
}

export async function resetSlot(bgId: string, slotIndex: number, mode: "dock" | "sea") {
  const next = { ...cache };
  const targets = layoutTargetsFor(bgId);
  for (const targetBgId of targets) {
    if (next[targetBgId]?.[slotIndex]) {
      const cur = { ...next[targetBgId][slotIndex] };
      delete (cur as any)[mode];
      next[targetBgId] = { ...next[targetBgId], [slotIndex]: cur };
    }
  }
  cache = next;
  persistCache(next);
  notify();
  await supabase
    .from("ship_slot_layout" as any)
    .delete()
    .in("bg_id", targets)
    .eq("slot_index", slotIndex)
    .eq("mode", mode);
}

/* ─── UI components ─── */

/** Floating admin control: shows a small button that opens edit mode and mode-switcher. */
export function ShipSlotEditorToolbar() {
  const { isAdmin, enabled, mode, setEnabled, setMode } = useShipSlotEditor();
  if (!isAdmin) return null;

  if (!enabled) {
    return (
      <button
        type="button"
        onClick={() => setEnabled(true)}
        className="fixed z-[85] top-40 right-2 px-3 py-1.5 rounded-full bg-stone-900/90 border-2 border-amber-400/70 text-amber-100 text-[11px] font-extrabold shadow-xl active:scale-95"
        title="تحرير مواقع السفن"
      >
        🛠️ مواقع السفن
      </button>
    );
  }

  return (
    <div className="fixed z-[85] top-40 right-2 flex flex-col gap-1.5 items-stretch bg-stone-900/95 border-2 border-amber-400/70 rounded-xl p-2 shadow-2xl">
      <div className="text-[10px] font-black text-amber-200 text-center">تحرير مواقع السفن</div>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setMode("dock")}
          className={`flex-1 px-2 py-1 rounded-md text-[10px] font-extrabold border-2 ${
            mode === "dock"
              ? "bg-amber-400 text-stone-900 border-amber-200"
              : "bg-stone-800 text-amber-200 border-amber-800"
          }`}
        >
          🅿️ رسو
        </button>
        <button
          type="button"
          onClick={() => setMode("sea")}
          className={`flex-1 px-2 py-1 rounded-md text-[10px] font-extrabold border-2 ${
            mode === "sea"
              ? "bg-cyan-400 text-stone-900 border-cyan-200"
              : "bg-stone-800 text-cyan-200 border-cyan-800"
          }`}
        >
          🌊 إبحار
        </button>
      </div>
      <div className="text-[9px] text-amber-100/80 text-center leading-tight px-1">
        اسحب الدوائر الملونة لتغيير موقع كل سفينة
      </div>
      <button
        type="button"
        onClick={() => setEnabled(false)}
        className="px-2 py-1 rounded-md bg-emerald-600 text-white text-[10px] font-extrabold border-2 border-emerald-200 active:scale-95"
      >
        ✓ إنهاء
      </button>
    </div>
  );
}

/**
 * Overlay of draggable pucks — one per ship slot — for the currently selected
 * mode. Renders inside the scene container so its % coordinates match the
 * ships. Only visible in admin edit mode.
 */
export function ShipSlotEditorOverlay({
  bgId,
  slots, // effective slots (defaults + overrides for the current mode)
}: {
  bgId: string;
  slots: Array<{ index: number; pos: SlotPos }>;
}) {
  const { isAdmin, enabled, mode } = useShipSlotEditor();
  const dragRef = useRef<{
    idx: number;
    startX: number;
    startY: number;
    baseLeft: number;
    baseTop: number;
    parentW: number;
    parentH: number;
    pos: SlotPos;
  } | null>(null);
  const [, force] = useState(0);
  if (!isAdmin || !enabled) return null;

  const puckColors = ["#f59e0b", "#22d3ee", "#a3e635"];

  const onPointerDown = (e: React.PointerEvent, idx: number, pos: SlotPos) => {
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    const parent = target.parentElement?.parentElement; // .absolute overlay → scene
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    dragRef.current = {
      idx,
      startX: e.clientX,
      startY: e.clientY,
      baseLeft: pos.left,
      baseTop: pos.top,
      parentW: rect.width,
      parentH: rect.height,
      pos: { ...pos },
    };
    target.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = ((e.clientX - d.startX) / d.parentW) * 100;
    const dy = ((e.clientY - d.startY) / d.parentH) * 100;
    d.pos = {
      ...d.pos,
      left: Math.max(0, Math.min(100, d.baseLeft + dx)),
      top: Math.max(0, Math.min(100, d.baseTop + dy)),
    };
    force((x) => x + 1);
  };
  const onPointerUp = async (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    force((x) => x + 1);
    await saveSlot(bgId, d.idx, mode, d.pos);
  };

  return (
    <div
      className="absolute inset-0 z-[60] pointer-events-none"
      style={{ touchAction: "none" }}
    >
      {slots.map((s, i) => {
        const live =
          dragRef.current && dragRef.current.idx === s.index
            ? dragRef.current.pos
            : s.pos;
        const color = puckColors[s.index % puckColors.length];
        return (
          <div key={s.index} className="absolute" style={{ left: `${live.left}%`, top: `${live.top}%`, transform: "translate(-50%, -50%)" }}>
            <div
              className="relative w-10 h-10 rounded-full border-4 shadow-2xl flex items-center justify-center font-black text-stone-900 text-sm select-none pointer-events-auto cursor-grab active:cursor-grabbing"
              style={{ background: color, borderColor: "rgba(0,0,0,0.7)", boxShadow: `0 0 0 3px ${color}55, 0 6px 20px rgba(0,0,0,0.5)`, touchAction: "none" }}
              onPointerDown={(e) => onPointerDown(e, s.index, live)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {s.index + 1}
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-black text-white bg-black/70 px-1 rounded whitespace-nowrap">
                {mode === "dock" ? "رسو" : "بحر"}
              </span>
              <button
                type="button"
                onClick={async (ev) => {
                  ev.stopPropagation();
                  await resetSlot(bgId, s.index, mode);
                }}
                className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] font-black text-white bg-red-700 px-1 rounded"
                title="مسح الإعداد"
              >
                ↺
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
