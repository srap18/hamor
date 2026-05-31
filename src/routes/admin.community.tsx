import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { confirmDialog } from "@/components/ConfirmDialog";

export const Route = createFileRoute("/admin/community")({
  component: AdminCommunity,
  head: () => ({ meta: [{ title: "القبائل والغرف الصوتية — Admin" }] }),
});

type Room = { id: string; name: string; topic: string; created_by: string; max_users: number; created_at: string; empty_since: string | null };
type Tribe = { id: string; name: string; emblem: string; owner_id: string; level: number; total_donations: number; join_mode: string };

function AdminCommunity() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [tribes, setTribes] = useState<Tribe[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: rs }, { data: ts }] = await Promise.all([
      supabase.from("voice_rooms").select("*").order("created_at", { ascending: false }),
      supabase.from("tribes").select("id,name,emblem,owner_id,level,total_donations,join_mode").order("total_donations", { ascending: false }),
    ]);
    setRooms((rs || []) as Room[]);
    setTribes((ts || []) as Tribe[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const deleteRoom = async (r: Room) => {
    const ok = await confirmDialog({ title: "حذف الغرفة الصوتية", message: `هل تريد حذف "${r.name}" نهائياً؟`, confirmText: "احذف", danger: true });
    if (!ok) return;
    const { error } = await supabase.rpc("admin_delete_voice_room" as never, { _room_id: r.id } as never);
    if (error) alert("فشل: " + error.message); else load();
  };

  const deleteTribe = async (t: Tribe) => {
    const ok = await confirmDialog({ title: "حذف القبيلة", message: `هل تريد حذف "${t.name}" وكل أعضائها؟`, confirmText: "احذف", danger: true });
    if (!ok) return;
    const { error } = await supabase.rpc("admin_delete_tribe" as never, { _tribe_id: t.id } as never);
    if (error) alert("فشل: " + error.message); else load();
  };

  return (
    <div className="p-4 space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold text-amber-300">🎙️ القبائل والغرف الصوتية</h1>
      {loading && <div className="text-slate-400">جاري التحميل...</div>}

      <section>
        <h2 className="text-lg font-bold mb-2">🎙️ الغرف الصوتية ({rooms.length})</h2>
        <div className="space-y-2">
          {rooms.length === 0 && <div className="text-slate-500 text-sm">لا توجد غرف</div>}
          {rooms.map(r => (
            <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-900 border border-slate-700">
              <div className="text-2xl">🎙️</div>
              <div className="flex-1 min-w-0">
                <div className="font-bold truncate">{r.name}</div>
                <div className="text-xs text-slate-400 truncate">{r.topic || "—"}</div>
                <div className="text-[10px] text-slate-500">أُنشئت {new Date(r.created_at).toLocaleString("ar")}</div>
              </div>
              <button onClick={() => deleteRoom(r)} className="px-3 py-1.5 rounded bg-red-700 text-white text-xs font-bold">🗑️ حذف</button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold mb-2">🏴‍☠️ القبائل ({tribes.length})</h2>
        <div className="space-y-2">
          {tribes.length === 0 && <div className="text-slate-500 text-sm">لا توجد قبائل</div>}
          {tribes.map(t => (
            <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-900 border border-slate-700">
              <div className="text-2xl">{t.emblem}</div>
              <div className="flex-1 min-w-0">
                <div className="font-bold truncate">{t.name}</div>
                <div className="text-xs text-slate-400">المستوى {t.level} • تبرعات {t.total_donations.toLocaleString()} 🪙 • {t.join_mode === "open" ? "🌍 مفتوحة" : "📩 بطلب"}</div>
              </div>
              <button onClick={() => deleteTribe(t)} className="px-3 py-1.5 rounded bg-red-700 text-white text-xs font-bold">🗑️ حذف</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
