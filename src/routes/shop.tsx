import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { buyWithCoins, buyWithCoinsGemFallback, buyWithGems, buyProtection } from "@/lib/economy";
import { useAuth, useProfile, refreshProfile } from "@/hooks/use-auth";
import { CREWS as LIB_CREWS } from "@/lib/crews";
import { WEAPONS as LIB_WEAPONS } from "@/lib/weapons";
import { sound } from "@/lib/sound";
import { RedeemDialog } from "@/components/RedeemDialog";
import { RechargePanel } from "@/components/RechargePanel";
import { BackgroundsPanel } from "@/components/BackgroundsPanel";
import { ELITE_VIP_TIERS } from "@/lib/elite-vip";
import { formatSarFromUsd } from "@/lib/currency";

import { serverNowMs } from "@/lib/server-time";


export const Route = createFileRoute("/shop")({
  head: () => ({
    meta: [
      { title: "المتجر — ملوك القراصنة | أسلحة وطواقم وجواهر هامور شابك" },
      { name: "description", content: "متجر ملوك القراصنة (هامور شابك): اشترِ الأسلحة، الطواقم، الحماية، الجواهر، وترقيات السفن للعبة القراصنة العربية." },
      { property: "og:title", content: "متجر ملوك القراصنة (هامور شابك)" },
      { property: "og:description", content: "أسلحة، طواقم، حماية، وجواهر في متجر لعبة ملوك القراصنة." },
      { property: "og:url", content: "https://www.molok-alqarasna.com/shop" },
    ],
    links: [{ rel: "canonical", href: "https://www.molok-alqarasna.com/shop" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "متجر ملوك القراصنة",
          url: "https://www.molok-alqarasna.com/shop",
          inLanguage: "ar",
          description: "تشكيلة العناصر القابلة للشراء داخل لعبة ملوك القراصنة: أسلحة، طواقم، دروع، جواهر، خلفيات، باقات الشحن، واشتراكات VIP.",
          isPartOf: { "@type": "WebSite", name: "ملوك القراصنة", url: "https://www.molok-alqarasna.com/" },
          mainEntity: {
            "@type": "ItemList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "أسلحة" },
              { "@type": "ListItem", position: 2, name: "طواقم" },
              { "@type": "ListItem", position: 3, name: "حماية ودروع" },
              { "@type": "ListItem", position: 4, name: "خلفيات" },
              { "@type": "ListItem", position: 5, name: "شحن جواهر وذهب" },
              { "@type": "ListItem", position: 6, name: "اشتراك VIP" },
            ],
          },
        }),
      },
    ],
  }),
  component: Shop,
});


type Tab = "protection" | "weapons" | "crews" | "ships" | "backgrounds" | "recharge" | "vip";

type Item = {
  id: string;
  name: string;
  emoji: string;
  price: number;
  currency: "gem" | "coin";
  desc?: string;
  rarity?: "common" | "rare" | "epic" | "legendary";
  image?: string;
};

import rocketSmallImg from "@/assets/weapons/rocket-small.png";
import rocketMediumImg from "@/assets/weapons/rocket-medium.png";
import rocketLargeImg from "@/assets/weapons/rocket-large.png";
import nukeImg from "@/assets/weapons/nuke.png";
import coinIcon from "@/assets/icons/icon-coins.png";
import gemIcon from "@/assets/icons/icon-gems.png";
import phoenixShipImg from "@/assets/ships/ship-phoenix.png";
import { showBanner } from "@/components/Banner";

const WEAPON_IMAGES: Record<string, string> = {
  rocket_small: rocketSmallImg,
  rocket_medium: rocketMediumImg,
  rocket_large: rocketLargeImg,
  nuke: nukeImg,
};

// Armor cooldown is enforced server-side in buy_protection.

const TABS: { id: Tab; label: string; banner: string }[] = [
  
  { id: "protection", label: "حمايه", banner: "Protection" },
  { id: "weapons", label: "أسلحه", banner: "Weapons" },
  { id: "crews", label: "طواقم", banner: "Ship Crew" },
  { id: "ships", label: "سفن", banner: "Special Ships" },
  { id: "vip", label: "👑 VIP", banner: "Elite VIP" },
  { id: "backgrounds", label: "🖼️ خلفيات", banner: "Backgrounds" },
  { id: "recharge", label: "💳 شحن", banner: "Recharge" },
];

// Max armor duration capped at 2 days. Higher tiers removed.
const PROTECTION: Item[] = [
  { id: "shield-4h", name: "درع لمده 4 ساعات", emoji: "🛡️", price: 60, currency: "gem", desc: "يُضاف للمخزن — فعّله وقت ما تحتاجه" },
  { id: "shield-1d", name: "درع لمده يوم", emoji: "🛡️", price: 280, currency: "gem", desc: "يُضاف للمخزن — فعّله وقت ما تحتاجه" },
  { id: "shield-2d", name: "درع لمده يومين", emoji: "🛡️", price: 550, currency: "gem", desc: "يُضاف للمخزن — فعّله وقت ما تحتاجه" },
  { id: "anti_rocket", name: "مضاد صواريخ", emoji: "🚀", price: 50, currency: "gem", desc: "استخدام واحد • نسبة صد 60% لأي صاروخ قادم", rarity: "rare" },
  { id: "anti_nuke", name: "مضاد قنبلة ذرية", emoji: "☢️", price: 120, currency: "gem", desc: "استخدام واحد • نسبة صد 75% للقنبلة الذرية", rarity: "epic" },
  { id: "anti_ad_bomb", name: "مضاد قنبلة إعلانية", emoji: "📺", price: 210, currency: "gem", desc: "استخدام واحد • نسبة صد 70% للقنبلة الإعلانية", rarity: "epic" },
];


const WEAPONS: Item[] = LIB_WEAPONS.map((w) => ({
  id: w.id,
  name: w.name,
  emoji: w.emoji,
  price: w.price,
  currency: w.currency === "gems" ? "gem" : "coin",
  desc: w.desc
    ? `${w.desc} • ضرر ${w.aoe ? "∞" : w.damage.toLocaleString()}`
    : `ضرر ${w.damage.toLocaleString()}`,
  rarity: w.rarity,
  image: WEAPON_IMAGES[w.id],
}));

const CREWS: Item[] = LIB_CREWS.map((c) => ({
  id: c.id,
  name: c.name,
  emoji: c.emoji,
  image: c.image,
  price: c.price,
  currency: c.currency === "gems" ? "gem" : "coin",
  desc: c.bonus,
  rarity: c.rarity,
}));

const SHIPS_FOR_SALE: Item[] = [
  {
    id: "phoenix-pack-3",
    name: "حزمة 3 سفن عنقاء 🐉",
    emoji: "🐉",
    image: phoenixShipImg,
    price: 3800,
    currency: "gem",
    desc: "ثلاث سفن عنقاء دفعة واحدة • كل سفينة بدمّ 13,000 وسعة صيد 13,000 • تصيد عنقاء النار النادرة 🔥 • صيد 20 دقيقة. أفضل قيمة للقادة الطموحين!",
    rarity: "legendary",
  },
  {
    id: "phoenix-pack-1",
    name: "سفينة عنقاء واحدة 🐉",
    emoji: "🐉",
    image: phoenixShipImg,
    price: 1500,
    currency: "gem",
    desc: "سفينة عنقاء فردية • دمّ 13,000 وسعة صيد 13,000 • تصيد عنقاء النار النادرة 🔥 • صيد 20 دقيقة. مثالية لتجربة قوة العنقاء.",
    rarity: "legendary",
  },
];



function Shop() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const coins = profile?.coins ?? 0;
  const gems = profile?.gems ?? 0;
  const [tab, setTab] = useState<Tab>("recharge");
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [pop, setPop] = useState<string | null>(null);

  const flash = (m: string, ms = 1500) => { setPop(m); setTimeout(() => setPop(null), ms); };

  const items =
    tab === "protection" ? PROTECTION :
    tab === "weapons" ? WEAPONS :
    tab === "ships" ? SHIPS_FOR_SALE : CREWS;

  const tabMeta = TABS.find((t) => t.id === tab)!;

  const pickItem = (it: Item) => {
    setSelected(it);
    setQty(1);
  };

  const buy = async () => {
    if (!selected || busy || busyRef.current) return;
    if (!user || !profile) { flash("سجّل الدخول أولاً"); return; }
    const total = selected.price * qty;
    if (selected.currency === "gem" && gems < total) { flash("لا تملك جواهر كافيه"); return; }
    if (selected.currency === "coin" && coins < total) {
      flash("الذهب غير كافٍ");
      return;
    }
    // تأكيد لكل عملية شراء
    const currencyLabel = selected.currency === "gem" ? "جوهرة" : "ذهب";
    if (!window.confirm(`تأكيد شراء ${qty} × ${selected.name} مقابل ${total.toLocaleString()} ${currencyLabel}؟`)) return;



    busyRef.current = true;
    setBusy(true);
    try {

    if (tab === "protection") {
      // Anti-weapon items go through a dedicated RPC
      if (selected.id.startsWith("anti_")) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.rpc as any)("buy_anti_to_inventory", { _item_id: selected.id, _qty: qty });
        setBusy(false);
        if (error) { flash("فشل الشراء: " + error.message, 2000); return; }
      } else {
      // Buy shield as an inventory item — user activates manually from المخزن.
      const invId =
        selected.id === "shield-4h" ? "shield_4h" :
        selected.id === "shield-1d" ? "shield_1d" :
        selected.id === "shield-2d" ? "shield_2d" : "";
      if (!invId) { setBusy(false); flash("نوع درع غير معروف", 2000); return; }
      const coinsCost = selected.currency === "coin" ? total : 0;
      const gemsCost = selected.currency === "gem" ? total : 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)("buy_shield_to_inventory", {
        _item_id: invId, _qty: qty, _coins_cost: coinsCost, _gems_cost: gemsCost,
      });
      setBusy(false);
      if (error) { flash("فشل الشراء: " + (error.message || ""), 2000); return; }
      flash("✓ تم إضافة الدرع للمخزن — فعّله من المخزن وقت ما تحتاجه", 2400);
      }
    } else if (tab === "ships") {
      // Phoenix shop ships — pack of 3 or single, calls dedicated RPC once per quantity
      const rpcName = selected.id === "phoenix-pack-3" ? "buy_phoenix_pack_3" : "buy_phoenix_pack_1";
      for (let i = 0; i < qty; i++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.rpc as any)(rpcName);
        if (error) { setBusy(false); flash("فشل الشراء: " + error.message, 2000); return; }
      }
      setBusy(false);
    } else {
      // Buy inventory item — one RPC call adds N to inventory and charges N × price
      const itemType = tab === "weapons" ? "weapon" : "crew";
      const { error } = selected.currency === "gem"
        ? await buyWithGems(selected.id, itemType, selected.price, undefined, qty)
        : await buyWithCoins(selected.id, itemType, selected.price, undefined, qty);
      if (error) { setBusy(false); flash("فشل الشراء: " + error.message, 2000); return; }
      setBusy(false);
    }

    sound.play("coin");
    sound.play("success");
    flash(`✓ اشتريت ${qty} × ${selected.name}`, 1600);
    showBanner({
      kind: "purchase",
      title: selected.name,
      subtitle: `${total} ${selected.currency === "gem" ? "جوهرة" : "ذهب"}`,
      emoji: selected.emoji,
      image: selected.image,
      count: qty,
    });
    refreshProfile();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };


  return (
    <div
      className="fixed inset-0 overflow-hidden text-white"
      dir="rtl"
      style={{
        background:
          "radial-gradient(ellipse at top, #6b1010 0%, #3a0b0b 45%, #1a0505 100%)",
      }}
    >
      {/* Subtle flame edge */}
      <div
        className="absolute inset-x-0 top-0 h-24 pointer-events-none opacity-40"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,120,40,0.6) 0%, rgba(255,40,20,0.1) 70%, transparent 100%)",
        }}
      />

      {/* TOP HUD */}
      <div className="absolute top-0 left-0 right-0 z-30 px-2 pb-2 flex items-center gap-2" style={{ paddingTop: "max(1.75rem, calc(env(safe-area-inset-top) + 1.25rem))" }}>
        <Link to="/" aria-label="العودة إلى الرئيسية" className="w-10 h-10 rounded-xl bg-gradient-to-b from-rose-500 to-rose-800 border-2 border-rose-300 flex items-center justify-center text-lg font-bold shadow-lg active:scale-95">
          ↩
        </Link>
        <div className="flex-1 flex items-center justify-around gap-1">
          <ResChip icon={gemIcon} v={gems} color="text-cyan-200" />
          <ResChip icon={coinIcon} v={coins} color="text-amber-300" />
        </div>
        <button onClick={() => setRedeemOpen(true)} aria-label="استبدال كود" className="w-10 h-10 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-800 border-2 border-emerald-300 flex items-center justify-center text-lg active:scale-95 shadow-lg" title="استبدال كود">🎟️</button>
        
        <Link to="/ships-shop" aria-label="سوق السفن" className="w-10 h-10 rounded-xl bg-gradient-to-b from-amber-500 to-amber-800 border-2 border-amber-300 flex items-center justify-center text-lg active:scale-95 shadow-lg" title="سوق السفن">⛵</Link>

      </div>

      {redeemOpen && <RedeemDialog onClose={() => setRedeemOpen(false)} />}

      {/* Title */}
      <h1 className="absolute left-0 right-0 z-20 text-center text-lg font-extrabold text-glow m-0" style={{ top: "calc(max(1.75rem, env(safe-area-inset-top)) + 3.75rem)" }}>
        المتجر — ملوك القراصنة (هامور شابك)
      </h1>


      {/* Tabs */}
      <div className="absolute left-0 right-0 z-20 px-2 flex gap-1" style={{ top: "calc(max(1.75rem, env(safe-area-inset-top)) + 5.25rem)" }}>
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setSelected(null); }}
              className={`flex-1 py-2 rounded-t-xl text-sm font-bold border-2 border-b-0 transition-all active:scale-95 ${
                active
                  ? "bg-gradient-to-b from-rose-400 to-rose-600 border-rose-200 text-white shadow-lg -mb-px"
                  : "bg-gradient-to-b from-rose-900/70 to-rose-950/80 border-rose-900/60 text-rose-200/70"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Panel */}
      <div className="absolute left-2 right-2 bottom-32 z-10 rounded-2xl bg-gradient-to-b from-rose-950/90 to-stone-950/90 border-2 border-rose-900/60 shadow-2xl flex flex-col overflow-hidden" style={{ top: "calc(max(1.75rem, env(safe-area-inset-top)) + 8rem)" }}>
        {/* Banner */}
        <div className="px-3 pt-3">
          <Banner
            text={tabMeta.banner}
            color={
              tab === "weapons"
                ? "orange"
                : tab === "crews"
                  ? "blue"
                  : tab === "recharge"
                    ? "violet"
                    : tab === "backgrounds"
                      ? "indigo"
                      : "green"
            }
          />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-1 pb-3">
          {tab === "recharge" ? (
            <RechargePanel />
          ) : tab === "backgrounds" ? (
            <BackgroundsPanel />
          ) : tab === "vip" ? (
            <VipPanel />
          ) : (
            <div className="grid grid-cols-3 gap-2 mt-3 px-2">
              {items.map((it) => (
                <ShopCard
                  key={it.id}
                  item={it}
                  tab={tab}
                  active={selected?.id === it.id}
                  onClick={() => pickItem(it)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer: selected item detail + qty + buy (hidden on recharge tab) */}
      {selected && tab !== "recharge" && tab !== "backgrounds" && tab !== "vip" && (
        <div className="absolute bottom-12 left-2 right-2 z-20 rounded-xl bg-gradient-to-b from-rose-900/90 to-stone-950/95 border-2 border-rose-700/60 shadow-2xl p-2">
          <div className="flex items-center gap-3">
            <div className="relative w-16 h-16 rounded-lg bg-gradient-to-b from-rose-800 to-stone-900 border border-rose-500/40 flex items-center justify-center text-3xl overflow-hidden">
              {selected.image ? (
                <img src={selected.image} alt={selected.name} className="w-full h-full object-contain" />
              ) : (
                selected.emoji
              )}
              {tab !== "ships" && (tab !== "protection" || selected.id.startsWith("anti_")) && (
                <span className="absolute -top-1 -left-1 text-[9px] font-bold bg-rose-600 px-1 rounded">X{qty}</span>
              )}
            </div>
            <div className="flex-1 text-right">
              <div className="text-sm font-bold">{selected.name}</div>
              {selected.desc && (
                <div className="text-[11px] text-rose-100/80 leading-snug">{selected.desc}</div>
              )}
              <div className="text-amber-300 font-bold text-sm mt-0.5">
                {(selected.price * qty).toLocaleString()}
              </div>
            </div>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <div className="rounded-lg bg-gradient-to-b from-emerald-400 to-emerald-700 border border-emerald-200 px-3 py-1.5 flex items-center gap-1">
              <span className="text-base inline-flex items-center">{selected.currency === "gem" ? "💎" : <img src={coinIcon} alt="أيقونة الذهب" className="w-5 h-5 object-contain" />}</span>
              <span className="text-sm font-extrabold text-white">{(selected.price * qty).toLocaleString()}</span>
            </div>

            {tab !== "ships" && (tab !== "protection" || selected.id.startsWith("anti_")) ? (
              <div className="flex-1 flex items-center justify-center gap-2">
                <button
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  aria-label="إنقاص الكمية"
                  className="w-9 h-9 rounded-full bg-rose-700 border-2 border-rose-300 text-white text-lg font-bold flex items-center justify-center active:scale-95"
                >−</button>
                <div className="min-w-[2.5rem] text-center font-extrabold text-lg">{qty}</div>
                <button
                  onClick={() => setQty((q) => Math.min(99, q + 1))}
                  aria-label="زيادة الكمية"
                  className="w-9 h-9 rounded-full bg-rose-700 border-2 border-rose-300 text-white text-lg font-bold flex items-center justify-center active:scale-95"
                >+</button>

              </div>
            ) : (
              <div className="flex-1" />
            )}

            <button
              onClick={buy}
              disabled={busy}
              className="px-5 py-2 rounded-lg bg-gradient-to-b from-amber-300 to-amber-500 border-2 border-amber-200 shadow-lg text-amber-950 font-extrabold active:scale-95 disabled:opacity-60 disabled:pointer-events-none"
            >
              {busy ? "..." : "شراء"}
            </button>
          </div>
        </div>
      )}

      {/* Bottom nav */}
      <BottomNav />

      {/* Popup */}
      {pop && (
        <div className="fixed left-1/2 top-1/3 -translate-x-1/2 z-50 text-base font-bold text-amber-200 text-glow pointer-events-none animate-float-up bg-stone-900/80 px-4 py-2 rounded-xl border border-amber-400/40">
          {pop}
        </div>
      )}
    </div>
  );
}

/* ───────────────── Components ───────────────── */

function Banner({ text, color }: { text: string; color: "green" | "orange" | "blue" | "violet" | "indigo" | "rose" }) {
  const colors = {
    green: "from-emerald-500 to-emerald-700 border-emerald-300",
    orange: "from-orange-500 to-orange-700 border-orange-300",
    blue: "from-sky-500 to-sky-700 border-sky-300",
    violet: "from-violet-500 to-violet-700 border-violet-300",
    indigo: "from-indigo-500 to-indigo-700 border-indigo-300",
    rose: "from-rose-500 to-rose-700 border-rose-300",
  }[color];
  return (
    <div className="relative h-12 flex items-center justify-center">
      <div className={`relative w-full max-w-md h-10 rounded-md bg-gradient-to-b ${colors} border-2 shadow-lg flex items-center justify-center`}>
        <span className="absolute -left-3 top-1/2 -translate-y-1/2 w-5 h-5 bg-stone-950 rotate-45 border-l-2 border-b-2 border-stone-900" />
        <span className="absolute -right-3 top-1/2 -translate-y-1/2 w-5 h-5 bg-stone-950 rotate-45 border-r-2 border-t-2 border-stone-900" />
        <span className="text-base font-extrabold text-white tracking-wide text-glow">{text}</span>
      </div>
    </div>
  );
}

function ShopCard({
  item, tab, active, onClick,
}: { item: Item; tab: Tab; active: boolean; onClick: () => void }) {
  const cardBg =
    tab === "protection" ? "from-emerald-500 to-emerald-700 border-emerald-300" :
    tab === "weapons" ? "from-stone-700 to-stone-900 border-amber-700/60" :
    tab === "crews" ? "from-sky-500 to-sky-800 border-sky-300" :
    "from-violet-600 to-violet-900 border-violet-300";

  const ringClass = active ? "ring-4 ring-amber-300 shadow-2xl scale-[1.02]" : "";

  return (
    <button
      onClick={onClick}
      className={`relative rounded-xl p-2 flex flex-col items-center text-center border-2 bg-gradient-to-b ${cardBg} ${ringClass} active:scale-95 transition-all`}
    >
      <div className="text-[10px] font-bold text-white text-glow mb-1 whitespace-nowrap overflow-hidden">
        {item.name}
      </div>
      <div className="w-full aspect-[3/4] rounded-md bg-black/25 border border-white/20 flex items-center justify-center text-4xl shadow-inner overflow-hidden">
        {item.image ? (
          <img
            src={item.image}
            alt={item.name}
            loading="lazy"
            width={512}
            height={512}
            className="w-full h-full object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.6)]"
          />
        ) : (
          item.emoji
        )}
      </div>
      <div className="mt-1 px-3 py-1 rounded bg-gradient-to-b from-amber-300 to-amber-500 border border-amber-200 flex items-center gap-1 shadow text-amber-950 text-[11px] font-extrabold">
        {item.price.toLocaleString()}
        <span className="inline-flex items-center">{item.currency === "gem" ? "💎" : <img src={coinIcon} alt="أيقونة الذهب" className="w-4 h-4 object-contain" />}</span>
      </div>
    </button>
  );
}

function ResChip({ icon, v, color, plus }: { icon: string; v: number; color: string; plus?: boolean }) {
  return (
    <div className="glass-hud rounded-lg px-2 py-1 flex items-center gap-1 border border-accent/30">
      <img src={icon} alt="" className="w-5 h-5 object-contain drop-shadow" />
      <span className={`text-[11px] font-bold tabular-nums ${color}`}>{v.toLocaleString()}</span>
      {plus && (
        <span className="w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">+</span>
      )}
    </div>
  );
}

function BottomNav() {
  const items = [
    { e: "✉️", l: "البريد" },
    { e: "🏛️", l: "المتجر" },
    { e: "⚔️", l: "القبائل" },
    { e: "🎉", l: "الفعاليات" },
    { e: "📜", l: "المهام" },
  ];
  return (
    <div className="absolute bottom-0 left-0 right-0 z-30 glass-hud border-t border-accent/30 px-2 py-1.5 flex items-center justify-around">
      {items.map((it, i) => (
        <button key={i} className="flex flex-col items-center gap-0.5 px-2 active:scale-95">
          <div className="w-8 h-8 rounded-full bg-gradient-to-b from-amber-700/80 to-amber-900/80 border border-accent/60 flex items-center justify-center text-sm">
            {it.e}
          </div>
          <span className="text-[8px] text-accent/90 font-medium">{it.l}</span>
        </button>
      ))}
    </div>
  );
}

function VipPanel() {
  return (
    <div className="mt-3 px-2 space-y-2">
      <Link
        to="/vip"
        className="block w-full rounded-xl p-3 bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 text-slate-900 font-extrabold text-center shadow-lg active:scale-95"
      >
        🏆 افتح صفحة Elite VIP الكاملة
      </Link>
      <div className="grid grid-cols-1 gap-2">
        {ELITE_VIP_TIERS.map((t) => (
          <Link
            key={t.level}
            to="/vip"
            className={`flex items-center gap-3 rounded-xl p-2 border-2 ${
              t.level === 5
                ? "bg-gradient-to-r from-purple-950/80 to-fuchsia-950/80 border-fuchsia-400/60"
                : t.level === 4
                  ? "bg-gradient-to-r from-indigo-950/80 to-sky-950/80 border-sky-400/50"
                  : t.level === 3
                    ? "bg-gradient-to-r from-amber-950/80 to-yellow-950/80 border-amber-400/50"
                    : t.level === 2
                      ? "bg-gradient-to-r from-slate-800/80 to-slate-950/80 border-slate-300/40"
                      : "bg-gradient-to-r from-orange-950/80 to-rose-950/80 border-amber-700/50"
            } active:scale-95`}
          >
            <img src={t.badge} alt={`VIP ${t.level}`} className="w-14 h-14 object-contain shrink-0" />
            <div className="flex-1 text-right">
              <div className="text-[10px] font-bold text-amber-300/80 tracking-widest">
                ELITE VIP {t.level}
              </div>
              <div className={`text-base font-extrabold ${t.nameColorClass || "text-amber-100"}`}>
                {t.emoji} {t.nameAr}
              </div>
              <div className="text-[11px] text-rose-100/80">
                ⚔️ +{t.combatBonusPct}% • 🛒 -{t.shopDiscountPct}% • 💎 {t.dailyGems}/يوم
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xl font-black text-white">{formatSarFromUsd(t.monthlyPriceUsd)}</div>
              <div className="text-[10px] text-slate-300">/شهر</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
