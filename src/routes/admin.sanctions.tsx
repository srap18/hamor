import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/hooks/use-admin";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/sanctions")({
  component: AdminSanctions,
  ssr: false,
});

type Row = {
  id: string;
  user_id: string;
  reason: string;
  expires_at: string | null;
  created_at: string;
  kind: "ban" | "mute";
  player_name?: string;
  player_emoji?: string;
};

function AdminSanctions() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "ban" | "mute">("all");

  const load = useCallback(async () => {
    setLoading(true);
    const nowIso = new Date().toISOString();
    const [{ data: bans }, { data: mutes }] = await Promise.all([
      supabase.from("bans").select("id,user_id,reason,expires_at,created_at:banned_at").eq("active", true),
      supabase.from("chat_mutes").select("id,user_id,reason,expires_at,created_at").eq("active", true),
    ]);
    const all: Row[] = [
      ...((bans ?? []) as any[]).map((b) => ({ ...b, kind: "ban" as const })),
      ...((mutes ?? []) as any[]).map((m) => ({ ...m, kind: "mute" as const })),
    ].filter((r) => !r.expires_at || r.expires_at > nowIso);

    const ids = Array.from(new Set(all.map((r) => r.user_id)));
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id,display_name,avatar_emoji").in("id", ids);
      const map = new Map((profs ?? []).map((p: any) => [p.id, p]));
      all.forEach((r) => {
        const p = map.get(r.user_id);
        r.player_name = p?.display_name ?? "غير معروف";
        r.player_emoji = p?.avatar_emoji ?? "👤";
      });
    }
    all.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    setRows(all);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const lift = async (r: Row) => {
    if (!confirm(`إلغاء ${r.kind === "ban" ? "الحظر" : "الكتم"} عن ${r.player_name}؟`)) return;
    const { data, error } = await supabase.rpc("admin_lift_sanction", { p_kind: r.kind, p_id: r.id });
    if (error) {
      toast.error(`فشل الإلغاء: ${error.message}`);
      return;
    }
    const affected = (data as any)?.affected ?? 0;
    if (!affected) {
      toast.error("لم يتم العثور على عقوبة نشطة لرفعها");
      load();
      return;
    }
    await logAudit(r.kind === "ban" ? "unban_user" : "unmute_user", r.user_id, { name: r.player_name, via: "sanctions_page" });
    toast.success("تم الإلغاء");
    load();
  };

  const filtered = filter === "all" ? rows : rows.filter((r) => r.kind === filter);

  const fmtRemaining = (iso: string | null) => {
    if (!iso) return "دائم";
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return "منتهٍ";
    const h = Math.floor(ms / 3600_000);
    const m = Math.floor((ms % 3600_000) / 60_000);
    if (h >= 24) return `${Math.floor(h / 24)} يوم`;
    if (h >= 1) return `${h} س ${m} د`;
    return `${m} د`;
  };

  return (
    <div className="p-3 md:p-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">العقوبات النشطة</h1>
          <p className="text-slate-400 text-xs md:text-sm mt-1">{filtered.length} عقوبة معروضة</p>
        </div>
        <div className="flex gap-2">
          {(["all", "ban", "mute"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 rounded-lg text-xs ${filter === k ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            >
              {k === "all" ? "الكل" : k === "ban" ? "🚫 حظر" : "🔇 كتم"}
            </button>
          ))}
          <button onClick={load} className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700">🔄</button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-slate-800/60 text-slate-300">
            <tr>
              <th className="text-right p-3">النوع</th>
              <th className="text-right p-3">اللاعب</th>
              <th className="text-right p-3">السبب</th>
              <th className="text-right p-3">المتبقي</th>
              <th className="text-right p-3">منذ</th>
              <th className="text-right p-3">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="p-6 text-center text-slate-500">جاري التحميل...</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">لا توجد عقوبات نشطة</td></tr>}
            {filtered.map((r) => (
              <tr key={`${r.kind}-${r.id}`} className="border-t border-slate-800/50">
                <td className="p-3">
                  {r.kind === "ban" ? (
                    <span className="px-2 py-1 rounded text-xs bg-red-600/30 text-red-200 border border-red-500/40">🚫 حظر</span>
                  ) : (
                    <span className="px-2 py-1 rounded text-xs bg-amber-600/30 text-amber-200 border border-amber-500/40">🔇 كتم</span>
                  )}
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{r.player_emoji}</span>
                    <div>
                      <div className="font-medium">{r.player_name}</div>
                      <div className="text-xs text-slate-500 font-mono">{r.user_id.slice(0, 8)}</div>
                    </div>
                  </div>
                </td>
                <td className="p-3 text-slate-300 max-w-xs truncate" title={r.reason}>{r.reason || "—"}</td>
                <td className="p-3 text-amber-300">{fmtRemaining(r.expires_at)}</td>
                <td className="p-3 text-xs text-slate-400">{new Date(r.created_at).toLocaleString("ar")}</td>
                <td className="p-3">
                  <button onClick={() => lift(r)} className="px-2 py-1 rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 text-xs">
                    رفع العقوبة
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
