import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BackButton } from "@/components/BackButton";

export const Route = createFileRoute("/invite")({
  head: () => ({
    meta: [
      { title: "ادعُ أصدقاءك — اربح جواهر | هامور شابك" },
      { name: "description", content: "ادعُ أصدقاءك إلى ملوك القراصنة واحصل على 30% جواهر هدية من اللعبة عند كل شحن يقومون به." },
    ],
  }),
  component: InvitePage,
});

type Earning = {
  id: string;
  invitee_id: string;
  amount_cents: number;
  gems_awarded: number;
  created_at: string;
};

function InvitePage() {
  const nav = useNavigate();
  const [code, setCode] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [invitedCount, setInvitedCount] = useState(0);
  const [totalGems, setTotalGems] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { nav({ to: "/login" }); return; }
      const { data: prof } = await supabase
        .from("profiles")
        .select("referral_code")
        .eq("id", user.id)
        .maybeSingle();
      setCode((prof as any)?.referral_code || "");

      const { data: earn } = await (supabase as any)
        .from("referral_earnings")
        .select("id, invitee_id, amount_cents, gems_awarded, created_at")
        .eq("inviter_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      const list: Earning[] = (earn as Earning[]) || [];
      setEarnings(list);
      setTotalGems(list.reduce((s, e) => s + (e.gems_awarded || 0), 0));

      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("referred_by", user.id);
      setInvitedCount(count || 0);
      setLoading(false);
    })();
  }, [nav]);

  const link = typeof window !== "undefined" && code
    ? `${window.location.origin}/signup?ref=${code}`
    : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const share = async () => {
    if (navigator.share && link) {
      try {
        await navigator.share({
          title: "انضم معي في ملوك القراصنة 🏴‍☠️",
          text: `استخدم كود دعوتي ${code} واحصلت على هدية بدء قوية!`,
          url: link,
        });
      } catch {}
    } else {
      copy();
    }
  };

  const shareText = `🏴‍☠️ انضم معي في لعبة ملوك القراصنة! أقوى لعبة بحرية عربية.\nسجّل من هذا الرابط واحصل على هدية بداية قوية:\n${link}`;
  const waUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("🏴‍☠️ انضم معي في ملوك القراصنة")}`;
  const xUrl  = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
  const smsUrl = `sms:?body=${encodeURIComponent(shareText)}`;

  return (
    <div className="min-h-screen text-white pb-20" dir="rtl" style={{
      background: "radial-gradient(ellipse at top, #0c4a6e 0%, #082f49 55%, #020617 100%)",
    }}>
      <div className="max-w-md mx-auto p-4">
        <div className="flex items-center gap-2 mb-4">
          <BackButton className="text-amber-300 text-2xl">←</BackButton>
          <h1 className="text-2xl font-extrabold text-amber-300">🎁 نظام الدعوات</h1>
        </div>

        {/* Hero */}
        <div className="rounded-2xl bg-gradient-to-b from-emerald-900/80 to-stone-950/90 border-2 border-emerald-600/50 p-5 mb-4 shadow-xl">
          <div className="text-center mb-3">
            <div className="text-4xl mb-1">🎉</div>
            <div className="text-lg font-extrabold text-emerald-300">ادعُ صديق = اربح 30% جواهر</div>
            <div className="text-xs text-emerald-100/80 mt-1">
              كل ما صديقك يشحن، تجيك <span className="text-amber-300 font-bold">30%</span> جواهر هدية من اللعبة 🎁
              <br/>
              <span className="text-emerald-100/60">بدون أي خصم على شراء صديقك — هديتك مدفوعة من اللعبة</span>
            </div>
          </div>

          {/* PRIMARY: Link box - the easiest way to invite */}
          {link && (
            <div className="bg-stone-950/80 rounded-xl border-2 border-amber-500/60 p-3 mb-3">
              <div className="text-[10px] text-amber-100/70 mb-1 text-center font-bold">🔗 رابط الدعوة المباشر (الأسهل)</div>
              <div className="text-[11px] text-amber-200 break-all text-center mb-2 leading-relaxed" dir="ltr">{link}</div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={copy} className="py-2 rounded-lg bg-stone-800 border border-stone-600 text-white text-sm font-bold active:scale-95">
                  {copied ? "✓ تم النسخ" : "📋 نسخ الرابط"}
                </button>
                <button onClick={share} className="py-2 rounded-lg bg-gradient-to-b from-emerald-500 to-emerald-700 border-2 border-emerald-300 text-white text-sm font-bold active:scale-95">
                  📤 مشاركة سريعة
                </button>
              </div>
            </div>
          )}

          {/* Quick share to specific apps */}
          {link && (
            <div className="grid grid-cols-4 gap-2 mb-3">
              <a href={waUrl} target="_blank" rel="noopener noreferrer"
                 className="flex flex-col items-center gap-1 py-2 rounded-lg bg-[#25D366]/15 border border-[#25D366]/60 text-white text-[10px] font-bold active:scale-95">
                <span className="text-xl">💬</span>واتساب
              </a>
              <a href={tgUrl} target="_blank" rel="noopener noreferrer"
                 className="flex flex-col items-center gap-1 py-2 rounded-lg bg-[#229ED9]/15 border border-[#229ED9]/60 text-white text-[10px] font-bold active:scale-95">
                <span className="text-xl">✈️</span>تيليجرام
              </a>
              <a href={xUrl} target="_blank" rel="noopener noreferrer"
                 className="flex flex-col items-center gap-1 py-2 rounded-lg bg-stone-800 border border-stone-500 text-white text-[10px] font-bold active:scale-95">
                <span className="text-xl">𝕏</span>تويتر
              </a>
              <a href={smsUrl}
                 className="flex flex-col items-center gap-1 py-2 rounded-lg bg-blue-900/40 border border-blue-500/60 text-white text-[10px] font-bold active:scale-95">
                <span className="text-xl">✉️</span>SMS
              </a>
            </div>
          )}

          {/* Code box (secondary) */}
          <div className="bg-stone-950/60 rounded-xl border border-stone-700 p-2">
            <div className="text-[10px] text-stone-400 mb-1 text-center">أو شارك كود الدعوة يدويًا</div>
            <div className="text-2xl font-black tracking-[0.4em] text-amber-300/90 text-center select-all">
              {loading ? "..." : code || "—"}
            </div>
          </div>
        </div>

          <div className="rounded-xl bg-stone-900/80 border border-emerald-700/40 p-3 text-center">
            <div className="text-2xl">💎</div>
            <div className="text-2xl font-black text-emerald-300">{totalGems.toLocaleString()}</div>
            <div className="text-[11px] text-emerald-100/70">إجمالي الجواهر المربوحة</div>
          </div>
        </div>

        {/* Earnings list */}
        <div className="rounded-xl bg-stone-950/70 border border-stone-700 p-3">
          <div className="text-sm font-bold text-amber-300 mb-2">📜 سجل المكافآت</div>
          {earnings.length === 0 ? (
            <div className="text-center text-xs text-stone-400 py-6">
              لا يوجد مكافآت بعد — ابدأ بمشاركة كودك مع أصدقائك!
            </div>
          ) : (
            <div className="space-y-1.5">
              {earnings.map((e) => (
                <div key={e.id} className="flex items-center justify-between bg-stone-900/60 rounded-lg px-3 py-2 border border-stone-800">
                  <div className="text-xs text-stone-300">
                    شحن ${(e.amount_cents / 100).toFixed(2)}
                  </div>
                  <div className="text-sm font-bold text-emerald-300">
                    +{e.gems_awarded.toLocaleString()} 💎
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 text-center text-[11px] text-stone-400">
          المكافأة تُحسب تلقائياً بعد كل عملية شحن ناجحة لصديقك.
          <br/>الهدية من اللعبة — لا ينقص شيء من شراء صديقك.
        </div>
      </div>
    </div>
  );
}
