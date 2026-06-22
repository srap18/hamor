import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useProfile } from "@/hooks/use-auth";
import { AuthGuard } from "@/components/AuthGuard";
import { BackButton } from "@/components/BackButton";
import { ELITE_VIP_TIERS, getEliteVipTier } from "@/lib/elite-vip";
import { EliteVipBadge } from "@/components/EliteVipBadge";

export const Route = createFileRoute("/my-vip")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "اشتراكي — Elite VIP" },
      { name: "description", content: "اعرض اشتراك Elite VIP الحالي والمدة المتبقية." },
    ],
  }),
  component: () => <AuthGuard><MyVipPage /></AuthGuard>,
});

function fmtRemain(ms: number) {
  if (ms <= 0) return "منتهي";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d} يوم · ${h} ساعة · ${m} دقيقة`;
  if (h > 0) return `${h} ساعة · ${m} دقيقة · ${sec} ثانية`;
  if (m > 0) return `${m} دقيقة · ${sec} ثانية`;
  return `${sec} ثانية`;
}

function MyVipPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const [row, setRow] = useState<{ elite_vip_level: number | null; elite_vip_expires_at: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [claimedToday, setClaimedToday] = useState<boolean>(false);
  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  const [broadcastEnabled, setBroadcastEnabled] = useState<boolean>(true);
  const [savingBroadcast, setSavingBroadcast] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [{ data }, { data: claim }] = await Promise.all([
        (supabase as any).rpc("get_my_elite_vip"),
        supabase
          .from("elite_vip_daily_claims" as never)
          .select("id")
          .eq("user_id", user.id)
          .eq("claim_date", today)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const r = Array.isArray(data) ? data[0] : data;
      setRow(r ?? null);
      setClaimedToday(!!claim);
      setLoading(false);
    })();
    const ch = supabase
      .channel(`my-vip:${user.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        async () => {
          const { data } = await (supabase as any).rpc("get_my_elite_vip");
          const r = Array.isArray(data) ? data[0] : data;
          setRow(r ?? null);
        })
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [user]);

  const claimDailyGems = async () => {
    setClaiming(true);
    setClaimMsg(null);
    const { data, error } = await (supabase as any).rpc("claim_elite_vip_daily_gems");
    setClaiming(false);
    if (error) {
      setClaimMsg(error.message?.includes("already_claimed") ? "✓ تم استلام جواهر اليوم" : "خطأ: " + error.message);
      if (error.message?.includes("already_claimed")) setClaimedToday(true);
      return;
    }
    setClaimedToday(true);
    setClaimMsg(`🎉 حصلت على ${data?.gems ?? 0} 💎`);
  };

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const rawLevel = Number(row?.elite_vip_level ?? 0);
  const expMs = row?.elite_vip_expires_at ? new Date(row.elite_vip_expires_at).getTime() : null;
  const isExpired = rawLevel > 0 && expMs !== null && expMs <= now;
  const level = isExpired ? 0 : rawLevel;
  const tier = getEliteVipTier(level);
  const remain = expMs !== null ? expMs - now : null;
  const totalMs = 30 * 24 * 3600 * 1000;
  const pct = remain !== null ? Math.max(0, Math.min(100, (remain / totalMs) * 100)) : 0;
  const expDate = expMs ? new Date(expMs) : null;

  return (
    <div dir="rtl" className="h-full overflow-y-auto bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 text-slate-100 pb-24">
      <style>{`@keyframes vip-rays-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {/* Header */}
      <div className="sticky top-0 z-30 bg-slate-950/85 backdrop-blur border-b border-amber-500/30 px-4 py-3 flex items-center justify-between">
        <BackButton>رجوع</BackButton>
        <h1 className="text-lg font-extrabold bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400 bg-clip-text text-transparent drop-shadow-[0_0_10px_rgba(251,191,36,0.4)]">
          👑 اشتراكي الفاخر
        </h1>
        <div className="w-8" />
      </div>

      {loading ? (
        <div className="px-4 py-16 text-center text-amber-200/60">جاري التحميل...</div>
      ) : tier ? (
        <div className="px-4 pt-6 max-w-2xl mx-auto">
          {/* Royal card */}
          <div className="relative overflow-hidden rounded-3xl border-2 border-amber-400/60 bg-gradient-to-br from-amber-950/80 via-yellow-900/40 to-slate-950 shadow-[0_0_60px_rgba(251,191,36,0.35)] p-6">
            {/* Animated golden rays */}
            <div className="absolute inset-0 opacity-30 pointer-events-none"
              style={{
                background: "conic-gradient(from 0deg, transparent 0%, rgba(251,191,36,0.35) 12%, transparent 24%, rgba(251,191,36,0.35) 36%, transparent 48%, rgba(251,191,36,0.35) 60%, transparent 72%, rgba(251,191,36,0.35) 84%, transparent 100%)",
                animation: "vip-rays-spin 18s linear infinite",
              }}
            />
            {/* Sparkles */}
            <div className="absolute top-2 right-3 text-yellow-300 text-xl animate-pulse">✨</div>
            <div className="absolute top-3 left-3 text-amber-300 text-xl animate-pulse" style={{ animationDelay: "0.5s" }}>✦</div>

            <div className="relative z-10 flex flex-col items-center text-center">
              <img
                src={tier.badge}
                alt={`Elite VIP ${tier.level}`}
                className="w-40 h-40 object-contain drop-shadow-[0_10px_30px_rgba(251,191,36,0.7)]"
              />
              <div className="mt-3 text-xs tracking-[0.3em] font-black text-amber-300/90">ELITE VIP {tier.level}</div>
              <div className={`mt-1 text-3xl font-black ${tier.nameColorClass || "text-amber-100"}`}>
                {tier.emoji} {tier.nameAr}
              </div>
              <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/60">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-extrabold text-emerald-200">الاشتراك مُفعّل</span>
              </div>

              {/* Hero name (player) */}
              <div className="mt-4 text-sm text-amber-200/70">صاحب الاشتراك</div>
              <div className="text-xl font-black text-amber-100">
                {(profile as any)?.display_name || "..."}
              </div>
            </div>
          </div>

          {/* Countdown */}
          <div className="mt-4 rounded-3xl border-2 border-amber-400/40 bg-gradient-to-b from-slate-900 to-slate-950 p-5">
            <div className="text-center">
              <div className="text-xs font-bold text-amber-300/80 tracking-widest">المدة المتبقية</div>
              <div className="mt-2 text-3xl font-black bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400 bg-clip-text text-transparent tabular-nums">
                {remain !== null ? fmtRemain(remain) : "اشتراك دائم"}
              </div>
              {expDate && (
                <div className="mt-1 text-xs text-slate-400">
                  ينتهي في {expDate.toLocaleString("ar", { dateStyle: "full", timeStyle: "short" })}
                </div>
              )}
            </div>
            {remain !== null && (
              <div className="mt-4 h-3 rounded-full bg-slate-800 overflow-hidden border border-amber-500/30">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 transition-all"
                  style={{ width: `${pct}%`, boxShadow: "0 0 20px rgba(251,191,36,0.7)" }}
                />
              </div>
            )}
          </div>

          {/* Daily gems claim */}
          <div className="mt-4 rounded-3xl border-2 border-emerald-400/40 bg-gradient-to-br from-emerald-950/60 to-slate-900 p-5 text-center">
            <div className="text-sm font-bold text-emerald-200">💎 جواهر يومية مجانية</div>
            <div className="text-3xl font-black text-emerald-300 mt-1">{tier.dailyGems} 💎</div>
            <button
              onClick={claimDailyGems}
              disabled={claiming || claimedToday}
              className="mt-3 w-full py-3 rounded-xl font-extrabold bg-gradient-to-r from-emerald-500 to-green-400 text-slate-900 shadow-lg hover:brightness-110 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {claiming ? "..." : claimedToday ? "✓ تم الاستلام اليوم" : `استلم ${tier.dailyGems} 💎 الآن`}
            </button>
            {claimMsg && <div className="mt-2 text-xs text-emerald-200">{claimMsg}</div>}
          </div>

          {/* Perks */}
          <div className="mt-4 rounded-3xl border border-amber-400/30 bg-slate-900/70 p-5">
            <div className="text-sm font-black text-amber-200 mb-3">✨ مميزاتك الحالية</div>
            <ul className="space-y-2">
              {tier.perks.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-amber-100">
                  <span className="text-amber-400">◆</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Upgrade CTA */}
          {tier.level < 5 && (
            <Link to="/vip" className="block mt-4 text-center py-4 rounded-2xl font-extrabold bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 text-slate-900 shadow-lg hover:brightness-110 active:scale-95 transition">
              ⬆️ ترقية لمستوى أعلى
            </Link>
          )}
          <Link to="/vip" className="block mt-3 text-center py-3 rounded-xl border border-amber-400/40 text-amber-200 hover:bg-amber-500/10">
            عرض جميع مستويات VIP
          </Link>
        </div>
      ) : (
        // No active VIP
        <div className="px-4 pt-6 max-w-2xl mx-auto">
          <div className="rounded-3xl border-2 border-amber-400/40 bg-gradient-to-b from-slate-900 to-slate-950 p-8 text-center">
            <div className="text-6xl mb-3">👑</div>
            <div className="text-xl font-black text-amber-100">لا يوجد اشتراك Elite VIP نشط</div>
            <p className="text-sm text-slate-400 mt-2">
              {isExpired
                ? "انتهى اشتراكك السابق. جدّد الآن لاستعادة مميزاتك الحصرية."
                : "اشترك الآن واحصل على مميزات قتالية وخصومات وشارات أسطورية."}
            </p>
            <Link to="/vip" className="inline-block mt-5 px-6 py-3 rounded-xl font-extrabold bg-gradient-to-r from-amber-500 to-yellow-400 text-slate-900 shadow-lg hover:brightness-110">
              استكشف باقات Elite VIP
            </Link>

            <div className="mt-8 grid grid-cols-5 gap-2">
              {ELITE_VIP_TIERS.map((t) => (
                <div key={t.level} className="flex flex-col items-center opacity-80">
                  <EliteVipBadge level={t.level} size="md" />
                  <div className="text-[10px] text-amber-300 font-bold mt-1">VIP {t.level}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
