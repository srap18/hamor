import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/referrals")({
  component: AdminReferralsPage,
  ssr: false,
  head: () => ({ meta: [{ title: "الدعوات — لوحة التحكم" }] }),
});

type Row = {
  inviter_id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  avatar_emoji: string | null;
  clean_invites: number;
  blocked_invites: number;
  gems_earned: number;
  last_invite_at: string | null;
};

type Weekly = {
  inviter_id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  avatar_emoji: string | null;
  invites_count: number;
  gems_earned: number;
  rank: number;
};

function AdminReferralsPage() {
  const [tab, setTab] = useState<"weekly" | "all">("weekly");
  const [rows, setRows] = useState<Row[]>([]);
  const [weekly, setWeekly] = useState<Weekly[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [giftUser, setGiftUser] = useState<Row | Weekly | null>(null);
  const [giftAmount, setGiftAmount] = useState("500");
  const [giftNote, setGiftNote] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: all, error: e1 }, { data: wk, error: e2 }] = await Promise.all([
        (supabase as any).rpc("admin_get_referrals_overview", { p_limit: 500 }),
        (supabase as any).rpc("get_referral_leaderboard_weekly", { p_limit: 100 }),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      setRows((all as Row[]) || []);
      setWeekly((wk as Weekly[]) || []);
    } catch (e: any) {
      toast.error(e?.message || "تعذّر تحميل البيانات");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = (tab === "all" ? rows : weekly).filter((r: any) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (
      (r.display_name || "").toLowerCase().includes(s) ||
      (r.username || "").toLowerCase().includes(s)
    );
  });

  async function grantGift() {
    if (!giftUser) return;
    const gems = parseInt(giftAmount, 10);
    if (!gems || gems <= 0) {
      toast.error("أدخل عدد جواهر صحيح");
      return;
    }
    try {
      const { data, error } = await (supabase as any).rpc("admin_grant_referral_gift", {
        p_user_id: (giftUser as any).inviter_id,
        p_gems: gems,
        p_note: giftNote.trim() || null,
      });
      if (error) throw error;
      if (!(data as any)?.ok) throw new Error((data as any)?.reason || "فشل");
      toast.success(`تم منح ${gems} جوهرة لـ ${(giftUser as any).display_name}`);
      setGiftUser(null);
      setGiftAmount("500");
      setGiftNote("");
      load();
    } catch (e: any) {
      toast.error(e?.message || "فشل المنح");
    }
  }

  async function grantTop10Weekly(gemsEach: number) {
    if (!weekly.length) return;
    if (!confirm(`منح ${gemsEach} جوهرة لأعلى ${Math.min(10, weekly.length)} داعين هذا الأسبوع؟`)) return;
    setBroadcasting(true);
    let ok = 0;
    for (const w of weekly.slice(0, 10)) {
      try {
        const { data, error } = await (supabase as any).rpc("admin_grant_referral_gift", {
          p_user_id: w.inviter_id,
          p_gems: gemsEach,
          p_note: `جائزة الترتيب #${w.rank} في مسابقة الدعوات الأسبوعية`,
        });
        if (!error && (data as any)?.ok) ok++;
      } catch {}
    }
    setBroadcasting(false);
    toast.success(`تم منح ${ok} لاعب`);
    load();
  }

  return (
    <div dir="rtl" className="p-4 md:p-6 max-w-6xl mx-auto text-slate-100">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
          🎁 لوحة الدعوات
        </h1>
        <button
          onClick={load}
          className="text-xs px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700"
        >
          🔄 تحديث
        </button>
      </div>

      {/* Quick contest actions */}
      <div className="rounded-xl bg-gradient-to-br from-amber-900/30 to-orange-900/20 border border-amber-500/30 p-4 mb-4">
        <div className="text-sm font-bold text-amber-200 mb-2">⚡ مسابقة أسبوعية سريعة</div>
        <div className="text-xs text-amber-100/70 mb-3">
          امنح جوائز فورية لأعلى 10 داعين هذا الأسبوع
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={broadcasting || !weekly.length}
            onClick={() => grantTop10Weekly(5000)}
            className="text-xs px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50"
          >
            🥇 5000 💎 للأعلى 10
          </button>
          <button
            disabled={broadcasting || !weekly.length}
            onClick={() => grantTop10Weekly(2000)}
            className="text-xs px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 disabled:opacity-50"
          >
            2000 💎 للأعلى 10
          </button>
          <button
            disabled={broadcasting || !weekly.length}
            onClick={() => grantTop10Weekly(1000)}
            className="text-xs px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
          >
            1000 💎 للأعلى 10
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setTab("weekly")}
          className={`px-4 py-2 rounded-lg text-sm font-bold ${tab === "weekly" ? "bg-indigo-600" : "bg-slate-800"}`}
        >
          🏆 الأسبوعي
        </button>
        <button
          onClick={() => setTab("all")}
          className={`px-4 py-2 rounded-lg text-sm font-bold ${tab === "all" ? "bg-indigo-600" : "bg-slate-800"}`}
        >
          📊 كل الوقت
        </button>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="بحث بالاسم أو المعرّف"
        className="w-full mb-3 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm"
      />

      {loading ? (
        <div className="text-center py-8 text-slate-400">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-slate-400">لا يوجد داعين بعد</div>
      ) : (
        <div className="rounded-xl border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400 text-xs">
              <tr>
                <th className="p-2 text-right">#</th>
                <th className="p-2 text-right">اللاعب</th>
                <th className="p-2 text-center">دعوات ناجحة</th>
                {tab === "all" && <th className="p-2 text-center">محظورة</th>}
                <th className="p-2 text-center">جواهر</th>
                <th className="p-2 text-center">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r: any, i: number) => (
                <tr key={r.inviter_id} className="border-t border-slate-800 hover:bg-slate-900/40">
                  <td className="p-2 text-slate-400">{r.rank ?? i + 1}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      {r.avatar_url ? (
                        <img src={r.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <span className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center">
                          {r.avatar_emoji || "🧑‍✈️"}
                        </span>
                      )}
                      <div>
                        <div className="font-bold text-white">{r.display_name}</div>
                        <div className="text-[10px] text-slate-500">@{r.username || "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-2 text-center font-bold text-emerald-300">
                    {(r.clean_invites ?? r.invites_count).toLocaleString()}
                  </td>
                  {tab === "all" && (
                    <td className="p-2 text-center text-red-300">
                      {(r.blocked_invites ?? 0).toLocaleString()}
                    </td>
                  )}
                  <td className="p-2 text-center text-amber-300 font-bold">
                    {(r.gems_earned ?? 0).toLocaleString()} 💎
                  </td>
                  <td className="p-2 text-center">
                    <button
                      onClick={() => setGiftUser(r)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600"
                    >
                      🎁 منح
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Gift modal */}
      {giftUser && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setGiftUser(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-bold mb-3">
              🎁 منح جواهر لـ <span className="text-amber-300">{(giftUser as any).display_name}</span>
            </div>
            <label className="text-xs text-slate-400 block mb-1">عدد الجواهر</label>
            <input
              type="number"
              value={giftAmount}
              onChange={(e) => setGiftAmount(e.target.value)}
              className="w-full mb-3 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700"
            />
            <label className="text-xs text-slate-400 block mb-1">ملاحظة (اختياري)</label>
            <input
              value={giftNote}
              onChange={(e) => setGiftNote(e.target.value)}
              placeholder="مثال: جائزة الترتيب الأول"
              className="w-full mb-4 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm"
            />
            <div className="flex gap-2 mb-3">
              {[500, 1000, 2000, 5000].map((n) => (
                <button
                  key={n}
                  onClick={() => setGiftAmount(String(n))}
                  className="flex-1 text-xs px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700"
                >
                  {n.toLocaleString()}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setGiftUser(null)} className="flex-1 py-2 rounded-lg bg-slate-800">
                إلغاء
              </button>
              <button onClick={grantGift} className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-bold">
                ✅ منح
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
