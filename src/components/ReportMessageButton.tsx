import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Kind = "chat" | "ad_bomb" | "destroyer";

type Props = {
  reportedUserId: string;
  kind: Kind;
  messageBody: string;
  sourceId?: string | null;
  className?: string;
  label?: string;
  compact?: boolean;
};

/**
 * Small "flag" button that lets a player report a chat message, an ad-bomb, or
 * a destroyer message. Opens a lightweight modal to enter an optional reason
 * and inserts a row into public.message_reports (RLS prevents self-report and
 * banned reporters).
 */
export function ReportMessageButton({
  reportedUserId,
  kind,
  messageBody,
  sourceId,
  className,
  label,
  compact,
}: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async () => {
    setSending(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setSending(false);
      toast.error("لازم تسجل دخول أولاً");
      return;
    }
    if (u.user.id === reportedUserId) {
      setSending(false);
      toast.error("ما تقدر تبلّغ على نفسك");
      return;
    }
    const { error } = await (supabase as any).rpc("submit_message_report", {
      _reported_user_id: reportedUserId,
      _kind: kind,
      _source_id: sourceId ?? null,
      _message_body: (messageBody || "").slice(0, 2000),
      _reason: reason.trim().slice(0, 400) || null,
    });
    setSending(false);
    if (error) {
      if (/already_reported|duplicate|unique/i.test(error.message)) {
        toast.error("⚠️ سبق إن أرسلت بلاغ على نفس الرسالة، بلاغك قيد المراجعة");
      } else if (/reports_disabled|row-level|violat/i.test(error.message)) {
        toast.error("تم إيقاف قدرتك على البلاغات من قِبل الإدارة");
      } else {
        toast.error("تعذّر إرسال البلاغ");
      }
      return;
    }
    toast.success("✅ تم إرسال البلاغ للإدارة");
    setReason("");
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={
          className ??
          (compact
            ? "shrink-0 w-8 h-8 rounded-full bg-red-500/20 hover:bg-red-500/40 active:scale-95 flex items-center justify-center text-red-200 text-sm border border-red-400/40"
            : "px-2 py-1 rounded-full bg-red-600/70 hover:bg-red-600 text-white text-[11px] font-bold active:scale-95")
        }
        title="إبلاغ عن هذه الرسالة"
        aria-label="إبلاغ"
      >
        {label ?? "🚩"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !sending && setOpen(false)}
        >
          <div
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-slate-900 border border-red-500/40 p-4 shadow-2xl"
          >
            <div className="text-red-200 font-extrabold text-base mb-2">🚩 إبلاغ عن رسالة</div>
            <div className="text-[11px] text-slate-400 mb-2">
              النوع: {kind === "chat" ? "رسالة شات" : kind === "ad_bomb" ? "قنبلة إعلانية" : "رسالة مفجّر"}
            </div>
            <div className="rounded-lg bg-slate-950/60 border border-slate-700 p-2 text-xs text-slate-200 max-h-28 overflow-y-auto whitespace-pre-wrap break-words mb-2">
              {messageBody || <span className="text-slate-500">— بدون نص —</span>}
            </div>
            <label className="block text-[11px] text-slate-300 mb-1">سبب البلاغ (اختياري)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={400}
              placeholder="مثلاً: شتيمة / إعلان / تحرّش..."
              className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-xs resize-none text-slate-100"
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setOpen(false)}
                disabled={sending}
                className="flex-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                onClick={submit}
                disabled={sending}
                className="flex-1 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-extrabold disabled:opacity-50"
              >
                {sending ? "..." : "🚩 إرسال البلاغ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
