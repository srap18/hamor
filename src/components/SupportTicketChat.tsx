import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Msg = {
  id: string;
  ticket_id: string;
  sender_id: string;
  is_admin: boolean;
  body: string;
  created_at: string;
};

type Props = {
  ticketId: string;
  currentUserId: string;
  asAdmin: boolean;
  ticketOwnerId: string;
};

export function SupportTicketChat({ ticketId, currentUserId, asAdmin, ticketOwnerId }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from("support_ticket_messages")
      .select("id, ticket_id, sender_id, is_admin, body, created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    setLoading(false);
    if (error) return;
    setMessages((data ?? []) as Msg[]);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`ticket-${ticketId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_ticket_messages", filter: `ticket_id=eq.${ticketId}` },
        (payload) => {
          const m = payload.new as Msg;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line
  }, [ticketId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    if (body.length > 4000) { toast.error("الرسالة طويلة جداً"); return; }
    setSending(true);
    const { error } = await supabase.from("support_ticket_messages").insert({
      ticket_id: ticketId,
      sender_id: currentUserId,
      is_admin: asAdmin,
      body,
    });
    setSending(false);
    if (error) { toast.error("تعذر إرسال الرسالة"); return; }
    setDraft("");
    if (asAdmin) {
      // Auto-bump status to in_progress when admin replies
      await supabase.from("support_tickets").update({ status: "in_progress" }).eq("id", ticketId).eq("status", "open");
      // Notify the ticket owner instantly so they know admin replied
      if (ticketOwnerId && ticketOwnerId !== currentUserId) {
        await supabase.from("notifications").insert({
          recipient_id: ticketOwnerId,
          kind: "support_reply",
          title: "🛡️ رد جديد من الإدارة على تذكرتك",
          body: body.length > 140 ? body.slice(0, 137) + "..." : body,
          meta: { ticket_id: ticketId },
        });
      }
    }
  };

  return (
    <div className="rounded-lg bg-slate-950/60 border border-slate-700 overflow-hidden">
      <div ref={scrollRef} className="max-h-72 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="text-center text-xs text-slate-500 py-4">جاري التحميل...</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-xs text-slate-500 py-4">لا توجد رسائل بعد — ابدأ المحادثة</div>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === currentUserId;
            const fromAdmin = m.is_admin;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words border ${
                    mine
                      ? "bg-amber-600/30 border-amber-500/40 text-amber-50"
                      : fromAdmin
                      ? "bg-emerald-700/30 border-emerald-600/40 text-emerald-50"
                      : "bg-slate-800/80 border-slate-700 text-slate-100"
                  }`}
                >
                  <div className="text-[9px] opacity-70 mb-0.5">
                    {fromAdmin ? "🛡️ الإدارة" : m.sender_id === ticketOwnerId ? "👤 اللاعب" : "👤"} ·{" "}
                    {new Date(m.created_at).toLocaleString("ar")}
                  </div>
                  {m.body}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="flex gap-2 p-2 border-t border-slate-800 bg-slate-900/60">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          rows={1}
          placeholder="اكتب رسالتك..."
          className="flex-1 px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-xs resize-none"
        />
        <button
          onClick={send}
          disabled={sending || !draft.trim()}
          className="text-xs px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold disabled:opacity-50"
        >
          إرسال
        </button>
      </div>
    </div>
  );
}
