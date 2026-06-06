import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { supabase } from "@/integrations/supabase/client";

type Position = { left?: string; top?: string; right?: string; width?: string; height?: string };

type Ctx = {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  signedIn: boolean;
  positions: Record<string, Position>;
  setPosition: (key: string, p: Position) => void;
  resetAll: () => Promise<void>;
};

const EditCtx = createContext<Ctx | null>(null);

export function AdminLayoutEditorProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [userId, setUserId] = useState<string | null>(null);

  // Track signed-in user (each player has their own layout).
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setUserId(data.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  // Load this user's saved layout whenever the user changes.
  useEffect(() => {
    if (!userId) { setPositions({}); setEnabled(false); return; }
    let cancelled = false;
    supabase
      .from("user_layout")
      .select("key,position")
      .then(({ data }) => {
        if (cancelled || !data) return;
        const map: Record<string, Position> = {};
        for (const row of data as any[]) map[row.key] = row.position;
        setPositions(map);
      });
    return () => { cancelled = true; };
  }, [userId]);

  // Allow opening edit mode from anywhere (Settings modal dispatches this).
  useEffect(() => {
    const open = () => { if (userId) setEnabled(true); };
    window.addEventListener("open-layout-editor", open);
    return () => window.removeEventListener("open-layout-editor", open);
  }, [userId]);

  const setPosition = (key: string, p: Position) => {
    if (!userId) return;
    setPositions((prev) => ({ ...prev, [key]: p }));
    supabase
      .from("user_layout")
      .upsert({ user_id: userId, key, position: p, updated_at: new Date().toISOString() })
      .then(() => {});
  };

  const resetAll = async () => {
    if (!userId) return;
    setPositions({});
    await supabase.from("user_layout").delete().eq("user_id", userId);
  };

  return (
    <EditCtx.Provider value={{ enabled, setEnabled, signedIn: !!userId, positions, setPosition, resetAll }}>
      {children}
    </EditCtx.Provider>
  );
}

export function useAdminLayoutEditor() {
  const ctx = useContext(EditCtx);
  if (!ctx) throw new Error("AdminLayoutEditorProvider missing");
  return ctx;
}

/** Floating toolbar — shown only while edit mode is on. */
export function AdminEditToggle() {
  const { enabled, setEnabled, signedIn, resetAll } = useAdminLayoutEditor();
  if (!signedIn || !enabled) return null;
  return (
    <div className="fixed z-[80] left-2 bottom-24 flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setEnabled(false)}
        className="px-2.5 py-1.5 rounded-lg border-2 text-[10px] font-extrabold shadow-xl active:scale-95 bg-emerald-600 border-emerald-200 text-white"
      >
        ✓ حفظ وإنهاء
      </button>
      <button
        type="button"
        onClick={async () => {
          if (!confirm("إرجاع جميع الأيقونات لمكانها الافتراضي؟")) return;
          await resetAll();
        }}
        className="px-2.5 py-1.5 rounded-lg border-2 text-[10px] font-extrabold shadow-xl active:scale-95 bg-stone-900/90 border-amber-400/60 text-amber-200"
      >
        ↺ إعادة افتراضي
      </button>
    </div>
  );
}

/**
 * Wraps a positioned child. When edit mode is on, the child becomes
 * draggable & resizable; otherwise it renders untouched.
 */
export function Placeable({
  id,
  defaultStyle,
  children,
}: {
  id: string;
  defaultStyle: Position;
  children: (style: CSSProperties) => ReactNode;
}) {
  const { enabled, signedIn, positions, setPosition } = useAdminLayoutEditor();
  const stored = positions[id];
  const pos: Position = { ...defaultStyle, ...stored };
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseLeft: number; baseTop: number; parentW: number; parentH: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; baseW: number; baseH: number; parentW: number; parentH: number } | null>(null);

  const editing = signedIn && enabled;

  const onPointerDownDrag = (e: React.PointerEvent) => {
    if (!editing) return;
    e.stopPropagation();
    const el = wrapRef.current?.parentElement;
    if (!el) return;
    const parent = el.getBoundingClientRect();
    const rect = wrapRef.current!.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseLeft: ((rect.left - parent.left) / parent.width) * 100,
      baseTop: ((rect.top - parent.top) / parent.height) * 100,
      parentW: parent.width,
      parentH: parent.height,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMoveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = ((e.clientX - d.startX) / d.parentW) * 100;
    const dy = ((e.clientY - d.startY) / d.parentH) * 100;
    const left = Math.max(0, Math.min(95, d.baseLeft + dx));
    const top = Math.max(0, Math.min(95, d.baseTop + dy));
    if (wrapRef.current) {
      wrapRef.current.style.left = `${left}%`;
      wrapRef.current.style.top = `${top}%`;
      wrapRef.current.style.right = "auto";
    }
  };
  const onPointerUpDrag = (_e: React.PointerEvent) => {
    if (!dragRef.current || !wrapRef.current) return;
    dragRef.current = null;
    const left = wrapRef.current.style.left;
    const top = wrapRef.current.style.top;
    setPosition(id, { ...pos, left, top, right: undefined });
  };

  const onPointerDownResize = (e: React.PointerEvent) => {
    if (!editing) return;
    e.stopPropagation();
    const el = wrapRef.current?.parentElement;
    if (!el || !wrapRef.current) return;
    const parent = el.getBoundingClientRect();
    const rect = wrapRef.current.getBoundingClientRect();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseW: (rect.width / parent.width) * 100,
      baseH: (rect.height / parent.height) * 100,
      parentW: parent.width,
      parentH: parent.height,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMoveResize = (e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r || !wrapRef.current) return;
    const dx = ((e.clientX - r.startX) / r.parentW) * 100;
    const dy = ((e.clientY - r.startY) / r.parentH) * 100;
    const width = Math.max(5, Math.min(80, r.baseW + dx));
    const height = Math.max(4, Math.min(60, r.baseH + dy));
    wrapRef.current.style.width = `${width}%`;
    wrapRef.current.style.height = `${height}%`;
  };
  const onPointerUpResize = (_e: React.PointerEvent) => {
    if (!resizeRef.current || !wrapRef.current) return;
    resizeRef.current = null;
    setPosition(id, {
      ...pos,
      width: wrapRef.current.style.width,
      height: wrapRef.current.style.height,
    });
  };

  if (!editing) {
    return <>{children(pos as CSSProperties)}</>;
  }

  return (
    <div
      ref={wrapRef}
      className="absolute z-[70] outline outline-2 outline-amber-300 outline-dashed cursor-move"
      style={pos as CSSProperties}
      onPointerDown={onPointerDownDrag}
      onPointerMove={onPointerMoveDrag}
      onPointerUp={onPointerUpDrag}
    >
      <div className="absolute -top-5 left-0 text-[10px] font-extrabold text-amber-200 bg-stone-900/90 px-1.5 py-0.5 rounded">
        {id}
      </div>
      <div className="absolute inset-0 pointer-events-none">
        {children({ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, width: "100%", height: "100%" })}
      </div>
      {/* Click-shield: intercepts taps so child buttons don't navigate while editing */}
      <div
        className="absolute inset-0 z-[5]"
        style={{ pointerEvents: "auto" }}
        onClickCapture={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onPointerDown={onPointerDownDrag}
        onPointerMove={onPointerMoveDrag}
        onPointerUp={onPointerUpDrag}
      />
      <div
        className="absolute -right-1 -bottom-1 w-4 h-4 rounded bg-amber-300 border-2 border-amber-900 cursor-se-resize z-[10]"
        onPointerDown={onPointerDownResize}
        onPointerMove={onPointerMoveResize}
        onPointerUp={onPointerUpResize}
        title="تغيير الحجم"
      />
    </div>
  );
}
