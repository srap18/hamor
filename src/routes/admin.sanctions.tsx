import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/hooks/use-admin";
import { adminBlockLogin } from "@/lib/admin-users.functions";
import { toast } from "sonner";
import { BannedPhraseHits } from "@/components/admin/BannedPhraseHits";

export const Route = createFileRoute("/admin/sanctions")({
  component: AdminSanctions,
  ssr: false,
});

type Row = {
  id: string;
  user_id: string;
  reason: string;
  message_body?: string | null;
  expires_at: string | null;
  created_at: string;
  kind: "ban" | "mute";
  player_name?: string;
  player_emoji?: string;
};

type BlockRow = {
  kind: "email" | "device" | "ip";
  key: string;
  reason: string | null;
  created_at: string;
  user_id: string | null;
  player_name?: string;
};

function AdminSanctions() {
  const [rows, setRows] = useState<Row[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "ban" | "mute" | "email" | "device" | "ip">("all");

  const load = useCallback(async () => {
    setLoading(true);
    const nowIso = new Date().toISOString();
    const [{ data: bans }, { data: mutes }, { data: bEmails }, { data: bDevices }, { data: bIps }] = await Promise.all([
      supabase.from("bans").select("id,user_id,reason,expires_at,created_at:banned_at").eq("active", true),
      supabase.from("chat_mutes").select("id,user_id,reason,expires_at,created_at").eq("active", true),
      supabase.from("banned_emails").select("email,reason,created_at").order("created_at", { ascending: false }),
      supabase.from("banned_devices").select("device_id,user_id,reason,created_at").order("created_at", { ascending: false }),
      supabase.from("banned_ips").select("ip,user_id,reason,created_at").order("created_at", { ascending: false }),
    ]);
    const blockRows: BlockRow[] = [
      ...((bEmails ?? []) as any[]).map((r) => ({ kind: "email" as const, key: r.email, reason: r.reason, created_at: r.created_at, user_id: null })),
      ...((bDevices ?? []) as any[]).map((r) => ({ kind: "device" as const, key: r.device_id, reason: r.reason, created_at: r.created_at, user_id: r.user_id })),
      ...((bIps ?? []) as any[]).map((r) => ({ kind: "ip" as const, key: r.ip, reason: r.reason, created_at: r.created_at, user_id: r.user_id })),
    ];
    const all: Row[] = [
      ...((bans ?? []) as any[]).map((b) => ({ ...b, kind: "ban" as const })),
      ...((mutes ?? []) as any[]).map((m) => ({ ...m, kind: "mute" as const })),
    ].filter((r) => !r.expires_at || r.expires_at > nowIso);

    const ids = Array.from(new Set([...all.map((r) => r.user_id), ...blockRows.map((b) => b.user_id)].filter(Boolean) as string[]));
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id,display_name,avatar_emoji").in("id", ids);
      const map = new Map((profs ?? []).map((p: any) => [p.id, p]));
      all.forEach((r) => {
        const p = map.get(r.user_id);
        r.player_name = p?.display_name ?? "غير معروف";
        r.player_emoji = p?.avatar_emoji ?? "👤";
      });
      blockRows.forEach((b) => {
        if (b.user_id) b.player_name = map.get(b.user_id)?.display_name ?? undefined;
      });
    }
    all.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    blockRows.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    setRows(all);
    setBlocks(blockRows);
    setLoading(false);
  }, []);

  const removeBlock = async (b: BlockRow) => {
    const label = b.kind === "email" ? "الإيميل" : b.kind === "device" ? "الجهاز" : "الآيبي";
    if (!confirm(`رفع حظر ${label}: ${b.key}؟`)) return;
    const q =
      b.kind === "email"
        ? supabase.from("banned_emails").delete().eq("email", b.key)
        : b.kind === "device"
          ? supabase.from("banned_devices").delete().eq("device_id", b.key)
          : supabase.from("banned_ips").delete().eq("ip", b.key);
    const { error } = await q;
    if (error) { toast.error(`فشل الرفع: ${error.message}`); return; }
    await logAudit(`unban_${b.kind}`, b.user_id, { key: b.key, via: "sanctions_page" });
    toast.success("تم الرفع");
    load();
  };

  useEffect(() => { load(); }, [load]);

  const unblockFn = useServerFn(adminBlockLogin);

  const lift = async (r: Row) => {
    if (!confirm(`إلغاء ${r.kind === "ban" ? "الحظر" : "الكتم"} عن ${r.player_name}؟`)) return;
    try {
      if (r.kind === "ban") {
        // Full unblock: clears bans + banned_emails + banned_devices + banned_ips + auth ban_duration
        await unblockFn({ data: { userId: r.user_id, unblock: true } });
      } else {
        const { data, error } = await supabase.rpc("admin_lift_sanction", { p_kind: r.kind, p_id: r.id });
        if (error) throw error;
        const affected = (data as any)?.affected ?? 0;
        if (!affected) {
          toast.error("لم يتم العثور على عقوبة نشطة لرفعها");
          load();
          return;
        }
      }
      await logAudit(r.kind === "ban" ? "unban_user" : "unmute_user", r.user_id, { name: r.player_name, via: "sanctions_page" });
      toast.success("تم الإلغاء");
      load();
    } catch (e: any) {
      toast.error(`فشل الإلغاء: ${e?.message ?? e}`);
    }
  };


  const isBlockFilter = filter === "email" || filter === "device" || filter === "ip";
  const filtered = filter === "all" ? rows : isBlockFilter ? [] : rows.filter((r) => r.kind === filter);
  const filteredBlocks = filter === "all" ? blocks : isBlockFilter ? blocks.filter((b) => b.kind === filter) : [];

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
          <p className="text-slate-400 text-xs md:text-sm mt-1">{filtered.length + filteredBlocks.length} عقوبة معروضة</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {(["all", "ban", "mute", "email", "device", "ip"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 rounded-lg text-xs ${filter === k ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            >
              {k === "all" ? "الكل" : k === "ban" ? "🚫 حظر" : k === "mute" ? "🔇 كتم" : k === "email" ? "📧 إيميل" : k === "device" ? "📱 جهاز" : "🌐 آيبي"}
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

      {(filter === "all" || isBlockFilter) && (
        <div className="mt-6">
          <h2 className="text-lg font-bold mb-2">حظر الإيميلات / الأجهزة / الآيبي ({filteredBlocks.length})</h2>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-slate-800/60 text-slate-300">
                <tr>
                  <th className="text-right p-3">النوع</th>
                  <th className="text-right p-3">القيمة</th>
                  <th className="text-right p-3">اللاعب</th>
                  <th className="text-right p-3">السبب</th>
                  <th className="text-right p-3">منذ</th>
                  <th className="text-right p-3">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {!loading && filteredBlocks.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">لا يوجد</td></tr>}
                {filteredBlocks.map((b) => (
                  <tr key={`${b.kind}-${b.key}`} className="border-t border-slate-800/50">
                    <td className="p-3">
                      <span className="px-2 py-1 rounded text-xs bg-red-600/20 text-red-200 border border-red-500/30">
                        {b.kind === "email" ? "📧 إيميل" : b.kind === "device" ? "📱 جهاز" : "🌐 آيبي"}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-xs max-w-[220px] truncate" title={b.key}>{b.key}</td>
                    <td className="p-3 text-slate-300 text-xs">{b.player_name ?? (b.user_id ? b.user_id.slice(0, 8) : "—")}</td>
                    <td className="p-3 text-slate-300 max-w-xs truncate" title={b.reason ?? ""}>{b.reason || "—"}</td>
                    <td className="p-3 text-xs text-slate-400">{new Date(b.created_at).toLocaleString("ar")}</td>
                    <td className="p-3">
                      <button onClick={() => removeBlock(b)} className="px-2 py-1 rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 text-xs">
                        رفع الحظر
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <BannedPhraseHits />
    </div>
  );
}
