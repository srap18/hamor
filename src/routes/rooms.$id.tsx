import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { getLivekitToken } from "@/lib/livekit-token.functions";
import { Room as LKRoom, RoomEvent, Track, createLocalAudioTrack } from "livekit-client";

export const Route = createFileRoute("/rooms/$id")({
  head: () => ({ meta: [{ title: "غرفة صوتية — ملوك القراصنة" }] }),
  component: () => <AuthGuard><RoomView /></AuthGuard>,
});

type Room = {
  id: string; owner_id: string; name: string; description: string | null; image_url: string | null;
  seat_count: number; is_private: boolean; allow_mic_requests: boolean; locked: boolean;
  listeners_only: boolean; closed_at: string | null; created_at: string;
};
type Member = {
  room_id: string; user_id: string; role: "owner" | "mod" | "speaker" | "listener";
  seat_index: number | null; muted: boolean; speaking: boolean; last_seen_at?: string | null;
};

type Profile = { id: string; display_name: string; avatar_emoji: string; level: number; avatar_url?: string | null };
type Req = { id: string; user_id: string; created_at: string };
type Msg = { id: string; user_id: string; content: string; pinned: boolean; deleted: boolean; created_at: string };

function RoomView() {
  const { id } = useParams({ from: "/rooms/$id" });
  const { user } = useAuth();
  const nav = useNavigate();
  const [room, setRoom] = useState<Room | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [requests, setRequests] = useState<Req[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chatText, setChatText] = useState("");
  const [showRequests, setShowRequests] = useState(false);
  const [lkConfigured, setLkConfigured] = useState<boolean | null>(null);
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const lkRoomRef = useRef<LKRoom | null>(null);
  const fetchToken = useServerFn(getLivekitToken);


  const me = members.find(m => m.user_id === user?.id);
  const isOwner = room?.owner_id === user?.id;
  const isMod = me?.role === "mod" || isOwner;
  const isSpeaker = me?.role === "speaker" || me?.role === "owner" || me?.role === "mod";

  const loadAll = useCallback(async () => {
    const [{ data: r }, { data: ms }, { data: rqs }, { data: msgs }] = await Promise.all([
      supabase.from("voice_rooms").select("*").eq("id", id).maybeSingle(),
      supabase.from("voice_room_members").select("*").eq("room_id", id),
      supabase.from("voice_room_requests").select("id,user_id,created_at").eq("room_id", id).eq("status", "pending").order("created_at"),
      supabase.from("voice_room_messages").select("*").eq("room_id", id).eq("deleted", false).order("created_at", { ascending: false }).limit(80),
    ]);
    setRoom(r as Room | null);
    setMembers((ms || []) as Member[]);
    setRequests((rqs || []) as Req[]);
    setMessages(((msgs || []) as Msg[]).reverse());
    const ids = new Set<string>([...(ms || []).map((x: any) => x.user_id), ...(msgs || []).map((x: any) => x.user_id), ...(rqs || []).map((x: any) => x.user_id)]);
    if (ids.size) {
      const { data: ps } = await supabase.from("profiles").select("id,display_name,avatar_emoji,level,avatar_url").in("id", Array.from(ids));
      const map: Record<string, Profile> = {};
      (ps || []).forEach((p: any) => { map[p.id] = p; });
      setProfiles(prev => ({ ...prev, ...map }));
    }
  }, [id]);

  // Auto-join + realtime + heartbeat
  useEffect(() => {
    if (!user) return;
    (supabase as any).rpc("vr_join_room", { _room: id, _password: "" }).then(loadAll);
    const ch = supabase.channel(`vr-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "voice_rooms", filter: `id=eq.${id}` }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "voice_room_members", filter: `room_id=eq.${id}` }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "voice_room_requests", filter: `room_id=eq.${id}` }, () => loadAll())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "voice_room_messages", filter: `room_id=eq.${id}` }, () => loadAll())
      .subscribe();
    const beat = setInterval(() => { (supabase as any).rpc("vr_heartbeat", { _room: id }); }, 20000);
    const refetch = setInterval(loadAll, 15000); // safety refetch
    return () => { supabase.removeChannel(ch); clearInterval(beat); clearInterval(refetch); };
  }, [id, user, loadAll]);


  // Connect to LiveKit
  useEffect(() => {
    if (!user || !room) return;
    let active = true;
    (async () => {
      try {
        const res = await fetchToken({ data: { roomId: id, canPublish: isSpeaker } });
        if (!active) return;
        if (!res.configured) { setLkConfigured(false); return; }
        setLkConfigured(true);
        if (lkRoomRef.current) await lkRoomRef.current.disconnect();
        const lk = new LKRoom({ adaptiveStream: true, dynacast: true });
        lkRoomRef.current = lk;
        const refreshOnline = () => {
          if (!user) return;
          const ids = new Set<string>([user.id]);
          lk.remoteParticipants.forEach(p => { if (p.identity) ids.add(p.identity); });
          setOnlineIds(ids);
        };
        lk.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
          setSpeakingIds(new Set(speakers.map(s => s.identity)));
        });
        lk.on(RoomEvent.ParticipantConnected, refreshOnline);
        lk.on(RoomEvent.ParticipantDisconnected, refreshOnline);
        lk.on(RoomEvent.Connected, refreshOnline);
        await lk.connect(res.url, res.token);
        refreshOnline();

        if (isSpeaker && !me?.muted) {
          const track = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true });
          await lk.localParticipant.publishTrack(track);
        }
      } catch (e) {
        console.error("LiveKit error", e);
      }
    })();
    return () => { active = false; lkRoomRef.current?.disconnect(); lkRoomRef.current = null; };
  }, [id, user, room?.id, isSpeaker, me?.muted, fetchToken]);

  const leave = async () => {
    await (supabase as any).rpc("vr_leave_room", { _room: id });
    nav({ to: "/rooms" });
  };

  const requestMic = async () => {
    const { error } = await (supabase as any).rpc("vr_request_mic", { _room: id });
    if (error) alert(error.message); else alert("تم إرسال الطلب");
  };

  const modAct = async (target: string, action: string, details: any = {}) => {
    const { error } = await (supabase as any).rpc("vr_mod_action", { _room: id, _target: target, _action: action, _details: details });
    if (error) alert(error.message);
  };

  const resolveReq = async (req: string, accept: boolean) => {
    const { error } = await (supabase as any).rpc("vr_resolve_request", { _req: req, _accept: accept });
    if (error) alert(error.message);
  };

  const sendMsg = async () => {
    const t = chatText.trim();
    if (!t || !user) return;
    setChatText("");
    await supabase.from("voice_room_messages").insert({ room_id: id, user_id: user.id, content: t });
  };

  const toggleMic = async () => {
    if (!me || !user) return;
    const lk = lkRoomRef.current;
    const wasMuted = me.muted;
    try {
      if (wasMuted) {
        const { error } = await (supabase as any).from("voice_room_members").update({ muted: false }).eq("room_id", id).eq("user_id", user.id);
        if (error) { alert("تعذر فتح المايك: " + error.message); return; }
        if (lk && lk.localParticipant.audioTrackPublications.size === 0) {
          try {
            const track = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true });
            await lk.localParticipant.publishTrack(track);
          } catch (e: any) {
            alert("تعذر الوصول للمايكروفون: " + (e?.message || e));
          }
        } else if (lk) {
          lk.localParticipant.audioTrackPublications.forEach(p => p.track && p.track.unmute());
        }
      } else {
        const { error } = await (supabase as any).from("voice_room_members").update({ muted: true }).eq("room_id", id).eq("user_id", user.id);
        if (error) { alert("تعذر كتم المايك: " + error.message); return; }
        if (lk) {
          lk.localParticipant.audioTrackPublications.forEach(p => p.track && p.track.mute());
        }
      }
      loadAll();
    } catch (e: any) {
      console.error("[toggleMic]", e);
      alert("خطأ: " + (e?.message || e));
    }
  };

  const takeSeat = async (seat: number) => {
    const { error } = await (supabase as any).rpc("vr_take_seat", { _room: id, _seat: seat });
    if (error) {
      const map: Record<string, string> = {
        seat_taken: "المقعد محجوز",
        listeners_only: "الغرفة للاستماع فقط",
        banned_from_room: "أنت محظور من هذه الغرفة",
        invalid_seat: "مقعد غير صحيح",
      };
      alert(map[error.message] || error.message);
    } else {
      loadAll();
    }
  };

  const leaveSeat = async () => {
    await (supabase as any).rpc("vr_leave_seat", { _room: id });
    loadAll();
  };

  // Filter out stale members (no heartbeat for > 90 seconds) so the room
  // shows only people who are actually still there.
  const STALE_MS = 90_000;
  const now = Date.now();
  const liveMembers = useMemo(() => members.filter(m => {
    if (m.user_id === user?.id) return true;
    if (onlineIds.has(m.user_id)) return true;
    const ts = m.last_seen_at ? new Date(m.last_seen_at).getTime() : 0;
    return now - ts < STALE_MS;
  }), [members, user?.id, onlineIds, now]);

  const seats = useMemo(() => {
    const arr: (Member | null)[] = Array.from({ length: room?.seat_count || 8 }, () => null);
    liveMembers.forEach(m => { if (m.seat_index !== null && m.seat_index < arr.length) arr[m.seat_index] = m; });
    return arr;
  }, [liveMembers, room?.seat_count]);

  const listeners = liveMembers.filter(m => m.seat_index === null);


  if (!room) return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center" dir="rtl">جاري التحميل...</div>;
  if (room.closed_at) return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center gap-3" dir="rtl">
      <div className="text-5xl">🚪</div>
      <div>تم إغلاق الغرفة</div>
      <Link to="/rooms" className="px-4 py-2 bg-amber-600 rounded-lg">رجوع</Link>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden text-white flex flex-col" dir="rtl"
      style={{ background: "radial-gradient(ellipse at top, #1e1b4b 0%, #0f172a 60%, #000 100%)" }}>
      {/* Header */}
      <div
        className="px-2 pb-2 flex items-center gap-2 border-b border-white/10"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
      >
        <button onClick={leave} aria-label="خروج" className="w-10 h-10 shrink-0 rounded-xl bg-rose-700 border-2 border-rose-400 flex items-center justify-center text-lg">✕</button>
        <div className="flex-1 min-w-0">
          <div className="font-bold truncate">{room.name}</div>
          <div className="text-[11px] text-white/60">{members.length} موجود • {room.is_private ? "🔒 خاصة" : "🌐 عامة"}</div>
        </div>
        {isMod && (
          <button onClick={() => setShowRequests(true)} className="relative px-3 h-10 shrink-0 rounded-xl bg-amber-600 font-bold text-sm">
            طلبات
            {requests.length > 0 && <span className="absolute -top-1 -right-1 bg-rose-600 rounded-full text-[10px] px-1.5">{requests.length}</span>}
          </button>
        )}
      </div>


      {/* Seats grid */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-4 gap-3">
          {seats.map((m, i) => {
            const p = m ? profiles[m.user_id] : null;
            const speaking = m && speakingIds.has(m.user_id);
            const isMine = m?.user_id === user?.id;
            const canTake = !m && i !== 0 && !room.listeners_only;
            const handleSeatClick = () => {
              if (canTake) takeSeat(i);
              else if (isMine && me?.role === "speaker") {
                if (confirm("النزول من المايك؟")) leaveSeat();
              }
            };
            return (
              <div key={i} className="flex flex-col items-center gap-1">
                <button
                  onClick={handleSeatClick}
                  disabled={!canTake && !isMine}
                  className={`relative w-16 h-16 rounded-full flex items-center justify-center text-2xl transition
                    ${m ? "bg-gradient-to-b from-amber-500 to-amber-800" : "bg-white/5 border-2 border-dashed border-white/20"}
                    ${speaking ? "ring-4 ring-emerald-400 animate-pulse" : ""}
                    ${canTake ? "hover:bg-emerald-700/30 hover:border-emerald-400 cursor-pointer active:scale-95" : ""}`}
                >
                  {p ? (p.avatar_url ? <img src={p.avatar_url} className="w-full h-full object-cover rounded-full" alt="" /> : <span>{p.avatar_emoji}</span>)
                     : <span className="text-white/30 text-3xl">+</span>}
                  {m?.muted && <div className="absolute -bottom-1 -right-1 bg-rose-600 w-6 h-6 rounded-full flex items-center justify-center text-xs">🔇</div>}
                  {m && onlineIds.has(m.user_id) && !m.muted && <div className="absolute -bottom-1 -right-1 bg-emerald-500 w-4 h-4 rounded-full border-2 border-stone-900" title="متصل"></div>}
                  {m?.role === "owner" && <div className="absolute -top-1 -left-1 bg-amber-400 text-amber-950 text-[10px] rounded px-1 font-bold">👑</div>}
                  {m?.role === "mod" && <div className="absolute -top-1 -left-1 bg-sky-500 text-white text-[10px] rounded px-1 font-bold">⚔</div>}
                </button>
                <div className="text-[11px] truncate w-full text-center">
                  {p?.display_name || (canTake ? <span className="text-emerald-400">اجلس هنا</span> : `مقعد ${i + 1}`)}
                </div>
                {isMod && m && m.user_id !== user?.id && (
                  <SeatMenu memberId={m.user_id} onAction={(act) => modAct(m.user_id, act)} role={m.role} isOwner={isOwner} />
                )}
              </div>
            );
          })}

        </div>

        {/* Listeners */}
        {listeners.length > 0 && (
          <div className="mt-4">
            <div className="text-xs text-white/60 mb-2">المستمعون ({listeners.length}) • <span className="text-emerald-400">{listeners.filter(m => onlineIds.has(m.user_id)).length} متصل</span></div>
            <div className="flex flex-wrap gap-2">
              {listeners.map(m => {
                const p = profiles[m.user_id];
                const online = onlineIds.has(m.user_id);
                return (
                  <div key={m.user_id} className={`flex items-center gap-1.5 rounded-full pl-2 pr-1 py-1 ${online ? "bg-emerald-900/40 border border-emerald-500/40" : "bg-white/5 border border-white/10 opacity-60"}`}>
                    <span className={`w-2 h-2 rounded-full ${online ? "bg-emerald-400" : "bg-stone-500"}`}></span>
                    <span className="text-xs truncate max-w-[80px]">{p?.display_name || "..."}</span>
                    <div className="w-6 h-6 rounded-full bg-stone-700 flex items-center justify-center text-xs">{p?.avatar_emoji}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}


        {/* Chat */}
        <div className="mt-4 space-y-1.5">
          {messages.map(msg => {
            const p = profiles[msg.user_id];
            return (
              <div key={msg.id} className="flex items-start gap-2 text-sm">
                <span className="text-amber-300 font-bold shrink-0">{p?.display_name || "..."}:</span>
                <span className="flex-1 break-words">{msg.content}</span>
                {isMod && <button onClick={() => supabase.from("voice_room_messages").update({ deleted: true }).eq("id", msg.id)} className="text-rose-400 text-xs">×</button>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom bar */}
      <div
        className="px-2 pt-2 border-t border-white/10 flex items-center gap-2"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }}
      >
        {isSpeaker ? (
          <button onClick={toggleMic} aria-label={me?.muted ? "فتح المايك" : "كتم المايك"} className={`w-12 h-12 shrink-0 rounded-full font-bold text-2xl flex items-center justify-center ${me?.muted ? "bg-rose-600" : "bg-emerald-600"}`}>
            {me?.muted ? "🔇" : "🎤"}
          </button>
        ) : room.allow_mic_requests && !room.listeners_only ? (
          <button onClick={requestMic} className="px-3 h-12 shrink-0 rounded-full bg-amber-600 font-bold text-sm">✋ طلب مايك</button>
        ) : null}
        <input value={chatText} onChange={e => setChatText(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMsg()}
          placeholder="اكتب رسالة..." className="flex-1 min-w-0 h-12 px-3 rounded-full bg-white/10 border border-white/20" />
        <button onClick={sendMsg} className="px-4 h-12 shrink-0 rounded-full bg-sky-600 font-bold">إرسال</button>
      </div>


      {lkConfigured === false && (
        <div className="absolute top-14 left-2 right-2 bg-amber-900/90 text-amber-100 text-xs p-2 rounded-lg border border-amber-500">
          ⚠️ الصوت الحقيقي غير مُفعل بعد. أضف مفاتيح LiveKit لتشغيل المايك.
        </div>
      )}

      {/* Requests modal */}
      {showRequests && isMod && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setShowRequests(false)}>
          <div className="bg-stone-900 border-2 border-amber-600 rounded-2xl p-4 w-full max-w-md max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="font-bold text-amber-300 mb-3">طلبات المايك ({requests.length})</div>
            {requests.length === 0 && <div className="text-center text-white/50 py-6">لا توجد طلبات</div>}
            {requests.map(rq => {
              const p = profiles[rq.user_id];
              return (
                <div key={rq.id} className="flex items-center gap-2 p-2 bg-stone-800 rounded-lg mb-2">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-b from-amber-500 to-amber-800 flex items-center justify-center">{p?.avatar_emoji}</div>
                  <div className="flex-1">
                    <div className="font-bold text-sm">{p?.display_name}</div>
                    <div className="text-[11px] text-white/50">مستوى {p?.level}</div>
                  </div>
                  <button onClick={() => resolveReq(rq.id, true)} className="px-3 py-1 bg-emerald-600 rounded text-sm">قبول</button>
                  <button onClick={() => resolveReq(rq.id, false)} className="px-3 py-1 bg-rose-600 rounded text-sm">رفض</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SeatMenu({ memberId, role, isOwner, onAction }: { memberId: string; role: string; isOwner: boolean; onAction: (a: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="text-[10px] text-white/60 hover:text-white">⚙️</button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" onClick={() => setOpen(false)}>
          <div className="bg-stone-900 border-t-2 border-amber-600 rounded-t-2xl p-3 w-full max-w-md space-y-1" onClick={e => e.stopPropagation()}>
            <button onClick={() => { onAction("mute"); setOpen(false); }} className="w-full text-right p-2 hover:bg-stone-800 rounded">🔇 كتم</button>
            <button onClick={() => { onAction("unmute"); setOpen(false); }} className="w-full text-right p-2 hover:bg-stone-800 rounded">🔊 فك الكتم</button>
            <button onClick={() => { onAction("remove_mic"); setOpen(false); }} className="w-full text-right p-2 hover:bg-stone-800 rounded">⬇️ إنزال من المايك</button>
            <button onClick={() => { onAction("kick"); setOpen(false); }} className="w-full text-right p-2 hover:bg-stone-800 rounded text-orange-400">👢 طرد</button>
            <button onClick={() => { onAction("ban"); setOpen(false); }} className="w-full text-right p-2 hover:bg-stone-800 rounded text-rose-400">🚫 حظر</button>
            {isOwner && role !== "mod" && <button onClick={() => { onAction("set_mod"); setOpen(false); }} className="w-full text-right p-2 hover:bg-stone-800 rounded text-sky-400">⚔ تعيين مشرف</button>}
            {isOwner && role === "mod" && <button onClick={() => { onAction("remove_mod"); setOpen(false); }} className="w-full text-right p-2 hover:bg-stone-800 rounded">إزالة المشرف</button>}
            {isOwner && <button onClick={() => { if (confirm("نقل ملكية الغرفة لهذا اللاعب؟")) { onAction("transfer_owner"); setOpen(false); } }} className="w-full text-right p-2 hover:bg-stone-800 rounded text-amber-400">👑 نقل الملكية</button>}
            <button onClick={() => setOpen(false)} className="w-full p-2 bg-stone-800 rounded mt-2">إلغاء</button>
          </div>
        </div>
      )}
    </>
  );
}
