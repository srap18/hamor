import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { BackButton } from "@/components/BackButton";
import { SupportTicketChat } from "@/components/SupportTicketChat";


export const Route = createFileRoute("/support")({
  component: SupportPage,
  ssr: false,
  head: () => ({
    meta: [{ title: "الدعم الفني — تذاكر المساعدة" }],
  }),
});

const CATEGORIES: Array<{ value: string; label: string; icon: string }> = [
  { value: "bug", label: "مشكلة / خطأ في اللعبة", icon: "🐛" },
  { value: "player_report", label: "بلاغ على لاعب", icon: "🚨" },
  { value: "payment", label: "مشكلة دفع أو شراء", icon: "💳" },
  { value: "account", label: "مشكلة في الحساب", icon: "👤" },
  { value: "suggestion", label: "اقتراح", icon: "💡" },
  { value: "other", label: "أخرى", icon: "📝" },
];

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  open: { label: "مفتوحة", color: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
  in_progress: { label: "قيد المعالجة", color: "bg-sky-500/20 text-sky-300 border-sky-500/40" },
  closed: { label: "مغلقة", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
};

type Ticket = {
  id: string;
  category: string;
  subject: string;
  message: string;
  image_path: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function SupportPage() {
  const nav = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const [category, setCategory] = useState<string>("bug");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!authLoading && !session) nav({ to: "/login" });
  }, [authLoading, session, nav]);

  const loadTickets = async () => {
    if (!session) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("support_tickets")
      .select("id, category, subject, message, image_path, status, admin_note, created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) { toast.error("تعذر تحميل التذاكر"); return; }
    setTickets((data ?? []) as Ticket[]);
    const paths = (data ?? []).map((t: any) => t.image_path).filter(Boolean) as string[];
    if (paths.length) {
      const { data: signed } = await supabase.storage.from("support-tickets").createSignedUrls(paths, 3600);
      const map: Record<string, string> = {};
      signed?.forEach((s) => { if (s.path && s.signedUrl) map[s.path] = s.signedUrl; });
      setSignedUrls(map);
    }
  };

  useEffect(() => { if (session) loadTickets(); /* eslint-disable-next-line */ }, [session?.user.id]);

  const onPickFile = (f: File | null) => {
    if (!f) { setFile(null); setPreview(null); return; }
    if (!f.type.startsWith("image/")) { toast.error("الرجاء اختيار صورة فقط"); return; }
    if (f.size > MAX_IMAGE_BYTES) { toast.error("حجم الصورة يجب أن يكون أقل من 5 ميجا"); return; }
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    const sub = subject.trim();
    const msg = message.trim();
    if (sub.length < 3) { toast.error("الرجاء كتابة عنوان واضح"); return; }
    if (msg.length < 10) { toast.error("الرجاء كتابة وصف لا يقل عن 10 أحرف"); return; }
    // Block more than one open ticket per user
    const { count: openCount } = await supabase
      .from("support_tickets")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.user.id)
      .in("status", ["open", "in_progress"]);
    if ((openCount ?? 0) > 0) {
      toast.error("لديك تذكرة مفتوحة بالفعل — انتظر إغلاقها قبل فتح تذكرة جديدة");
      return;
    }
    setSubmitting(true);
    try {
      let imagePath: string | null = null;
      if (file) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
        const path = `${session.user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("support-tickets").upload(path, file, {
          contentType: file.type,
          upsert: false,
        });
        if (upErr) throw upErr;
        imagePath = path;
      }
      const { error } = await supabase.from("support_tickets").insert({
        user_id: session.user.id,
        category,
        subject: sub,
        message: msg,
        image_path: imagePath,
      });
      if (error) throw error;
      toast.success("تم إرسال التذكرة بنجاح");
      setSubject(""); setMessage(""); setFile(null);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
      await loadTickets();
    } catch (err: any) {
      toast.error(err?.message ?? "تعذر إرسال التذكرة");
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || !session) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-200">جاري التحميل...</div>;
  }

  return (
    <div dir="rtl" className="min-h-screen bg-slate-950 text-slate-100 pb-[200px]">
      <header className="sticky top-0 z-20 bg-slate-900/90 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center gap-3">
        <BackButton className="text-xs px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700">← رجوع</BackButton>
        <h1 className="text-lg font-bold">🛟 الدعم الفني</h1>
      </header>

      <div className="max-w-2xl mx-auto p-4 space-y-6">
        {/* New Ticket Form */}
        <form onSubmit={submit} className="rounded-2xl bg-slate-900/70 border border-slate-800 p-4 space-y-4">
          <div className="text-base font-bold text-amber-300">إنشاء تذكرة جديدة</div>

          <div>
            <label className="text-xs text-slate-300 mb-2 block">نوع البلاغ</label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((c) => (
                <button
                  type="button"
                  key={c.value}
                  onClick={() => setCategory(c.value)}
                  className={`p-2.5 rounded-lg text-xs font-bold border text-right transition ${
                    category === c.value
                      ? "bg-amber-500/20 border-amber-400 text-amber-200"
                      : "bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <span className="ml-1">{c.icon}</span>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-300 mb-1 block">العنوان</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder="اكتب عنوان مختصر للمشكلة"
              className="w-full px-3 py-2 rounded-lg bg-slate-800/80 border border-slate-700 text-sm focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-300 mb-1 block">التفاصيل</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              maxLength={4000}
              placeholder="اشرح المشكلة بالتفصيل..."
              className="w-full px-3 py-2 rounded-lg bg-slate-800/80 border border-slate-700 text-sm focus:outline-none focus:border-amber-500 resize-y"
            />
            <div className="text-[10px] text-slate-500 mt-1 text-left">{message.length}/4000</div>
          </div>

          <div>
            <label className="text-xs text-slate-300 mb-1 block">إرفاق صورة (اختياري — حد أقصى 5MB)</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              className="w-full text-xs text-slate-300 file:ml-2 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-amber-600 file:text-white file:font-bold file:cursor-pointer"
            />
            {preview && (
              <div className="mt-2 relative inline-block">
                <img src={preview} alt="معاينة" className="max-h-40 rounded-lg border border-slate-700" />
                <button
                  type="button"
                  onClick={() => onPickFile(null)}
                  className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full w-6 h-6 text-xs"
                >✕</button>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-lg bg-gradient-to-b from-amber-500 to-amber-700 text-white font-bold disabled:opacity-50 active:scale-95"
          >
            {submitting ? "جاري الإرسال..." : "إرسال التذكرة"}
          </button>
        </form>

        {/* My Tickets */}
        <div className="rounded-2xl bg-slate-900/70 border border-slate-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-base font-bold text-amber-300">تذاكري السابقة</div>
            <button onClick={loadTickets} className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700">🔄 تحديث</button>
          </div>
          {loading ? (
            <div className="text-center text-slate-400 py-6 text-sm">جاري التحميل...</div>
          ) : tickets.length === 0 ? (
            <div className="text-center text-slate-500 py-6 text-sm">لا توجد تذاكر بعد</div>
          ) : (
            <div className="space-y-3">
              {tickets.map((t) => {
                const cat = CATEGORIES.find((c) => c.value === t.category);
                const st = STATUS_LABEL[t.status] ?? STATUS_LABEL.open;
                return (
                  <div key={t.id} className="rounded-lg bg-slate-800/50 border border-slate-700 p-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="text-sm font-bold">{cat?.icon} {t.subject}</div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${st.color}`}>{st.label}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mb-2">{cat?.label} · {new Date(t.created_at).toLocaleString("ar")}</div>
                    <div className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">{t.message}</div>
                    {t.image_path && signedUrls[t.image_path] && (
                      <a href={signedUrls[t.image_path]} target="_blank" rel="noreferrer">
                        <img src={signedUrls[t.image_path]} alt="مرفق" className="mt-2 max-h-40 rounded border border-slate-700" />
                      </a>
                    )}
                    {t.admin_note && (
                      <div className="mt-2 p-2 rounded bg-emerald-900/30 border border-emerald-700/50 text-xs text-emerald-200">
                        <span className="font-bold">📩 رد الإدارة: </span>{t.admin_note}
                      </div>
                    )}
                    {session?.user.id && (
                      <div className="mt-3">
                        <SupportTicketChat
                          ticketId={t.id}
                          currentUserId={session.user.id}
                          asAdmin={false}
                          ticketOwnerId={session.user.id}
                        />
                      </div>
                    )}
                  </div>

                );
              })}
            </div>
          )}
        </div>

        <div className="text-center">
          <Link to="/" className="text-xs text-slate-400 hover:text-slate-200">← العودة للعبة</Link>
        </div>
      </div>
    </div>
  );
}
