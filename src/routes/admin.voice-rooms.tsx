import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/voice-rooms")({
  component: AdminVoiceRooms,
});

type Room = { id: string; name: string; owner_id: string; created_at: string; closed_at: string | null; is_private: boolean; locked: boolean; seat_count: number };
type CBan = { user_id: string; reason: string | null; expires_at: string | null; created_at: string };

function AdminVoiceRooms() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bans, setBans] = useState<CBan[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [owners, setOwners] = useState<Record<string, { display_name: string }>>({});
  const [banUserId, setBanUserId] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banDuration, setBanDuration] = useState("permanent");

  const load = async () => {
    const [{ data: r }, { data: b }] = await Promise.all([
      supabase.from("voice_rooms").select("*").is("closed_at", null).order("created_at", { ascending: false }).limit(200),
      supabase.from("voice_room_creation_bans").select("*").order("created_at", { ascending: false }),
    ]);
    setRooms((r || []) as Room[]);
    setBans((b || []) as CBan[]);
    const ids = [...(r || []).map((x: any) => x.owner_id), ...(b || []).map((x: any) => x.user_id)];
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("id,display_name").in("id", ids);
      const map: Record<string, any> = {};
      (ps || []).forEach((p: any) => { map[p.id] = p; });
      setOwners(map);
    }
    const { data: ms } = await supabase.from("voice_room_members").select("room_id").in("room_id", (r || []).map((x: any) => x.id));
    const cmap: Record<string, number> = {};
    (ms || []).forEach((m: any) => { cmap[m.room_id] = (cmap[m.room_id] || 0) + 1; });
    setCounts(cmap);
  };

  useEffect(() => { load(); }, []);

  const closeRoom = async (id: string) => {
    if (!confirm("إغلاق هذه الغرفة؟")) return;
    await supabase.from("voice_rooms").update({ closed_at: new Date().toISOString() }).eq("id", id);
    load();
  };

  const banCreator = async () => {
    if (!banUserId.trim()) return;
    let expires: string | null = null;
    const now = Date.now();
    if (banDuration === "hour") expires = new Date(now + 60 * 60 * 1000).toISOString();
    else if (banDuration === "day") expires = new Date(now + 24 * 60 * 60 * 1000).toISOString();
    else if (banDuration === "week") expires = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    else if (banDuration === "month") expires = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await (supabase as any).rpc("vr_admin_creation_ban", { _target: banUserId.trim(), _reason: banReason || null, _expires: expires });
    if (error) { alert(error.message); return; }
    setBanUserId(""); setBanReason("");
    load();
  };

  const unbanCreator = async (uid: string) => {
    await (supabase as any).rpc("vr_admin_creation_unban", { _target: uid });
    load();
  };

  return (
    <div className="p-4 space-y-6 text-slate-100" dir="rtl">
      <h1 className="text-2xl font-bold">🎙️ الغرف الصوتية</h1>

      <section className="bg-slate-900 rounded-xl border border-slate-800 p-4">
        <h2 className="font-bold mb-3">الغرف النشطة ({rooms.length})</h2>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {rooms.map(r => (
            <div key={r.id} className="flex items-center gap-3 p-2 bg-slate-800 rounded-lg">
              <div className="flex-1">
                <div className="font-bold">{r.name} {r.is_private && "🔒"} {r.locked && "⛔"}</div>
                <div className="text-xs text-slate-400">صاحبها: {owners[r.owner_id]?.display_name || r.owner_id.slice(0, 8)} • {counts[r.id] || 0}/{r.seat_count}</div>
              </div>
              <button onClick={() => closeRoom(r.id)} className="px-3 py-1 bg-rose-700 rounded text-sm">إغلاق</button>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-slate-900 rounded-xl border border-slate-800 p-4">
        <h2 className="font-bold mb-3">منع لاعب من إنشاء الغرف</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
          <input value={banUserId} onChange={e => setBanUserId(e.target.value)} placeholder="معرف اللاعب (UUID)" className="px-3 py-2 bg-slate-800 rounded border border-slate-700 md:col-span-2" />
          <input value={banReason} onChange={e => setBanReason(e.target.value)} placeholder="السبب" className="px-3 py-2 bg-slate-800 rounded border border-slate-700" />
          <select value={banDuration} onChange={e => setBanDuration(e.target.value)} className="px-3 py-2 bg-slate-800 rounded border border-slate-700">
            <option value="hour">ساعة</option>
            <option value="day">يوم</option>
            <option value="week">أسبوع</option>
            <option value="month">شهر</option>
            <option value="permanent">دائم</option>
          </select>
        </div>
        <button onClick={banCreator} className="px-4 py-2 bg-rose-700 rounded font-bold">حظر من الإنشاء</button>

        <h3 className="font-bold mt-4 mb-2 text-sm text-slate-300">المحظورون ({bans.length})</h3>
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {bans.map(b => (
            <div key={b.user_id} className="flex items-center gap-3 p-2 bg-slate-800 rounded">
              <div className="flex-1 text-sm">
                <div>{owners[b.user_id]?.display_name || b.user_id.slice(0, 8)}</div>
                <div className="text-xs text-slate-400">{b.reason || "—"} • ينتهي: {b.expires_at ? new Date(b.expires_at).toLocaleString("ar") : "دائم"}</div>
              </div>
              <button onClick={() => unbanCreator(b.user_id)} className="px-3 py-1 bg-emerald-700 rounded text-sm">فك</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
