import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/hooks/use-auth";
import { PROFILE_PUBLIC_COLUMNS } from "@/lib/profile-columns";

export const Route = createFileRoute("/friends")({
  head: () => ({ meta: [{ title: "الأصدقاء — ملوك القراصنة" }] }),
  component: () => <AuthGuard><FriendsPage /></AuthGuard>,
});

type P = { id: string; display_name: string; avatar_emoji: string; level: number; online_at: string };
type F = { id: string; requester_id: string; addressee_id: string; status: string };

function FriendsPage() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<P[]>([]);
  const [online, setOnline] = useState<P[]>([]);
  const [friends, setFriends] = useState<(F & { profile: P })[]>([]);
  const [requests, setRequests] = useState<(F & { profile: P })[]>([]);
  const [blocked, setBlocked] = useState<P[]>([]);
  const [requestsClosed, setRequestsClosed] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    if (!user) return;
    const fiveMin = new Date(Date.now() - 5 * 60_000).toISOString();
    const [{ data: f }, { data: bl }] = await Promise.all([
      supabase.from("friends").select("*").or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`),
      (supabase as any).from("user_blocks").select("blocked_id").eq("blocker_id", user.id),
    ]);
    const all = (f || []) as F[];
    const friendIds = all
      .filter(x => x.status === "accepted")
      .map(x => x.requester_id === user.id ? x.addressee_id : x.requester_id);
    const { data: on } = friendIds.length
      ? await supabase.from("profiles").select(PROFILE_PUBLIC_COLUMNS).in("id", friendIds).gte("online_at", fiveMin).limit(20)
      : { data: [] as P[] };
    setOnline((on || []) as P[]);
    const ids = new Set<string>();
    all.forEach(x => { ids.add(x.requester_id); ids.add(x.addressee_id); });
    ids.delete(user.id);
    const blockedIds = ((bl as any[]) || []).map(r => r.blocked_id as string);
    blockedIds.forEach(id => ids.add(id));
    const { data: profs } = ids.size ? await supabase.from("profiles").select(PROFILE_PUBLIC_COLUMNS).in("id", Array.from(ids)) : { data: [] as P[] };
    const pMap = new Map((profs || []).map((p: any) => [p.id, p as P]));
    setFriends(all.filter(x => x.status === "accepted").map(x => ({ ...x, profile: pMap.get(x.requester_id === user.id ? x.addressee_id : x.requester_id)! })).filter(x => x.profile));
    setRequests(all.filter(x => x.status === "pending" && x.addressee_id === user.id).map(x => ({ ...x, profile: pMap.get(x.requester_id)! })).filter(x => x.profile));
    setBlocked(blockedIds.map(id => pMap.get(id)).filter(Boolean) as P[]);
    const { data: me } = await supabase.from("profiles").select("friend_requests_closed").eq("id", user.id).maybeSingle();
    setRequestsClosed(!!(me as any)?.friend_requests_closed);
  };
  useEffect(() => {
    if (!user) return;
    reload();
    const ch = supabase
      .channel(`friends-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "friends", filter: `requester_id=eq.${user.id}` }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "friends", filter: `addressee_id=eq.${user.id}` }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const toggleClosed = async () => {
    if (busy) return;
    setBusy(true);
    const next = !requestsClosed;
    const { error } = await (supabase as any).rpc("set_friend_requests_closed", { p_closed: next });
    setBusy(false);
    if (error) { alert("فشل: " + error.message); return; }
    setRequestsClosed(next);
  };
  const acceptAll = async () => {
    if (busy || requests.length === 0) return;
    if (!confirm(`قبول جميع طلبات الصداقة (${requests.length})؟`)) return;
    setBusy(true);
    const { error } = await (supabase as any).rpc("accept_all_friend_requests");
    setBusy(false);
    if (error) { alert("فشل: " + error.message); return; }
    reload();
  };
  const rejectAll = async () => {
    if (busy || requests.length === 0) return;
    if (!confirm(`رفض جميع طلبات الصداقة (${requests.length})؟`)) return;
    setBusy(true);
    const { error } = await (supabase as any).rpc("reject_all_friend_requests");
    setBusy(false);
    if (error) { alert("فشل: " + error.message); return; }
    reload();
  };

  const unblock = async (uid: string) => {
    if (!user) return;
    if (!confirm("إلغاء حظر هذا اللاعب؟")) return;
    await (supabase as any).from("user_blocks").delete().eq("blocker_id", user.id).eq("blocked_id", uid);
    reload();
  };

  const search = async () => {
    if (!q.trim()) return;
    const { data } = await supabase.from("profiles").select(PROFILE_PUBLIC_COLUMNS).ilike("display_name", `%${q}%`).neq("id", user?.id || "").limit(20);
    setResults((data || []) as P[]);
  };

  const sendReq = async (toId: string) => {
    if (!user) return;
    const { data, error } = await (supabase as any).rpc("send_friend_request", { p_target: toId });
    const code = (data?.code || error?.message || "").toString();
    const map: Record<string, string> = {
      sent: "تم إرسال طلب الصداقة ✓",
      accepted_existing: "تم قبول صداقتكم ✓",
      already_sent: "تم إرسال الطلب مسبقاً",
      already_friends: "أنتم أصدقاء بالفعل",
      invalid_target: "طلب غير صالح",
      blocked: "🚫 لا يمكن إرسال طلب صداقة — يوجد حظر بينكما",
      requests_closed: "🔒 هذا اللاعب أوقف استقبال طلبات الصداقة",
    };
    if (map[code]) alert(map[code]);
    reload();
  };
  const accept = async (fid: string) => { await supabase.from("friends").update({ status: "accepted" }).eq("id", fid); reload(); };
  const reject = async (fid: string) => { await supabase.from("friends").delete().eq("id", fid); reload(); };
  const removeFriend = async (fid: string) => {
    if (!confirm("هل تريد إزالة هذا الصديق؟")) return;
    await supabase.from("friends").delete().eq("id", fid);
    reload();
  };

  return (
    <div className="fixed inset-0 overflow-hidden text-white" dir="rtl" style={{ background: "radial-gradient(ellipse at top, #0c4a6e 0%, #082f49 55%, #020617 100%)" }}>
      <div className="absolute top-0 left-0 right-0 z-30 p-2 flex items-center gap-2">
        <Link to="/" className="w-10 h-10 rounded-xl bg-amber-700 border-2 border-amber-300 flex items-center justify-center">↩</Link>
        <div className="flex-1 text-center text-lg font-extrabold text-amber-300">👥 الأصدقاء</div>
        <div className="w-10" />
      </div>
      <div className="absolute top-14 bottom-2 left-2 right-2 overflow-y-auto rounded-2xl bg-stone-950/70 border-2 border-amber-700/60 p-3 pb-6 space-y-4">
        <section>
          <div className="flex gap-2 mb-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="ابحث باسم قبطان..." className="flex-1 px-3 py-2 rounded-lg bg-stone-900 border border-amber-700/40 text-sm" />
            <button onClick={search} className="px-4 rounded-lg bg-amber-500 text-amber-950 font-bold">بحث</button>
          </div>
          {results.length > 0 && (
            <div className="space-y-1">
              {results.map(p => (
                <Row key={p.id} p={p} action={<button onClick={() => sendReq(p.id)} className="text-xs bg-emerald-600 px-2 py-1 rounded">+ صديق</button>} />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-amber-700/40 bg-stone-900/60 p-2.5">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-black text-amber-200">🔒 إيقاف طلبات الصداقة</div>
              <div className="text-[11px] text-amber-100/60">لن يستطيع أحد إرسال طلب صداقة لك.</div>
            </div>
            <button
              onClick={toggleClosed}
              disabled={busy}
              className={`px-3 py-1.5 rounded-lg text-xs font-black shadow active:scale-95 ${requestsClosed ? "bg-rose-600 text-white" : "bg-emerald-600 text-white"}`}
            >
              {requestsClosed ? "موقوفة — تفعيل" : "مفعّلة — إيقاف"}
            </button>
          </div>
        </section>

        {requests.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-1">
              <div className="text-sm font-bold text-amber-300 flex-1">طلبات صداقه ({requests.length})</div>
              <button onClick={acceptAll} disabled={busy} className="text-[11px] bg-emerald-700 hover:bg-emerald-600 px-2 py-1 rounded font-black">قبول الكل</button>
              <button onClick={rejectAll} disabled={busy} className="text-[11px] bg-rose-700 hover:bg-rose-600 px-2 py-1 rounded font-black">رفض الكل</button>
            </div>
            <div className="space-y-1">
              {requests.map(r => (
                <Row key={r.id} p={r.profile} action={
                  <div className="flex gap-1">
                    <button onClick={() => accept(r.id)} className="text-xs bg-emerald-600 px-2 py-1 rounded">قبول</button>
                    <button onClick={() => reject(r.id)} className="text-xs bg-rose-600 px-2 py-1 rounded">رفض</button>
                  </div>
                } />
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="text-sm font-bold text-amber-300 mb-1">متصلين الآن ({online.length})</div>
          <div className="space-y-1 cv-auto">{online.map(p => <Row key={p.id} p={p} action={<span className="w-2 h-2 rounded-full bg-emerald-400" />} />)}</div>
        </section>


        <section>
          <div className="text-sm font-bold text-amber-300 mb-1">أصدقائي ({friends.length})</div>
          <div className="space-y-1 cv-auto">{friends.map(f => <Row key={f.id} p={f.profile} action={
            <div className="flex gap-1">
              <Link
                to="/chat"
                search={{ dm: f.profile?.id ?? "" } as any}
                className="text-xs bg-sky-600 px-2 py-1 rounded"
              >💬</Link>
              <button onClick={() => removeFriend(f.id)} className="text-xs bg-rose-600 px-2 py-1 rounded">إزالة</button>
            </div>
          } />)}</div>
        </section>

        {blocked.length > 0 && (
          <section>
            <div className="text-sm font-bold text-rose-300 mb-1">🚫 المحظورون ({blocked.length})</div>
            <div className="space-y-1">
              {blocked.map(p => (
                <Row key={p.id} p={p} action={
                  <button onClick={() => unblock(p.id)} className="text-xs bg-emerald-600 px-2 py-1 rounded font-bold">إلغاء الحظر</button>
                } />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Row({ p, action }: { p: P; action: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 p-2 bg-stone-900/60 rounded-lg border border-amber-900/40">
      <Link
        to="/p/$id"
        params={{ id: p.id }}
        className="flex items-center gap-2 flex-1 min-w-0 hover:bg-amber-900/20 rounded-md -m-1 p-1 transition-colors"
      >
        <div className="w-9 h-9 rounded-full bg-gradient-to-b from-sky-400 to-sky-700 flex items-center justify-center text-lg shrink-0">{p.avatar_emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate">{p.display_name}</div>
          <div className="text-[10px] text-amber-200/60">المستوى {p.level}</div>
        </div>
      </Link>
      {action}
    </div>
  );
}
