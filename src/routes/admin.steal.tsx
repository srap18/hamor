import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/steal")({
  component: AdminStealPage,
  ssr: false,
  head: () => ({ meta: [{ title: "سجل السرقة — لوحة التحكم" }] }),
});

type LogRow = {
  id: string;
  created_at: string;
  thief_id: string;
  thief_name: string | null;
  victim_id: string;
  victim_name: string | null;
  result: string;
  reject_reason: string | null;
  link_reason: string | null;
  fish_id: string | null;
  quantity: number;
  total_value: number;
  device_id: string | null;
  hardware_hash: string | null;
  ip: string | null;
};

type AlertRow = {
  kind: string;
  thief_id: string | null;
  thief_name: string | null;
  victim_id: string | null;
  victim_name: string | null;
  hits: number;
  detail: string;
};

const RESULT_LABEL: Record<string, string> = {
  success: "ناجحة",
  started: "جارية",
  empty: "بدون سمك",
  cancelled: "ملغاة",
  rejected: "مرفوضة",
};

const REJECT_LABEL: Record<string, string> = {
  linked_accounts: "حسابات مرتبطة",
  cooldown: "انتظار ساعتين",
  pair_daily_limit: "حد 3 من نفس الضحية",
  daily_limit: "حد 10 يوميًا",
};

const KIND_LABEL: Record<string, string> = {
  repeat_pair: "سرقة متكررة لنفس الضحية",
  swarmed_victim: "عدة حسابات تستهدف لاعبًا واحدًا",
  bypass_attempts: "محاولات تجاوز الحماية",
  request_burst: "طلبات سرقة كثيفة",
};

function AdminStealPage() {
  const [tab, setTab] = useState<"alerts" | "log">("alerts");
  const [rows, setRows] = useState<LogRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: log, error: e1 }, { data: al, error: e2 }] = await Promise.all([
        (supabase as any).rpc("admin_steal_log", { _limit: 300 }),
        (supabase as any).rpc("admin_steal_alerts", { _hours: 48 }),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      setRows((log as LogRow[]) || []);
      setAlerts((al as AlertRow[]) || []);
    } catch (e: any) {
      toast.error(e?.message || "تعذّر تحميل البيانات");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = rows.filter((r) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (
      (r.thief_name || "").toLowerCase().includes(s) ||
      (r.victim_name || "").toLowerCase().includes(s) ||
      (r.ip || "").includes(s) ||
      (r.hardware_hash || "").includes(s)
    );
  });

  return (
    <div className="space-y-4 p-3" dir="rtl">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold text-foreground">حماية السرقة</h1>
        <button
          onClick={load}
          className="rounded-lg bg-secondary px-3 py-1.5 text-xs text-secondary-foreground"
        >
          تحديث
        </button>
        <div className="ms-auto flex gap-1 rounded-lg bg-muted p-1">
          {(["alerts", "log"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1 text-xs ${
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {t === "alerts" ? "تنبيهات" : "السجل"}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card/60 p-3 text-xs text-muted-foreground">
        القواعد المطبقة من السيرفر: منع السرقة نهائيًا بين الحسابات المرتبطة (جهاز / بصمة عتاد / ربط
        إداري / شبكة مثبتة) — 3 سرقات ناجحة كحد أقصى من نفس الضحية خلال 24 ساعة — انتظار ساعتين بين
        كل سرقة لنفس الضحية — 10 سرقات ناجحة كحد أقصى لكل لاعب خلال 24 ساعة.
      </div>

      {loading && <div className="text-sm text-muted-foreground">جاري التحميل…</div>}

      {!loading && tab === "alerts" && (
        <div className="space-y-2">
          {alerts.length === 0 && (
            <div className="text-sm text-muted-foreground">لا توجد أنماط مشبوهة خلال 48 ساعة.</div>
          )}
          {alerts.map((a, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm"
            >
              <span className="rounded-md bg-destructive/15 px-2 py-0.5 text-xs text-destructive">
                {KIND_LABEL[a.kind] || a.kind}
              </span>
              {a.thief_name && <span className="text-foreground">السارق: {a.thief_name}</span>}
              {a.victim_name && <span className="text-foreground">الضحية: {a.victim_name}</span>}
              <span className="text-muted-foreground">{a.detail}</span>
              <span className="ms-auto font-bold text-foreground">{a.hits}</span>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === "log" && (
        <div className="space-y-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث بالاسم أو IP أو البصمة"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-right text-xs">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="p-2">الوقت</th>
                  <th className="p-2">السارق</th>
                  <th className="p-2">الضحية</th>
                  <th className="p-2">النتيجة</th>
                  <th className="p-2">الكمية</th>
                  <th className="p-2">القيمة</th>
                  <th className="p-2">IP</th>
                  <th className="p-2">البصمة</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-2 whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString("ar-SA")}
                    </td>
                    <td className="p-2">{r.thief_name || r.thief_id.slice(0, 8)}</td>
                    <td className="p-2">{r.victim_name || r.victim_id.slice(0, 8)}</td>
                    <td className="p-2">
                      {RESULT_LABEL[r.result] || r.result}
                      {r.reject_reason && (
                        <span className="text-destructive">
                          {" "}
                          — {REJECT_LABEL[r.reject_reason] || r.reject_reason}
                          {r.link_reason ? ` (${r.link_reason})` : ""}
                        </span>
                      )}
                    </td>
                    <td className="p-2">{r.quantity}</td>
                    <td className="p-2">{r.total_value}</td>
                    <td className="p-2">{r.ip || "-"}</td>
                    <td className="p-2">{(r.hardware_hash || "-").slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div className="text-sm text-muted-foreground">لا توجد سجلات.</div>
          )}
        </div>
      )}
    </div>
  );
}
