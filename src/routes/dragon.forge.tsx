import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { rateLimit } from "@/lib/rate-limit";
import { useDragonUnlocked } from "@/lib/dragon-access";

import {
  EquipmentItem, Rarity, Slot,
  SHOP, SLOT_IMG, SLOT_LABEL, RARITY_LABEL, RARITY_COLOR,
  UPGRADE_COST, nextRarity,
} from "@/lib/dragon-equipment";

export const Route = createFileRoute("/dragon/forge")({
  ssr: false,
  head: () => ({ meta: [{ title: "⚒️ الفورج — ملوك القراصنة" }] }),
  component: ForgeGate,
});

function ForgeGate() {
  const unlocked = useDragonUnlocked();
  return unlocked ? <ForgePage /> : <ForgeLocked />;
}

function ForgeLocked() {
  return (
    <div className="fixed inset-0 bg-gradient-to-b from-[#0a0a14] via-[#12122a] to-[#0a0a14] flex items-center justify-center p-6" dir="rtl">
      <div className="max-w-sm w-full text-center bg-stone-900/80 border border-amber-700/40 rounded-2xl p-6 shadow-2xl">
        <div className="text-6xl mb-4">🔒⚒️</div>
        <div className="text-amber-200 text-xl font-extrabold mb-2">الفورج وتطوير التنين مقفل</div>
        <div className="text-amber-100/70 text-sm mb-5">هذه الميزة قيد الإعداد — راجعنا قريباً!</div>
        <Link to="/" className="inline-block px-5 py-2 rounded-xl bg-amber-600 text-white font-bold active:scale-95">رجوع</Link>
      </div>
    </div>
  );
}





type Tab = "smelt" | "inventory" | "shop" | "upgrade";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase.rpc.bind(supabase) as unknown as (n: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;

function ForgePage() {
  const [tab, setTab] = useState<Tab>("smelt");
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [coins, setCoins] = useState(0);
  const [gems, setGems] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const [{ data: invD }, { data: pD }] = await Promise.all([
      supabase.from("dragon_equipment").select("*").eq("user_id", user.id).order("acquired_at", { ascending: false }),
      supabase.from("profiles").select("coins,gems").eq("id", user.id).single(),
    ]);
    setItems((invD ?? []) as EquipmentItem[]);
    if (pD) { setCoins(Number(pD.coins ?? 0)); setGems(Number(pD.gems ?? 0)); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  const buy = async (slot: Slot, rarity: Rarity, currency: "coins" | "gems") => {
    if (busy) return;
    if (!(await rateLimit("purchase", 1000))) { flash("⏳ تمهّل قليلاً قبل المحاولة مجدداً"); return; }
    setBusy(true);

    const { data, error } = await rpc("buy_dragon_equipment", { p_slot: slot, p_rarity: rarity, p_currency: currency });
    setBusy(false);
    if (error) return flash("❌ " + error.message);
    if (data?.ok === false) return flash("❌ " + (data.error ?? "فشل الشراء"));
    flash("✅ تم الشراء: " + data?.name);
    reload();
  };

  const equip = async (id: string) => {
    if (busy) return;
    setBusy(true);
    // optimistic toggle so UI feels instant
    const target = items.find((x) => x.id === id);
    if (target) {
      setItems((cur) => cur.map((x) =>
        x.slot === target.slot
          ? { ...x, equipped: x.id === id ? !target.equipped : false }
          : x
      ));
    }
    const { data, error } = await rpc("equip_dragon_item", { p_item_id: id });
    setBusy(false);
    if (error) { flash("❌ " + error.message); reload(); return; }
    flash(data?.equipped ? "⚔ تم التجهيز" : "↩ تم إلغاء التجهيز");
    reload();
  };


  const upgrade = async (id: string) => {
    if (busy) return;
    if (!(await rateLimit("purchase", 1000))) { flash("⏳ تمهّل قليلاً قبل المحاولة مجدداً"); return; }
    setBusy(true);
    const { data, error } = await rpc("upgrade_dragon_item", { p_item_id: id });

    setBusy(false);
    if (error) return flash("❌ " + error.message);
    if (data?.ok === false) return flash("❌ " + (data.error ?? "فشل الترقية"));
    flash(`✨ تمت الترقية إلى ${RARITY_LABEL[data.rarity as Rarity]}`);
    reload();
  };

  const smelt = async (aId: string, bId: string) => {
    if (busy) return;
    if (!(await rateLimit("purchase", 1500))) { flash("⏳ تمهّل قليلاً"); return; }
    setBusy(true);
    const { data, error } = await rpc("smelt_dragon_items", { p_a_id: aId, p_b_id: bId });
    setBusy(false);
    if (error) return flash("❌ " + error.message);
    if (data?.ok === false) return flash("❌ " + (data.error ?? "فشل الصهر"));
    const icon = data.outcome === "upgrade" ? "🌟" : data.outcome === "downgrade" ? "💔" : "✨";
    const label = data.outcome === "upgrade" ? "ترقية ناجحة!" : data.outcome === "downgrade" ? "تراجع!" : "بدون تغيير";
    flash(`${icon} ${label} — ${RARITY_LABEL[data.rarity as Rarity]}`);
    reload();
  };

  return (
    <div
      className="fixed inset-0 overflow-y-auto"
      dir="rtl"
      style={{ background: "radial-gradient(ellipse at top, #1a0a1f 0%, #0a0a14 60%, #000 100%)" }}
    >
      {/* Ember particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {Array.from({ length: 24 }).map((_, i) => (
          <div key={i} className="absolute w-1 h-1 rounded-full bg-amber-400"
            style={{
              left: `${(i * 41) % 100}%`, bottom: "-10px",
              animation: `ember-rise ${8 + (i % 5) * 2}s linear infinite`,
              animationDelay: `${(i * 0.4) % 8}s`, opacity: 0.6,
              boxShadow: "0 0 6px rgba(251,191,36,0.8)",
            }} />
        ))}
      </div>
      <style>{`
        @keyframes ember-rise { 0%{transform:translateY(0);opacity:0}10%{opacity:.8}90%{opacity:.4}100%{transform:translateY(-110vh);opacity:0} }
        @keyframes shimmer { 0%,100%{filter:drop-shadow(0 0 12px var(--g))} 50%{filter:drop-shadow(0 0 24px var(--g))} }
      `}</style>

      <div className="relative z-10 max-w-md mx-auto px-3 pt-4 pb-32">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <Link to="/dragon" className="glass-hud rounded-full px-3 py-1.5 text-amber-200 text-sm font-bold border border-amber-500/40">← التنين</Link>
          <div className="glass-hud rounded-full px-3 py-1.5 text-amber-200 text-sm font-bold border border-amber-500/40">⚒️ الفورج</div>
        </div>

        {/* Wallet */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-stone-900/70 border border-amber-700/40 rounded-xl p-2 text-center backdrop-blur">
            <div className="text-amber-300/70 text-[10px]">الذهب</div>
            <div className="text-amber-100 font-extrabold tabular-nums">🪙 {coins.toLocaleString()}</div>
          </div>
          <div className="bg-stone-900/70 border border-purple-600/40 rounded-xl p-2 text-center backdrop-blur">
            <div className="text-purple-300/70 text-[10px]">الجواهر</div>
            <div className="text-purple-100 font-extrabold tabular-nums">💎 {gems.toLocaleString()}</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-4 gap-1.5 mb-3 bg-stone-900/60 p-1 rounded-xl border border-amber-700/30">
          {([
            ["smelt", "🔥 صهر"],
            ["inventory", "🎒 الانفنتري"],
            ["shop", "🛒 المتجر"],
            ["upgrade", "✨ ترقية"],
          ] as [Tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`py-2 rounded-lg text-[11px] font-bold transition-all ${
                tab === k ? "bg-gradient-to-b from-amber-500 to-orange-600 text-stone-900 shadow-lg" : "text-amber-200/70"
              }`}>{label}</button>
          ))}
        </div>

        {tab === "smelt" && (
          <SmeltTab items={items} onSmelt={smelt} gems={gems} busy={busy} />
        )}
        {tab === "inventory" && (
          <InventoryTab items={items} onEquip={equip} />
        )}
        {tab === "shop" && (
          <ShopTab onBuy={buy} busy={busy} />
        )}
        {tab === "upgrade" && (
          <UpgradeTab items={items} onUpgrade={upgrade} gems={gems} />
        )}
      </div>

      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-stone-900/95 border border-amber-500/60 rounded-2xl px-5 py-3 text-amber-100 font-bold shadow-2xl backdrop-blur">
          {toast}
        </div>
      )}
    </div>
  );
}

function ItemCard({ item, action }: { item: EquipmentItem; action?: React.ReactNode }) {
  const c = RARITY_COLOR[item.rarity];
  return (
    <div className={`relative rounded-2xl p-3 border-2 ${c.ring} bg-gradient-to-br ${c.bg} backdrop-blur`}
      style={{ ["--g" as string]: c.glow } as React.CSSProperties}>
      {item.equipped && (
        <div className="absolute -top-1.5 -end-1.5 z-10 bg-emerald-500 text-stone-900 text-[10px] font-extrabold rounded-full px-2 py-0.5 border-2 border-emerald-900">مُجهَّز</div>
      )}
      <div className="flex items-center gap-3">
        <div className="w-16 h-16 rounded-xl bg-stone-950/60 border border-stone-700/50 flex items-center justify-center overflow-hidden flex-shrink-0">
          <img src={SLOT_IMG[item.slot]} alt={item.name} className="w-full h-full object-contain"
            style={{ animation: "shimmer 2.5s ease-in-out infinite" }} loading="lazy" />
        </div>
        <div className="flex-1 min-w-0">
          <div className={`font-extrabold text-sm ${c.text} truncate`}>{item.name}</div>
          <div className="text-stone-400 text-[10px] mb-1">
            {SLOT_LABEL[item.slot]} • <span className={c.text}>{RARITY_LABEL[item.rarity]}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {typeof item.stats.attack_pct === "number" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-900/50 text-rose-200 border border-rose-700/40">+{item.stats.attack_pct}% هجوم</span>
            )}
            {typeof item.stats.crit === "number" && item.stats.crit > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-200 border border-amber-700/40">{item.stats.crit}% ضربة قاضية</span>
            )}
            {item.stats.free_strike && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-200 border border-purple-700/40">🐲 ضربة مجانية</span>
            )}
            {item.stats.continuous && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-900/60 text-rose-100 border border-rose-500/60">🔥 إطلاق مستمر</span>
            )}
          </div>
        </div>
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

function InventoryTab({ items, onEquip }: { items: EquipmentItem[]; onEquip: (id: string) => void }) {
  if (items.length === 0) {
    return (
      <div className="bg-stone-900/60 border border-amber-700/30 rounded-2xl p-8 text-center text-amber-200/70">
        🎒 لا توجد قطع بعد — اذهب للمتجر
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <ItemCard key={it.id} item={it} action={
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); console.log("[equip-click]", it.id); onEquip(it.id); }}
            className={`w-full py-2 rounded-lg text-xs font-bold relative z-20 touch-manipulation ${

              it.equipped
                ? "bg-stone-800 text-stone-300 border border-stone-600/50"
                : "bg-gradient-to-b from-emerald-500 to-emerald-700 text-white shadow-md"
            }`}>
            {it.equipped ? "↩ إزالة التجهيز" : "⚔ تجهيز"}
          </button>
        } />
      ))}

    </div>
  );
}

function ShopTab({ onBuy, busy }: { onBuy: (s: Slot, r: Rarity, c: "coins" | "gems") => void; busy: boolean }) {
  const [slot, setSlot] = useState<Slot>("weapon");
  const offers = SHOP.filter((o) => o.slot === slot);
  return (
    <div>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {(["weapon", "armor", "talisman"] as Slot[]).map((s) => (
          <button key={s} onClick={() => setSlot(s)}
            className={`py-2 rounded-lg text-xs font-bold border-2 transition-all ${
              slot === s ? "bg-amber-500/20 border-amber-400 text-amber-100" : "bg-stone-900/50 border-stone-700/50 text-stone-400"
            }`}>
            <div className="text-base">{s === "weapon" ? "⚔️" : s === "armor" ? "🛡️" : "📿"}</div>
            <div>{SLOT_LABEL[s]}</div>
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {offers.map((o, i) => {
          const c = RARITY_COLOR[o.rarity];
          return (
            <div key={i} className={`rounded-xl p-3 border-2 ${c.ring} bg-gradient-to-br ${c.bg} backdrop-blur`}
              style={{ ["--g" as string]: c.glow } as React.CSSProperties}>
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-lg bg-stone-950/70 border border-stone-700/50 flex items-center justify-center overflow-hidden flex-shrink-0">
                  <img src={SLOT_IMG[o.slot]} alt={o.rarity} className="w-full h-full object-contain"
                    style={{ animation: "shimmer 2.5s ease-in-out infinite" }} loading="lazy" />
                </div>
                <div className="flex-1">
                  <div className={`font-extrabold text-sm ${c.text}`}>{RARITY_LABEL[o.rarity]} {SLOT_LABEL[o.slot]}</div>
                  <div className="text-stone-400 text-[10px]">
                    +{o.rarity === "common" ? 5 : o.rarity === "rare" ? 15 : o.rarity === "epic" ? 25 : o.rarity === "legendary" ? 35 : 50}% هجوم
                    {o.rarity !== "common" && ` • ${o.rarity === "rare" ? 5 : o.rarity === "epic" ? 10 : o.rarity === "legendary" ? 15 : 20}% قاضية`}
                  </div>
                </div>
                <button disabled={busy} onClick={() => onBuy(o.slot, o.rarity, o.currency)}
                  className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-extrabold shadow-md disabled:opacity-50 ${
                    o.currency === "coins"
                      ? "bg-gradient-to-b from-amber-400 to-amber-600 text-stone-900"
                      : "bg-gradient-to-b from-purple-500 to-purple-700 text-white"
                  }`}>
                  {o.currency === "coins" ? "🪙" : "💎"} {o.price.toLocaleString()}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-center text-amber-300/50 text-[10px]">
        💡 الذهب يصل لـ نادر فقط • الجواهر تفتح الطبقات النخبوية
      </div>
    </div>
  );
}

function UpgradeTab({ items, onUpgrade, gems }: { items: EquipmentItem[]; onUpgrade: (id: string) => void; gems: number }) {
  const upgradable = items.filter((i) => nextRarity(i.rarity) !== null);
  if (upgradable.length === 0) {
    return <div className="bg-stone-900/60 border border-amber-700/30 rounded-2xl p-8 text-center text-amber-200/70">لا توجد قطع قابلة للترقية</div>;
  }
  return (
    <div className="space-y-2">
      {upgradable.map((it) => {
        const next = nextRarity(it.rarity)!;
        const cost = UPGRADE_COST[it.rarity]!;
        const canAfford = gems >= cost;
        return (
          <ItemCard key={it.id} item={it} action={
            <div className="flex items-center gap-2">
              <div className="flex-1 text-[11px] text-amber-200">
                ⬆ {RARITY_LABEL[next]} <span className="text-purple-200">💎 {cost.toLocaleString()}</span>
              </div>
              <button disabled={!canAfford} onClick={() => onUpgrade(it.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold ${
                  canAfford
                    ? "bg-gradient-to-b from-purple-500 to-purple-700 text-white shadow-md"
                    : "bg-stone-800 text-stone-500 border border-stone-700"
                }`}>
                {canAfford ? "✨ ترقية" : "جواهر غير كافية"}
              </button>
            </div>
          } />
        );
      })}
    </div>
  );
}

function SmeltTab({ items, onSmelt, gems, busy }:
  { items: EquipmentItem[]; onSmelt: (a: string, b: string) => void; gems: number; busy: boolean }) {
  const [slot, setSlot] = useState<Slot>("weapon");
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);
  const cost = 1000;
  const canAfford = gems >= cost;
  const list = items.filter((i) => i.slot === slot && !i.equipped);

  const a = list.find((x) => x.id === aId) ?? null;
  const b = list.find((x) => x.id === bId) ?? null;

  // Stability/risk: same rarity = 55% success, diff = 35%
  const sameR = a && b && a.rarity === b.rarity;
  const stability = !a || !b ? 0 : sameR ? 55 : 35;
  const risk = !a || !b ? 0 : 100 - stability;

  const toggle = (id: string) => {
    if (aId === id) { setAId(bId); setBId(null); return; }
    if (bId === id) { setBId(null); return; }
    if (!aId) { setAId(id); return; }
    if (!bId) { setBId(id); return; }
    // both filled, replace b
    setBId(id);
  };

  const doSmelt = () => {
    if (!a || !b || !canAfford || busy) return;
    onSmelt(a.id, b.id);
    setAId(null); setBId(null);
  };

  return (
    <div className="space-y-3">
      <div className="text-center text-amber-100 font-extrabold text-base">
        🐲 مختبر صهر التنين الاستراتيجي
      </div>

      {/* Slot tabs */}
      <div className="grid grid-cols-3 gap-1.5">
        {(["weapon", "armor", "talisman"] as Slot[]).map((s) => (
          <button key={s} onClick={() => { setSlot(s); setAId(null); setBId(null); }}
            className={`py-2 rounded-lg text-xs font-bold border-2 transition-all ${
              slot === s ? "bg-amber-500/20 border-amber-400 text-amber-100" : "bg-stone-900/50 border-stone-700/50 text-stone-400"
            }`}>
            <div className="text-base">{s === "weapon" ? "⚔️" : s === "armor" ? "🛡️" : "📿"}</div>
            <div>{SLOT_LABEL[s]}</div>
          </button>
        ))}
      </div>

      {/* Two slots */}
      <div className="grid grid-cols-2 gap-2">
        {[a, b].map((slot, i) => {
          const c = slot ? RARITY_COLOR[slot.rarity] : null;
          return (
            <div key={i} className={`h-28 rounded-2xl border-2 flex items-center justify-center ${
              slot ? `${c!.ring} bg-gradient-to-br ${c!.bg}` : "border-dashed border-amber-700/40 bg-stone-900/50"
            }`}>
              {slot ? (
                <div className="text-center px-2">
                  <img src={SLOT_IMG[slot.slot]} alt="" className="w-10 h-10 mx-auto opacity-90" />
                  <div className={`text-[11px] font-bold ${c!.text}`}>{RARITY_LABEL[slot.rarity]}</div>
                </div>
              ) : (
                <div className="text-amber-400/40 text-3xl">＋</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Stability meter */}
      <div className="bg-stone-900/70 border border-amber-700/40 rounded-2xl p-3">
        <div className="text-amber-200 text-xs font-bold text-center mb-2">⚖️ مقياس الاستقرار</div>
        <div className="relative h-3 bg-stone-800 rounded-full overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500 rounded-full"
               style={{ width: `${stability}%` }} />
        </div>
        <div className="flex justify-between text-[10px] mt-1.5">
          <span className="text-emerald-300">نجاح {stability}%</span>
          <span className="text-rose-300">مخاطرة {risk}%</span>
        </div>
        <div className="text-center text-amber-100/60 text-[10px] mt-1">
          {sameR ? "نفس الندرة — فرصة ترقية أعلى" : a && b ? "ندرات مختلفة — مخاطرة أكبر" : "اختر قطعتين للصهر"}
        </div>
      </div>

      {/* Inventory pick list */}
      <div className="bg-stone-900/60 border border-amber-700/30 rounded-2xl p-2">
        {list.length === 0 ? (
          <div className="text-center text-amber-200/60 text-xs py-6">لا توجد قطع متاحة من هذا النوع</div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {list.map((it) => {
              const c = RARITY_COLOR[it.rarity];
              const selected = it.id === aId || it.id === bId;
              return (
                <button key={it.id} onClick={() => toggle(it.id)}
                  className={`p-2 rounded-xl border-2 text-end ${selected ? "border-amber-300 bg-amber-500/10" : c.ring + " bg-gradient-to-br " + c.bg}`}>
                  <div className="flex items-center gap-2">
                    <img src={SLOT_IMG[it.slot]} alt="" className="w-8 h-8" />
                    <div className="flex-1 min-w-0">
                      <div className={`text-[11px] font-extrabold ${c.text} truncate`}>{RARITY_LABEL[it.rarity]}</div>
                      <div className="text-stone-400 text-[9px] truncate">{it.name}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Smelt button */}
      <button disabled={!a || !b || !canAfford || busy} onClick={doSmelt}
        className={`w-full py-3.5 rounded-2xl font-black text-base shadow-2xl transition-all ${
          a && b && canAfford
            ? "bg-gradient-to-b from-amber-400 via-orange-500 to-rose-600 text-white active:scale-95"
            : "bg-stone-800 text-stone-500 border border-stone-700"
        }`}>
        🔥 صهر — 💎 {cost.toLocaleString()}
      </button>
      {!canAfford && (
        <div className="text-center text-rose-300 text-[11px]">جواهر غير كافية</div>
      )}
    </div>
  );
}
