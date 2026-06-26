import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/hooks/use-auth";
import { useEliteVipLevel } from "@/hooks/use-elite-vip";

export const Route = createFileRoute("/rooms")({
  head: () => ({ meta: [{ title: "الغرف الصوتية — ملوك القراصنة" }] }),
  component: () => <AuthGuard><RoomsList /></AuthGuard>,
});

type Room = {
  id: string; owner_id: string; name: string; description: string | null; image_url: string | null;
  seat_count: number; is_private: boolean; allow_mic_requests: boolean; locked: boolean;
  listeners_only: boolean; created_at: string;
};
type Owner = { id: string; display_name: string; avatar_emoji: string; level: number };

function RoomsList() {
  const { user } = useAuth();
  const { level: vipLevel } = useEliteVipLevel();
  const nav = useNavigate();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [owners, setOwners] = useState<Record<string, Owner>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [joinPw, setJoinPw] = useState<{ id: string } | null>(null);
  const [pwInput, setPwInput] = useState("");

  const load = async () => {
    const { data } = await supabase.from("voice_rooms").select("*").is("closed_at", null).order("created_at", { ascending: false }).limit(60);
    const list = (data || []) as Room[];
    setRooms(list);
    const ids = list.map(r => r.owner_id);
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id,display_name,avatar_emoji,level").in("id", ids);
      const map: Record<string, Owner> = {};
      (profs || []).forEach((p: any) => { map[p.id] = p; });
      setOwners(map);
      const { data: members } = await supabase.from("voice_room_members").select("room_id").in("room_id", list.map(r => r.id));
      const cmap: Record<string, number> = {};
      (members || []).forEach((m: any) => { cmap[m.room_id] = (cmap[m.room_id] || 0) + 1; });
      setCounts(cmap);
    }
  };
  useEffect(() => {
    load();
    const ch = supabase.channel("voice-rooms-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "voice_rooms" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "voice_room_members" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const join = async (r: Room, password?: string) => {
    const { error } = await (supabase as any).rpc("vr_join_room", { _room: r.id, _password: password || "" });
    if (error) {
      const msg: Record<string, string> = {
        banned_from_room: "أنت محظور من هذه الغرفة",
        wrong_password: "كلمة المرور خاطئة",
        room_locked: "الغرفة مقفلة حالياً",
        room_not_found: "الغرفة غير موجودة",
      };
      const key = (error.message || "").replace(/^.*?:\s*/, "").trim();
      alert(msg[key] || error.message);
      return;
    }
    setJoinPw(null); setPwInput("");
    nav({ to: "/rooms/$id", params: { id: r.id } });
  };

  return (
    <div className="fixed inset-0 overflow-hidden text-white" dir="rtl"
      style={{ background: "radial-gradient(ellipse at top, #0c4a6e 0%, #082f49 55%, #020617 100%)" }}>
      <div className="absolute top-0 left-0 right-0 z-30 p-2 flex items-center gap-2"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)" }}>
        <Link to="/" className="w-10 h-10 rounded-xl bg-amber-700 border-2 border-amber-300 flex items-center justify-center">↩</Link>
        <div className="flex-1 text-center text-lg font-extrabold text-amber-300">🎙️ الغرف الصوتية</div>
        <button onClick={() => setShowCreate(true)}
          className="px-3 h-10 rounded-xl bg-emerald-600 border-2 border-emerald-300 font-bold text-sm">+ غرفة</button>
      </div>

      <div className="absolute left-2 right-2 overflow-y-auto rounded-2xl bg-stone-950/70 border-2 border-amber-700/60 p-3 space-y-2 pb-6"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 56px)", bottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }}>
        {rooms.length === 0 && (
          <div className="text-center text-amber-200/70 py-12">
            <div className="text-5xl mb-3">🎙️</div>
            <div>لا توجد غرف نشطة. كن أول من ينشئ غرفة!</div>
          </div>
        )}
        {rooms.map(r => {
          const o = owners[r.owner_id];
          return (
            <button key={r.id} onClick={() => r.is_private ? setJoinPw({ id: r.id }) : join(r)}
              className="w-full text-right flex items-center gap-3 p-3 rounded-xl bg-stone-900/70 border border-amber-700/40 hover:border-amber-500 transition">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-b from-amber-600 to-amber-900 flex items-center justify-center overflow-hidden shrink-0">
                {r.image_url ? <img src={r.image_url} alt="" className="w-full h-full object-cover" /> : <span className="text-2xl">🎙️</span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-bold truncate">{r.name}</div>
                  {r.is_private && <span className="text-xs bg-rose-700 px-1.5 py-0.5 rounded">🔒 خاصة</span>}
                  {r.locked && <span className="text-xs bg-stone-700 px-1.5 py-0.5 rounded">مغلقة</span>}
                </div>
                {r.description && <div className="text-xs text-amber-200/60 truncate">{r.description}</div>}
                <div className="text-[11px] text-amber-200/50 mt-0.5">
                  بواسطة {o?.display_name || "..."} • {counts[r.id] || 0} / {r.seat_count} مقعد
                </div>
              </div>
              <div className="text-emerald-400 text-2xl">›</div>
            </button>
          );
        })}
      </div>

      {joinPw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setJoinPw(null)}>
          <div className="bg-stone-900 border-2 border-amber-600 rounded-2xl p-4 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="font-bold text-amber-300 mb-2">كلمة مرور الغرفة</div>
            <input type="password" value={pwInput} onChange={e => setPwInput(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-stone-950 border border-amber-700/60" />
            <div className="flex gap-2 mt-3">
              <button onClick={() => { const r = rooms.find(x => x.id === joinPw.id); if (r) join(r, pwInput); }}
                className="flex-1 py-2 rounded-lg bg-emerald-600 font-bold">دخول</button>
              <button onClick={() => setJoinPw(null)} className="px-4 py-2 rounded-lg bg-stone-700">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateRoomDialog vipLevel={vipLevel} onClose={() => setShowCreate(false)}
          onCreated={(id) => { setShowCreate(false); nav({ to: "/rooms/$id", params: { id } }); }} />
      )}
    </div>
  );
}

function CreateRoomDialog({ vipLevel, onClose, onCreated }: { vipLevel: number; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [seats, setSeats] = useState(8);
  const [isPrivate, setIsPrivate] = useState(false);
  const [password, setPassword] = useState("");
  const [allowMic, setAllowMic] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (name.trim().length < 2) { alert("اسم الغرفة قصير"); return; }
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("vr_create_room", {
      _name: name.trim(), _description: description.trim(), _image_url: "",
      _seats: seats, _is_private: isPrivate, _password: password, _allow_mic_requests: allowMic,
    });
    setBusy(false);
    if (error) {
      const msg: Record<string, string> = {
        vip_required: "إنشاء الغرف متاح فقط لأعضاء VIP",
        creation_banned: "تم منعك من إنشاء الغرف",
        already_owns_room: "لديك غرفة نشطة بالفعل — أغلقها أولاً",
      };
      const key = (error.message || "").replace(/^.*?:\s*/, "").trim();
      alert(msg[key] || error.message);
      return;
    }
    onCreated(data as string);
  };

  if (vipLevel < 1) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
        <div className="bg-stone-900 border-2 border-amber-600 rounded-2xl p-5 w-full max-w-sm text-center" onClick={e => e.stopPropagation()}>
          <div className="text-5xl mb-2">👑</div>
          <div className="font-bold text-amber-300 mb-1">VIP فقط</div>
          <p className="text-sm text-amber-200/70 mb-4">إنشاء الغرف الصوتية متاح فقط لأعضاء Elite VIP.</p>
          <Link to="/vip" className="block py-2 rounded-lg bg-amber-500 text-amber-950 font-bold">احصل على VIP</Link>
          <button onClick={onClose} className="block w-full mt-2 py-2 rounded-lg bg-stone-700 text-sm">إغلاق</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-stone-900 border-2 border-amber-600 rounded-2xl p-4 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="font-bold text-lg text-amber-300 mb-3">إنشاء غرفة صوتية</div>
        <div className="space-y-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="اسم الغرفة *" maxLength={60}
            className="w-full px-3 py-2 rounded-lg bg-stone-950 border border-amber-700/60" />
          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="الوصف (اختياري)" maxLength={300} rows={2}
            className="w-full px-3 py-2 rounded-lg bg-stone-950 border border-amber-700/60" />
          <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="رابط الصورة (اختياري)"
            className="w-full px-3 py-2 rounded-lg bg-stone-950 border border-amber-700/60" />
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>عدد المقاعد ({seats})</span>
            <input type="range" min={2} max={20} value={seats} onChange={e => setSeats(+e.target.value)} className="flex-1" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} /> غرفة خاصة (كلمة مرور)
          </label>
          {isPrivate && (
            <input value={password} onChange={e => setPassword(e.target.value)} placeholder="كلمة المرور" type="text"
              className="w-full px-3 py-2 rounded-lg bg-stone-950 border border-amber-700/60" />
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allowMic} onChange={e => setAllowMic(e.target.checked)} /> السماح بطلبات المايك
          </label>
        </div>
        <div className="flex gap-2 mt-4">
          <button disabled={busy} onClick={submit} className="flex-1 py-2 rounded-lg bg-emerald-600 font-bold disabled:opacity-50">
            {busy ? "..." : "إنشاء"}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-stone-700">إلغاء</button>
        </div>
      </div>
    </div>
  );
}
