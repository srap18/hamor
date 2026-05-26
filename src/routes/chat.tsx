import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { officerSetTribe, setMyTribe, giftGold } from "@/lib/economy";
import { AuthGuard } from "@/components/AuthGuard";
import { BottomNav } from "@/components/BottomNav";
import { useAuth, useProfile } from "@/hooks/use-auth";
import { QuickReplies } from "@/components/QuickReplies";
import { frameById } from "@/lib/frames";

export const Route = createFileRoute("/chat")({
  head: () => ({ meta: [{ title: "الشات — Ocean Catch" }] }),
  component: () => <AuthGuard><ChatPage /></AuthGuard>,
});

type Channel = "public" | "tribe" | "dm";
type Msg = { id: string; channel: string; sender_id: string; recipient_id: string | null; tribe_id: string | null; body: string; created_at: string; audio_url?: string | null; audio_duration_ms?: number | null };
type Prof = { id: string; display_name: string; avatar_emoji: string; level?: number; coins?: number; avatar_url?: string | null; avatar_frame?: string | null; name_frame?: string | null };

function Avatar({ p, size = 28 }: { p?: Prof | null; size?: number }) {
  const style = { width: size, height: size };
  const frame = frameById(p?.avatar_frame);
  const ringCls = frame?.kind === "avatar" ? frame.ring || "" : "";
  if (p?.avatar_url) {
    return <img src={p.avatar_url} alt={p.display_name || ""} style={style} className={`rounded-full object-cover bg-sky-700 shrink-0 ${ringCls}`} />;
  }
  return <div style={style} className={`rounded-full bg-sky-700 flex items-center justify-center text-sm shrink-0 ${ringCls}`}>{p?.avatar_emoji || "👤"}</div>;
}

function NameBadge({ p, mine }: { p?: Prof | null; mine?: boolean }) {
  const frame = frameById(p?.name_frame);
  const cls = frame?.kind === "name" ? frame.nameClass || "" : "";
  const lvl = typeof p?.level === "number" ? p.level : null;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold ${cls || (mine ? "text-amber-100" : "text-amber-300")}`}>
      <span>{p?.display_name || "..."}</span>
      {lvl !== null && (
        <span className="text-[9px] px-1 rounded bg-black/40 text-amber-200 border border-amber-300/40">Lv {lvl}</span>
      )}
    </span>
  );
}

function ChatPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const [tab, setTab] = useState<Channel>("public");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [profMap, setProfMap] = useState<Map<string, Prof>>(new Map());
  const [text, setText] = useState("");
  const [dmFriends, setDmFriends] = useState<Prof[]>([]);
  const [dmWith, setDmWith] = useState<string | null>(null);
  const [showManage, setShowManage] = useState(false);
  const [supportTarget, setSupportTarget] = useState<Prof | null>(null);
  const [warTarget, setWarTarget] = useState<Prof | null>(null);
  const [actionTarget, setActionTarget] = useState<Prof | null>(null);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set()); // people I blocked
  const [blockedBy, setBlockedBy] = useState<Set<string>>(new Set()); // people who blocked me
  const scrollRef = useRef<HTMLDivElement>(null);

  const reloadBlocks = useCallback(async () => {
    if (!user) return;
    const [a, b] = await Promise.all([
      supabase.from("user_blocks").select("blocked_id").eq("blocker_id", user.id),
      supabase.from("user_blocks").select("blocker_id").eq("blocked_id", user.id),
    ]);
    setBlockedIds(new Set(((a.data as any[]) || []).map(r => r.blocked_id)));
    setBlockedBy(new Set(((b.data as any[]) || []).map(r => r.blocker_id)));
  }, [user]);

  useEffect(() => { reloadBlocks(); }, [reloadBlocks]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: f } = await supabase.from("friends").select("*").eq("status", "accepted")
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);
      const ids = (f || []).map((x: any) => x.requester_id === user.id ? x.addressee_id : x.requester_id);
      if (ids.length) {
        const { data: ps } = await supabase.from("profiles").select("id,display_name,avatar_emoji,avatar_url,level,coins,avatar_frame,name_frame").in("id", ids);
        setDmFriends((ps || []) as Prof[]);
      }
    })();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let q = supabase.from("messages").select("*").order("created_at", { ascending: true }).limit(100);
    if (tab === "public") q = q.eq("channel", "public");
    else if (tab === "tribe" && profile?.tribe_id) q = q.eq("channel", "tribe").eq("tribe_id", profile.tribe_id);
    else if (tab === "dm" && dmWith) q = q.eq("channel", "dm").or(`and(sender_id.eq.${user.id},recipient_id.eq.${dmWith}),and(sender_id.eq.${dmWith},recipient_id.eq.${user.id})`);
    else { setMsgs([]); return; }

    q.then(async ({ data }) => {
      const list = (data || []) as Msg[];
      setMsgs(list);
      const ids = Array.from(new Set(list.map(m => m.sender_id)));
      if (ids.length) {
        const { data: ps } = await supabase.from("profiles").select("id,display_name,avatar_emoji,avatar_url,level,avatar_frame,name_frame").in("id", ids);
        setProfMap(new Map((ps || []).map((p: any) => [p.id, p])));
      }
    });

    const ch = supabase.channel(`msgs-${tab}-${dmWith || ""}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async (payload) => {
        const m = payload.new as Msg;
        let ok = false;
        if (tab === "public" && m.channel === "public") ok = true;
        else if (tab === "tribe" && m.channel === "tribe" && m.tribe_id === profile?.tribe_id) ok = true;
        else if (tab === "dm" && m.channel === "dm" && dmWith && ((m.sender_id === user.id && m.recipient_id === dmWith) || (m.sender_id === dmWith && m.recipient_id === user.id))) ok = true;
        if (!ok) return;
        setMsgs(s => s.some(x => x.id === m.id) ? s : [...s, m]);
        setProfMap(prev => {
          if (prev.has(m.sender_id)) return prev;
          supabase.from("profiles").select("id,display_name,avatar_emoji,avatar_url,level,avatar_frame,name_frame").eq("id", m.sender_id).maybeSingle().then(({ data: p }) => {
            if (p) setProfMap(s => new Map(s).set((p as any).id, p as Prof));
          });
          return prev;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tab, dmWith, user, profile?.tribe_id]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [msgs]);

  const send = useCallback(async (override?: string) => {
    if (!user) return;
    const raw = override ?? text;
    const body = raw.trim().slice(0, 500);
    if (!body) return;
    if (tab === "tribe" && !profile?.tribe_id) return;
    if (tab === "dm" && !dmWith) return;
    if (!override) setText("");
    const row: any = { sender_id: user.id, body, channel: tab };
    if (tab === "tribe") row.tribe_id = profile?.tribe_id;
    if (tab === "dm") row.recipient_id = dmWith;
    const { data, error } = await supabase.from("messages").insert(row).select("*").single();
    if (!error && data) setMsgs(s => s.some(x => x.id === (data as any).id) ? s : [...s, data as Msg]);
    else if (error) alert("تعذر الإرسال: " + error.message);
  }, [user, text, tab, profile?.tribe_id, dmWith]);

  const dmFriendInfo = dmWith ? dmFriends.find(f => f.id === dmWith) : null;

  return (
    <div className="fixed inset-0 overflow-hidden text-white" dir="rtl" style={{ background: "radial-gradient(ellipse at top, #0c4a6e 0%, #082f49 55%, #020617 100%)" }}>
      <div className="absolute top-0 left-0 right-0 z-30 p-2 flex items-center gap-2">
        <Link to="/" className="w-10 h-10 rounded-xl bg-amber-700 border-2 border-amber-300 flex items-center justify-center">↩</Link>
        <div className="flex-1 text-center text-lg font-extrabold text-amber-300">💬 الشات</div>
        {tab === "tribe" && profile?.tribe_id && (
          <button onClick={() => setShowManage(true)} className="w-10 h-10 rounded-xl bg-amber-700 border-2 border-amber-300 flex items-center justify-center">⚙️</button>
        )}
        {!(tab === "tribe" && profile?.tribe_id) && <div className="w-10" />}
      </div>

      <div className="absolute top-14 left-2 right-2 z-20 flex gap-1">
        {(["public", "tribe", "dm"] as Channel[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setDmWith(null); }}
            className={`flex-1 py-1.5 rounded-t-lg text-xs font-bold border-2 border-b-0 ${tab === t ? "bg-amber-500 border-amber-200 text-amber-950" : "bg-stone-900/70 border-amber-900/60 text-amber-200/70"}`}>
            {t === "public" ? "عام" : t === "tribe" ? "القبيله" : "خاص"}
          </button>
        ))}
      </div>

      <div className="absolute top-24 bottom-32 left-2 right-2 rounded-2xl bg-stone-950/70 border-2 border-amber-700/60 overflow-hidden flex flex-col">
        {tab === "dm" && !dmWith ? (
          <div className="flex-1 overflow-y-auto p-3">
            <div className="text-xs text-amber-200/60 mb-2">اختر صديق للمحادثه:</div>
            {dmFriends.length === 0 && <div className="text-center text-amber-100/50 text-sm py-8">لا يوجد أصدقاء بعد. اذهب إلى صفحه الأصدقاء.</div>}
            {dmFriends.map(f => (
              <button key={f.id} onClick={() => setDmWith(f.id)} className="w-full flex items-center gap-2 p-2 hover:bg-amber-900/30 rounded-lg">
                <Avatar p={f} size={32} />
                <div className="text-sm font-bold">{f.display_name}</div>
              </button>
            ))}
          </div>
        ) : tab === "tribe" && !profile?.tribe_id ? (
          <NoTribePanel userId={user?.id || ""} />
        ) : (
          <>
            {tab === "dm" && dmFriendInfo && (
              <div className="flex items-center gap-2 p-2 border-b border-amber-700/40 bg-stone-900/60">
                <button onClick={() => setDmWith(null)} className="text-amber-300 text-sm">←</button>
                <Avatar p={dmFriendInfo} size={28} />
                <div className="flex-1 text-sm font-bold">{dmFriendInfo.display_name}</div>
                <button onClick={() => setSupportTarget(dmFriendInfo)} className="px-2 py-1 rounded bg-emerald-600 text-xs font-bold">🛠️ دعم</button>
                <button onClick={() => setWarTarget(dmFriendInfo)} className="px-2 py-1 rounded bg-red-700 text-xs font-bold">⚔️ حرب</button>
              </div>
            )}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
              {msgs.filter(m => !blockedIds.has(m.sender_id) && !blockedBy.has(m.sender_id)).length === 0 && <div className="text-center text-amber-100/40 text-sm py-8">لا توجد رسائل بعد — كن أول من يكتب</div>}
              {msgs.filter(m => !blockedIds.has(m.sender_id) && !blockedBy.has(m.sender_id)).map(m => {
                const p = profMap.get(m.sender_id);
                const mine = m.sender_id === user?.id;
                return (
                  <div key={m.id} className={`flex gap-2 ${mine ? "flex-row-reverse" : ""}`}>
                    <button type="button" onClick={() => !mine && p && setActionTarget(p)} className="shrink-0">
                      <Avatar p={p} size={28} />
                    </button>
                    <div className={`max-w-[75%] rounded-2xl px-3 py-1.5 ${mine ? "bg-amber-600 text-amber-50" : "bg-stone-800 text-white"}`}>
                      {!mine && (
                        <button type="button" onClick={() => p && setActionTarget(p)} className="hover:opacity-90">
                          <NameBadge p={p} />
                        </button>
                      )}
                      {mine && (
                        <div className="mb-0.5"><NameBadge p={profile as any} mine /></div>
                      )}
                      {m.audio_url ? (
                        <audio controls src={m.audio_url} className="max-w-[200px] h-8" />
                      ) : (
                        <div className="text-sm break-words">{m.body}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <ChatComposer
        text={text}
        setText={setText}
        onSend={send}
        disabled={(tab === "tribe" && !profile?.tribe_id) || (tab === "dm" && !dmWith)}
        userId={user?.id || ""}
        onAudioSent={(m) => setMsgs(s => s.some(x => x.id === m.id) ? s : [...s, m])}
        channel={tab}
        tribeId={profile?.tribe_id || null}
        dmWith={dmWith}
      />


      <BottomNav active="/chat" />

      {showManage && profile?.tribe_id && user && (
        <TribeManageModal tribeId={profile.tribe_id} userId={user.id} onClose={() => setShowManage(false)} />
      )}
      {supportTarget && user && (
        <SupportModal sender={user.id} recipient={supportTarget} onClose={() => setSupportTarget(null)} />
      )}
      {warTarget && user && (
        <WarModal sender={user.id} senderTribe={profile?.tribe_id || null} target={warTarget} onClose={() => setWarTarget(null)} />
      )}
      {actionTarget && user && (
        <ProfileActionsModal
          me={user.id}
          target={actionTarget}
          isBlocked={blockedIds.has(actionTarget.id)}
          onClose={() => setActionTarget(null)}
          onBlocksChanged={reloadBlocks}
        />
      )}
    </div>
  );
}

// ===================== Profile Actions Modal =====================
function ProfileActionsModal({ me, target, isBlocked, onClose, onBlocksChanged }:
  { me: string; target: Prof; isBlocked: boolean; onClose: () => void; onBlocksChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const addFriend = async () => {
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("friends").insert({ requester_id: me, addressee_id: target.id, status: "pending" });
    setBusy(false);
    if (error) setMsg(error.message.includes("duplicate") ? "تم إرسال الطلب مسبقاً" : error.message);
    else setMsg("تم إرسال طلب الصداقه ✓");
  };

  const toggleBlock = async () => {
    setBusy(true); setMsg(null);
    if (isBlocked) {
      await supabase.from("user_blocks").delete().eq("blocker_id", me).eq("blocked_id", target.id);
      setMsg("تم إلغاء الحظر");
    } else {
      const { error } = await supabase.from("user_blocks").insert({ blocker_id: me, blocked_id: target.id });
      if (error) setMsg(error.message);
      else setMsg("تم الحظر");
    }
    setBusy(false);
    onBlocksChanged();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" dir="rtl" onClick={onClose}>
      <div className="w-full max-w-xs bg-stone-950 border-2 border-amber-600 rounded-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <Avatar p={target} size={56} />
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-amber-200 truncate">{target.display_name}</div>
            {typeof target.level === "number" && <div className="text-xs text-amber-300/70">المستوى {target.level}</div>}
          </div>
        </div>
        <Link to="/players/$playerId" params={{ playerId: target.id }} onClick={onClose}
          className="block w-full py-2 rounded-lg bg-sky-600 text-white text-center font-bold text-sm">
          👤 زياره الملف الشخصي
        </Link>
        <button onClick={addFriend} disabled={busy}
          className="w-full py-2 rounded-lg bg-emerald-600 text-white font-bold text-sm disabled:opacity-50">
          ➕ إضافه صديق
        </button>
        <button onClick={toggleBlock} disabled={busy}
          className={`w-full py-2 rounded-lg text-white font-bold text-sm disabled:opacity-50 ${isBlocked ? "bg-stone-700" : "bg-red-700"}`}>
          {isBlocked ? "🔓 إلغاء الحظر" : "🚫 حظر"}
        </button>
        {msg && <div className="text-xs text-amber-300 text-center">{msg}</div>}
        <button onClick={onClose} className="w-full py-2 rounded-lg bg-stone-800 text-amber-200 font-bold text-sm">إغلاق</button>
      </div>
    </div>
  );
}

// ===================== Tribe Management Modal =====================
type Member = { user_id: string; role: string; display_name: string; avatar_emoji: string; level: number };
type JoinReq = { id: string; user_id: string; display_name: string; avatar_emoji: string; level: number };

function TribeManageModal({ tribeId, userId, onClose }: { tribeId: string; userId: string; onClose: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [requests, setRequests] = useState<JoinReq[]>([]);
  const [myRole, setMyRole] = useState<string>("member");
  const [tribeName, setTribeName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: t } = await supabase.from("tribes").select("name").eq("id", tribeId).maybeSingle();
    if (t) setTribeName((t as any).name);
    const { data: ms } = await supabase.from("tribe_members").select("user_id,role").eq("tribe_id", tribeId);
    const mIds = (ms || []).map((m: any) => m.user_id);
    const { data: ps } = mIds.length ? await supabase.from("profiles").select("id,display_name,avatar_emoji,level").in("id", mIds) : { data: [] };
    const pmap = new Map((ps || []).map((p: any) => [p.id, p]));
    const merged: Member[] = (ms || []).map((m: any) => ({
      user_id: m.user_id, role: m.role,
      display_name: (pmap.get(m.user_id) as any)?.display_name || "...",
      avatar_emoji: (pmap.get(m.user_id) as any)?.avatar_emoji || "👤",
      level: (pmap.get(m.user_id) as any)?.level || 1,
    }));
    setMembers(merged);
    const me = merged.find(x => x.user_id === userId);
    setMyRole(me?.role || "member");

    const { data: rs } = await supabase.from("tribe_join_requests").select("id,user_id").eq("tribe_id", tribeId).eq("status", "pending");
    const rIds = (rs || []).map((r: any) => r.user_id);
    const { data: rps } = rIds.length ? await supabase.from("profiles").select("id,display_name,avatar_emoji,level").in("id", rIds) : { data: [] };
    const rpmap = new Map((rps || []).map((p: any) => [p.id, p]));
    setRequests((rs || []).map((r: any) => ({
      id: r.id, user_id: r.user_id,
      display_name: (rpmap.get(r.user_id) as any)?.display_name || "...",
      avatar_emoji: (rpmap.get(r.user_id) as any)?.avatar_emoji || "👤",
      level: (rpmap.get(r.user_id) as any)?.level || 1,
    })));
  }, [tribeId, userId]);

  useEffect(() => { load(); }, [load]);

  const isOfficer = myRole === "owner" || myRole === "moderator";
  const isOwner = myRole === "owner";

  const acceptReq = async (r: JoinReq) => {
    setBusy(true);
    await supabase.from("tribe_members").insert({ tribe_id: tribeId, user_id: r.user_id, role: "member" });
    await officerSetTribe(r.user_id, tribeId);
    await supabase.from("tribe_join_requests").update({ status: "accepted" }).eq("id", r.id);
    setBusy(false); load();
  };
  const rejectReq = async (r: JoinReq) => {
    setBusy(true);
    await supabase.from("tribe_join_requests").update({ status: "rejected" }).eq("id", r.id);
    setBusy(false); load();
  };
  const kick = async (m: Member) => {
    if (m.role === "owner") return alert("لا يمكن طرد المالك");
    if (!confirm(`طرد ${m.display_name}؟`)) return;
    setBusy(true);
    await supabase.from("tribe_members").delete().eq("tribe_id", tribeId).eq("user_id", m.user_id);
    await officerSetTribe(m.user_id, null);
    setBusy(false); load();
  };
  const promote = async (m: Member) => {
    setBusy(true);
    const newRole = m.role === "moderator" ? "member" : "moderator";
    await supabase.from("tribe_members").update({ role: newRole }).eq("tribe_id", tribeId).eq("user_id", m.user_id);
    setBusy(false); load();
  };
  const leaveTribe = async () => {
    if (!confirm("هل تريد مغادرة القبيلة؟")) return;
    setBusy(true);
    await supabase.from("tribe_members").delete().eq("tribe_id", tribeId).eq("user_id", userId);
    await setMyTribe(null);
    setBusy(false);
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" dir="rtl">
      <div className="w-full max-w-md max-h-[90vh] bg-stone-950 border-2 border-amber-700 rounded-2xl flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 p-3 border-b border-amber-700/60 bg-stone-900">
          <div className="flex-1 font-extrabold text-amber-300">⚙️ إدارة القبيلة — {tribeName}</div>
          <button onClick={onClose} className="px-3 py-1 rounded bg-stone-800 text-amber-200">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {isOfficer && requests.length > 0 && (
            <div>
              <div className="text-xs font-bold text-amber-300 mb-2">📩 طلبات الانضمام ({requests.length})</div>
              <div className="space-y-1">
                {requests.map(r => (
                  <div key={r.id} className="flex items-center gap-2 p-2 rounded-lg bg-stone-900 border border-amber-700/30">
                    <div className="w-8 h-8 rounded-full bg-sky-700 flex items-center justify-center">{r.avatar_emoji}</div>
                    <div className="flex-1 text-sm">
                      <div className="font-bold">{r.display_name}</div>
                      <div className="text-[10px] text-amber-300/70">المستوى {r.level}</div>
                    </div>
                    <button disabled={busy} onClick={() => acceptReq(r)} className="px-2 py-1 rounded bg-emerald-600 text-xs font-bold">قبول</button>
                    <button disabled={busy} onClick={() => rejectReq(r)} className="px-2 py-1 rounded bg-red-700 text-xs font-bold">رفض</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="text-xs font-bold text-amber-300 mb-2">👥 الأعضاء ({members.length})</div>
            <div className="space-y-1">
              {members.map(m => (
                <div key={m.user_id} className="flex items-center gap-2 p-2 rounded-lg bg-stone-900 border border-amber-700/30">
                  <div className="w-8 h-8 rounded-full bg-sky-700 flex items-center justify-center">{m.avatar_emoji}</div>
                  <div className="flex-1 text-sm">
                    <div className="font-bold">{m.display_name} {m.role === "owner" ? "👑" : m.role === "moderator" ? "🛡️" : ""}</div>
                    <div className="text-[10px] text-amber-300/70">المستوى {m.level} • {m.role === "owner" ? "المالك" : m.role === "moderator" ? "مشرف" : "عضو"}</div>
                  </div>
                  {isOwner && m.user_id !== userId && m.role !== "owner" && (
                    <>
                      <button disabled={busy} onClick={() => promote(m)} className="px-2 py-1 rounded bg-sky-600 text-xs font-bold">
                        {m.role === "moderator" ? "تنزيل" : "مشرف"}
                      </button>
                      <button disabled={busy} onClick={() => kick(m)} className="px-2 py-1 rounded bg-red-700 text-xs font-bold">طرد</button>
                    </>
                  )}
                  {isOfficer && !isOwner && m.user_id !== userId && m.role === "member" && (
                    <button disabled={busy} onClick={() => kick(m)} className="px-2 py-1 rounded bg-red-700 text-xs font-bold">طرد</button>
                  )}
                </div>
              ))}
            </div>
          </div>
          {!isOwner && (
            <button onClick={leaveTribe} disabled={busy} className="w-full py-2 rounded-lg bg-red-800 text-white font-bold text-sm">مغادرة القبيلة</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ===================== Support Modal =====================
function SupportModal({ sender, recipient, onClose }: { sender: string; recipient: Prof; onClose: () => void }) {
  const [kind, setKind] = useState<"repair" | "crew" | "coins">("repair");
  const [amount, setAmount] = useState(500);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async () => {
    setBusy(true); setErr(null);
    const { error: e1 } = await supabase.from("support_gifts").insert({
      sender_id: sender, recipient_id: recipient.id, kind, amount, message: msg.slice(0, 200),
    });
    if (e1) { setErr(e1.message); setBusy(false); return; }
    const { error: e2 } = await giftGold(recipient.id, amount);
    if (e2) { setErr(e2.message); setBusy(false); return; }
    await supabase.from("messages").insert({
      sender_id: sender, recipient_id: recipient.id, channel: "dm",
      body: `🎁 دعم (${kind === "repair" ? "إصلاح سفن" : kind === "crew" ? "طاقم" : "عملات"}): ${amount} 🪙${msg ? " — " + msg : ""}`,
    });
    setBusy(false); onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" dir="rtl">
      <div className="w-full max-w-sm bg-stone-950 border-2 border-emerald-600 rounded-2xl p-4 space-y-3">
        <div className="font-extrabold text-emerald-300">🛠️ دعم {recipient.display_name}</div>
        <div className="flex gap-1">
          {([["repair","🛠️ إصلاح"],["crew","⚓ طاقم"],["coins","🪙 عملات"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setKind(k as any)}
              className={`flex-1 py-2 rounded-lg text-xs font-bold border ${kind === k ? "bg-emerald-500 text-emerald-950 border-emerald-200" : "bg-stone-900 text-emerald-200 border-emerald-700/40"}`}>{l}</button>
          ))}
        </div>
        <div>
          <div className="text-xs text-emerald-200/70 mb-1">المبلغ (يُخصم من رصيدك)</div>
          <input type="number" value={amount} min={100} onChange={(e) => setAmount(Math.max(100, Number(e.target.value) || 0))}
            className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-emerald-700/40 text-sm text-white" />
        </div>
        <input value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={200} placeholder="رساله مرافقه (اختياري)..."
          className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-emerald-700/40 text-sm text-white" />
        {err && <div className="text-xs text-red-400">{err}</div>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-stone-800 text-white font-bold text-sm">إلغاء</button>
          <button onClick={send} disabled={busy} className="flex-1 py-2 rounded-lg bg-emerald-500 text-emerald-950 font-bold text-sm disabled:opacity-50">
            {busy ? "..." : "إرسال الدعم"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===================== War Modal =====================
function WarModal({ sender, senderTribe, target, onClose }: { sender: string; senderTribe: string | null; target: Prof; onClose: () => void }) {
  const [msg, setMsg] = useState("استعد للمعركه!");
  const [busy, setBusy] = useState(false);

  const declare = async () => {
    setBusy(true);
    const { data: tp } = await supabase.from("profiles").select("tribe_id").eq("id", target.id).maybeSingle();
    await supabase.from("tribe_wars").insert({
      declarer_id: sender, target_id: target.id,
      declarer_tribe_id: senderTribe, target_tribe_id: (tp as any)?.tribe_id || null,
      message: msg.slice(0, 200),
    });
    await supabase.from("messages").insert({
      sender_id: sender, recipient_id: target.id, channel: "dm",
      body: `⚔️ إعلان حرب: ${msg}`,
    });
    setBusy(false); onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" dir="rtl">
      <div className="w-full max-w-sm bg-stone-950 border-2 border-red-700 rounded-2xl p-4 space-y-3">
        <div className="font-extrabold text-red-400">⚔️ إعلان حرب على {target.display_name}</div>
        <div className="text-xs text-red-200/70">سيتم إرسال إشعار للطرف الآخر وتسجيل الحرب.</div>
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={200} rows={3}
          className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-red-700/40 text-sm text-white" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-stone-800 text-white font-bold text-sm">إلغاء</button>
          <button onClick={declare} disabled={busy} className="flex-1 py-2 rounded-lg bg-red-600 text-white font-bold text-sm disabled:opacity-50">
            {busy ? "..." : "أعلن الحرب"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===================== No Tribe Panel (join/create) =====================
type TribeRow = { id: string; name: string; emblem: string; members: number; power: number; };

function NoTribePanel({ userId }: { userId: string }) {
  const [name, setName] = useState("");
  const [emblem, setEmblem] = useState("⚔️");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tribes, setTribes] = useState<TribeRow[]>([]);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"join" | "create">("join");
  const [myRequests, setMyRequests] = useState<Set<string>>(new Set());

  const loadTribes = async () => {
    const { data: ts } = await supabase.from("tribes").select("id,name,emblem").limit(200);
    if (!ts) { setTribes([]); return; }
    const ids = ts.map((t) => t.id);
    if (ids.length === 0) { setTribes([]); return; }
    const { data: mems } = await supabase.from("tribe_members").select("tribe_id,user_id").in("tribe_id", ids);
    const memberByTribe = new Map<string, string[]>();
    (mems || []).forEach((m: any) => {
      const arr = memberByTribe.get(m.tribe_id) || [];
      arr.push(m.user_id);
      memberByTribe.set(m.tribe_id, arr);
    });
    const allUserIds = Array.from(new Set((mems || []).map((m: any) => m.user_id)));
    const levelMap = new Map<string, number>();
    if (allUserIds.length > 0) {
      const { data: profs } = await supabase.from("profiles").select("id,level,xp").in("id", allUserIds);
      (profs || []).forEach((p: any) => {
        levelMap.set(p.id, (p.level || 1) * 100 + Math.floor((p.xp || 0) / 10));
      });
    }
    const rows: TribeRow[] = ts.map((t: any) => {
      const uids = memberByTribe.get(t.id) || [];
      const power = uids.reduce((sum, uid) => sum + (levelMap.get(uid) || 0), 0);
      return { id: t.id, name: t.name, emblem: t.emblem, members: uids.length, power };
    }).sort((a, b) => (b.power + b.members * 50) - (a.power + a.members * 50));
    setTribes(rows);

    const { data: reqs } = await supabase.from("tribe_join_requests").select("tribe_id").eq("user_id", userId).eq("status", "pending");
    setMyRequests(new Set((reqs || []).map((r: any) => r.tribe_id)));
  };

  useEffect(() => { loadTribes(); }, []);

  const filtered = q.trim() ? tribes.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase())) : tribes;

  const createTribe = async () => {
    if (!userId || !name.trim()) return;
    setBusy(true); setErr(null);
    const { data: tribe, error: e1 } = await supabase.from("tribes").insert({ owner_id: userId, name: name.trim().slice(0, 40), emblem }).select("id").single();
    if (e1 || !tribe) { setErr(e1?.message || "تعذر إنشاء القبيلة"); setBusy(false); return; }
    const { error: e2 } = await supabase.from("tribe_members").insert({ tribe_id: tribe.id, user_id: userId, role: "owner" });
    if (e2) { setErr(e2.message); setBusy(false); return; }
    const { error: e3 } = await setMyTribe(tribe.id);
    if (e3) { setErr(e3.message); setBusy(false); return; }
    setBusy(false);
    window.location.reload();
  };

  const requestJoin = async (tribeId: string) => {
    if (!userId) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("tribe_join_requests").insert({ tribe_id: tribeId, user_id: userId, status: "pending" });
    if (error) setErr(error.message);
    setBusy(false); loadTribes();
  };

  return (
    <div className="flex-1 overflow-y-auto p-3">
      <div className="flex gap-1 mb-3">
        <button onClick={() => setMode("join")}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold border ${mode === "join" ? "bg-amber-500 text-amber-950 border-amber-200" : "bg-stone-900 text-amber-200 border-amber-700/40"}`}>
          انضم لقبيلة
        </button>
        <button onClick={() => setMode("create")}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold border ${mode === "create" ? "bg-amber-500 text-amber-950 border-amber-200" : "bg-stone-900 text-amber-200 border-amber-700/40"}`}>
          أنشئ قبيلة
        </button>
      </div>

      {mode === "create" ? (
        <div className="space-y-2">
          <div className="text-xs text-amber-200/70">اختر شعار واسم القبيلة:</div>
          <div className="flex gap-1 flex-wrap">
            {["⚔️", "🏴‍☠️", "⚓", "🐉", "🦈", "👑", "🛡️", "🔱"].map(e => (
              <button key={e} onClick={() => setEmblem(e)}
                className={`w-10 h-10 rounded-lg text-xl border-2 ${emblem === e ? "bg-amber-500 border-amber-200" : "bg-stone-900 border-amber-700/40"}`}>{e}</button>
            ))}
          </div>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="اسم القبيلة..."
            className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-amber-700/40 text-sm text-white" />
          <button onClick={createTribe} disabled={busy || !name.trim()}
            className="w-full py-2 rounded-lg bg-amber-500 text-amber-950 font-bold text-sm disabled:opacity-50">
            {busy ? "جاري الإنشاء…" : "إنشاء القبيلة"}
          </button>
          {err && <div className="text-xs text-red-400">{err}</div>}
        </div>
      ) : (
        <div className="space-y-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث باسم القبيلة..."
            className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-amber-700/40 text-sm text-white" />
          {filtered.length === 0 && <div className="text-center text-amber-100/40 text-sm py-4">لا توجد قبائل</div>}
          {filtered.map(t => {
            const pending = myRequests.has(t.id);
            return (
              <div key={t.id} className="flex items-center gap-2 p-2 rounded-lg bg-stone-900/70 border border-amber-700/40">
                <div className="w-10 h-10 rounded-full bg-sky-800 flex items-center justify-center text-lg">{t.emblem}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-amber-100 truncate">{t.name}</div>
                  <div className="text-[10px] text-amber-300/70">👥 {t.members} • ⚡ {t.power.toLocaleString()}</div>
                </div>
                <button onClick={() => requestJoin(t.id)} disabled={busy || pending}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 text-amber-950 font-bold text-xs disabled:opacity-50">
                  {pending ? "بانتظار القبول" : "طلب انضمام"}
                </button>
              </div>
            );
          })}
          {err && <div className="text-xs text-red-400">{err}</div>}
        </div>
      )}
    </div>
  );
}

// ===================== Chat Composer with Voice Recorder =====================
function ChatComposer({ text, setText, onSend, disabled, userId, onAudioSent, channel, tribeId, dmWith }: {
  text: string; setText: (v: string) => void; onSend: (override?: string) => void; disabled: boolean; userId: string;
  onAudioSent: (m: Msg) => void; channel: Channel; tribeId: string | null; dmWith: string | null;
}) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);

  const stopTimer = () => { if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; } };

  const startRec = async () => {
    if (disabled || recording || uploading) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const duration = Date.now() - startedAtRef.current;
        const blob = new Blob(chunksRef.current, { type: mime });
        if (blob.size < 500) return;
        setUploading(true);
        const ext = mime.includes("webm") ? "webm" : "m4a";
        const path = `${userId}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("chat-audio").upload(path, blob, { contentType: mime, upsert: false });
        if (upErr) { setUploading(false); alert("فشل رفع التسجيل: " + upErr.message); return; }
        const { data: pub } = supabase.storage.from("chat-audio").getPublicUrl(path);
        const row: any = { sender_id: userId, body: "", channel, audio_url: pub.publicUrl, audio_duration_ms: duration };
        if (channel === "tribe") row.tribe_id = tribeId;
        if (channel === "dm") row.recipient_id = dmWith;
        const { data, error } = await supabase.from("messages").insert(row).select("*").single();
        setUploading(false);
        if (error) { alert("تعذر الإرسال: " + error.message); return; }
        if (data) onAudioSent(data as Msg);
      };
      recRef.current = rec;
      startedAtRef.current = Date.now();
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 250);
      rec.start();
      setRecording(true);
    } catch (e: any) {
      alert("لا يمكن الوصول إلى الميكروفون: " + (e?.message || ""));
    }
  };

  const stopRec = (cancel = false) => {
    if (!recording || !recRef.current) return;
    stopTimer();
    setRecording(false);
    if (cancel) chunksRef.current = [];
    try { recRef.current.stop(); } catch {}
  };

  useEffect(() => () => stopTimer(), []);

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSend(); }} className="absolute bottom-[76px] left-2 right-2 z-40 flex gap-2">
      {recording ? (
        <>
          <div className="flex-1 px-3 py-2 rounded-lg bg-red-900/60 border border-red-500/60 text-sm text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            🎤 جاري التسجيل... {elapsed}ث
          </div>
          <button type="button" onClick={() => stopRec(true)} className="px-3 rounded-lg bg-stone-700 text-white font-bold">إلغاء</button>
          <button type="button" onClick={() => stopRec(false)} className="px-4 rounded-lg bg-emerald-500 text-emerald-950 font-bold">إرسال</button>
        </>
      ) : (
        <>
          <QuickReplies onSend={(t) => onSend(t)} disabled={disabled || uploading} />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            disabled={disabled || uploading}
            placeholder={uploading ? "جاري رفع التسجيل..." : "اكتب رساله..."}
            className="flex-1 px-3 py-2 rounded-lg bg-stone-900 border border-amber-700/40 text-sm text-white disabled:opacity-50"
          />
          <button type="button" onClick={startRec} disabled={disabled || uploading}
            className="px-3 rounded-lg bg-red-600 text-white font-bold disabled:opacity-50" title="تسجيل صوتي">🎤</button>
          <button type="submit" disabled={disabled || uploading} className="px-4 rounded-lg bg-amber-500 text-amber-950 font-bold disabled:opacity-50">إرسال</button>
        </>
      )}
    </form>
  );
}

