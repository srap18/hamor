import { useEffect } from "react";
import type { StorePack } from "@/lib/store-catalog";

type Props = {
  pack: StorePack;
  onClose: () => void;
};

const ITEM_LABEL: Record<string, string> = {
  ad_bomb: "قنبلة إعلانية",
  bomb: "قنبلة",
  shield: "درع",
};
const ITEM_EMOJI: Record<string, string> = {
  ad_bomb: "💣",
  bomb: "💣",
  shield: "🛡️",
};

export function RewardPopup({ pack, onClose }: Props) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [onClose]);

  const rows: { emoji: string; label: string; qty: string }[] = [];
  const r = pack.reward;
  if (r.gems) rows.push({ emoji: "💎", label: "جوهرة", qty: r.gems.toLocaleString() });
  if (r.coins) rows.push({ emoji: "🪙", label: "ذهب", qty: r.coins.toLocaleString() });
  if (r.rubies) rows.push({ emoji: "❤️", label: "ياقوت", qty: r.rubies.toLocaleString() });
  if (r.shieldDays) rows.push({ emoji: "🛡️", label: "أيام حماية", qty: String(r.shieldDays) });
  if (r.vipDays) rows.push({ emoji: "👑", label: "أيام VIP", qty: String(r.vipDays) });
  if (r.items?.length) {
    for (const it of r.items) {
      rows.push({
        emoji: ITEM_EMOJI[it.itemId] ?? "🎁",
        label: ITEM_LABEL[it.itemId] ?? it.itemId,
        qty: `× ${it.qty}`,
      });
    }
  }

  return (
    <div
      className="fixed inset-0 z-[2147483600] flex items-center justify-center p-5 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      dir="rtl"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs rounded-3xl border-2 border-amber-300 bg-gradient-to-b from-stone-900 to-stone-950 p-5 text-center shadow-[0_0_60px_rgba(251,191,36,0.55)] animate-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[11px] font-bold text-emerald-300 mb-1">✅ تم استلام مشترياتك</div>
        <div className="text-5xl mb-1 drop-shadow-[0_0_18px_rgba(251,191,36,0.7)]">
          {pack.emoji}
        </div>
        <h2 className="text-base font-extrabold text-amber-200 mb-3 leading-tight">
          {pack.label}
        </h2>

        <ul className="space-y-1.5 mb-4">
          {rows.map((row, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3 rounded-xl bg-stone-800/70 border border-stone-700 px-3 py-2"
            >
              <span className="flex items-center gap-2 text-sm font-bold text-stone-100">
                <span className="text-xl">{row.emoji}</span>
                <span>{row.label}</span>
              </span>
              <span className="text-sm font-extrabold text-amber-300">{row.qty}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 font-extrabold active:scale-95"
        >
          استمتع 🎉
        </button>
      </div>
    </div>
  );
}
