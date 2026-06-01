import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CREWS } from "@/lib/crews";
import { WEAPONS } from "@/lib/weapons";
import { FISH, FISH_TOTAL } from "@/lib/fish";
import { CoinIcon } from "@/components/CurrencyIcon";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "المخزن — Ocean Catch" },
      { name: "description", content: "إدارة الطواقم والأسلحة والأسماك" },
    ],
  }),
  component: InventoryPage,
});

type Tab = "crew" | "weapon" | "fish" | "shield";

interface InvRow { item_type: string; item_id: string; quantity: number; }
interface FishRow { fish_id: string; quantity: number; total_caught: number; }

function InventoryPage() {
  const [tab, setTab] = useState<Tab>("crew");
  const [inv, setInv] = useState<InvRow[]>([]);
  const [fishRows, setFishRows] = useState<FishRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setLoading(false); return; }
    const [{ data: i }, { data: f }] = await Promise.all([
      supabase.from("inventory").select("item_type,item_id,quantity").eq("user_id", u.user.id),
      supabase.from("fish_caught").select("fish_id,quantity,total_caught").eq("user_id", u.user.id),
    ]);
    setInv(i ?? []);
    setFishRows(f ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const qty = (type: string, id: string) => inv.find(r => r.item_type === type && r.item_id === id)?.quantity ?? 0;
  const fishQty = (id: string) => fishRows.find(r => r.fish_id === id)?.quantity ?? 0;
  const fishDiscovered = (id: string) => (fishRows.find(r => r.fish_id === id)?.total_caught ?? 0) > 0;

  return (
    <div className="fixed inset-0 overflow-y-auto text-foreground" dir="rtl" style={{
      background: "radial-gradient(ellipse at top, oklch(0.30 0.10 250) 0%, oklch(0.12 0.06 245) 100%)",
    }}>
      <header className="sticky top-0 z-20 glass-hud border-b border-accent/30 px-3 py-3 flex items-center gap-3">
        <Link to="/" className="w-10 h-10 rounded-xl glass-hud flex items-center justify-center text-lg active:scale-95">←</Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-glow flex items-center gap-2">📦 المخزن</h1>
          <p className="text-[10px] text-muted-foreground">طواقمك وأسلحتك وأسماكك</p>
        </div>
      </header>

      <div className="px-3 pt-3 flex gap-2 justify-center flex-wrap">
        {([
          { id: "crew",   label: "طواقم 👨‍✈️" },
          { id: "weapon", label: "أسلحة 🚀" },
          { id: "shield", label: "دروع 🛡️" },
          { id: "fish",   label: "أسماك 🐟" },
        ] as { id: Tab; label: string }[]).map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 max-w-32 py-2 rounded-xl text-xs font-bold active:scale-95 transition-all border-2 ${
                active
                  ? "bg-gradient-to-b from-amber-400 to-amber-700 border-amber-200 text-amber-950 shadow-lg"
                  : "bg-secondary/40 border-border text-muted-foreground"
              }`}>
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="p-3 pb-6">
        {loading && <div className="text-center text-muted-foreground py-12">جاري التحميل…</div>}

        {!loading && tab === "crew" && (
          <div className="grid grid-cols-2 gap-2">
            {CREWS.map(c => {
              const n = qty("crew", c.id);
              return (
                <div key={c.id} className={`glass-hud rounded-xl p-3 border ${n>0?"border-emerald-400/60":"border-border/40 opacity-60"}`}>
                  <div className="h-16 flex items-center justify-center">
                    {c.image ? (
                      <img src={c.image} alt={c.name} className="max-h-16 max-w-full object-contain drop-shadow-lg" />
                    ) : (
                      <div className="text-4xl">{c.emoji}</div>
                    )}
                  </div>
                  <div className="text-sm font-bold text-center mt-1">{c.name}</div>
                  <div className="text-[10px] text-accent text-center">{c.bonus}</div>
                  <div className="text-center mt-2 text-sm font-bold">
                    {n > 0 ? <span className="text-emerald-300">×{n}</span> : <span className="text-muted-foreground">لا تملك</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && tab === "weapon" && (
          <div className="grid grid-cols-2 gap-2">
            {WEAPONS.map(w => {
              const n = qty("weapon", w.id);
              return (
                <div key={w.id} className={`glass-hud rounded-xl p-3 border ${n>0?"border-rose-400/60":"border-border/40 opacity-60"}`}>
                  <div className="h-16 flex items-center justify-center">
                    {w.image ? (
                      <img src={w.image} alt={w.name} className="max-h-16 max-w-full object-contain drop-shadow-lg" />
                    ) : (
                      <div className="text-4xl">{w.emoji}</div>
                    )}
                  </div>
                  <div className="text-sm font-bold text-center mt-1">{w.name}</div>
                  <div className="text-[10px] text-rose-300 text-center">⚔️ ضرر {w.damage.toLocaleString()}</div>
                  <div className="text-center mt-2 text-sm font-bold">
                    {n > 0 ? <span className="text-rose-300">×{n}</span> : <span className="text-muted-foreground">لا تملك</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && tab === "shield" && (() => {
          const SHIELDS = [
            { id: "shield_1h", name: "درع ساعة", hours: 1, emoji: "🛡️" },
            { id: "shield_4h", name: "درع 4 ساعات", hours: 4, emoji: "🛡️" },
            { id: "shield_1d", name: "درع يوم", hours: 24, emoji: "🛡️" },
            { id: "shield_2d", name: "درع يومين", hours: 48, emoji: "🛡️" },
          ];
          const useShield = async (id: string) => {
            const { error } = await supabase.rpc("use_shield_from_inventory" as never, { _item_id: id } as never);
            if (error) {
              const m = error.message || "";
              if (m.includes("not_enough")) alert("لا تملك هذا الدرع");
              else alert("فشل تفعيل الدرع");
              return;
            }
            await load();
            alert("🛡️ تم تفعيل الدرع!");
          };
          return (
            <div className="grid grid-cols-2 gap-2">
              {SHIELDS.map(s => {
                const n = qty("shield", s.id);
                return (
                  <div key={s.id} className={`glass-hud rounded-xl p-3 border ${n>0?"border-sky-400/60":"border-border/40 opacity-60"}`}>
                    <div className="h-16 flex items-center justify-center text-5xl">{s.emoji}</div>
                    <div className="text-sm font-bold text-center mt-1">{s.name}</div>
                    <div className="text-[10px] text-sky-300 text-center">حماية {s.hours} ساعة</div>
                    <div className="text-center mt-2 text-sm font-bold">
                      {n > 0 ? <span className="text-sky-300">×{n}</span> : <span className="text-muted-foreground">لا تملك</span>}
                    </div>
                    {n > 0 && (
                      <button onClick={() => useShield(s.id)}
                        className="mt-2 w-full py-1.5 rounded-lg bg-gradient-to-b from-sky-500 to-sky-700 text-white text-xs font-extrabold active:scale-95">
                        تفعيل
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
          <>
            <div className="mb-3 glass-hud rounded-xl px-3 py-2 flex items-center justify-between border border-sky-300/40">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔍</span>
                <span className="text-xs font-bold text-sky-100">الأسماك المكتشفة</span>
              </div>
              <div className="text-sm font-extrabold text-amber-300">
                {fishRows.filter(r => (r.total_caught ?? 0) > 0).length}
                <span className="text-muted-foreground mx-1">/</span>
                <span className="text-sky-200">{FISH_TOTAL}</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
            {Object.values(FISH).map(f => {
              const n = fishQty(f.id);
              const discovered = fishDiscovered(f.id);
              return (
                <div key={f.id} className={`glass-hud rounded-xl p-2 border ${discovered?"border-sky-400/60":"border-border/40 opacity-50"}`}>
                  <div className="h-16 flex items-center justify-center">
                    {discovered ? (
                      <img src={f.img} alt={f.name} loading="lazy" width={64} height={64}
                        className="max-h-16 max-w-full object-contain drop-shadow-lg" />
                    ) : (
                      <div className="text-4xl grayscale opacity-40">❓</div>
                    )}
                  </div>
                  <div className="text-[10px] font-bold text-center mt-1 truncate">{discovered ? f.name : "؟؟؟"}</div>
                  <div className="text-[9px] text-amber-300 text-center inline-flex items-center justify-center gap-1 w-full">{f.price.toLocaleString()} <CoinIcon size={10} /></div>
                  <div className="text-center text-xs font-bold mt-1">
                    {discovered ? <span className="text-sky-300">×{n}</span> : <span className="text-muted-foreground/60">—</span>}
                  </div>
                </div>
              );
            })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
