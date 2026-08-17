import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { confirmDialog } from "@/components/ConfirmDialog";

export const Route = createFileRoute("/admin/community")({
  component: AdminCommunity,
  head: () => ({ meta: [{ title: "القبائل — Admin" }] }),
});

type Tribe = { id: string; name: string; emblem: string; owner_id: string; level: number; total_donations: number; points: number; join_mode: string };

type Member = { user_id: string; display_name: string | null; username: string | null; avatar_emoji: string | null; level: number | null; role: string; donation_coins: number; is_founder: boolean };

function AdminCommunity() {
  const [tribes, setTribes] = useState<Tribe[]>([]);
  const [loading, setLoading] = useState(true);
  const [deltas, setDeltas] = useState<Record<string, string>>({});
  const [manageTribe, setManageTribe] = useState<Tribe | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [mLoading, setMLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: ts } = await supabase.from("tribes").select("id,name,emblem,owner_id,level,total_donations,points,join_mode").order("points", { ascending: false });
    setTribes((ts || []) as Tribe[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadMembers = useCallback(async (t: Tribe) => {
    setMLoading(true);
    const { data, error } = await supabase.rpc("admin_tribe_members" as never, { _tribe_id: t.id } as never);
    if (error) alert("فشل تحميل الأعضاء: " + error.message);
    const list = ((data || []) as Member[]).slice().sort((a, b) =>
      (a.role === "owner" ? -1 : b.role === "owner" ? 1 : (b.donation_coins || 0) - (a.donation_coins || 0)));
    setMembers(list);
    setMLoading(false);
  }, []);

  const openManage = async (t: Tribe) => { setManageTribe(t); setMembers([]); await loadMembers(t); };

  const setOwner = async (m: Member) => {
    if (!manageTribe) return;
    const ok = await confirmDialog({ title: "تعيين قائد", message: `تعيين "${m.display_name || "قرصان"}" قائداً لقبيلة "${manageTribe.name}"؟`, confirmText: "تعيين" });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_tribe_set_owner" as never, { _tribe_id: manageTribe.id, _user_id: m.user_id } as never);
    setBusy(false);
    if (error) { alert("فشل: " + error.message); return; }
    await loadMembers(manageTribe); load();
  };

  const kick = async (m: Member) => {
    if (!manageTribe) return;
    const ok = await confirmDialog({ title: "طرد عضو", message: `طرد "${m.display_name || "قرصان"}" من "${manageTribe.name}"؟`, confirmText: "اطرد", danger: true });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_tribe_kick_member" as never, { _tribe_id: manageTribe.id, _user_id: m.user_id } as never);
    setBusy(false);
    if (error) { alert("فشل: " + error.message); return; }
    await loadMembers(manageTribe);
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
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
