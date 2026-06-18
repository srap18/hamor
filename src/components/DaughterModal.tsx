import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, refreshProfile } from "@/hooks/use-auth";
import { useDaughter } from "@/hooks/use-daughter";
import { renameDaughter, bonusesFor, nextThreshold, STAGE_LABELS, OUTFITS, outfitImage, setDaughterOutfit, gemCostFor, remainingTodayFor, upgradeDaughterWithGems, DAILY_FISH_LIMIT, MAX_STAGE, type OutfitId } from "@/lib/daughter";
import { FISH } from "@/lib/fish";
import { toast } from "sonner";
import { confirmDialog } from "@/components/ConfirmDialog";

type CaughtRow = { fish_id: string; quantity: number };

export function DaughterModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const { daughter, refresh } = useDaughter();
  const [stock, setStock] = useState<CaughtRow[]>([]);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const loadStock = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("fish_caught")
      .select("fish_id, quantity")
      .eq("user_id", user.id);
    const map: Record<string, number> = {};
    for (const r of (data as CaughtRow[] | null) ?? []) {
      map[r.fish_id] = (map[r.fish_id] ?? 0) + (r.quantity ?? 0);
    }
    setStock(Object.entries(map).filter(([, q]) => q > 0).map(([fish_id, quantity]) => ({ fish_id, quantity })));
    setSelected({});
  };

  useEffect(() => {
    if (!open || !user) return;
    loadStock();
  }, [open, user]);

  if (!daughter) return null;
  const bonuses = bonusesFor(daughter.stage);
  const nextAt = nextThreshold(daughter.stage);
  const progress = nextAt ? Math.min(100, (daughter.total_fish_fed / nextAt) * 100) : 100;
  const gemCost = gemCostFor(daughter.stage);
  const remainingToday = remainingTodayFor(daughter);

  const totalSelected = Object.values(selected).reduce((s, n) => s + n, 0);

  const addOne = (fish_id: string) => {
    const have = stock.find((s) => s.fish_id === fish_id)?.quantity ?? 0;
    const cur = selected[fish_id] ?? 0;
    if (cur >= have) return;
    if (totalSelected >= remainingToday) {
      toast.error(`الحد اليومي ${DAILY_FISH_LIMIT} سمكات — متبقي ${remainingToday}`);
      return;
    }
    setSelected({ ...selected, [fish_id]: cur + 1 });
  };
  const removeOne = (fish_id: string) => {
    const cur = selected[fish_id] ?? 0;
    if (cur <= 0) return;
    const next = { ...selected, [fish_id]: cur - 1 };
    if (next[fish_id] === 0) delete next[fish_id];
    setSelected(next);
  };

  const handleFeed = async () => {
    if (totalSelected === 0) return;
    if (remainingToday === 0) { toast.error("انتهى حدّك اليومي — جرّب بكرة"); return; }
    const ids: string[] = [];
    for (const [fid, n] of Object.entries(selected)) {
      for (let i = 0; i < n; i++) ids.push(fid);
    }
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("feed_daughter_caught", { _fish_ids: ids });
    setBusy(false);
    if (error) {
      const msg = error.message || "";
      if (msg.includes("daily_limit_reached")) toast.error("انتهى حدّك اليومي — جرّب بكرة");
      else toast.error(msg);
      return;
    }
    const res: any = data;
    toast.success(`أطعمتها ${res?.fed_count ?? totalSelected} سمكة 🐟 (باقي اليوم: ${res?.remaining_today ?? 0})`);
    if (res?.leveled_up) toast.success(`ترقّت ابنتك إلى ${STAGE_LABELS[res.new_stage]} 🎉`);
    await refresh();
    await loadStock();
  };

  const handleGemUpgrade = async () => {
    if (!gemCost) return;
    const ok = await confirmDialog({
      title: "ترقية الابنة",
      message: `هل تريد ترقيتها إلى المرحلة التالية مقابل ${gemCost} جوهرة؟`,
      confirmText: "ترقية بالجواهر",
    });
    if (!ok) return;
    setBusy(true);
    const { data, error } = await upgradeDaughterWithGems();
    setBusy(false);
    if (error) {
      const msg = error.message || "";
      if (msg.includes("not_enough_gems")) toast.error(`تحتاج ${gemCost} جوهرة`);
      else if (msg.includes("max_stage")) toast.error("وصلت لأعلى مرحلة");
      else toast.error(msg);
      return;
    }
    const res: any = data;
    toast.success(`💎 ترقّت إلى ${STAGE_LABELS[res.new_stage]} (-${res.gems_spent} جوهرة)`);
    await refresh();
    await refreshProfile();
  };

  const handleRename = async () => {
    const n = newName.trim();
    if (n.length < 1 || n.length > 20) { toast.error("الاسم بين 1 و 20 حرف"); return; }
    const { error } = await renameDaughter(n);
    if (error) { toast.error(error.message); return; }
    setRenaming(false);
    toast.success("تم تغيير الاسم");
    refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md max-h-[90vh] overflow-y-auto bg-gradient-to-b from-stone-900 to-stone-950 border-amber-700/40 text-amber-50">
        <DialogHeader>
          <DialogTitle className="text-center text-amber-200">
            {renaming ? (
              <div className="flex gap-2 items-center">
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={20} className="bg-stone-800" />
                <Button size="sm" onClick={handleRename}>حفظ</Button>
                <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>إلغاء</Button>
              </div>
            ) : (
              <button onClick={() => { setNewName(daughter.name); setRenaming(true); }} className="hover:underline">
                {daughter.name} ✏️
              </button>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3">
          <img
            src={outfitImage(daughter.outfit)}
            alt={`صورة الشخصية ${daughter.name}`}
            className="w-40 h-56 object-contain drop-shadow-[0_8px_24px_rgba(255,200,100,0.3)]"
          />
          <div className="text-sm text-amber-300">
            المرحلة {daughter.stage} — {STAGE_LABELS[daughter.stage]}
          </div>

          <div className="w-full">
            <div className="text-sm text-amber-200 font-bold mb-2">👗 خزانة الملابس</div>
            <div className="grid grid-cols-4 gap-2">
              {OUTFITS.map((o) => {
                const active = (daughter.outfit || "sailor") === o.id;
                return (
                  <button
                    key={o.id}
                    onClick={async () => {
                      const { error } = await setDaughterOutfit(o.id as OutfitId);
                      if (error) { toast.error(error.message); return; }
                      toast.success(`غيّرت لبسها إلى ${o.name}`);
                      refresh();
                    }}
                    className={`rounded-lg border p-1 ${active ? "border-amber-400 bg-amber-600/30 ring-2 ring-amber-400" : "border-stone-700 bg-stone-800/40"}`}
                    title={o.name}
                  >
                    <img src={o.img} alt={`زي ${o.name}`} className="w-full h-16 object-contain" />
                    <div className="text-[10px] text-amber-200 mt-1 truncate">{o.emoji} {o.name}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="w-full">
            <div className="flex justify-between text-xs text-amber-300/80 mb-1">
              <span>{daughter.total_fish_fed} سمكة مُطعَمَة</span>
              <span>{nextAt ? `${nextAt} للترقية` : "أعلى مرحلة"}</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* Gem upgrade — instant level-up, gets more expensive each stage */}
          {gemCost !== null && daughter.stage < MAX_STAGE && (
            <div className="w-full bg-gradient-to-br from-fuchsia-900/40 to-purple-950/40 border border-fuchsia-500/40 rounded-xl p-3">
              <div className="text-xs text-fuchsia-200 mb-2">
                ترقية فورية إلى <b>{STAGE_LABELS[daughter.stage + 1]}</b>
              </div>
              <Button
                onClick={handleGemUpgrade}
                disabled={busy}
                className="w-full bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 text-white font-bold"
              >
                💎 ترقّية بـ {gemCost.toLocaleString("en-US")} جوهرة
              </Button>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 w-full text-center text-xs">
            <div className="bg-stone-800/60 rounded-lg p-2">
              <div className="text-amber-200 font-bold">+{bonuses.luckPct}%</div>
              <div className="text-amber-400/70">حظ صيد 🍀</div>
            </div>
            <div className="bg-stone-800/60 rounded-lg p-2">
              <div className="text-amber-200 font-bold">+{bonuses.fishingSpeedPct}%</div>
              <div className="text-amber-400/70">سرعة 🎣</div>
            </div>
            <div className="bg-stone-800/60 rounded-lg p-2">
              <div className="text-amber-200 font-bold">+{bonuses.cashbackPct}%</div>
              <div className="text-amber-400/70">كاش‑باك 💰</div>
            </div>
          </div>

          <div className="w-full">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-amber-200 font-bold">إطعامها من مخزون السمك</div>
              <div className={`text-[11px] px-2 py-1 rounded-full border ${remainingToday > 0 ? "border-emerald-500/40 text-emerald-300 bg-emerald-900/30" : "border-red-500/40 text-red-300 bg-red-900/30"}`}>
                باقي اليوم: {remainingToday}/{DAILY_FISH_LIMIT}
              </div>
            </div>
            <div className="text-[11px] text-amber-400/70 mb-2">
              الحد اليومي {DAILY_FISH_LIMIT} سمكات فقط — للترقية الأسرع استخدم الجواهر 💎
            </div>
            {stock.length === 0 ? (
              <div className="text-center text-xs text-amber-400/60 py-4">
                لا يوجد سمك في مخزونك — اصطد أولاً من السفن قبل البيع
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                {stock.map((f) => {
                  const fish = FISH[f.fish_id];
                  const n = selected[f.fish_id] ?? 0;
                  return (
                    <div
                      key={f.fish_id}
                      className={`relative p-2 rounded-lg border text-center ${n > 0 ? "bg-amber-600/40 border-amber-400" : "bg-stone-800/40 border-stone-700"}`}
                      title={fish?.name || f.fish_id}
                    >
                      <button onClick={() => addOne(f.fish_id)} className="w-full flex items-center justify-center">
                        {fish?.img ? (
                          <img src={fish.img} alt={`سمكة ${fish.name}`} className="w-10 h-10 object-contain drop-shadow"/>
                        ) : (
                          <span className="text-2xl">🐟</span>
                        )}
                      </button>
                      <div className="text-[10px] text-amber-200 mt-0.5">x{f.quantity}</div>
                      {n > 0 && (
                        <button
                          onClick={() => removeOne(f.fish_id)}
                          className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-red-600 text-white text-xs font-bold flex items-center justify-center"
                        >
                          −{n}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <Button
              onClick={handleFeed}
              disabled={totalSelected === 0 || busy || remainingToday === 0}
              className="w-full mt-3 bg-amber-600 hover:bg-amber-500 text-stone-900 font-bold"
            >
              أطعمها ({totalSelected}) 🍽️
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
