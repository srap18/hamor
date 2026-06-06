import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { useIsAdmin } from "@/hooks/use-admin";
import { supabase } from "@/integrations/supabase/client";

type Position = { left?: string; top?: string; right?: string; width?: string; height?: string };

type Ctx = {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  isAdmin: boolean;
  positions: Record<string, Position>;
  setPosition: (key: string, p: Position) => void;
};

const EditCtx = createContext<Ctx | null>(null);

export function AdminLayoutEditorProvider({ children }: { children: ReactNode }) {
  const { isAdmin } = useIsAdmin();
  const [enabled, setEnabled] = useState(false);
  const [positions, setPositions] = useState<Record<string, Position>>({});

  useEffect(() => {
    let cancelled = false;
    supabase.from("site_layout").select("key,position").then(({ data }) => {
      if (cancelled || !data) return;
      const map: Record<string, Position> = {};
      for (const row of data as any[]) map[row.key] = row.position;
      setPositions(map);
    });
    const ch = supabase
      .channel("site_layout_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "site_layout" }, (payload: any) => {
        const row = payload.new || payload.old;
        if (!row?.key) return;
        setPositions((prev) => {
          const next = { ...prev };
          if (payload.eventType === "DELETE") delete next[row.key];
          else next[row.key] = payload.new.position;
          return next;
        });
      })
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, []);

  const setPosition = (key: string, p: Position) => {
    setPositions((prev) => ({ ...prev, [key]: p }));
    // fire-and-forget — RLS enforces admin-only writes
    supabase.from("site_layout").upsert({ key, position: p, updated_at: new Date().toISOString() }).then(() => {});
  };

  return (
    <EditCtx.Provider value={{ enabled, setEnabled, isAdmin, positions, setPosition }}>
      {children}
    </EditCtx.Provider>
  );
}

export function useAdminLayoutEditor() {
  const ctx = useContext(EditCtx);
  if (!ctx) throw new Error("AdminLayoutEditorProvider missing");
  return ctx;
}

/** Floating toggle button — visible only for admins. */
export function AdminEditToggle() {
  const { isAdmin, enabled, setEnabled } = useAdminLayoutEditor();
  if (!isAdmin) return null;
  return (
    <button
      type="button"
      onClick={() => setEnabled(!enabled)}
      className={`fixed z-[80] left-2 bottom-24 px-2.5 py-1.5 rounded-lg border-2 text-[10px] font-extrabold shadow-xl active:scale-95 ${
        enabled
          ? "bg-rose-600 border-rose-200 text-white"
          : "bg-stone-900/90 border-amber-400/60 text-amber-200"
      }`}
      title="وضع تعديل المواقع (مسؤول)"
    >
      {enabled ? "✕ إنهاء التعديل" : "✎ تعديل المواقع"}
    </button>
  );
}

/**
 * Wraps a positioned child (typically style absolute via parent). Renders a
 * positioned container the child must fill via 100% width/height styling.
 * When admin edit mode is on, the container becomes draggable & resizable.
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
  const { enabled, isAdmin, positions, setPosition } = useAdminLayoutEditor();
  const stored = positions[id];
  const pos: Position = { ...defaultStyle, ...stored };
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseLeft: number; baseTop: number; parentW: number; parentH: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; baseW: number; baseH: number; parentW: number; parentH: number } | null>(null);

  const editing = isAdmin && enabled;

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
  const onPointerUpDrag = (e: React.PointerEvent) => {
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
  const onPointerUpResize = (e: React.PointerEvent) => {
    if (!resizeRef.current || !wrapRef.current) return;
    resizeRef.current = null;
    setPosition(id, {
      ...pos,
      width: wrapRef.current.style.width,
      height: wrapRef.current.style.height,
    });
  };

  // When NOT editing, just render the child directly with merged style (no extra wrapper).
  if (!editing) {
    return <>{children(pos as CSSProperties)}</>;
  }

  // Editing mode — wrap child in an absolutely positioned outline with handles.
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
        {id} — {pos.left} / {pos.top}
      </div>
      {/* Child fills wrapper */}
      <div className="absolute inset-0 pointer-events-none">
        {children({ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, width: "100%", height: "100%" })}
      </div>
      {/* Resize handle bottom-right */}
      <div
        className="absolute -right-1 -bottom-1 w-4 h-4 rounded bg-amber-300 border-2 border-amber-900 cursor-se-resize"
        onPointerDown={onPointerDownResize}
        onPointerMove={onPointerMoveResize}
        onPointerUp={onPointerUpResize}
        title="تغيير الحجم"
      />
    </div>
  );
}
