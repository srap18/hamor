import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { sound } from "@/lib/sound";
import { syncServerTime, serverTodayKey } from "@/lib/server-time";
import iconCoins from "@/assets/icons/icon-coins.png";
import iconGems from "@/assets/icons/icon-gems.png";

type Reward = {
  item_type: "crew" | "weapon" | "coins" | "gems";
  item_id: string;
  emoji: string;
  name: string;
  qty: number;
};


// 15-day cycle. Day 15 = legendary nuke bundle.
// IMPORTANT: crew item_id must match an entry in src/lib/crews.ts and
// weapon item_id must match src/lib/weapons.ts, otherwise the item is
// saved to the DB but never appears in the inventory UI.
const REWARDS: Reward[] = [
  { item_type: "coins",  item_id: "coins",        emoji: "🪙",   name: "ذهب",          qty: 1000 },
  { item_type: "weapon", item_id: "rocket_small", emoji: "🚀",   name: "صاروخ صغير",   qty: 4 },
  { item_type: "crew",   item_id: "sailor",       emoji: "⛵",   name: "بحار",         qty: 1 },
  { item_type: "weapon", item_id: "rocket_small", emoji: "🚀",   name: "صاروخ صغير",   qty: 5 },
  { item_type: "coins",  item_id: "coins",        emoji: "🪙",   name: "ذهب",          qty: 3000 },
  { item_type: "weapon", item_id: "rocket_medium",emoji: "🎯",   name: "صاروخ متوسط",  qty: 5 },
  { item_type: "crew",   item_id: "fixer_1",      emoji: "🔧",   name: "مصلح مبتدئ",   qty: 1 },
  { item_type: "weapon", item_id: "rocket_medium",emoji: "🎯",   name: "صاروخ متوسط",  qty: 6 },
  { item_type: "gems",   item_id: "gems",         emoji: "💎",   name: "جواهر",        qty: 20 },
  { item_type: "weapon", item_id: "rocket_large", emoji: "💥",   name: "صاروخ كبير",   qty: 7 },
  { item_type: "crew",   item_id: "guide",        emoji: "🧭",   name: "المرشد",       qty: 1 },
  { item_type: "weapon", item_id: "rocket_large", emoji: "💥",   name: "صاروخ كبير",   qty: 8 },
  { item_type: "crew",   item_id: "luck",         emoji: "🍀",   name: "الحظ",         qty: 1 },
  { item_type: "coins",  item_id: "coins",        emoji: "🪙",   name: "ذهب",          qty: 15000 },
  { item_type: "weapon", item_id: "nuke",         emoji: "☢️",   name: "قنبلة ذرية",   qty: 10 },
];

const todayKey = () => serverTodayKey();
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

function RewardIcon({ r, size }: { r: Reward; size: number }) {
  if (r.item_type === "coins") {
    return <img src={iconCoins} alt="مكافأة الذهب اليومية" style={{ width: size, height: size }} className="object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]" />;
  }
  if (r.item_type === "gems") {
    return <img src={iconGems} alt="أيقونة الجواهر الزرقاء" style={{ width: size, height: size }} className="object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]" />;
  }
  return <span style={{ fontSize: size, lineHeight: 1 }}>{r.emoji}</span>;
}


export function DailyLoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [streak, setStreak] = useState(0);
  const [lastDate, setLastDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user) return;
    (async () => {
      await syncServerTime(true);
      const { data } = await supabase
        .from("daily_login_streaks")
        .select("current_streak,last_claim_date")
        .eq("user_id", user.id)
        .maybeSingle();
      setStreak(data?.current_streak ?? 0);
      setLastDate(data?.last_claim_date ?? null);
    })();
  }, [open, user]);

  if (!open) return null;

  const today = todayKey();
  const claimedToday = lastDate === today;
  // Determine which day-slot the next claim covers
  let nextDayIndex: number; // 0..14
  if (!lastDate) {
    nextDayIndex = 0;
  } else if (claimedToday) {
    nextDayIndex = ((streak - 1) % 15 + 15) % 15;
  } else {
    const gap = daysBetween(lastDate, today);
    if (gap === 1) nextDayIndex = streak % 15; // continue
    else nextDayIndex = 0; // reset
  }
  const todaysReward = REWARDS[nextDayIndex];


  const claim = async () => {
    if (!user || busyRef.current || busy || claimedToday) return;

    busyRef.current = true;
    setBusy(true);
    sound.play("coin");

    // Atomic server-side claim: enforces one-claim-per-day, awards reward, updates streak.
    const { data, error } = await (supabase as any).rpc("claim_daily_login_pirate");
    if (error) {
      const msg = String(error.message || "").includes("already claimed")
        ? "✅ تم استلام هدية اليوم بالفعل"
        : `❌ ${error.message || "فشل الاستلام"}`;
      setToast(msg);
      setBusy(false);
      busyRef.current = false;
      setTimeout(() => setToast(null), 2800);
      // Reload streak state from DB so UI reflects truth
      const { data: row } = await supabase
        .from("daily_login_streaks")
        .select("current_streak,last_claim_date")
        .eq("user_id", user.id)
        .maybeSingle();
      setStreak(row?.current_streak ?? streak);
      setLastDate(row?.last_claim_date ?? lastDate);
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    const reward = row ? REWARDS[row.day_index] : todaysReward;
    setStreak(row?.new_streak ?? streak + 1);
    setLastDate(today);
    setToast(`+${reward.qty} ${reward.emoji} ${reward.name}`);
    setBusy(false);
    busyRef.current = false;
    setTimeout(() => setToast(null), 2400);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-3xl border-4 border-amber-400/80 bg-gradient-to-b from-[#3a1f0a] via-[#1f1207] to-[#0f0703] shadow-[0_0_60px_rgba(252,191,73,0.4)] overflow-hidden"
      >
        {/* Ornate corners */}
        <div className="absolute top-1 left-1 text-amber-300 text-lg">⚜</div>
        <div className="absolute top-1 right-1 text-amber-300 text-lg">⚜</div>
        <div className="absolute bottom-1 left-1 text-amber-300 text-lg">⚜</div>
        <div className="absolute bottom-1 right-1 text-amber-300 text-lg">⚜</div>

        {/* Header */}
        <div className="px-5 pt-4 pb-3 text-center border-b border-amber-400/30 bg-gradient-to-b from-amber-900/40 to-transparent">
          <div className="text-amber-300 text-[11px] tracking-widest">🏴‍☠️ صندوق القراصنة اليومي 🏴‍☠️</div>
          <h2 className="text-amber-100 text-xl font-black mt-1 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
            هديتك اليومية
          </h2>
          <div className="text-amber-200/80 text-[11px] mt-1">
            متتالية {streak} يوم — اجمع 15 يوم للحصول على 10 قنابل ذرية ☢️
          </div>
        </div>

        {/* 15 day grid */}
        <div className="p-3 grid grid-cols-5 gap-1.5">
          {REWARDS.map((r, i) => {
            const isToday = i === nextDayIndex && !claimedToday;
            const isClaimed = i < nextDayIndex || (claimedToday && i === nextDayIndex);
            const isFinal = i === 14;
            return (
              <div
                key={i}
                className={`relative aspect-square rounded-lg border-2 flex flex-col items-center justify-center text-center p-1 ${
                  isFinal
                    ? "border-purple-400 bg-gradient-to-b from-purple-900/60 to-fuchsia-900/60"
                    : isToday
                    ? "border-amber-300 bg-gradient-to-b from-amber-500/40 to-amber-800/40 animate-pulse"
                    : isClaimed
                    ? "border-emerald-500/40 bg-emerald-900/30 opacity-60"
                    : "border-amber-700/50 bg-amber-950/30"
                }`}
              >
                <div className="text-[8px] text-amber-200/80 font-bold">يوم {i + 1}</div>
                <RewardIcon r={r} size={22} />
                <div className="text-[9px] font-bold text-amber-100">×{r.qty}</div>

                {isClaimed && (
                  <div className="absolute inset-0 flex items-center justify-center text-emerald-400 text-xl bg-black/40 rounded-md">
                    ✓
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Today reward + claim */}
        <div className="px-4 pb-4">
          <div className="rounded-xl border-2 border-amber-400/60 bg-gradient-to-r from-amber-900/50 via-amber-800/40 to-amber-900/50 p-3 flex items-center gap-3">
            <div className="shrink-0"><RewardIcon r={todaysReward} size={44} /></div>
            <div className="flex-1 text-right">
              <div className="text-[10px] text-amber-300">هدية اليوم {nextDayIndex + 1}</div>
              <div className="text-amber-100 font-bold text-sm">{todaysReward.name}</div>
              <div className="text-amber-300 text-xs">الكمية: ×{todaysReward.qty}</div>
            </div>
            <button
              onClick={claim}
              disabled={claimedToday || busy || !nukeAllowed}
              className={`px-4 py-2 rounded-lg font-black text-sm border-2 ${
                claimedToday
                  ? "bg-emerald-900/60 border-emerald-500/40 text-emerald-300"
                  : !nukeAllowed
                  ? "bg-stone-800 border-stone-600 text-stone-400 opacity-60"
                  : "bg-gradient-to-b from-amber-300 to-amber-600 border-amber-200 text-amber-950 active:scale-95 shadow-lg"
              }`}
            >
              {claimedToday ? "✓ تم" : !nukeAllowed ? "🔒 مقفل" : "استلم"}
            </button>
          </div>
          <button
            onClick={onClose}
            className="w-full mt-3 py-2 rounded-lg bg-black/40 border border-amber-700/40 text-amber-200/80 text-xs"
          >
            إغلاق
          </button>
        </div>

        {toast && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-5 py-3 rounded-2xl bg-gradient-to-b from-amber-300 to-amber-600 border-2 border-amber-100 text-amber-950 font-black text-lg shadow-2xl animate-bounce">
            🎁 {toast}
          </div>
        )}
      </div>
    </div>
  );
}
