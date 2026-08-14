import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/suspected-devices")({
  component: AdminSuspectedDevices,
  ssr: false,
});

type Row = {
  id: string;
  source_user_id: string;
  source_name: string | null;
  suspect_user_id: string;
  suspect_name: string | null;
  score: number;
  signals: number;
  detail: any;
  status: string;
  created_at: string;
};

function AdminSuspectedDevices() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<"pending" | "confirmed" | "dismissed">("pending");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_list_suspected_matches", {
      _status: status,
      _limit: 200,
    });
    if (error) toast.error(error.message);
    setRows(((data ?? []) as any[]) as Row[]);
    setLoading(false);
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (id: string, action: "confirm" | "dismiss") => {
    if (action === "confirm" && !confirm("تأكيد أنه نفس الجهاز وحظر الحساب نهائيًا؟")) return;
    setBusy(id);
    const { error } = await supabase.rpc("admin_resolve_suspected_match", { _id: id, _action: action });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(action === "confirm" ? "تم الحظر" : "تم الرفض");
    load();
  };

  return (
    <div className="space-y-4 p-3" dir="rtl">
      <header className="space-y-1">
        <h1 className="text-lg font-bold">أجهزة مشتبه بها</h1>
        <p className="text-xs text-muted-foreground">
          حالات ثقة عالية لكن بلا دليل هوية قوي — لم يُحظر أحد تلقائيًا. راجعها يدويًا.
        </p>
      </header>

      <div className="flex gap-2">
        {(["pending", "confirmed", "dismissed"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-lg px-3 py-1.5 text-xs ${
              status === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {s === "pending" ? "قيد المراجعة" : s === "confirmed" ? "مؤكدة" : "مرفوضة"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">جاري التحميل…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">لا توجد حالات.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-border bg-card p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{r.suspect_name ?? r.suspect_user_id.slice(0, 8)}</span>
                <span className="text-xs text-muted-foreground">
                  مشتبه بارتباطه بـ {r.source_name ?? r.source_user_id.slice(0, 8)}
                </span>
                <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
                  درجة {r.score} · إشارات {r.signals}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                إشارات قوية: {JSON.stringify(r.detail?.strong ?? {})}
              </p>
              {r.status === "pending" && (
                <div className="mt-2 flex gap-2">
                  <button
                    disabled={busy === r.id}
                    onClick={() => resolve(r.id, "confirm")}
                    className="rounded-lg bg-destructive px-3 py-1.5 text-xs text-destructive-foreground disabled:opacity-50"
                  >
                    تأكيد وحظر
                  </button>
                  <button
                    disabled={busy === r.id}
                    onClick={() => resolve(r.id, "dismiss")}
                    className="rounded-lg bg-muted px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    رفض (بريء)
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
