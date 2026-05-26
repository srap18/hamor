import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AVATAR_FRAMES, NAME_FRAMES, type Frame } from "@/lib/frames";
import { buyWithGems } from "@/lib/economy";

export const Route = createFileRoute("/cosmetics")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "متجر الإطارات — Ocean Catch" },
      { name: "description", content: "اشتري إطارات للصورة وللاسم" },
    ],
  }),
  component: CosmeticsShop,
});

type Tab = "avatar" | "name";

const RARITY_COLOR: Record<Frame["rarity"], string> = {
  common:    "from-stone-600 to-stone-800 border-stone-400",
  rare:      "from-sky-600 to-sky-800 border-sky-300",
  epic:      "from-violet-600 to-violet-900 border-violet-300",
  legendary: "from-amber-500 to-amber-800 border-amber-200",
  mythic:    "from-rose-500 via-fuchsia-600 to-amber-500 border-fuchsia-200",
};

function CosmeticsShop() {
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("avatar");
  const [userId, setUserId] = useState<string | null>(null);
  const [gems, setGems] = useState(0);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pop, setPop] = useState<string | null>(null);

  const flash = (m: string) => { setPop(m); setTimeout(() => setPop(null), 1800); };

  const reload = async (uid: string) => {
    const [{ data: p }, { data: inv }] = await Promise.all([
      supabase.from("profiles").select("gems").eq("id", uid).maybeSingle(),
      supabase.from("inventory").select("item_id").eq("user_id", uid).eq("item_type", "frame"),
    ]);
    if (p) setGems(p.gems);
    setOwned(new Set((inv ?? []).map(r => r.item_id)));
  };

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { nav({ to: "/login" }); return; }
      setUserId(u.user.id);
      await reload(u.user.id);
    })();
  }, [nav]);

  const buy = async (f: Frame) => {
    if (!userId || busy) return;
    if (owned.has(f.id)) { flash("تملك هذا الإطار"); return; }
    if (gems < f.price) { flash("جواهر غير كافية"); return; }
    setBusy(true);
    const { error } = await buyWithGems(f.id, "frame", f.price, { kind: f.kind, name: f.name });
    if (error) { setBusy(false); flash("فشل الشراء"); return; }
    setGems(gems - f.price);
    setOwned(new Set([...owned, f.id]));
    setBusy(false);
    flash(`اشتريت ${f.name} ✓`);
  };

  const list = tab === "avatar" ? AVATAR_FRAMES : NAME_FRAMES;

  return (
    <div className="fixed inset-0 overflow-y-auto text-white" dir="rtl"
      style={{ background: "radial-gradient(ellipse at top, #4a0a4a 0%, #1a0a1a 60%, #050505 100%)" }}>
      <header className="sticky top-0 z-20 glass-hud border-b border-accent/30 px-3 py-3 flex items-center gap-2">
        <Link to="/profile" className="w-10 h-10 rounded-xl glass-hud flex items-center justify-center text-lg active:scale-95">←</Link>
        <h1 className="flex-1 text-lg font-bold text-glow">✨ متجر الإطارات</h1>
        <div className="flex items-center gap-1.5 glass-hud px-2 py-1 rounded-lg border border-cyan-400/40">
          <span className="text-base">💎</span>
          <span className="text-cyan-200 font-bold tabular-nums text-xs">{gems.toLocaleString()}</span>
        </div>
      </header>

      <div className="px-3 pt-3 flex gap-2">
        {([
          { id: "avatar" as const, label: "إطار الصورة 👤" },
          { id: "name" as const,   label: "إطار الاسم ✍️" },
        ]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 py-2 rounded-xl text-sm font-bold border-2 transition-all ${tab === t.id ? "bg-gradient-to-b from-amber-400 to-amber-700 border-amber-200 text-amber-950" : "bg-secondary/40 border-border text-muted-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <main className="p-3 pb-6">
        <div className="grid grid-cols-2 gap-3">
          {list.map(f => {
            const isOwned = owned.has(f.id);
            return (
              <div key={f.id} className={`relative rounded-2xl p-3 border-2 bg-gradient-to-b ${RARITY_COLOR[f.rarity]} shadow-2xl overflow-hidden`}>
                {/* ornate corner accents */}
                <span className="absolute -top-1 -right-1 text-base drop-shadow-[0_0_4px_rgba(255,215,120,0.9)] pointer-events-none">✦</span>
                <span className="absolute -top-1 -left-1 text-base drop-shadow-[0_0_4px_rgba(255,215,120,0.9)] pointer-events-none">✦</span>
                <span className="absolute -bottom-1 -right-1 text-base drop-shadow-[0_0_4px_rgba(255,215,120,0.9)] pointer-events-none">✦</span>
                <span className="absolute -bottom-1 -left-1 text-base drop-shadow-[0_0_4px_rgba(255,215,120,0.9)] pointer-events-none">✦</span>
                <div className="absolute top-1.5 left-1.5 z-10 text-[8px] font-bold uppercase bg-black/50 px-1.5 py-0.5 rounded">{f.rarity}</div>
                <div className="relative aspect-square rounded-xl bg-gradient-to-b from-black/50 to-black/20 border border-white/15 flex items-center justify-center mb-2 overflow-hidden">
                  {/* soft conic halo */}
                  <div className="absolute inset-0 opacity-40 pointer-events-none"
                       style={{ background: "conic-gradient(from 0deg, rgba(255,255,255,0.0), rgba(255,255,255,0.25), rgba(255,255,255,0.0), rgba(255,255,255,0.25), rgba(255,255,255,0.0))" }} />
                  {f.kind === "avatar" ? (
                    <div className={`relative w-16 h-16 rounded-full bg-gradient-to-b from-stone-600 to-stone-800 flex items-center justify-center text-3xl ${f.ring}`}>
                      <span className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)]">{f.preview}</span>
                    </div>
                  ) : (
                    <div className={`relative px-4 py-2 rounded-lg text-sm font-extrabold tracking-wide ${f.nameClass}`}>اللاعب</div>
                  )}
                </div>
                <div className="text-xs font-bold text-center text-white text-glow truncate">{f.name}</div>
                {isOwned ? (
                  <div className="mt-2 text-center text-[11px] font-extrabold text-emerald-200 bg-emerald-900/60 border border-emerald-400/40 rounded py-1">
                    ✓ مملوك
                  </div>
                ) : (
                  <button onClick={() => buy(f)} disabled={busy}
                    className="mt-2 w-full rounded-lg bg-gradient-to-b from-amber-300 to-amber-500 border-2 border-amber-200 text-amber-950 font-extrabold py-1.5 text-xs flex items-center justify-center gap-1 active:scale-95 disabled:opacity-50">
                    <span>{f.price.toLocaleString()}</span>
                    <span>💎</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {pop && (
        <div className="fixed left-1/2 top-20 -translate-x-1/2 z-50 text-base font-bold text-amber-200 bg-stone-900/90 px-4 py-2 rounded-xl border border-amber-400/50 animate-float-up">
          {pop}
        </div>
      )}
    </div>
  );
}
