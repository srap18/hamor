import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthGuard } from "@/components/AuthGuard";
import { BottomNav } from "@/components/BottomNav";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/friends")({
  head: () => ({ meta: [{ title: "الأصدقاء — Ocean Catch" }] }),
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

  const reload = async () => {
    if (!user) return;
    const fiveMin = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: on } = await supabase.from("profiles").select("*").gte("online_at", fiveMin).neq("id", user.id).limit(20);
    setOnline((on || []) as P[]);

    const { data: f } = await supabase.from("friends").select("*").or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);
    const all = (f || []) as F[];
    const ids = new Set<string>();
    all.forEach(x => { ids.add(x.requester_id); ids.add(x.addressee_id); });
    ids.delete(user.id);
    const { data: profs } = ids.size ? await supabase.from("profiles").select("*").in("id", Array.from(ids)) : { data: [] as P[] };
    const pMap = new Map((profs || []).map((p: any) => [p.id, p as P]));
    setFriends(all.filter(x => x.status === "accepted").map(x => ({ ...x, profile: pMap.get(x.requester_id === user.id ? x.addressee_id : x.requester_id)! })).filter(x => x.profile));
    setRequests(all.filter(x => x.status === "pending" && x.addressee_id === user.id).map(x => ({ ...x, profile: pMap.get(x.requester_id)! })).filter(x => x.profile));
  };
  useEffect(() => { reload(); }, [user]);

  const search = async () => {
    if (!q.trim()) return;
    const { data } = await supabase.from("profiles").select("*").ilike("display_name", `%${q}%`).neq("id", user?.id || "").limit(20);
    setResults((data || []) as P[]);
  };

  const sendReq = async (toId: string) => {
    if (!user) return;
    await supabase.from("friends").insert({ requester_id: user.id, addressee_id: toId, status: "pending" });
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
      <div className="absolute top-14 bottom-16 left-2 right-2 overflow-y-auto rounded-2xl bg-stone-950/70 border-2 border-amber-700/60 p-3 space-y-4">
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

        {requests.length > 0 && (
          <section>
            <div className="text-sm font-bold text-amber-300 mb-1">طلبات صداقه</div>
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
          <div className="space-y-1">{online.map(p => <Row key={p.id} p={p} action={<span className="w-2 h-2 rounded-full bg-emerald-400" />} />)}</div>
        </section>

        <section>
          <div className="text-sm font-bold text-amber-300 mb-1">أصدقائي ({friends.length})</div>
          <div className="space-y-1">{friends.map(f => <Row key={f.id} p={f.profile} action={<Link to="/chat" className="text-xs bg-sky-600 px-2 py-1 rounded">💬</Link>} />)}</div>
        </section>
      </div>
      <BottomNav active="/friends" />
    </div>
  );
}

function Row({ p, action }: { p: P; action: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 p-2 bg-stone-900/60 rounded-lg border border-amber-900/40">
      <div className="w-9 h-9 rounded-full bg-gradient-to-b from-sky-400 to-sky-700 flex items-center justify-center text-lg">{p.avatar_emoji}</div>
      <div className="flex-1">
        <div className="text-sm font-bold">{p.display_name}</div>
        <div className="text-[10px] text-amber-200/60">المستوى {p.level}</div>
      </div>
      {action}
    </div>
  );
}
