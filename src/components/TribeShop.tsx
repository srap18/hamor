import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sound } from "@/lib/sound";
import { TRIBE_SHIPS } from "@/lib/ships";

type TribeShopProps = { userId: string; tribeId: string | null };

type Profile = { tribe_gems: number; level: number; coins: number };
type Tribe = { name: string; treasure_coins: number; treasure_tribe_gems: number };

export function TribeShop({ userId, tribeId }: TribeShopProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tribe, setTribe] = useState<Tribe | null>(null);
  const [loading, setLoading] = useState(true);
  const [donAmount, setDonAmount] = useState("1000");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const [{ data: p }, { data: t }] = await Promise.all([
      supabase.from("profiles").select("tribe_gems,level,coins").eq("id", userId).maybeSingle(),
      tribeId
        ? supabase.from("tribes").select("name,treasure_coins,treasure_tribe_gems").eq("id", tribeId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (p) setProfile(p as Profile);
    if (t) setTribe(t as Tribe);
    setLoading(false);
  }, [userId, tribeId]);

  useEffect(() => { load(); }, [load]);

  // Live updates on tribe_gems
  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel(`tribe-shop-${userId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, load]);

  const flash = (kind: "ok" | "err", text: string) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 3500);
  };

  const donate = useCallback(async () => {
    if (!tribeId || busy) return;
    const amt = parseInt(donAmount, 10);
    if (!amt || amt < 1000) { flash("err", "أقل تبرع: 1,000 ذهب"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("donate_to_tribe", { _tribe_id: tribeId, _amount: amt });
    setBusy(false);
    if (error) {
      const m = error.message || "";
      if (m.includes("daily cap")) flash("err", "تجاوزت الحد اليومي للتبرع");
      else if (m.includes("not enough")) flash("err", "رصيدك من الذهب غير كافٍ");
      else if (m.includes("market level")) flash("err", "يجب الوصول لمستوى السفن 6");
      else flash("err", "تعذّر التبرع");
      return;
    }
    sound.play("click");
    flash("ok", `+${Math.floor(amt / 1000)} 🔱 جوهرة قبيلة`);
    load();
  }, [tribeId, donAmount, busy, load]);

  const buyShip = useCallback(async (code: string, price: number) => {
    if (busy) return;
    if (!profile || profile.tribe_gems < price) { flash("err", "تحتاج المزيد من جواهر القبيلة"); return; }
    if (!confirm(`شراء هذه السفينة بـ ${price} 🔱 ؟`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("buy_tribe_ship", { _code: code });
    setBusy(false);
    if (error) {
      const m = error.message || "";
      if (m.includes("NOT_ENOUGH_TRIBE_GEMS")) flash("err", "جواهر القبيلة غير كافية");
      else if (m.includes("مستوى السفن")) flash("err", "يتطلب الوصول لمستوى السفن 24");
      else if (m.includes("عضواً")) flash("err", "يجب أن تكون عضواً في قبيلة");
      else flash("err", "تعذّر الشراء");
      return;
    }
    sound.play("click");
    flash("ok", "تم الشراء! السفينة في مخزنك 🚢");
    load();
  }, [busy, profile, load]);

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-amber-200/60 text-sm">جارٍ التحميل...</div>;
  }
  if (!tribeId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div className="text-amber-200/70 text-sm">انضم إلى قبيلة لفتح متجر القبيلة 🏴‍☠️</div>
      </div>
    );
  }

  const gems = profile?.tribe_gems ?? 0;

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {/* Header */}
      <div className="rounded-xl bg-gradient-to-br from-indigo-900/80 to-stone-900/80 border-2 border-indigo-400/60 p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-indigo-200/70 font-bold">رصيدك</div>
            <div className="text-2xl font-black text-indigo-100">🔱 {gems.toLocaleString("ar")}</div>
            <div className="text-[10px] text-indigo-200/60 mt-0.5">جواهر القبيلة</div>
          </div>
          {tribe && (
            <div className="text-right">
              <div className="text-[10px] text-amber-300/80 font-bold">{tribe.name}</div>
              <div className="text-[11px] text-amber-200">خزينة: {tribe.treasure_coins.toLocaleString("ar")} 💰</div>
            </div>
          )}
        </div>
      </div>

      {/* How to earn */}
      <div className="rounded-xl bg-stone-900/70 border-2 border-amber-700/50 p-2.5">
        <div className="text-[11px] font-extrabold text-amber-200 mb-1.5">🔱 كيف تحصل على الجواهر؟</div>
        <ul className="text-[10px] text-amber-200/80 space-y-0.5 leading-relaxed">
          <li>• تبرّع 1,000 ذهب للقبيلة = <b>+1 جوهرة</b></li>
          <li>• فز بهجوم على لاعب قريب من مستواك = <b>+1</b> (حد 5/يوم)</li>
          <li>• دمّر سفينة عدو مستوى 15+ = <b>+2</b> (حد 3/يوم)</li>
        </ul>
      </div>

      {/* Donate */}
      <div className="rounded-xl bg-stone-900/80 border-2 border-emerald-600/60 p-3 space-y-2">
        <div className="text-sm font-extrabold text-emerald-200">💰 تبرّع لخزينة القبيلة</div>
        <div className="flex gap-2">
          <input
            type="number" min={1000} step={1000}
            value={donAmount}
            onChange={e => setDonAmount(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg bg-stone-950/70 border border-amber-700/60 text-amber-100 text-sm"
          />
          <button
            onClick={donate} disabled={busy}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-extrabold text-sm border-2 border-emerald-300 active:scale-95 disabled:opacity-60"
          >
            تبرّع
          </button>
        </div>
        <div className="text-[10px] text-emerald-200/70">كل 1,000 ذهب = 1 🔱 (حد التبرع اليومي 10,000 ذهب)</div>
      </div>

      {msg && (
        <div className={`rounded-lg px-3 py-2 text-[12px] font-bold border-2 ${msg.kind === "ok" ? "bg-emerald-600/30 border-emerald-400 text-emerald-100" : "bg-red-600/30 border-red-400 text-red-100"}`}>
          {msg.text}
        </div>
      )}

      {/* Ships */}
      <div className="rounded-xl bg-stone-900/70 border-2 border-amber-700/50 p-2.5">
        <div className="text-sm font-extrabold text-amber-200 mb-2">🚢 سفن القبيلة</div>
        <div className="space-y-2">
          {TRIBE_SHIPS.map((s) => {
            const price = s.code === "tribe-lightning" ? 60 : s.code === "tribe-tornado" ? 90 : 150;
            const canBuy = gems >= price;
            return (
              <div key={s.code} className="rounded-lg bg-stone-950/60 border-2 border-amber-800/40 p-2 flex gap-2 items-center">
                <img src={s.image} alt={s.name} width={64} height={64} loading="lazy" className="w-16 h-16 object-contain shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-extrabold text-amber-100">{s.name}</div>
                  <div className="text-[10px] text-amber-200/70 leading-snug">{s.flavor}</div>
                  <div className="flex gap-2 mt-1 text-[10px] text-amber-300/90 font-bold flex-wrap">
                    <span>❤️ {s.maxHp.toLocaleString("ar")}</span>
                    <span>📦 {s.storage.toLocaleString("ar")}</span>
                    <span>🛡️ {s.armor}</span>
                    <span>⚔️ {s.armor + 100}</span>
                  </div>
                </div>
                <button
                  onClick={() => buyShip(s.code, price)}
                  disabled={!canBuy || busy}
                  className={`px-3 py-2 rounded-lg text-[11px] font-black border-2 active:scale-95 transition shrink-0 ${
                    canBuy
                      ? "bg-indigo-600 border-indigo-200 text-white shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                      : "bg-stone-800 border-stone-600 text-stone-400"
                  }`}
                >
                  🔱 {price}
                </button>
              </div>
            );
          })}
        </div>
        <div className="text-[10px] text-amber-300/60 mt-2 text-center">يتطلب الوصول لمستوى السفن 24</div>
      </div>
    </div>
  );
}
