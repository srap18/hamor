import { useState } from "react";
import { OFFERS, buyOfferRpc, type Offer } from "@/lib/offers";
import { useProfile } from "@/hooks/use-auth";
import { showBanner } from "@/components/Banner";
import coinIcon from "@/assets/icons/icon-coins.png";
import gemIcon from "@/assets/icons/icon-gems.png";

export function OffersPanel({ onPurchase }: { onPurchase?: () => void }) {
  const { profile } = useProfile();
  const coins = profile?.coins ?? 0;
  const gems = profile?.gems ?? 0;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pop, setPop] = useState<string | null>(null);

  const flash = (m: string, ms = 1800) => {
    setPop(m);
    setTimeout(() => setPop(null), ms);
  };

  const buy = async (offer: Offer) => {
    if (busyId) return;
    if (offer.currency === "gem" && gems < offer.price) {
      flash("لا تملك جواهر كافية");
      return;
    }
    if (offer.currency === "coin" && coins < offer.price) {
      flash("لا تملك ذهب كافي");
      return;
    }
    if (!window.confirm(`شراء ${offer.name} بـ ${offer.price.toLocaleString()} ${offer.currency === "gem" ? "جوهرة" : "ذهب"}؟`)) return;

    setBusyId(offer.id);
    const { error } = await buyOfferRpc(offer.id);
    setBusyId(null);

    if (error) {
      flash("فشل الشراء: " + error.message, 2200);
      return;
    }

    flash(`✓ تم شراء ${offer.name}`, 1800);
    showBanner({
      kind: "purchase",
      title: offer.name,
      subtitle: `${offer.price.toLocaleString()} ${offer.currency === "gem" ? "جوهرة" : "ذهب"}`,
      emoji: "🎁",
      image: offer.contents[0]?.image,
    });
    onPurchase?.();
  };

  return (
    <div className="flex flex-col gap-3 mt-3 px-2 pb-2">
      {OFFERS.map((offer) => {
        const savings = Math.round(((offer.originalPrice - offer.price) / offer.originalPrice) * 100);
        const rarityBorder =
          offer.rarity === "legendary"
            ? "border-amber-300 shadow-[0_0_20px_rgba(251,191,36,0.4)]"
            : offer.rarity === "epic"
              ? "border-violet-300 shadow-[0_0_15px_rgba(167,139,250,0.35)]"
              : offer.rarity === "rare"
                ? "border-sky-300"
                : "border-rose-300";
        const rarityBg =
          offer.rarity === "legendary"
            ? "from-amber-700/90 via-rose-900/90 to-stone-950/95"
            : offer.rarity === "epic"
              ? "from-violet-800/90 via-rose-900/90 to-stone-950/95"
              : offer.rarity === "rare"
                ? "from-sky-800/90 via-rose-900/90 to-stone-950/95"
                : "from-rose-800/90 via-rose-900/90 to-stone-950/95";

        return (
          <div
            key={offer.id}
            className={`relative rounded-2xl border-2 ${rarityBorder} bg-gradient-to-br ${rarityBg} p-3 overflow-hidden`}
          >
            {/* Discount badge */}
            <div className="absolute top-2 left-2 z-10 bg-gradient-to-b from-red-500 to-red-700 text-white text-[10px] font-extrabold px-2 py-1 rounded-md border border-red-300 shadow-lg rotate-[-8deg]">
              -{savings}%
            </div>
            {offer.badge && (
              <div className="absolute top-2 right-2 z-10 bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 text-[10px] font-extrabold px-2 py-1 rounded-md border border-amber-200 shadow-lg">
                {offer.badge}
              </div>
            )}

            <div className="text-center mt-6 mb-2">
              <div className="text-base font-extrabold text-white text-glow">{offer.name}</div>
              <div className="text-[11px] text-rose-100/80 mt-0.5">{offer.desc}</div>
            </div>

            {/* Contents preview */}
            <div className="flex items-center justify-center gap-2 my-3 flex-wrap">
              {offer.contents.map((c) => (
                <div
                  key={c.id}
                  className="relative w-14 h-14 rounded-lg bg-black/40 border-2 border-white/20 flex items-center justify-center overflow-hidden"
                >
                  <img src={c.image} alt={c.name} className="w-full h-full object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]" />
                  <span className="absolute -bottom-1 -right-1 bg-rose-600 border border-rose-200 text-white text-[10px] font-extrabold rounded-md px-1.5 py-0.5 shadow">
                    ×{c.qty}
                  </span>
                </div>
              ))}
            </div>

            {/* Price + buy */}
            <div className="flex items-center justify-between gap-2 mt-2">
              <div className="flex flex-col items-start">
                <div className="text-[11px] text-rose-200/70 line-through">
                  {offer.originalPrice.toLocaleString()}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xl font-extrabold text-amber-300 text-glow tabular-nums">
                    {offer.price.toLocaleString()}
                  </span>
                  {offer.currency === "gem" ? (
                    <img src={gemIcon} alt="gem" className="w-6 h-6 object-contain" />
                  ) : (
                    <img src={coinIcon} alt="gold" className="w-6 h-6 object-contain" />
                  )}
                </div>
              </div>

              <button
                onClick={() => buy(offer)}
                disabled={busyId === offer.id}
                className="px-6 py-3 rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200 shadow-lg text-white font-extrabold text-base active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busyId === offer.id ? "..." : "شراء"}
              </button>
            </div>
          </div>
        );
      })}

      {pop && (
        <div className="fixed left-1/2 top-1/3 -translate-x-1/2 z-50 text-base font-bold text-amber-200 text-glow pointer-events-none bg-stone-900/90 px-4 py-2 rounded-xl border border-amber-400/40">
          {pop}
        </div>
      )}
    </div>
  );
}
