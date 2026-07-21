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
  _pending?: boolean;
};

type Props = {
  ticketId: string;
  currentUserId: string;
  asAdmin: boolean;
  ticketOwnerId: string;
};

const IMG_TAG_RE = /\[IMG:([^\]]+)\]/;

export function SupportTicketChat({ ticketId, currentUserId, asAdmin, ticketOwnerId }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshSignedUrls = async (msgs: Msg[]) => {
    const paths = Array.from(new Set(
      msgs.map((m) => m.body.match(IMG_TAG_RE)?.[1]).filter(Boolean) as string[]
    )).filter((p) => !signedUrls[p]);
    if (paths.length === 0) return;
    const { data } = await supabase.storage.from("support-tickets").createSignedUrls(paths, 3600);
    const map: Record<string, string> = {};
    data?.forEach((s) => { if (s.path && s.signedUrl) map[s.path] = s.signedUrl; });
    if (Object.keys(map).length) setSignedUrls((prev) => ({ ...prev, ...map }));
  };

  const load = async () => {
    const { data, error } = await supabase
      .from("support_ticket_messages")
      .select("id, ticket_id, sender_id, is_admin, body, created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    setLoading(false);
    if (error) return;
    const rows = (data ?? []) as Msg[];
    setMessages(rows);
    refreshSignedUrls(rows);
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
          setMessages((prev) => {
            // Replace optimistic (pending) sibling from same sender with same body if present.
            const idx = prev.findIndex((x) => x._pending && x.sender_id === m.sender_id && x.body === m.body);
            if (idx >= 0) {
              const next = prev.slice();
              next[idx] = m;
              return next;
            }
            if (prev.some((x) => x.id === m.id)) return prev;
            return [...prev, m];
          });
          refreshSignedUrls([m]);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line
  }, [ticketId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Instant on first paint, smooth after.
    el.scrollTo({ top: el.scrollHeight, behavior: messages.length <= 1 ? "auto" : "smooth" });
  }, [messages.length]);

  const doSend = async (body: string) => {
    const optimisticId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        ticket_id: ticketId,
        sender_id: currentUserId,
        is_admin: asAdmin,
        body,
        created_at: new Date().toISOString(),
        _pending: true,
      },
    ]);
    const { error } = await supabase.from("support_ticket_messages").insert({
      ticket_id: ticketId,
      sender_id: currentUserId,
      is_admin: asAdmin,
      body,
    });
    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      toast.error("تعذّر إرسال الرسالة");
      return false;
    }
    if (asAdmin) {
      supabase.from("support_tickets").update({ status: "in_progress" }).eq("id", ticketId).eq("status", "open").then(() => {});
      if (ticketOwnerId && ticketOwnerId !== currentUserId) {
        supabase.from("notifications").insert({
          recipient_id: ticketOwnerId,
          kind: "support_reply",
          title: "🛡️ رد جديد من الإدارة على تذكرتك",
          body: body.length > 140 ? body.slice(0, 137) + "..." : body,
          meta: { ticket_id: ticketId },
        } as never).then(() => {});
      }
    }
    return true;
  };

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    if (body.length > 4000) { toast.error("الرسالة طويلة جداً"); return; }
    setSending(true);
    setDraft("");
    await doSend(body);
    setSending(false);
  };

  const pickImage = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("الرجاء اختيار صورة"); return; }
    if (file.size > 8 * 1024 * 1024) { toast.error("الصورة أكبر من 8MB"); return; }
    setUploading(true);
    const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `tickets/${ticketId}/${currentUserId}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("support-tickets").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    });
    setUploading(false);
    if (upErr) { toast.error("فشل رفع الصورة"); return; }
    await doSend(`[IMG:${path}]`);
  };

  return (
    <div className="rounded-lg bg-slate-950/70 border border-slate-700 overflow-hidden flex flex-col">
      <div ref={scrollRef} className="max-h-80 min-h-40 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="text-center text-xs text-slate-500 py-4">جاري التحميل...</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-xs text-slate-500 py-4">لا توجد رسائل بعد — ابدأ المحادثة</div>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === currentUserId;
            const fromAdmin = m.is_admin;
            const imgMatch = m.body.match(IMG_TAG_RE);
            const imgPath = imgMatch?.[1];
            const url = imgPath ? signedUrls[imgPath] : null;
            const textOnly = imgPath ? m.body.replace(IMG_TAG_RE, "").trim() : m.body;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words border transition ${
                    mine
                      ? "bg-amber-600/30 border-amber-500/40 text-amber-50"
                      : fromAdmin
                      ? "bg-emerald-700/30 border-emerald-600/40 text-emerald-50"
                      : "bg-slate-800/80 border-slate-700 text-slate-100"
                  } ${m._pending ? "opacity-60" : ""}`}
                >
                  <div className="text-[9px] opacity-70 mb-1 flex items-center gap-1">
                    <span>{fromAdmin ? "🛡️ الإدارة" : m.sender_id === ticketOwnerId ? "👤 اللاعب" : "👤"}</span>
                    <span>·</span>
                    <span>{new Date(m.created_at).toLocaleString("ar")}</span>
                    {m._pending && <span className="text-amber-300">· يُرسل...</span>}
                  </div>
                  {imgPath && (
                    url ? (
                      <a href={url} target="_blank" rel="noreferrer" className="block">
                        <img src={url} alt="مرفق" className="rounded-lg border border-slate-700 max-h-64 mb-1" />
                      </a>
                    ) : (
                      <div className="text-[10px] italic opacity-70 mb-1">📎 جاري تحميل الصورة...</div>
                    )
                  )}
                  {textOnly && <div>{textOnly}</div>}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="flex items-end gap-2 p-2 border-t border-slate-800 bg-slate-900/70">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        <button
          type="button"
          onClick={pickImage}
          disabled={uploading}
          title="إرفاق صورة"
          className="shrink-0 text-base px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50"
        >{uploading ? "⏳" : "📷"}</button>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          rows={1}
          placeholder="اكتب رسالتك... (Enter للإرسال)"
          className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs resize-none focus:outline-none focus:border-amber-500 min-h-9 max-h-32"
        />
        <button
          onClick={send}
          disabled={sending || !draft.trim()}
          className="shrink-0 text-xs px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold disabled:opacity-50"
        >إرسال</button>
      </div>
    </div>
  );
}
