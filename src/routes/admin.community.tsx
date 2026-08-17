import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { confirmDialog } from "@/components/ConfirmDialog";
import { TribeRoleBadge } from "@/components/TribeRoleBadge";

export const Route = createFileRoute("/admin/community")({
  component: AdminCommunity,
  head: () => ({ meta: [{ title: "القبائل — Admin" }] }),
});

type Tribe = { id: string; name: string; emblem: string; owner_id: string; founder_id: string | null; level: number; total_donations: number; points: number; join_mode: string };
type TMember = { user_id: string; role: string; joined_at: string; donation_coins: number; display_name: string | null; username: string | null; avatar_emoji: string | null; level: number | null; is_founder: boolean };

function AdminCommunity() {
  const [tribes, setTribes] = useState<Tribe[]>([]);
  const [loading, setLoading] = useState(true);
  const [deltas, setDeltas] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, TMember[]>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: ts } = await supabase.from("tribes").select("id,name,emblem,owner_id,founder_id,level,total_donations,points,join_mode").order("points", { ascending: false });
    setTribes((ts || []) as Tribe[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadMembers = useCallback(async (tribeId: string) => {
    const { data, error } = await (supabase as any).rpc("admin_tribe_members", { _tribe_id: tribeId });
    if (error) { alert("فشل تحميل الأعضاء: " + error.message); return; }
    setMembers((m) => ({ ...m, [tribeId]: (data || []) as TMember[] }));
  }, []);

  const toggleMembers = async (t: Tribe) => {
    if (openId === t.id) { setOpenId(null); return; }
    setOpenId(t.id);
    if (!members[t.id]) await loadMembers(t.id);
  };

  const setOwner = async (t: Tribe, m: TMember) => {
    const ok = await confirmDialog({ title: "تعيين قائد", message: `تعيين "${m.display_name || "قرصان"}" قائداً لقبيلة "${t.name}"؟`, confirmText: "عيّن" });
    if (!ok) return;
    setBusy(true);
    const { error } = await (supabase as any).rpc("admin_set_tribe_owner", { _tribe_id: t.id, _user_id: m.user_id });
    setBusy(false);
    if (error) { alert("فشل: " + error.message); return; }
    await loadMembers(t.id);
    load();
  };

  const kickMember = async (t: Tribe, m: TMember) => {
    const ok = await confirmDialog({ title: "طرد عضو", message: `طرد "${m.display_name || "قرصان"}" من قبيلة "${t.name}"؟`, confirmText: "اطرد", danger: true });
    if (!ok) return;
    setBusy(true);
    const { error } = await (supabase as any).rpc("admin_kick_tribe_member", { _tribe_id: t.id, _user_id: m.user_id });
    setBusy(false);
    if (error) { alert("فشل: " + error.message); return; }
    await loadMembers(t.id);
    load();
  };

  const deleteTribe = async (t: Tribe) => {
    const ok = await confirmDialog({ title: "حذف القبيلة", message: `هل تريد حذف "${t.name}" وكل أعضائها؟`, confirmText: "احذف", danger: true });
    if (!ok) return;
    const { error } = await supabase.rpc("admin_delete_tribe" as never, { _tribe_id: t.id } as never);
    if (error) alert("فشل: " + error.message); else load();
  };

  const adjustPoints = async (t: Tribe, sign: 1 | -1) => {
    const raw = (deltas[t.id] ?? "").trim();
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n <= 0) { alert("ادخل رقم موجب"); return; }
    const delta = sign * n;
    const ok = await confirmDialog({
      title: sign > 0 ? "منح نقاط" : "خصم نقاط",
      message: `${sign > 0 ? "منح" : "خصم"} ${n.toLocaleString()} نقطة ${sign > 0 ? "إلى" : "من"} "${t.name}"؟${sign > 0 ? "\nسيظهر كتبرع عادي من قائد القبيلة." : ""}`,
      confirmText: sign > 0 ? "امنح" : "اخصم",
      danger: sign < 0,
    });
    if (!ok) return;
    const { error } = await supabase.rpc("admin_adjust_tribe_points" as never, { _tribe_id: t.id, _delta: delta } as never);
    if (error) { alert("فشل: " + error.message); return; }
    setDeltas((d) => ({ ...d, [t.id]: "" }));
    load();
  };

  return (
    <div className="p-4 space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold text-amber-300">🏴‍☠️ القبائل</h1>
      {loading && <div className="text-slate-400">جاري التحميل...</div>}

      <section>
        <h2 className="text-lg font-bold mb-2">🏴‍☠️ القبائل ({tribes.length})</h2>
        <div className="space-y-2">
          {tribes.length === 0 && <div className="text-slate-500 text-sm">لا توجد قبائل</div>}
          {tribes.map(t => (
            <div key={t.id} className="p-3 rounded-lg bg-slate-900 border border-slate-700 space-y-2">
              <div className="flex items-center gap-3">
                <div className="text-2xl">{t.emblem}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold truncate">{t.name}</div>
                  <div className="text-xs text-slate-400">
                    المستوى {t.level} • النقاط {Number(t.points || 0).toLocaleString()} ⭐ • تبرعات {Number(t.total_donations || 0).toLocaleString()} 🪙 • {t.join_mode === "open" ? "🌍 مفتوحة" : "📩 بطلب"}
                  </div>
                </div>
                <button onClick={() => deleteTribe(t)} className="px-3 py-1.5 rounded bg-red-700 text-white text-xs font-bold">🗑️ حذف</button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  placeholder="مقدار النقاط"
                  value={deltas[t.id] ?? ""}
                  onChange={(e) => setDeltas((d) => ({ ...d, [t.id]: e.target.value }))}
                  className="flex-1 px-3 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:border-amber-500"
                />
                <button onClick={() => adjustPoints(t, 1)} className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold">+ منح</button>
                <button onClick={() => adjustPoints(t, -1)} className="px-3 py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white text-xs font-bold">− خصم</button>
              </div>

              <button onClick={() => toggleMembers(t)} className="w-full px-3 py-1.5 rounded bg-slate-800 border border-slate-700 text-xs font-bold text-amber-200">
                {openId === t.id ? "▲ إخفاء الأعضاء" : "▼ إدارة الأعضاء (قائد / طرد)"}
              </button>

              {openId === t.id && (
                <div className="space-y-1.5">
                  {!members[t.id] && <div className="text-xs text-slate-500">جاري التحميل…</div>}
                  {(members[t.id] || []).map(m => (
                    <div key={m.user_id} className="flex items-center gap-2 p-2 rounded bg-slate-800 border border-slate-700">
                      <span className="text-lg">{m.avatar_emoji || "🏴‍☠️"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold truncate">
                          {m.display_name || "قرصان"}
                          <span className="mr-1 align-middle">
                            {m.role === "owner" && <TribeRoleBadge role="owner" showLabel />}
                            {m.is_founder && <TribeRoleBadge role="founder" showLabel />}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400">⭐ {m.level ?? 1} • 🤝 {Number(m.donation_coins || 0).toLocaleString()}</div>
                      </div>
                      {m.role !== "owner" && (
                        <button disabled={busy} onClick={() => setOwner(t, m)} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white text-[10px] font-bold disabled:opacity-50">
                          <TribeRoleBadge role="owner" size="sm" /> قائد
                        </button>
                      )}
                      <button disabled={busy} onClick={() => kickMember(t, m)} className="px-2 py-1 rounded bg-red-700 hover:bg-red-600 text-white text-[10px] font-bold disabled:opacity-50">🚪 طرد</button>
                    </div>
                  ))}
                  {members[t.id]?.length === 0 && <div className="text-xs text-slate-500">لا يوجد أعضاء</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
