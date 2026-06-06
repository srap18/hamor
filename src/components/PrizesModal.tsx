import { CoinIcon } from "@/components/CurrencyIcon";

export type PrizeTier = {
  rank?: number;
  coins?: number;
  gems?: number;
  xp?: number;
  text?: string | null;
};

export function PrizesModal({
  title,
  tiers,
  onClose,
}: {
  title: string;
  tiers: PrizeTier[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[140] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3"
      onClick={onClose}
      dir="rtl"
    >
      <div
        className="w-full max-w-sm glass-hud border-2 border-amber-400/70 rounded-2xl p-3 shadow-[0_0_30px_rgba(251,191,36,0.4)] flex flex-col"
        style={{ maxHeight: "calc(var(--app-height, 100dvh) - 2rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center text-amber-300 font-black text-base mb-1">🏆 الجوائز</div>
        <div className="text-center text-accent/80 text-[11px] font-bold mb-2 truncate px-2">{title}</div>

        <div className="flex-1 overflow-y-auto space-y-1 pr-1">
          {tiers.length === 0 ? (
            <div className="text-center text-accent/60 text-xs py-6">لا توجد جوائز</div>
          ) : tiers.map((t, i) => {
            const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${t.rank ?? i + 1}`;
            const tierBg = i === 0
              ? "bg-gradient-to-l from-amber-500/30 via-yellow-300/15 to-amber-500/30 border-amber-300/70"
              : i === 1
                ? "bg-gradient-to-l from-slate-300/25 via-slate-200/10 to-slate-400/25 border-slate-200/60"
                : i === 2
                  ? "bg-gradient-to-l from-orange-500/25 via-amber-700/10 to-orange-600/25 border-orange-400/60"
                  : "bg-secondary/60 border-accent/20";
            return (
              <div key={i} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border text-[12px] ${tierBg}`}>
                <span className="w-9 text-center font-black text-amber-200 drop-shadow">{medal}</span>
                <div className="flex-1 flex flex-wrap gap-2 text-accent font-bold">
                  {!!t.coins && t.coins > 0 && (
                    <span className="inline-flex items-center gap-1"><CoinIcon size={12}/>{t.coins.toLocaleString()}</span>
                  )}
                  {!!t.gems && t.gems > 0 && <span>💎 {t.gems.toLocaleString()}</span>}
                  {!!t.xp && t.xp > 0 && <span>⭐ {t.xp.toLocaleString()}</span>}
                  {t.text && <span>🎁 {t.text}</span>}
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={onClose}
          className="mt-3 w-full py-2 rounded-lg bg-accent text-secondary text-sm font-black active:scale-95"
        >
          إغلاق
        </button>
      </div>
    </div>
  );
}
