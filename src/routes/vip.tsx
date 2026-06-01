import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useProfile, refreshProfile } from "@/hooks/use-auth";
import { VIP_TIERS, getVipTier } from "@/lib/vip-perks";
import { RedeemDialog } from "@/components/RedeemDialog";
import { toast } from "sonner";

export const Route = createFileRoute("/vip")({
  component: VipPage,
  head: () => ({ meta: [{ title: "VIP — المميزات الفخمة" }] }),
});

function VipPage() {
  const { user, profile } = useAuth();
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [claimedToday, setClaimedToday] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [showRedeem, setShowRedeem] = useState(false);

  const vipLevel = profile?.vip_level || 0;
  const isExpired = !!expiresAt && new Date(expiresAt) < new Date();
  const effectiveLevel = isExpired ? 0 : vipLevel;
  const currentTier = getVipTier(effectiveLevel);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: prof } = await supabase
        .from("profiles").select("vip_expires_at").eq("id", user.id).maybeSingle();
      setExpiresAt((prof as any)?.vip_expires_at ?? null);
      const today = new Date().toISOString().slice(0, 10);
      const { data: claim } = await supabase
        .from("vip_daily_claims" as never)
        .select("id").eq("user_id", user.id).eq("claim_date", today).maybeSingle();
      setClaimedToday(!!claim);
    })();
  }, [user]);

  const claim = async () => {
    setClaiming(true);
    const { data, error } = await supabase.rpc("claim_vip_daily" as never);
    setClaiming(false);
    if (error) {
      const k = (error.message || "").trim();
      if (k.includes("no_vip")) toast.error("تحتاج VIP أولاً");
      else if (k.includes("already_claimed")) toast.info("استلمت جواهر اليوم بالفعل");
      else toast.error("تعذرت المطالبة");
      return;
    }
    const d = data as { gems?: number } | null;
    toast.success(`🎉 +${d?.gems || 0} جوهرة!`);
    setClaimedToday(true);
    refreshProfile();
  };

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-to-b from-stone-950 via-violet-950/30 to-stone-950 text-amber-50 p-3">
      {showRedeem && <RedeemDialog onClose={() => setShowRedeem(false)} />}

      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Link to="/" className="px-2.5 py-1 rounded bg-stone-800/80 text-amber-200 text-sm">←</Link>
          <h1 className="text-2xl font-extrabold flex items-center gap-2">👑 نظام VIP</h1>
        </div>

        {/* Current status */}
        <div className={`rounded-2xl border-2 p-4 bg-gradient-to-br ${currentTier?.bgGradient || "from-stone-900 to-stone-950"} ${currentTier ? `border-${currentTier.color}` : "border-stone-700"}`}>
          {currentTier ? (
            <>
              <div className="flex items-center gap-3">
                <div className="text-5xl">{currentTier.emoji}</div>
                <div className="flex-1">
                  <div className="text-xs opacity-80">مستواك الحالي</div>
                  <div className="text-xl font-extrabold">VIP {currentTier.level} — {currentTier.name}</div>
                  {expiresAt && (
                    <div className="text-[11px] text-amber-200/80">
                      ينتهي: {new Date(expiresAt).toLocaleString("ar")}
                    </div>
                  )}
                  {!expiresAt && (
                    <div className="text-[11px] text-emerald-300/90">دائم ♾️</div>
                  )}
                </div>
              </div>

              <button
                disabled={claiming || claimedToday}
                onClick={claim}
                className="mt-3 w-full py-2.5 rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 text-stone-950 font-extrabold disabled:opacity-50"
              >
                {claimedToday ? "✅ تم استلام جواهر اليوم" : claiming ? "جاري..." : `🎁 استلم ${currentTier.dailyGems} جوهرة يومية`}
              </button>
            </>
          ) : (
            <div className="text-center py-2">
              <div className="text-5xl mb-2">🔒</div>
              <div className="font-extrabold text-lg">لست عضو VIP بعد</div>
              <div className="text-sm opacity-80 mt-1">استخدم كود VIP الذي حصلت عليه من المشرف لتفعيل المميزات</div>
              <button onClick={() => setShowRedeem(true)}
                className="mt-3 px-5 py-2.5 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-700 font-extrabold">
                🎟️ استبدل كود VIP
              </button>
            </div>
          )}
        </div>

        {/* All tiers */}
        <div>
          <h2 className="text-base font-bold mb-2 text-amber-200">📜 جميع المستويات والمميزات</h2>
          <div className="space-y-2">
            {VIP_TIERS.map((tier) => {
              const isCurrent = tier.level === effectiveLevel;
              const isUnlocked = tier.level <= effectiveLevel;
              return (
                <div
                  key={tier.level}
                  className={`rounded-xl border p-3 bg-gradient-to-r ${tier.bgGradient}
                    ${isCurrent ? `border-${tier.color} shadow-[0_0_18px_rgba(251,191,36,0.35)]` : "border-stone-700/60"}
                    ${!isUnlocked ? "opacity-70" : ""}`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="text-2xl">{tier.emoji}</div>
                    <div className="flex-1">
                      <div className="font-extrabold">VIP {tier.level} — {tier.name}</div>
                      <div className="text-[10px] opacity-80">💎 {tier.dailyGems} جوهرة يوميًا</div>
                    </div>
                    {isCurrent && <div className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-400/20 text-amber-200 border border-amber-400/50">الحالي</div>}
                    {!isUnlocked && <div className="text-[10px] text-stone-400">🔒</div>}
                  </div>
                  <ul className="space-y-0.5 pr-2">
                    {tier.perks.map((p, i) => (
                      <li key={i} className="text-[12px] text-amber-100/90">• {p}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        <div className="text-center text-xs text-stone-400 py-4">
          💡 احصل على كود VIP من المشرف لتفعيل أي مستوى
        </div>
      </div>
    </div>
  );
}
