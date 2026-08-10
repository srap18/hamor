import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { confirmDialog } from "@/components/ConfirmDialog";

export const Route = createFileRoute("/admin/vip")({
  component: AdminVipPage,
  ssr: false,
  head: () => ({ meta: [{ title: "اشتراكات VIP — لوحة التحكم" }] }),
});

type VipRow = {
  user_id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  avatar_emoji: string | null;
  elite_vip_level: number;
  elite_vip_expires_at: string;
  days_left: number;
  source: "purchase" | "code" | "admin";
  last_purchase_at: string | null;
  last_code_at: string | null;
};

function SourceBadge({ source }: { source: VipRow["source"] }) {
  const map: Record<VipRow["source"], { label: string; cls: string; icon: string }> = {
    purchase: { label: "مشترٍ", icon: "💳", cls: "bg-emerald-900/40 text-emerald-200 border-emerald-700/40" },
    code: { label: "كود", icon: "🎟️", cls: "bg-amber-900/40 text-amber-200 border-amber-700/40" },
    admin: { label: "منح إداري", icon: "🛠️", cls: "bg-slate-800/60 text-slate-200 border-slate-600/40" },
  };
  const s = map[source];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${s.cls}`}>
      <span>{s.icon}</span>
      {s.label}
    </span>
  );
}

function fmtDate(v: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" });
}

function AdminVipPage() {
  const [rows, setRows] = useState<VipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "purchase" | "code" | "admin">("all");
  const [target, setTarget] = useState<VipRow | null>(null);
  const [days, setDays] = useState("30");
  const [level, setLevel] = useState("1");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc("admin_list_elite_vips");
      if (error) throw error;
      setRows((data as VipRow[]) || []);
    } catch (e: any) {
      toast.error(e?.message || "تعذّر تحميل الاشتراكات");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.source !== filter) return false;
      if (!s) return true;
      return (
        (r.display_name || "").toLowerCase().includes(s) ||
        (r.username || "").toLowerCase().includes(s) ||
        r.user_id.toLowerCase().includes(s)
      );
    });
  }, [rows, q, filter, ]);

  const counts = useMemo(() => ({
    total: rows.length,
    purchase: rows.filter((r) => r.source === "purchase").length,
    code: rows.filter((r) => r.source === "code").length,
    admin: rows.filter((r) => r.source === "admin").length,
  }), [rows]);

  function openManage(r: VipRow) {
    setTarget(r);
    setDays("30");
    setLevel(String(r.elite_vip_level || 1));
  }

  async function apply(kind: "extend" | "shorten" | "level") {
    if (!target) return;
    const d = Number(days);
    if (kind !== "level" && (!Number.isFinite(d) || d <= 0)) {
      toast.error("أدخل عدد أيام صحيح");
      return;
    }
    const lvl = kind === "level" ? Number(level) : target.elite_vip_level;
    if (!Number.isFinite(lvl) || lvl < 1 || lvl > 6) {
      toast.error("المستوى غير صحيح");
      return;
    }
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("admin_set_elite_vip", {
        _user_id: target.user_id,
        _level: lvl,
        _days: kind === "extend" ? d : kind === "shorten" ? -d : 0,
      });
      if (error) throw error;
      toast.success("تم التحديث");
      setTarget(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "فشل التحديث");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(r: VipRow) {
    const ok = await confirmDialog({
      title: "إلغاء الاشتراك",
      message: `هل تريد إلغاء VIP عن «${r.display_name || r.username}» فوراً؟`,
      confirmText: "إلغاء الاشتراك",
      danger: true,
    });
    if (!ok) return;
    try {
      const { error } = await (supabase as any).rpc("admin_revoke_elite_vip", { _user_id: r.user_id });
      if (error) throw error;
      toast.success("تم إلغاء الاشتراك");
      setTarget(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "فشل الإلغاء");
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl md:text-2xl font-black text-amber-300">👑 اشتراكات VIP النشطة</h1>
        <button onClick={load} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700">
          تحديث
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { k: "all" as const, label: "الكل", v: counts.total, icon: "👑" },
          { k: "purchase" as const, label: "مشترون", v: counts.purchase, icon: "💳" },
          { k: "code" as const, label: "عبر كود", v: counts.code, icon: "🎟️" },
          { k: "admin" as const, label: "منح إداري", v: counts.admin, icon: "🛠️" },
        ].map((c) => (
          <button
            key={c.k}
            onClick={() => setFilter(c.k)}
            className={`rounded-xl border p-3 text-right transition ${
              filter === c.k ? "border-amber-500/60 bg-amber-900/20" : "border-slate-700/60 bg-slate-900/40 hover:bg-slate-900/70"
            }`}
          >
            <div className="text-xs text-slate-400">{c.icon} {c.label}</div>
            <div className="text-lg font-black text-slate-100">{c.v}</div>
          </button>
        ))}
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="بحث بالاسم أو المعرّف..."
        className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
      />

      {loading ? (
        <div className="py-10 text-center text-slate-400">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center text-slate-400">لا يوجد مشتركون مطابقون</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const soon = r.days_left <= 3;
            return (
              <div
                key={r.user_id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-900/50 p-3"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {r.avatar_url ? (
                    <img src={r.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-lg">
                      {r.avatar_emoji || "🐟"}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-bold text-slate-100">{r.display_name || r.username || "—"}</span>
                      <SourceBadge source={r.source} />
                      <span className="rounded-full border border-purple-700/40 bg-purple-900/40 px-2 py-0.5 text-[11px] font-bold text-purple-200">
                        VIP {r.elite_vip_level}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      ينتهي: {fmtDate(r.elite_vip_expires_at)}
                    </div>
                  </div>
                </div>

                <div className={`rounded-lg px-3 py-1.5 text-sm font-black ${soon ? "bg-red-900/40 text-red-200" : "bg-emerald-900/30 text-emerald-200"}`}>
                  {Math.max(0, Math.floor(r.days_left))} يوم متبقي
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => openManage(r)}
                    className="rounded-lg bg-amber-600/80 px-3 py-1.5 text-sm font-bold text-white hover:bg-amber-600"
                  >
                    إدارة
                  </button>
                  <button
                    onClick={() => revoke(r)}
                    className="rounded-lg bg-red-700/80 px-3 py-1.5 text-sm font-bold text-white hover:bg-red-700"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setTarget(null)}>
          <div
            className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-black text-amber-300">إدارة اشتراك {target.display_name || target.username}</h2>
              <button onClick={() => setTarget(null)} className="text-slate-400 hover:text-slate-200">✕</button>
            </div>

            <div className="rounded-lg bg-slate-800/60 p-3 text-sm text-slate-300 space-y-1">
              <div>المستوى الحالي: <b>VIP {target.elite_vip_level}</b></div>
              <div>المتبقي: <b>{Math.max(0, Math.floor(target.days_left))} يوم</b></div>
              <div>المصدر: <SourceBadge source={target.source} /></div>
              <div className="text-[11px] text-slate-400">آخر شراء: {fmtDate(target.last_purchase_at)}</div>
              <div className="text-[11px] text-slate-400">آخر كود: {fmtDate(target.last_code_at)}</div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-slate-400">عدد الأيام</label>
              <input
                value={days}
                onChange={(e) => setDays(e.target.value)}
                inputMode="numeric"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
              />
              <div className="flex gap-2">
                <button disabled={busy} onClick={() => apply("extend")} className="flex-1 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
                  تمديد +
                </button>
                <button disabled={busy} onClick={() => apply("shorten")} className="flex-1 rounded-lg bg-orange-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
                  خصم −
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-slate-400">تغيير المستوى</label>
              <div className="flex gap-2">
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                >
                  {[1, 2, 3, 4, 5, 6].map((l) => (
                    <option key={l} value={l}>VIP {l}</option>
                  ))}
                </select>
                <button disabled={busy} onClick={() => apply("level")} className="rounded-lg bg-purple-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
                  حفظ المستوى
                </button>
              </div>
            </div>

            <button onClick={() => revoke(target)} className="w-full rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white">
              إلغاء الاشتراك فوراً
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
