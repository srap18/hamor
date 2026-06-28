import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { confirmDialog } from "@/components/ConfirmDialog";
import { SupportTicketChat } from "@/components/SupportTicketChat";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { adminReconcilePaddleForUser } from "@/lib/admin-payments.functions";


export const Route = createFileRoute("/admin/tickets")({
  component: AdminTicketsPage,
  ssr: false,
  head: () => ({ meta: [{ title: "تذاكر الدعم — الإدارة" }] }),
});

const CATEGORIES: Record<string, { label: string; icon: string }> = {
  bug: { label: "مشكلة / خطأ", icon: "🐛" },
  player_report: { label: "بلاغ على لاعب", icon: "🚨" },
  payment: { label: "مشكلة دفع", icon: "💳" },
  account: { label: "مشكلة حساب", icon: "👤" },
  suggestion: { label: "اقتراح", icon: "💡" },
  other: { label: "أخرى", icon: "📝" },
};

const STATUSES = [
  { value: "open", label: "مفتوحة", color: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
  { value: "in_progress", label: "قيد المعالجة", color: "bg-sky-500/20 text-sky-300 border-sky-500/40" },
  { value: "closed", label: "مغلقة", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
];

type Ticket = {
  id: string;
  user_id: string;
  category: string;
  subject: string;
  message: string;
  image_path: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
};

function AdminTicketsPage() {
  const { session } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [profiles, setProfiles] = useState<Record<string, { username: string | null; display_name: string | null }>>({});
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [openChat, setOpenChat] = useState<Record<string, boolean>>({});
  const [reconciling, setReconciling] = useState<Record<string, boolean>>({});
  const reconcileFn = useServerFn(adminReconcilePaddleForUser);

  const reconcileForTicket = async (t: Ticket) => {
    setReconciling((p) => ({ ...p, [t.id]: true }));
    try {
      const res = await reconcileFn({ data: { userId: t.user_id, environment: "live" } }) as { ok?: boolean; grantedCount?: number; reason?: string; skipped?: { id: string; reason: string }[] };
      if (res?.ok === false) {
        toast.error(`فشل: ${res.reason ?? "غير معروف"}`);
      } else if ((res?.grantedCount ?? 0) > 0) {
        toast.success(`✅ تم صرف ${res.grantedCount} عملية للاعب`);
      } else {
        const skipReasons = res?.skipped?.map((s) => s.reason).join(", ") ?? "";
        toast.message("ℹ️ لا توجد عمليات معلقة للصرف", { description: skipReasons || undefined });
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "فشل الصرف");
    } finally {
      setReconciling((p) => ({ ...p, [t.id]: false }));
    }
  };

  const load = async () => {

    setLoading(true);
    const { data, error } = await supabase
      .from("support_tickets")
      .select("id, user_id, category, subject, message, image_path, status, admin_note, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    setLoading(false);
    if (error) { toast.error("تعذر التحميل"); return; }
    const rows = (data ?? []) as Ticket[];
    setTickets(rows);

    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
    if (userIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, username, display_name")
        .in("id", userIds);
      const map: Record<string, { username: string | null; display_name: string | null }> = {};
      profs?.forEach((p: any) => { map[p.id] = { username: p.username, display_name: p.display_name }; });
      setProfiles(map);
    }

    const paths = rows.map((r) => r.image_path).filter(Boolean) as string[];
    if (paths.length) {
      const { data: signed } = await supabase.storage.from("support-tickets").createSignedUrls(paths, 3600);
      const map: Record<string, string> = {};
      signed?.forEach((s) => { if (s.path && s.signedUrl) map[s.path] = s.signedUrl; });
      setSignedUrls(map);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return tickets.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const uname = (profiles[t.user_id]?.username ?? "").toLowerCase();
        if (!t.subject.toLowerCase().includes(q) && !t.message.toLowerCase().includes(q) && !uname.includes(q)) return false;
      }
      return true;
    });
  }, [tickets, statusFilter, categoryFilter, search, profiles]);

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("support_tickets").update({ status }).eq("id", id);
    if (error) { toast.error("فشل التحديث"); return; }
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    toast.success("تم تحديث الحالة");
  };

  const remove = async (t: Ticket) => {

    const ok = await confirmDialog({
      title: "حذف التذكرة",
      message: "سيتم حذف التذكرة والصورة المرفقة نهائياً.",
      confirmText: "حذف",
      danger: true,
    });
    if (!ok) return;
    if (t.image_path) {
      await supabase.storage.from("support-tickets").remove([t.image_path]);
    }
    const { error } = await supabase.from("support_tickets").delete().eq("id", t.id);
    if (error) { toast.error("فشل الحذف"); return; }
    setTickets((prev) => prev.filter((x) => x.id !== t.id));
    toast.success("تم الحذف");
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl md:text-2xl font-bold">🛟 تذاكر الدعم الفني</h1>
        <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700">🔄 تحديث</button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm"
        >
          <option value="all">كل الحالات</option>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm"
        >
          <option value="all">كل الأنواع</option>
          {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        <input
          type="text"
          placeholder="بحث في العنوان/المحتوى/اللاعب"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm"
        />
      </div>

      {loading ? (
        <div className="text-center text-slate-400 py-10">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-slate-500 py-10">لا توجد تذاكر مطابقة</div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-slate-400">إجمالي: {filtered.length} تذكرة</div>
          {filtered.map((t) => {
            const cat = CATEGORIES[t.category] ?? CATEGORIES.other;
            const st = STATUSES.find((s) => s.value === t.status) ?? STATUSES[0];
            const prof = profiles[t.user_id];
            const dn = prof?.display_name?.trim();
            const un = prof?.username?.trim();
            const nameLabel = dn && un ? `${dn} (@${un})` : dn || (un ? `@${un}` : t.user_id.slice(0, 8));
            return (
              <div key={t.id} className="rounded-xl bg-slate-900/70 border border-slate-800 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                  <div>
                    <div className="text-sm font-bold">{cat.icon} {t.subject}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {cat.label} · 👤 {nameLabel} · {new Date(t.created_at).toLocaleString("ar")}
                    </div>
                  </div>
                  <span className={`text-[10px] px-2 py-1 rounded-full border ${st.color}`}>{st.label}</span>
                </div>

                <div className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed mb-3">{t.message}</div>

                {t.image_path && signedUrls[t.image_path] && (
                  <a href={signedUrls[t.image_path]} target="_blank" rel="noreferrer">
                    <img src={signedUrls[t.image_path]} alt="مرفق" className="mb-3 max-h-56 rounded border border-slate-700" />
                  </a>
                )}

                <div className="space-y-2 mb-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-slate-400">💬 محادثة مع اللاعب:</label>
                    <button
                      onClick={() => setOpenChat((p) => ({ ...p, [t.id]: !p[t.id] }))}
                      className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700"
                    >
                      {openChat[t.id] ? "إخفاء" : "فتح المحادثة"}
                    </button>
                  </div>
                  {openChat[t.id] && session?.user.id && (
                    <SupportTicketChat
                      ticketId={t.id}
                      currentUserId={session.user.id}
                      asAdmin={true}
                      ticketOwnerId={t.user_id}
                    />
                  )}
                  {t.admin_note && (
                    <div className="p-2 rounded bg-emerald-900/30 border border-emerald-700/50 text-[11px] text-emerald-200">
                      <span className="font-bold">ملاحظة قديمة: </span>{t.admin_note}
                    </div>
                  )}
                </div>


                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => reconcileForTicket(t)}
                    disabled={!!reconciling[t.id]}
                    className="text-xs px-3 py-1 rounded bg-emerald-700/70 hover:bg-emerald-700 text-white border border-emerald-600 disabled:opacity-50"
                    title="يجلب مدفوعات اللاعب من Paddle ويصرف أي عملية لم تُصرف (جواهر/VIP/دروع...)"
                  >
                    {reconciling[t.id] ? "⏳ جاري الصرف..." : "💰 صرف المدفوعات المعلقة"}
                  </button>
                  {STATUSES.filter((s) => s.value !== t.status).map((s) => (
                    <button
                      key={s.value}
                      onClick={() => updateStatus(t.id, s.value)}
                      className="text-xs px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700"
                    >
                      تعيين كـ {s.label}
                    </button>
                  ))}
                  <button
                    onClick={() => remove(t)}
                    className="text-xs px-3 py-1 rounded bg-red-900/60 hover:bg-red-800 text-red-200 border border-red-800 mr-auto"
                  >🗑️ حذف</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
