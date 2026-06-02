import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useProfile, refreshProfile } from "@/hooks/use-auth";
import { VIP_TIERS, getVipTier } from "@/lib/vip-perks";
import { RedeemDialog } from "@/components/RedeemDialog";
import { toast } from "sonner";
import submarineAsset from "@/assets/ships/ship-vip-submarine.png.asset.json";
import { syncServerTime, serverTodayKey } from "@/lib/server-time";

export const Route = createFileRoute("/vip")({
  component: VipPage,
  head: () => ({ meta: [{ title: "VIP — المميزات الفخمة" }] }),
});

function VipPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [claimedToday, setClaimedToday] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const claimingRef = useRef(false);
  const [showRedeem, setShowRedeem] = useState(false);

  const vipLevel = (profile as any)?.vip_level || 0;
  const isExpired = !!expiresAt && new Date(expiresAt) < new Date();
  const effectiveLevel = isExpired ? 0 : vipLevel;
  const currentTier = getVipTier(effectiveLevel);

  useEffect(() => {
    if (!user) return;
    (async () => {
      await syncServerTime(true);
      const { data: prof } = await supabase
        .from("profiles").select("vip_expires_at").eq("id", user.id).maybeSingle();
      setExpiresAt((prof as any)?.vip_expires_at ?? null);
      const today = serverTodayKey();
      const { data: claim } = await supabase
        .from("vip_daily_claims" as never)
        .select("id").eq("user_id", user.id).eq("claim_date", today).maybeSingle();
      setClaimedToday(!!claim);
    })();
  }, [user]);

  const claim = async () => {
    if (claimingRef.current || claiming || claimedToday) return;
    claimingRef.current = true;
    setClaiming(true);
    const { data, error } = await supabase.rpc("claim_vip_daily" as never);
    setClaiming(false);
    claimingRef.current = false;
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
    <div dir="rtl" className="absolute inset-0 overflow-y-auto overflow-x-hidden bg-stone-950 text-amber-50 p-3 pb-24" style={{ WebkitOverflowScrolling: "touch" }}>
      {showRedeem && <RedeemDialog onClose={() => setShowRedeem(false)} />}

      <div className="max-w-3xl mx-auto space-y-4 pb-12">
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

              {effectiveLevel >= 5 && (
                <button
                  onClick={async () => {
                    const { data, error } = await supabase.rpc("claim_vip_shield" as never);
                    if (error) {
                      const m = error.message || "";
                      if (m.includes("already_claimed")) toast.info("استلمت درع اليوم بالفعل");
                      else if (m.includes("need_vip")) toast.error("يحتاج VIP 5+");
                      else toast.error("تعذر استلام الدرع");
                      return;
                    }
                    const d = data as { count?: number } | null;
                    toast.success(`🛡️ +${d?.count || 1} درع للمخزن!`);
                  }}
                  className="mt-2 w-full py-2 rounded-xl bg-gradient-to-b from-sky-500 to-sky-700 text-white font-extrabold"
                >
                  🛡️ استلم الدرع اليومي (للمخزن)
                </button>
              )}

              {effectiveLevel >= 9 && (
                <button
                  onClick={async () => {
                    const { error } = await supabase.rpc("claim_royal_box" as never);
                    if (error) {
                      const m = error.message || "";
                      if (m.includes("already_claimed")) toast.info("استلمت الصندوق الملكي اليوم");
                      else if (m.includes("need_vip")) toast.error("يحتاج VIP 9+");
                      else toast.error("تعذر فتح الصندوق");
                      return;
                    }
                    toast.success("👑 تم فتح الصندوق الملكي! جميع الطواقم والصواريخ ذهبت للمخزن");
                  }}
                  className="mt-2 w-full py-2 rounded-xl bg-gradient-to-b from-fuchsia-500 to-fuchsia-800 text-white font-extrabold"
                >
                  👑 افتح الصندوق الملكي اليومي
                </button>
              )}

              {effectiveLevel >= 10 && (
                <button
                  onClick={async () => {
                    const { error } = await supabase.rpc("grant_cosmic_frame" as never);
                    if (error) { toast.error("تعذر منح الإطار"); return; }
                    toast.success("🌌 الإطار الكوني الحصري في مخزنك!");
                  }}
                  className="mt-2 w-full py-2 rounded-xl bg-gradient-to-b from-violet-500 to-fuchsia-700 text-white font-extrabold"
                >
                  🌌 احصل على الإطار الكوني الحصري
                </button>
              )}
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

        {/* VIP Exclusive Submarine showcase */}
        <div className="rounded-2xl border-2 border-amber-400/60 bg-gradient-to-br from-slate-900 via-stone-950 to-slate-900 p-4 shadow-[0_0_30px_rgba(251,191,36,0.25)]">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-amber-600 text-stone-950">حصري VIP 5+</span>
            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-200 border border-emerald-400/40">3 غواصات</span>
            <h3 className="text-lg font-extrabold text-amber-200">🔱 الغواصة الملكية</h3>
          </div>
          <div className="relative rounded-xl overflow-hidden bg-gradient-to-b from-sky-900/40 via-blue-950/60 to-stone-950 p-3">
            <img
              src={submarineAsset.url}
              alt="الغواصة الملكية VIP"
              className="w-full h-auto object-contain drop-shadow-[0_8px_30px_rgba(56,189,248,0.35)]"
            />
          </div>
          <ul className="text-[12px] text-amber-100/90 mt-2 space-y-0.5 leading-relaxed">
            <li>• 🎁 كل شحنة VIP 5+ تفتح <b>3 غواصات</b> مجاناً</li>
            <li>• ⚡ <b>ترقية تلقائية:</b> غواصاتك الحالية يكبر دمها وسعتها تلقائياً كل ما يرتفع VIP — بدون بيع أو إعادة استلام</li>
            <li>• 🔁 <b>لو بعت غواصة:</b> ما تقدر تستلم بدالها إلا بعد شحن VIP جديد (شحن جديد = 3 استلامات جديدة)</li>
            <li>• 🔱 تصيد <b>تيتان الأعماق</b> النادر — حصري لها فقط (السعر 20–30 ذهب)</li>
            <li>• ⏱️ مدة الصيد 45 دقيقة، تصليح 24 ساعة، درع 150</li>
            <li>• 💪 جدول الدم/السعة حسب مستوى VIP:</li>
          </ul>
          <div className="mt-2 rounded-xl border border-amber-500/30 bg-stone-950/60 p-2.5 text-[11.5px] text-amber-100/95 grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
            <div>VIP 5  →  <b>60,000</b></div>
            <div>VIP 6  →  <b>118,000</b></div>
            <div>VIP 7  →  <b>176,000</b></div>
            <div>VIP 8  →  <b>234,000</b></div>
            <div>VIP 9  →  <b>292,000</b></div>
            <div className="text-amber-300">VIP 10 → <b>350,000</b> 🌟</div>
          </div>
          <p className="text-[11px] text-stone-300/80 mt-2 leading-relaxed">
            🛡️ كل التحقق يتم على الخادم: مستوى VIP، عدد الاستلامات في الدورة، والترقية التلقائية. لا يمكن لأي عميل أو تعديل تلاعب بها.
          </p>
          <button
            disabled={effectiveLevel < 5}
            onClick={async () => {
              const { data, error } = await supabase.rpc("claim_vip_submarine" as never);
              if (error) {
                const m = error.message || "";
                if (m.includes("need_vip_5")) toast.error("تحتاج VIP 5 أو أعلى");
                else if (m.includes("already_claimed_recharge_required")) toast.info("استلمت 3 غواصات — اشحن VIP من جديد لفتح 3 جديدة");
                else if (m.includes("vip_expired")) toast.error("انتهى اشتراك VIP");
                else toast.error("تعذرت المطالبة");
                return;
              }
              toast.success("🔱 وصلت غواصة ملكية جديدة إلى أسطولك!");
              void data;
            }}
            className="mt-3 w-full py-2.5 rounded-xl bg-gradient-to-b from-amber-400 via-amber-500 to-amber-700 text-stone-950 font-extrabold disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
          >
            {effectiveLevel < 5 ? "🔒 يحتاج VIP 5+" : "🔱 استلم غواصة"}
          </button>
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
