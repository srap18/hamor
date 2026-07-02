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

type LeaderRow = {
  inviter_id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  avatar_emoji: string | null;
  invites_count: number;
  gems_earned: number;
  rank: number;
};

function InvitePage() {
  const nav = useNavigate();
  const [code, setCode] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [invitedCount, setInvitedCount] = useState(0);
  const [totalGems, setTotalGems] = useState(0);
  const [weeklyInvites, setWeeklyInvites] = useState(0);
  const [cleanInvites, setCleanInvites] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { nav({ to: "/login" }); return; }
      setMyUserId(user.id);
      const { data: prof } = await supabase
        .from("profiles")
        .select("referral_code")
        .eq("id", user.id)
        .maybeSingle();
      setCode((prof as any)?.referral_code || "");

      const [{ data: earn }, { data: stats }, { data: lb }] = await Promise.all([
        (supabase as any)
          .from("referral_earnings")
          .select("id, invitee_id, amount_cents, gems_awarded, created_at")
          .eq("inviter_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50),
        (supabase as any).rpc("get_my_referral_stats"),
        (supabase as any).rpc("get_referral_leaderboard_weekly", { p_limit: 10 }),
      ]);

      const list: Earning[] = (earn as Earning[]) || [];
      setEarnings(list);
      setTotalGems((stats as any)?.total_gems || list.reduce((s, e) => s + (e.gems_awarded || 0), 0));
      setWeeklyInvites((stats as any)?.weekly_invites || 0);
      setCleanInvites((stats as any)?.clean_invites || 0);
      setLeaderboard((lb as LeaderRow[]) || []);

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
            <div className="text-lg font-extrabold text-amber-300">500 💎 فوراً لكل صديق جديد</div>
            <div className="text-xs text-emerald-100/80 mt-1">
              كل صديق يسجّل بكودك = <span className="text-amber-300 font-bold">500 جوهرة</span> تدخل حسابك مباشرة
              <br/>
              + عند وصولك <span className="text-amber-300 font-bold">10 دعوات</span> → <span className="text-amber-300 font-bold">2000 جوهرة</span> إضافية 🏆
              <br/>
              + <span className="text-emerald-300 font-bold">30% جواهر</span> من كل شحن يسوّيه صديقك
            </div>
          </div>

          {/* Milestone progress */}
          <div className="bg-stone-950/70 rounded-xl border border-amber-500/40 p-3 mb-3">
            <div className="flex items-center justify-between text-[11px] mb-1.5">
              <span className="text-amber-200 font-bold">🏆 إنجاز 10 دعوات</span>
              <span className="text-amber-300 font-black">{Math.min(cleanInvites, 10)}/10</span>
            </div>
            <div className="h-2 bg-stone-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-l from-amber-400 to-orange-500 transition-all"
                style={{ width: `${Math.min((cleanInvites / 10) * 100, 100)}%` }}
              />
            </div>
            <div className="text-[10px] text-amber-100/60 text-center mt-1">
              {cleanInvites >= 10 ? "✅ تم! المكافأة صرفت في حسابك" : `متبقي ${10 - cleanInvites} دعوة لجائزة 2000 💎`}
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

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="rounded-xl bg-stone-900/80 border border-amber-700/40 p-3 text-center">
            <div className="text-xl">👥</div>
            <div className="text-xl font-black text-amber-300">{invitedCount}</div>
            <div className="text-[10px] text-amber-100/70">مدعو</div>
          </div>
          <div className="rounded-xl bg-stone-900/80 border border-sky-700/40 p-3 text-center">
            <div className="text-xl">📅</div>
            <div className="text-xl font-black text-sky-300">{weeklyInvites}</div>
            <div className="text-[10px] text-sky-100/70">هذا الأسبوع</div>
          </div>
          <div className="rounded-xl bg-stone-900/80 border border-emerald-700/40 p-3 text-center">
            <div className="text-xl">💎</div>
            <div className="text-xl font-black text-emerald-300">{totalGems.toLocaleString()}</div>
            <div className="text-[10px] text-emerald-100/70">جواهر</div>
          </div>
        </div>

        {/* Weekly Leaderboard */}
        <div className="rounded-2xl bg-gradient-to-b from-amber-900/40 to-stone-950/90 border-2 border-amber-600/40 p-4 mb-4 shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <div className="text-base font-black text-amber-300 flex items-center gap-1.5">
              🏆 صدارة الدعوات الأسبوعية
            </div>
            <div className="text-[10px] text-amber-100/60">تُحدّث كل أسبوع</div>
          </div>
          {leaderboard.length === 0 ? (
            <div className="text-center text-xs text-stone-400 py-4">
              كن أول من يتصدّر هذا الأسبوع! 🥇
            </div>
          ) : (
            <div className="space-y-1.5">
              {leaderboard.map((r) => {
                const isMe = r.inviter_id === myUserId;
                const medal = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `#${r.rank}`;
                return (
                  <div
                    key={r.inviter_id}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-2 border ${
                      isMe
                        ? "bg-amber-500/20 border-amber-400"
                        : r.rank <= 3
                        ? "bg-stone-900/80 border-amber-700/40"
                        : "bg-stone-900/50 border-stone-800"
                    }`}
                  >
                    <div className={`w-8 text-center text-sm font-black ${r.rank <= 3 ? "text-amber-300" : "text-stone-400"}`}>
                      {medal}
                    </div>
                    {r.avatar_url ? (
                      <img src={r.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-stone-800 flex items-center justify-center text-sm">
                        {r.avatar_emoji || "🧑‍✈️"}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-white truncate">
                        {r.display_name} {isMe && <span className="text-amber-300 text-[10px]">(أنت)</span>}
                      </div>
                      <div className="text-[10px] text-stone-400">@{r.username || "—"}</div>
                    </div>
                    <div className="text-left shrink-0">
                      <div className="text-sm font-black text-emerald-300">{r.invites_count} 👥</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-3 text-center text-[10px] text-amber-100/60">
            💡 الإدارة تمنح جوائز فورية للمتصدرين — ادعُ أكثر وتصدّر القائمة
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
                    {e.amount_cents > 0 ? `شحن $${(e.amount_cents / 100).toFixed(2)}` : "دعوة صديق"}
                  </div>
                  <div className="text-sm font-bold text-emerald-300">
                    +{e.gems_awarded.toLocaleString()} 💎
                  </div>
                </div>
              ))}
            </div>
          )}
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
