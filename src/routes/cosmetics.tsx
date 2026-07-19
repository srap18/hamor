import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  AVATAR_FRAMES, NAME_FRAMES, BUBBLE_FRAMES, PROFILE_FRAMES,
  FRAME_KIND_TO_ITEM_TYPE, type Frame, type FrameKind,
} from "@/lib/frames";
import { buyWithGems } from "@/lib/economy";
import { showBanner } from "@/components/Banner";

export const Route = createFileRoute("/cosmetics")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "متجر الإطارات — ملوك القراصنة" },
      { name: "description", content: "إطارات صورة، اسم، بطاقة بروفايل، وفقاعات شات" },
    ],
  }),
  component: CosmeticsShop,
});

const RARITY_GRADIENT: Record<Frame["rarity"], string> = {
  common:    "from-slate-700/80 to-slate-900/80 border-slate-500/60",
  rare:      "from-sky-700/70 to-indigo-900/80 border-sky-300/60",
  epic:      "from-violet-700/70 to-purple-900/80 border-violet-300/70",
  legendary: "from-amber-600/70 to-orange-900/80 border-amber-200/80",
  mythic:    "from-rose-600/70 via-fuchsia-700/70 to-amber-600/70 border-fuchsia-200/80",
};

const RARITY_LABEL: Record<Frame["rarity"], string> = {
  common: "عادي", rare: "نادر", epic: "ملحمي", legendary: "أسطوري", mythic: "خيالي",
};

const TABS: { id: FrameKind; label: string; icon: string }[] = [
  { id: "avatar",  label: "الصورة",   icon: "👤" },
  { id: "name",    label: "الاسم",    icon: "✍️" },
  { id: "bubble",  label: "الفقاعة",  icon: "💬" },
  { id: "profile", label: "البطاقة",  icon: "🪪" },
];

const LIST_BY_KIND: Record<FrameKind, Frame[]> = {
  avatar: AVATAR_FRAMES,
  name: NAME_FRAMES,
  bubble: BUBBLE_FRAMES,
  profile: PROFILE_FRAMES,
};


function CosmeticsShop() {
  const nav = useNavigate();
  const [tab, setTab] = useState<FrameKind>("avatar");
  const [userId, setUserId] = useState<string | null>(null);
  const [gems, setGems] = useState(0);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pop, setPop] = useState<string | null>(null);

  const flash = (m: string) => { setPop(m); setTimeout(() => setPop(null), 1800); };

  const reload = async (uid: string) => {
    const [{ data: p }, { data: inv }] = await Promise.all([
      supabase.from("profiles").select("gems").eq("id", uid).maybeSingle(),
      supabase
        .from("inventory")
        .select("item_id,item_type")
        .eq("user_id", uid)
        .in("item_type", ["frame", "name_frame", "bubble_frame", "profile_frame"]),
    ]);
    if (p) setGems(p.gems);
    setOwned(new Set((inv ?? []).map((r: any) => r.item_id)));
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
    const itemType = FRAME_KIND_TO_ITEM_TYPE[f.kind];
    const { error } = await buyWithGems(f.id, itemType, f.price, { kind: f.kind, name: f.name });
    if (error) { setBusy(false); flash("فشل الشراء"); return; }
    setGems(gems - f.price);
    setOwned(new Set([...owned, f.id]));
    setBusy(false);
    flash(`اشتريت ${f.name} ✓`);
    showBanner({ kind: "purchase", title: f.name, subtitle: `${f.price} جوهرة • ${f.kind}`, image: f.imageUrl ?? f.preview, emoji: "🎖️" });
  };


  const list = LIST_BY_KIND[tab];

  return (
    <div
      className="fixed inset-0 overflow-y-auto text-white"
      dir="rtl"
      style={{
        background:
          "radial-gradient(ellipse at top, #2a0f4a 0%, #170a2e 50%, #06030d 100%)",
      }}
    >
      <header className="sticky top-0 z-20 backdrop-blur-xl bg-black/40 border-b border-fuchsia-400/20 px-3 py-3 flex items-center gap-2">
        <Link to="/profile" className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-lg active:scale-95">←</Link>
        <h1 className="flex-1 text-base font-extrabold tracking-tight">
          <span className="bg-gradient-to-r from-fuchsia-300 via-pink-200 to-amber-200 bg-clip-text text-transparent">
            ✨ متجر الإطارات
          </span>
        </h1>
        <div className="flex items-center gap-1.5 bg-white/5 border border-cyan-400/30 px-2.5 py-1 rounded-lg">
          <span className="text-base">💎</span>
          <span className="text-cyan-100 font-bold tabular-nums text-xs">{gems.toLocaleString()}</span>
        </div>
      </header>

      {/* Tabs */}
      <div className="px-3 pt-3 grid grid-cols-4 gap-1.5">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`py-2 rounded-xl text-[11px] font-bold border transition-all flex flex-col items-center gap-0.5 ${
              tab === t.id
                ? "bg-gradient-to-b from-fuchsia-500/80 to-purple-700/80 border-fuchsia-300 text-white shadow-[0_0_18px_rgba(232,121,249,0.55)]"
                : "bg-white/5 border-white/10 text-white/60"
            }`}
          >
            <span className="text-base leading-none">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <p className="px-4 mt-3 text-[11px] text-white/60 text-center">
        إطارات تظهر للجميع في بروفايلك ورسائلك — اشترِ مرة، استخدمها للأبد.
      </p>

      {/* 🔥 شريط العرض */}
      <div className="mx-3 mt-3 rounded-2xl border border-rose-300/50 bg-gradient-to-r from-rose-600/90 via-fuchsia-600/90 to-amber-500/90 px-3 py-2.5 flex items-center justify-between gap-2 shadow-[0_8px_24px_rgba(244,63,94,0.45)] animate-pulse">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🎉</span>
          <div className="leading-tight">
            <div className="text-[13px] font-extrabold text-white">عرض على كل إطارات البروفايل</div>
            <div className="text-[10px] text-amber-100">الصورة • الاسم • الفقاعة • البطاقة</div>
          </div>
        </div>
        <div className="bg-black/40 border border-amber-200/60 px-2.5 py-1 rounded-lg text-amber-100 font-extrabold text-sm">
          -30%
        </div>
      </div>

      <main className="p-3 pb-10">
        <div className="grid grid-cols-2 gap-3">
          {list.map(f => {
            const isOwned = owned.has(f.id);
            return (
              <div
                key={f.id}
                className={`relative rounded-2xl p-3 border bg-gradient-to-b ${RARITY_GRADIENT[f.rarity]} backdrop-blur-md overflow-hidden`}
                style={{ boxShadow: "0 10px 30px -10px rgba(0,0,0,0.6)" }}
              >
                {/* shimmer */}
                <div
                  className="absolute inset-0 opacity-20 pointer-events-none"
                  style={{
                    background:
                      "conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,0.4) 60deg, transparent 120deg, rgba(255,255,255,0.3) 180deg, transparent 240deg)",
                  }}
                />
                <div className="absolute top-1.5 right-1.5 z-10 text-[8px] font-extrabold uppercase tracking-wider bg-black/60 px-1.5 py-0.5 rounded-full border border-white/15">
                  {RARITY_LABEL[f.rarity]}
                </div>
                {/* شارة الخصم */}
                <div className="absolute top-1.5 left-1.5 z-10 text-[9px] font-extrabold bg-gradient-to-r from-rose-500 to-amber-500 text-white px-1.5 py-0.5 rounded-full border border-amber-200/70 shadow-[0_2px_8px_rgba(244,63,94,0.6)]">
                  -30%
                </div>

                <div className="relative aspect-[4/3] rounded-xl bg-gradient-to-b from-black/60 to-black/30 border border-white/10 flex items-center justify-center mb-2 overflow-hidden">
                  <FramePreview frame={f} />
                </div>

                <div className="text-[12px] font-extrabold text-center text-white truncate drop-shadow">{f.name}</div>

                {isOwned ? (
                  <div className="mt-2 text-center text-[10px] font-extrabold text-emerald-200 bg-emerald-900/60 border border-emerald-400/40 rounded-lg py-1.5">
                    ✓ مملوك
                  </div>
                ) : (
                  <button
                    onClick={() => buy(f)}
                    disabled={busy}
                    className="mt-2 w-full rounded-lg bg-gradient-to-b from-cyan-300 to-cyan-500 border border-cyan-100 text-cyan-950 font-extrabold py-1.5 text-xs flex flex-col items-center justify-center gap-0 active:scale-95 disabled:opacity-50 shadow-[0_4px_14px_rgba(34,211,238,0.45)]"
                  >
                    <span className="text-[9px] text-cyan-900/70 line-through tabular-nums">{f.price.toLocaleString()} 💎</span>
                    <span className="flex items-center gap-1">
                      <span className="tabular-nums">{discountedPrice(f.price).toLocaleString()}</span>
                      <span>💎</span>
                    </span>
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

function FramePreview({ frame: f }: { frame: Frame }) {
  if (f.kind === "avatar") {
    if (f.imageUrl) {
      return (
        <div className="relative w-20 h-20 flex items-center justify-center">
          <div className="absolute w-12 h-12 rounded-full bg-gradient-to-b from-stone-600 to-stone-800 flex items-center justify-center text-xl">
            🧙
          </div>
          <img
            src={f.imageUrl}
            alt={f.name}
            className={`absolute inset-0 w-full h-full object-contain pointer-events-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)] ${f.animClass ?? ""}`}
            loading="lazy"
          />
        </div>
      );
    }
    return (
      <div className={`relative w-16 h-16 rounded-full bg-gradient-to-b from-stone-600 to-stone-800 flex items-center justify-center text-3xl ${f.ring ?? ""}`}>
        <span className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)]">{f.preview}</span>
      </div>
    );
  }
  if (f.kind === "name") {
    return (
      <div className={`relative px-4 py-2 rounded-lg text-sm font-extrabold tracking-wide ${f.nameClass ?? ""}`}>
        اللاعب
      </div>
    );
  }
  if (f.kind === "bubble") {
    return (
      <div className={`relative px-3 py-2 rounded-2xl text-xs max-w-[80%] ${f.bubbleClass ?? ""}`}>
        مرحباً 👋
      </div>
    );
  }
  // profile card preview
  return (
    <div className={`w-[90%] flex items-center gap-2 ${f.profileClass ?? ""}`}>
      <div className="w-9 h-9 rounded-full bg-gradient-to-b from-sky-500 to-sky-800 flex items-center justify-center text-base shrink-0">🧙</div>
      <div className="flex-1 bg-black/40 rounded-md px-2 py-1">
        <div className="text-[10px] font-bold text-white truncate">اللاعب</div>
        <div className="h-1 mt-0.5 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full w-2/3 bg-white/50" />
        </div>
      </div>
    </div>
  );
}
