import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sound } from "@/lib/sound";
import { ReportMessageButton } from "@/components/ReportMessageButton";
import woodenSignAsset from "@/assets/wooden-sign-v2.png.asset.json";
import { useSignPos, saveSignPos, type SignPos } from "@/lib/sign-slot-editor";
import { useShipSlotEditor } from "@/lib/ship-slot-editor";

type SignMsg = {
  id: string;
  attacker_id: string;
  attacker_name: string | null;
  kind: string;
  message: string;
  created_at: string;
};

type Props = {
  /** Defender's user id (ocean owner). */
  playerId: string;
  /** Latest destroyer's avatar (optional, falls back to emoji). */
  destroyerAvatar?: string | null;
  /** Latest destroyer's emoji fallback. */
  destroyerEmoji?: string | null;
  /** Current background id — used to store per-background sign position. */
  bgId?: string;
  /** Position of the sign within the parent (absolute). Overrides the stored per-bg position. */
  style?: React.CSSProperties;
};

/**
 * Shows the wooden sign + parchment scroll of destroyer messages for `playerId`.
 * Used both on the visitor's profile view and on the owner's own home so they
 * can read the same taunts left on their ocean.
 */
export function DestroyerSign({ playerId, destroyerAvatar, destroyerEmoji, bgId, style }: Props) {
  const [messages, setMessages] = useState<SignMsg[]>([]);
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const pos = useSignPos(bgId);
  const { isAdmin, enabled: editEnabled } = useShipSlotEditor();
  const canEdit = isAdmin && editEnabled && !!bgId;
  const btnRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseLeft: number; baseTop: number; parentW: number; parentH: number; pos: SignPos; moved: boolean } | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    if (!playerId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await (supabase as never as {
          rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: SignMsg[] | null }>;
        }).rpc("get_destroyer_messages", { _defender_id: playerId });
        if (!cancelled) {
          setMessages((data || []) as SignMsg[]);
          setIdx(0);
        }
      } catch {
        if (!cancelled) setMessages([]);
      }
    };
    load();

    // Realtime: when a new attack/message is recorded against this defender,
    // refresh so the owner sees it appear without reloading.
    const ch = supabase
      .channel(`destroyer-sign:${playerId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attacks", filter: `defender_id=eq.${playerId}` },
        () => load(),
      )
      .subscribe();

    return () => { cancelled = true; void supabase.removeChannel(ch); };
  }, [playerId]);

  if (messages.length === 0) return null;

  const cur = messages[Math.min(idx, messages.length - 1)];
  const total = messages.length;
  const safeIdx = Math.min(idx, total - 1);
  const canPrev = safeIdx < total - 1;
  const canNext = safeIdx > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => { sound.play("click"); setIdx(0); setOpen(true); }}
        className="absolute z-30 active:scale-95 transition-transform"
        style={{ top: "62%", left: "30%", width: "9%", filter: "drop-shadow(0 6px 8px rgba(0,0,0,0.7))", ...style }}
        aria-label="رسائل المفجّرين"
      >
        <div className="relative w-full" style={{ aspectRatio: "1024 / 1536" }}>
          <img src={woodenSignAsset.url} alt="" className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none" draggable={false} />
          <div className="absolute" style={{ top: "26%", left: "50%", transform: "translateX(-50%)", width: "46%", aspectRatio: "1 / 1" }}>
            <div className="relative w-full h-full rounded-full overflow-hidden ring-2 ring-amber-950 shadow-md bg-amber-100">
              {destroyerAvatar ? (
                <img src={destroyerAvatar} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[10px]">{destroyerEmoji || "🧙"}</div>
              )}
            </div>
          </div>
          <div
            className="absolute text-amber-100 font-extrabold text-center bg-red-900/90 rounded-full px-1 border border-amber-300/60 shadow"
            style={{ top: "58%", left: "20%", right: "20%", fontSize: "0.4rem" }}
          >
            {total > 1 ? total : "☢️"}
          </div>
        </div>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="relative w-full max-w-sm" onClick={(e) => e.stopPropagation()} dir="rtl">
            <div
              className="relative w-full rounded-[14px] p-5 pb-12"
              style={{
                background: "radial-gradient(ellipse at center, #f5ecd6 0%, #e8d9b3 70%, #c9b78a 100%)",
                boxShadow: "0 0 0 6px #1a0e08, 0 0 0 8px #3a2418, 0 20px 40px rgba(0,0,0,0.7)",
                border: "2px solid #6b4423",
                clipPath:
                  "polygon(0% 4%, 3% 0%, 8% 3%, 14% 1%, 22% 4%, 30% 0%, 38% 3%, 48% 1%, 58% 4%, 68% 0%, 78% 3%, 88% 1%, 96% 4%, 100% 8%, 98% 18%, 100% 30%, 97% 42%, 100% 56%, 98% 70%, 100% 82%, 97% 92%, 92% 100%, 82% 97%, 70% 100%, 56% 97%, 42% 100%, 30% 97%, 18% 100%, 8% 97%, 2% 92%, 0% 80%, 3% 68%, 0% 54%, 2% 40%, 0% 28%, 3% 16%)",
              }}
            >
              <button
                onClick={() => setOpen(false)}
                className="absolute -top-2 -left-2 w-10 h-10 rounded-full flex items-center justify-center text-white text-xl font-black shadow-lg active:scale-95 z-10"
                style={{ background: "radial-gradient(circle at 30% 30%, #c97a3a, #6b3a18)", border: "2px solid #2a1408" }}
                aria-label="إغلاق"
              >
                ✕
              </button>

              <div className="text-center text-stone-900 font-extrabold text-lg mb-4 mt-1">
                {cur.attacker_name || "لاعب"}
              </div>

              <div className="flex items-center gap-2 min-h-[140px]">
                <button
                  onClick={() => { if (canPrev) { sound.play("click"); setIdx(safeIdx + 1); } }}
                  disabled={!canPrev}
                  className="shrink-0 w-8 h-10 text-stone-800 disabled:opacity-30 active:scale-95 text-2xl"
                  aria-label="السابق"
                >◀</button>
                <div className="flex-1 text-center text-stone-900 font-bold leading-relaxed px-1 whitespace-pre-wrap break-words" style={{ fontSize: "1rem" }}>
                  {cur.message}
                </div>
                <button
                  onClick={() => { if (canNext) { sound.play("click"); setIdx(safeIdx - 1); } }}
                  disabled={!canNext}
                  className="shrink-0 w-8 h-10 text-stone-800 disabled:opacity-30 active:scale-95 text-2xl"
                  aria-label="التالي"
                >▶</button>
              </div>

              <div className="absolute bottom-3 left-5 right-5 flex items-center justify-between text-stone-800 text-xs font-bold">
                <span dir="ltr">
                  {new Date(cur.created_at).toLocaleString("ar", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span>{safeIdx + 1}/{total}</span>
                <ReportMessageButton
                  reportedUserId={cur.attacker_id}
                  kind="destroyer"
                  messageBody={cur.message}
                  sourceId={cur.id}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
