import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { adminBlockLogin } from "@/lib/admin-users.functions";
import { logAudit } from "@/hooks/use-admin";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/reports")({
  component: AdminReports,
  ssr: false,
});

type Report = {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  kind: "chat" | "ad_bomb" | "destroyer";
  source_id: string | null;
  message_body: string;
  reason: string | null;
  status: "pending" | "resolved" | "dismissed";
  created_at: string;
  resolved_at: string | null;
  audio_url?: string | null;
  audio_duration_ms?: number | null;
};

type Prof = { id: string; display_name: string | null; avatar_emoji: string | null; reports_disabled?: boolean };

function AdminReports() {
  const [rows, setRows] = useState<Report[]>([]);
  const [profs, setProfs] = useState<Map<string, Prof>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = (supabase as any)
      .from("message_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (filter === "pending") q = q.eq("status", "pending");
    const { data, error } = await q;
    if (error) {
      toast.error("تعذّر تحميل البلاغات");
      setLoading(false);
      return;
    }
    const reports = (data ?? []) as Report[];
    setRows(reports);
    const ids = Array.from(new Set(reports.flatMap((r) => [r.reporter_id, r.reported_user_id])));
    if (ids.length) {
      const { data: ps } = await supabase
        .from("profiles")
        .select("id,display_name,avatar_emoji,reports_disabled")
        .in("id", ids);
      setProfs(new Map(((ps ?? []) as Prof[]).map((p) => [p.id, p])));
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id: string, status: "resolved" | "dismissed", note?: string) => {
    setBusy(id);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await (supabase as any)
      .from("message_reports")
      .update({ status, resolved_at: new Date().toISOString(), resolved_by: u.user?.id ?? null, resolution_note: note ?? null })
      .eq("id", id);
    setBusy(null);
    if (error) { toast.error("فشل التحديث"); return; }
    toast.success("تم");
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, status } : r));
  };

  const deleteChatMessage = async (r: Report) => {
    if (r.kind !== "chat" || !r.source_id) { toast.error("هذا النوع ما يدعم حذف الرسالة"); return; }
    if (!confirm("حذف الرسالة من الشات؟")) return;
    const { error } = await supabase.from("messages").delete().eq("id", r.source_id);
    if (error) { toast.error("فشل الحذف: " + error.message); return; }
    await logAudit("delete_message_from_report", r.reported_user_id, { report_id: r.id });
    toast.success("تم حذف الرسالة");
    await updateStatus(r.id, "resolved", "حذف الرسالة");
  };

  const muteReported = async (r: Report, hours: number) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const expires_at = hours >= 87600 ? null : new Date(Date.now() + hours * 3600_000).toISOString();
    await supabase.from("chat_mutes").update({ active: false }).eq("user_id", r.reported_user_id).eq("active", true);
    const { error } = await supabase.from("chat_mutes").insert({
      user_id: r.reported_user_id,
      reason: `بلاغ #${r.id.slice(0, 8)}: ${r.reason || r.message_body?.slice(0, 60) || ""}`,
      muted_by: u.user.id,
      expires_at,
    });
    if (error) { toast.error("فشل الكتم"); return; }
    await logAudit("mute_from_report", r.reported_user_id, { hours, report_id: r.id });
    toast.success(`تم الكتم ${hours >= 87600 ? "دائم" : hours + "س"}`);
    await updateStatus(r.id, "resolved", `كتم ${hours}س`);
  };

  const banReported = async (r: Report, days: number) => {
    if (!confirm(`حظر ${profs.get(r.reported_user_id)?.display_name || "اللاعب"} لمدة ${days} يوم؟`)) return;
    try {
      await adminBlockLogin({ data: { userId: r.reported_user_id, hours: days * 24, reason: `بلاغ: ${r.reason || r.message_body?.slice(0, 80) || ""}` } });
      toast.success("تم الحظر");
      await updateStatus(r.id, "resolved", `حظر ${days} يوم`);
    } catch (e) {
      toast.error("فشل الحظر: " + (e as Error).message);
    }
  };

  const toggleReporterBan = async (reporterId: string, disable: boolean) => {
    if (!confirm(disable ? "منع هذا المُبلِّغ من إرسال بلاغات؟" : "السماح لهذا المُبلِّغ بإرسال البلاغات؟")) return;
    const { error } = await supabase.from("profiles").update({ reports_disabled: disable } as never).eq("id", reporterId);
    if (error) { toast.error("فشل: " + error.message); return; }
    await logAudit(disable ? "disable_reporter" : "enable_reporter", reporterId, {});
    toast.success(disable ? "تم منع المُبلِّغ" : "تم إلغاء المنع");
    setProfs((prev) => {
      const m = new Map(prev);
      const p = m.get(reporterId);
      if (p) m.set(reporterId, { ...p, reports_disabled: disable });
      return m;
    });
  };

  const removeReport = async (id: string) => {
    if (!confirm("حذف هذا البلاغ نهائياً؟")) return;
    const { error } = await (supabase as any).from("message_reports").delete().eq("id", id);
    if (error) { toast.error("فشل الحذف"); return; }
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const kindLabel = (k: Report["kind"]) =>
    k === "chat" ? "💬 شات" : k === "ad_bomb" ? "📺 قنبلة إعلانية" : "☢️ رسالة مفجّر";

  return (
    <div className="p-3 md:p-6" dir="rtl">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">🚩 بلاغات اللاعبين</h1>
          <p className="text-slate-400 text-xs mt-1">{rows.length} بلاغ</p>
        </div>
        <div className="flex gap-2">
          {(["pending", "all"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 rounded-lg text-xs ${filter === k ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            >
              {k === "pending" ? "قيد المراجعة" : "الكل"}
            </button>
          ))}
          <button onClick={load} className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700">🔄</button>
        </div>
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm py-8 text-center">جاري التحميل...</div>
      ) : rows.length === 0 ? (
        <div className="text-slate-400 text-sm py-8 text-center">لا توجد بلاغات</div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const reporter = profs.get(r.reporter_id);
            const reported = profs.get(r.reported_user_id);
            return (
              <div key={r.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200">{kindLabel(r.kind)}</span>
                    <span className={`px-2 py-0.5 rounded ${
                      r.status === "pending" ? "bg-amber-800/60 text-amber-100" :
                      r.status === "resolved" ? "bg-emerald-800/60 text-emerald-100" :
                      "bg-slate-700 text-slate-300"
                    }`}>
                      {r.status === "pending" ? "قيد المراجعة" : r.status === "resolved" ? "تم الحل" : "مرفوض"}
                    </span>
                    <span className="text-slate-500">{new Date(r.created_at).toLocaleString("ar")}</span>
                  </div>
                  <button onClick={() => removeReport(r.id)} className="text-[11px] text-red-400 hover:text-red-300">حذف البلاغ</button>
                </div>

                <div className="grid md:grid-cols-2 gap-2 mb-2 text-xs">
                  <div className="rounded-lg bg-slate-950/60 border border-slate-700 p-2">
                    <div className="text-slate-400 mb-1">👤 صاحب البلاغ</div>
                    <div className="text-slate-100 font-bold flex items-center gap-2">
                      <span>{reporter?.avatar_emoji || "👤"}</span>
                      <span>{reporter?.display_name || r.reporter_id.slice(0, 8)}</span>
                      {reporter?.reports_disabled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/60 text-red-200">ممنوع من البلاغ</span>}
                    </div>
                    <button
                      onClick={() => toggleReporterBan(r.reporter_id, !reporter?.reports_disabled)}
                      className={`mt-1.5 text-[10px] px-2 py-0.5 rounded ${reporter?.reports_disabled ? "bg-emerald-700 hover:bg-emerald-600 text-white" : "bg-red-800/70 hover:bg-red-700 text-red-100"}`}
                    >
                      {reporter?.reports_disabled ? "✅ السماح بالبلاغ" : "🚫 منعه من البلاغ"}
                    </button>
                  </div>
                  <div className="rounded-lg bg-slate-950/60 border border-slate-700 p-2">
                    <div className="text-slate-400 mb-1">🎯 المُبلَّغ عليه</div>
                    <div className="text-slate-100 font-bold flex items-center gap-2">
                      <span>{reported?.avatar_emoji || "👤"}</span>
                      <span>{reported?.display_name || r.reported_user_id.slice(0, 8)}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg bg-slate-950/60 border border-red-800/40 p-2 mb-2">
                  <div className="text-red-300 text-[11px] font-bold mb-1">📝 نص الرسالة</div>
                  <div className="text-slate-100 text-sm whitespace-pre-wrap break-words">{r.message_body || <span className="text-slate-500">— بدون نص —</span>}</div>
                  {r.reason && (
                    <div className="mt-1.5 pt-1.5 border-t border-slate-800 text-[11px] text-amber-200">
                      <span className="text-slate-400">سبب البلاغ:</span> {r.reason}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {r.kind === "chat" && r.source_id && (
                    <button
                      onClick={() => deleteChatMessage(r)}
                      disabled={busy === r.id}
                      className="text-[11px] px-2.5 py-1 rounded bg-red-700 hover:bg-red-600 text-white font-bold disabled:opacity-50"
                    >
                      🗑️ حذف الرسالة
                    </button>
                  )}
                  <button onClick={() => muteReported(r, 1)} className="text-[11px] px-2.5 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white font-bold">🔇 كتم 1س</button>
                  <button onClick={() => muteReported(r, 24)} className="text-[11px] px-2.5 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white font-bold">🔇 كتم 24س</button>
                  <button onClick={() => muteReported(r, 24 * 7)} className="text-[11px] px-2.5 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white font-bold">🔇 كتم أسبوع</button>
                  <button onClick={() => muteReported(r, 87600)} className="text-[11px] px-2.5 py-1 rounded bg-amber-900 hover:bg-amber-800 text-white font-bold">🔇 كتم دائم</button>
                  <button onClick={() => banReported(r, 1)} className="text-[11px] px-2.5 py-1 rounded bg-rose-700 hover:bg-rose-600 text-white font-bold">🚫 حظر يوم</button>
                  <button onClick={() => banReported(r, 7)} className="text-[11px] px-2.5 py-1 rounded bg-rose-700 hover:bg-rose-600 text-white font-bold">🚫 حظر 7 أيام</button>
                  <button onClick={() => banReported(r, 30)} className="text-[11px] px-2.5 py-1 rounded bg-rose-800 hover:bg-rose-700 text-white font-bold">🚫 حظر شهر</button>
                  {r.status === "pending" && (
                    <>
                      <button onClick={() => updateStatus(r.id, "resolved", "تم الحل")} className="text-[11px] px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-bold">✅ تم الحل</button>
                      <button onClick={() => updateStatus(r.id, "dismissed", "بلاغ غير صحيح")} className="text-[11px] px-2.5 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 font-bold">❌ رفض البلاغ</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
