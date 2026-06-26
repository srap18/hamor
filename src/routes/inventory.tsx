import { createFileRoute, Link } from "@tanstack/react-router";
import { BackButton } from "@/components/BackButton";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CREWS } from "@/lib/crews";
import { WEAPONS } from "@/lib/weapons";
import { FISH, FISH_TOTAL } from "@/lib/fish";
import { SHIPS } from "@/lib/ships";
import { CoinIcon } from "@/components/CurrencyIcon";
import { toast } from "sonner";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "المخزن — ملوك القراصنة" },
      { name: "description", content: "إدارة الطواقم والأسلحة والأسماك" },
    ],
  }),
  component: InventoryPage,
});

type Tab = "crew" | "weapon" | "fish" | "shield";

interface InvRow { id: string; item_type: string; item_id: string; quantity: number; meta: any; }
interface FishRow { fish_id: string; quantity: number; total_caught: number; }
interface OwnedShip { id: string; catalog_code: string | null; hp: number; max_hp: number; in_storage: boolean; }

function InventoryPage() {
  const [tab, setTab] = useState<Tab>("crew");
  const [inv, setInv] = useState<InvRow[]>([]);
  const [fishRows, setFishRows] = useState<FishRow[]>([]);
  const [ships, setShips] = useState<OwnedShip[]>([]);
  const [goldenFisherUntil, setGoldenFisherUntil] = useState<string | null>(null);
  const [crewToUse, setCrewToUse] = useState<string | null>(null);
  const [usingCrew, setUsingCrew] = useState<string | null>(null);
  const usingCrewRef = useRef(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const [{ data: i }, { data: f }, { data: s }, { data: p }] = await Promise.all([
        supabase.from("inventory").select("id,item_type,item_id,quantity,meta").eq("user_id", u.user.id),
        supabase.from("fish_caught").select("fish_id,quantity,total_caught").eq("user_id", u.user.id),
        supabase.from("ships_owned").select("id,catalog_code,hp,max_hp,in_storage").eq("user_id", u.user.id).order("acquired_at", { ascending: false }),
        supabase.from("profiles").select("golden_fisher_until").eq("id", u.user.id).maybeSingle(),
      ]);
      setGoldenFisherUntil(((p as any)?.golden_fisher_until as string | null) ?? null);
      let stockQty: Record<string, number> = {};
      try {
        const { data: summary } = await supabase.rpc("get_fish_stock_summary" as never);
        const summaryRows = (summary ?? []) as Array<{ fish_id: string; qty: number | string }>;
        for (const row of summaryRows) {
          const q = typeof row.qty === "string" ? parseInt(row.qty, 10) : row.qty;
          if (q && q > 0) stockQty[row.fish_id] = q;
        }
      } catch { /* non-fatal */ }

      const caughtRows = (f ?? []) as FishRow[];
      const fishIds = new Set([...caughtRows.map((r) => r.fish_id), ...Object.keys(stockQty)]);
      setInv((i ?? []) as InvRow[]);
      setShips((s as OwnedShip[] | null) ?? []);
      setFishRows(Array.from(fishIds).map((fish_id) => {
        const caught = caughtRows.find((r) => r.fish_id === fish_id);
        return {
          fish_id,
          quantity: stockQty[fish_id] ?? 0,
          total_caught: Math.max(caught?.total_caught ?? 0, stockQty[fish_id] ?? 0),
        };
      }));
    } catch (e) {
      console.error("[inventory] load failed", e);
      toast.error("تعذر تحميل المخزن — حاول مرة ثانية");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const onChanged = () => load();
    const onFocus = () => load();
    window.addEventListener("fish-stock-changed", onChanged);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("fish-stock-changed", onChanged);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const isUsableStack = (r: InvRow) => !r.meta?.assigned_ship_id;
  const qty = (type: string, id: string) => inv.filter(r => r.item_type === type && r.item_id === id && isUsableStack(r)).reduce((sum, r) => sum + (r.quantity ?? 0), 0);
  const fishQty = (id: string) => fishRows.find(r => r.fish_id === id)?.quantity ?? 0;
  const fishDiscovered = (id: string) => (fishRows.find(r => r.fish_id === id)?.total_caught ?? 0) > 0;
  const pickedCrew = CREWS.find(c => c.id === crewToUse) ?? null;
  const useCrew = async (crewId: string, shipId?: string | null) => {
    if (usingCrewRef.current) return;
    const row = inv.find(r => r.item_type === "crew" && r.item_id === crewId && isUsableStack(r) && r.quantity > 0);
    if (!row) { toast.error("ما عندك هذا الطاقم في المخزن"); return; }
    usingCrewRef.current = true;
    setUsingCrew(crewId);
    try {
      if (crewId === "golden_fisher") {
        const { data, error } = await (supabase as any).rpc("activate_golden_fisher");
        if (error) {
          const m = error.message || "";
          if (/golden_fisher_temporarily_disabled/i.test(m)) toast.error("⏸️ الصياد الذهبي موقف مؤقتاً — قيد الفحص");
          else if (/no_golden_fisher/i.test(m)) toast.error("ما عندك صياد ذهبي في المخزن");
          else toast.error("تعذر تفعيل الصياد الذهبي");
          return;
        }
        setCrewToUse(null);
        await load();
        window.dispatchEvent(new Event("inventory-changed"));
        const alreadyActive = (data as any)?.already_active;
        toast.success(alreadyActive ? "🏅 الصياد الذهبي مفعّل عندك بالفعل" : "🏅 تم تفعيل الصياد الذهبي لمدة 24 ساعة");
        return;
      }
      const { error } = await (supabase as any).rpc("use_crew_from_inventory", { _inventory_id: row.id, _ship_id: shipId ?? null });
      if (error) {
        const msg = error.message || "";
        if (msg.includes("ship already")) toast.error("هذه السفينة فيها نفس الطاقم بالفعل");
        else if (msg.includes("missing ship")) toast.error("اختر سفينة أولًا");
        else toast.error("تعذر استخدام الطاقم");
        return;
      }
      setCrewToUse(null);
      await load();
      window.dispatchEvent(new Event("inventory-changed"));
      toast.success(crewId === "trader" ? "💰 تم تفعيل التاجر في سوق السمك" : "✅ تم استخدام الطاقم");
    } catch (e: any) {
      console.error("[inventory] useCrew failed", e);
      toast.error("حصل خطأ غير متوقع");
    } finally {
      usingCrewRef.current = false;
      setUsingCrew(null);
    }
  };

  return (
    <div className="fixed inset-0 overflow-y-auto text-foreground" dir="rtl" style={{
      background: "radial-gradient(ellipse at top, oklch(0.30 0.10 250) 0%, oklch(0.12 0.06 245) 100%)",
    }}>
      <header className="sticky top-0 z-20 glass-hud border-b border-accent/30 px-3 pb-3 flex items-center gap-3" style={{ paddingTop: "max(1.75rem, calc(env(safe-area-inset-top) + 1.25rem))" }}>
        <BackButton className="w-10 h-10 rounded-xl glass-hud flex items-center justify-center text-lg active:scale-95">←</BackButton>
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
              const gfActive = !!goldenFisherUntil && new Date(goldenFisherUntil).getTime() > Date.now();
              const isGoldenLocked = c.id === "golden_fisher" && gfActive;
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
                  {isGoldenLocked && (
                    <div className="text-[10px] text-amber-300 text-center mt-1">🏅 مفعّل حالياً على حسابك</div>
                  )}
                  {n > 0 && c.id !== "golden_fisher" && (
                    <button
                      onClick={() => {
                        if (isGoldenLocked) { toast.info("🏅 الصياد الذهبي مفعّل بالفعل على حسابك"); return; }
                        return c.id === "trader" ? useCrew(c.id, null) : setCrewToUse(c.id);
                      }}
                      disabled={usingCrew === c.id || isGoldenLocked}
                      className="mt-2 w-full py-1.5 rounded-lg bg-gradient-to-b from-emerald-400 to-emerald-700 text-white text-xs font-extrabold active:scale-95 disabled:opacity-60"
                    >
                      {usingCrew === c.id ? "..." : isGoldenLocked ? "مفعّل ✓" : "استخدام"}
                    </button>
                  )}
                  {n > 0 && c.id === "golden_fisher" && (
                    <button
                      onClick={() => useCrew(c.id, null)}
                      disabled={usingCrew === c.id || isGoldenLocked}
                      className="mt-2 w-full py-1.5 rounded-lg bg-gradient-to-b from-emerald-400 to-emerald-700 text-white text-xs font-extrabold active:scale-95 disabled:opacity-60"
                    >
                      {usingCrew === c.id ? "..." : isGoldenLocked ? "مفعّل ✓" : "تفعيل"}
                    </button>
                  )}
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
            { id: "shield_7d", name: "درع أسبوع", hours: 24 * 7, emoji: "🛡️" },
            { id: "shield_30d", name: "درع شهر", hours: 24 * 30, emoji: "🛡️" },
          ];
          const useShield = async (id: string) => {
            const { error } = await supabase.rpc("use_shield_from_inventory" as never, { _item_id: id } as never);
            if (error) {
              const m = error.message || "";
              if (m.includes("not_enough")) toast.error("لا تملك هذا الدرع");
              else toast.error("فشل تفعيل الدرع");
              return;
            }
            await load();
            toast.success("🛡️ تم تفعيل الدرع!");
          };
          const ANTIS = [
            { id: "anti_rocket", name: "مضاد صواريخ", emoji: "🚀", pct: 60, desc: "يصد أي صاروخ قادم" },
            { id: "anti_nuke", name: "مضاد قنبلة ذرية", emoji: "☢️", pct: 75, desc: "يصد القنبلة الذرية" },
            { id: "anti_ad_bomb", name: "مضاد قنبلة إعلانية", emoji: "📺", pct: 70, desc: "يصد القنبلة الإعلانية" },
          ];
          return (
            <>
            <div className="grid grid-cols-2 gap-2">
              {SHIELDS.map(s => {
                const n = qty("shield", s.id);
                return (
                  <div key={s.id} className={`glass-hud rounded-xl p-3 border ${n>0?"border-sky-400/60":"border-border/40 opacity-60"}`}>
                    <div className="h-16 flex items-center justify-center text-5xl">{s.emoji}</div>
                    <div className="text-sm font-bold text-center mt-1">{s.name}</div>
                    <div className="text-[10px] text-sky-300 text-center">حماية {s.hours >= 24 ? `${Math.round(s.hours/24)} يوم` : `${s.hours} ساعة`}</div>
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
            <div className="mt-4 mb-2 text-xs font-bold text-amber-200/90 text-center">🛡️ المضادات الدفاعية (تعمل تلقائياً عند الهجوم)</div>
            <div className="grid grid-cols-3 gap-2">
              {ANTIS.map(a => {
                const n = qty("anti", a.id);
                return (
                  <div key={a.id} className={`glass-hud rounded-xl p-2 border ${n>0?"border-amber-400/60":"border-border/40 opacity-60"}`}>
                    <div className="h-12 flex items-center justify-center text-3xl">{a.emoji}</div>
                    <div className="text-[11px] font-bold text-center mt-1">{a.name}</div>
                    <div className="text-[9px] text-amber-300 text-center">صد {a.pct}%</div>
                    <div className="text-center mt-1 text-xs font-bold">
                      {n > 0 ? <span className="text-amber-300">×{n}</span> : <span className="text-muted-foreground">لا تملك</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            </>
          );
        })()}
        {!loading && tab === "fish" && (() => {
          const allFish = Object.values(FISH);
          const discoveredCount = fishRows.filter(r => (r.total_caught ?? 0) > 0).length;
          const remaining = allFish.filter(f => !fishDiscovered(f.id));
          return (
            <>
              <div className="mb-2 glass-hud rounded-xl px-3 py-2 flex items-center justify-between border border-sky-300/40">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🔍</span>
                  <span className="text-xs font-bold text-sky-100">المكتشف</span>
                </div>
                <div className="text-sm font-extrabold text-amber-300">
                  {discoveredCount}
                  <span className="text-muted-foreground mx-1">/</span>
                  <span className="text-sky-200">{FISH_TOTAL}</span>
                </div>
              </div>
              {remaining.length > 0 && (
                <div className="mb-3 glass-hud rounded-xl px-3 py-2 border border-rose-300/40">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base">🎯</span>
                      <span className="text-xs font-bold text-rose-100">باقي عليك</span>
                    </div>
                    <span className="text-xs font-extrabold text-rose-200">{remaining.length} نوع</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {remaining.map(f => (
                      <span key={f.id} className="text-[10px] px-2 py-0.5 rounded-full bg-rose-900/40 border border-rose-400/30 text-rose-100">
                        {f.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
              {allFish.map(f => {
                const n = fishQty(f.id);
                const discovered = fishDiscovered(f.id);
                return (
                  <div key={f.id} className={`glass-hud rounded-xl p-2 border ${discovered?"border-sky-400/60":"border-border/40 opacity-60"}`}>
                    <div className="h-16 flex items-center justify-center">
                      {discovered ? (
                        <img src={f.img} alt={f.name} loading="lazy" width={64} height={64}
                          className="max-h-16 max-w-full object-contain drop-shadow-lg" />
                      ) : (
                        <img src={f.img} alt={f.name} loading="lazy" width={64} height={64}
                          className="max-h-16 max-w-full object-contain grayscale opacity-40" />
                      )}
                    </div>
                    <div className="text-[10px] font-bold text-center mt-1 truncate">{f.name}</div>
                    <div className="text-[9px] text-amber-300 text-center inline-flex items-center justify-center gap-1 w-full">{f.price.toLocaleString()} <CoinIcon size={10} /></div>
                    <div className="text-center text-xs font-bold mt-1">
                      {discovered ? <span className="text-sky-300">×{n}</span> : <span className="text-rose-300/80 text-[10px]">غير مكتشفة</span>}
                    </div>
                  </div>
                );
              })}
              </div>
            </>
          );
        })()}
      </div>
      {pickedCrew && (
        <div className="fixed inset-0 z-50 bg-black/70 p-4 flex items-center justify-center" onClick={() => !usingCrew && setCrewToUse(null)}>
          <div className="w-full max-w-sm glass-hud rounded-2xl border border-emerald-300/50 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-center text-lg font-extrabold text-emerald-200 mb-1">{pickedCrew.emoji} استخدام {pickedCrew.name}</div>
            <div className="text-center text-xs text-muted-foreground mb-3">اختر السفينة التي تريد تركيب الطاقم عليها</div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {(() => {
                const activeShips = ships.filter(s => !s.in_storage);
                if (activeShips.length === 0) return <div className="text-center text-sm text-muted-foreground py-6">ما عندك سفن نشطة في المحيط</div>;
                return activeShips.map((ship) => {
                  const def = SHIPS.find(s => s.code === ship.catalog_code);
                  return (
                    <button key={ship.id} onClick={() => useCrew(pickedCrew.id, ship.id)} disabled={!!usingCrew} className="w-full rounded-xl border border-border bg-secondary/50 p-3 flex items-center gap-3 text-right active:scale-95 disabled:opacity-60">
                      {def?.image && <img src={def.image} alt={def.title} className="w-16 h-12 object-contain" />}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold truncate">{def?.title ?? ship.catalog_code ?? "سفينة"}</div>
                        <div className="text-[11px] text-muted-foreground">HP {ship.hp.toLocaleString()} / {ship.max_hp.toLocaleString()} • نشطة</div>
                      </div>
                    </button>
                  );
                });
              })()}
            </div>
            <button onClick={() => setCrewToUse(null)} disabled={!!usingCrew} className="mt-3 w-full text-xs text-muted-foreground underline">إلغاء</button>
          </div>
        </div>
      )}
    </div>
  );
}
