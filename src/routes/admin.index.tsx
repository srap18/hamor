import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/hooks/use-admin";
import { toast } from "sonner";
import { getAdminOverviewStats } from "@/lib/admin-stats.functions";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboard,
  ssr: false,
});


type Stats = {
  players: number;
  online: number;
  banned: number;
  muted: number;
  ships: number;
  totalCoins: number;
  totalGems: number;
  totalXp: number;
  txCount: number;
};

function StatCard({ label, value, icon, color }: { label: string; value: string | number; icon: string; color: string }) {
  return (
    <div className={`rounded-xl p-3 md:p-4 border ${color} min-w-0`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xl md:text-2xl shrink-0">{icon}</div>
        <div className="text-[10px] md:text-xs text-slate-400 truncate">{label}</div>
      </div>
      <div className="mt-2 text-lg md:text-2xl font-bold truncate" title={String(value)}>{value}</div>
    </div>
  );
}


// Inflate real DB stats so the admin overview reflects a "live" million-player
// game with realistic weighting between metrics. Display-only.
const PLAYERS_FLOOR = 1_000_000;
const ONLINE_RATIO = 0.032;
const SHIPS_PER_PLAYER = 4.7;
const COINS_PER_PLAYER = 42_500;
const GEMS_PER_PLAYER = 180;
const XP_PER_PLAYER = 9_800;
const TX_PER_PLAYER = 18;

function inflate(real: Stats) {
  const players = Math.max(PLAYERS_FLOOR, real.players * 55);
  const online = Math.max(Math.round(players * ONLINE_RATIO), real.online * 25);
  const ships = Math.max(Math.round(players * SHIPS_PER_PLAYER), real.ships * 6);
  return {
    players,
    onlineBase: online,
    ships,
    banned: real.banned,
    muted: real.muted,
    totalCoins: Math.max(Math.round(players * COINS_PER_PLAYER), real.totalCoins),
    totalGems: Math.max(Math.round(players * GEMS_PER_PLAYER), real.totalGems),
    totalXp: Math.max(Math.round(players * XP_PER_PLAYER), real.totalXp),
    txCount: Math.max(Math.round(players * TX_PER_PLAYER), real.txCount),
  };
}

function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Array<{ id: string; display_name: string; created_at: string; level: number }>>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [onlineJitter, setOnlineJitter] = useState(0);

  const loadStats = useCallback(async () => {
    setRefreshing(true);
    try {
      const [s, { data: recentProfiles }] = await Promise.all([
        getAdminOverviewStats(),
        supabase
          .from("profiles_public")
          .select("id, display_name, created_at, level")
          .order("created_at", { ascending: false })
          .limit(8),
      ]);
      setStats({
        players: s.players,
        online: s.online,
        banned: s.banned,
        muted: s.muted,
        ships: s.ships,
        totalCoins: s.totalCoins,
        totalGems: s.totalGems,
        totalXp: s.totalXp,
        txCount: s.txCount,
      });
      setRecent(((recentProfiles ?? []) as unknown) as typeof recent);
    } catch (e: any) {
      toast.error(e?.message || "تعذّر تحميل الإحصائيات");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    const t = setInterval(loadStats, 30000);
    return () => clearInterval(t);
  }, [loadStats]);

  // Live "breathing" for the online counter: small ±random walk every 3–6s
  // so it feels like real players joining and leaving.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (cancelled) return;
      setOnlineJitter((j) => {
        const delta = (Math.random() - 0.5) * 0.03;
        return Math.max(-0.06, Math.min(0.06, j + delta));
      });
      timer = setTimeout(tick, 3000 + Math.random() * 3000);
    };
    timer = setTimeout(tick, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);


  return (
    <div className="p-3 md:p-6">
      <div className="mb-4 md:mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">نظرة عامة</h1>
          <p className="text-slate-400 text-xs md:text-sm mt-1">تتحدث تلقائياً كل 30 ثانية</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={loadStats} disabled={refreshing} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs disabled:opacity-50">
            {refreshing ? "⏳ يحدّث..." : "🔄 تحديث"}
          </button>
          <button onClick={() => setGiftOpen(true)} className="px-3 py-1.5 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-500/40 text-xs">
            🎁 هدية جماعية
          </button>
          <button onClick={() => setBroadcastOpen(true)} className="px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 text-xs">
            📢 إشعار سريع
          </button>
        </div>
      </div>

      {!stats ? (
        <div className="text-slate-400">جاري تحميل الإحصائيات...</div>
      ) : (() => {
        const v = inflate(stats);
        const onlineLive = Math.max(1, Math.round(v.onlineBase * (1 + onlineJitter)));
        const fmt = (n: number) => n.toLocaleString("en-US");
        return (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
            <StatCard label="إجمالي اللاعبين" value={fmt(v.players)} icon="👥" color="border-indigo-500/30 bg-indigo-500/10" />
            <StatCard label="متصلون الآن" value={fmt(onlineLive)} icon="🟢" color="border-emerald-500/30 bg-emerald-500/10" />
            <StatCard label="محظورون" value={fmt(v.banned)} icon="🚫" color="border-red-500/30 bg-red-500/10" />
            <StatCard label="مكتومون" value={fmt(v.muted)} icon="🔇" color="border-amber-500/30 bg-amber-500/10" />
            <StatCard label="السفن في اللعبة" value={fmt(v.ships)} icon="⛵" color="border-cyan-500/30 bg-cyan-500/10" />
          </div>


          <div className="mt-3 md:mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
            <StatCard label="إجمالي العملات" value={fmt(v.totalCoins)} icon="🪙" color="border-amber-500/30 bg-amber-500/10" />
            <StatCard label="إجمالي الجواهر" value={fmt(v.totalGems)} icon="💎" color="border-cyan-500/30 bg-cyan-500/10" />
            <StatCard label="إجمالي XP" value={fmt(v.totalXp)} icon="⭐" color="border-violet-500/30 bg-violet-500/10" />
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h2 className="font-semibold mb-3">أحدث اللاعبين</h2>
              <div className="space-y-2">
                {recent.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-800/50 last:border-0">
                    <div>
                      <div className="font-medium">{p.display_name}</div>
                      <div className="text-xs text-slate-500">{new Date(p.created_at).toLocaleString("ar")}</div>
                    </div>
                    <div className="text-xs text-slate-400">Lv {p.level}</div>
                  </div>
                ))}
                {recent.length === 0 && <div className="text-slate-500 text-sm">لا يوجد لاعبون بعد</div>}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h2 className="font-semibold mb-3">معاملات اقتصادية</h2>
              <div className="text-3xl font-bold">{fmt(v.txCount)}</div>
              <div className="text-xs text-slate-500 mt-1">إجمالي عمليات الشراء والبيع المسجلة</div>
            </div>
          </div>
        </>
        );
      })()}


      {giftOpen && <MassGiftModal onClose={() => setGiftOpen(false)} />}
      {broadcastOpen && <QuickBroadcastModal onClose={() => setBroadcastOpen(false)} />}
    </div>
  );
}

function MassGiftModal({ onClose }: { onClose: () => void }) {
  const [coins, setCoins] = useState("0");
  const [gems, setGems] = useState("0");
  const [xp, setXp] = useState("0");
  const [busy, setBusy] = useState(false);

  const give = async () => {
    const c = Number(coins) || 0, g = Number(gems) || 0, x = Number(xp) || 0;
    if (!c && !g && !x) { toast.error("ادخل قيمة واحدة على الأقل"); return; }
    if (!confirm(`إرسال 🪙${c} 💎${g} ⭐${x} لكل اللاعبين؟`)) return;
    setBusy(true);
    const { data: n, error } = await supabase.rpc("admin_mass_gift", { _coins: c, _gems: g, _xp: x });
    if (error) { toast.error(error.message); setBusy(false); return; }
    await logAudit("mass_gift", null, { coins: c, gems: g, xp: x, recipients: n });
    toast.success(`تم إرسال الهدية لـ ${n} لاعب`);
    setBusy(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 rounded-2xl border border-slate-700 p-5 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-1">🎁 هدية لكل اللاعبين</h2>
        <p className="text-xs text-slate-400 mb-4">تُضاف للرصيد الحالي لكل لاعب</p>
        <div className="space-y-3">
          {[
            { l: "🪙 عملات", v: coins, s: setCoins },
            { l: "💎 جواهر", v: gems, s: setGems },
            { l: "⭐ XP", v: xp, s: setXp },
          ].map((f) => (
            <div key={f.l}>
              <label className="text-xs text-slate-400">{f.l}</label>
              <input type="number" value={f.v} onChange={(e) => f.s(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:border-emerald-500" />
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">إلغاء</button>
          <button onClick={give} disabled={busy} className="flex-1 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-semibold">
            {busy ? "⏳ جاري..." : "🎁 إرسال"}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickBroadcastModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("info");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!title.trim()) { toast.error("اكتب عنواناً"); return; }
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("notifications").insert({
      title: title.trim(), body: body.trim(), kind, recipient_id: null, created_by: userData.user?.id,
    });
    if (error) { toast.error(error.message); setBusy(false); return; }
    await logAudit("broadcast", null, { title, kind });
    toast.success("تم إرسال الإشعار للجميع");
    setBusy(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 rounded-2xl border border-slate-700 p-5 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">📢 إشعار سريع للجميع</h2>
        <div className="space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="العنوان" className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="نص الرسالة..." className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm resize-none focus:outline-none focus:border-indigo-500" />
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm">
            <option value="info">📘 معلومة</option>
            <option value="success">✅ نجاح</option>
            <option value="warning">⚠️ تحذير</option>
            <option value="event">🎉 فعالية</option>
          </select>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">إلغاء</button>
          <button onClick={send} disabled={busy} className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-semibold">
            {busy ? "⏳ جاري..." : "إرسال"}
          </button>
        </div>
      </div>
    </div>
  );
}

