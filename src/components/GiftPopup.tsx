import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, refreshProfile } from "@/hooks/use-auth";
import { sound } from "@/lib/sound";
import { CREWS } from "@/lib/crews";
import { WEAPONS } from "@/lib/weapons";
import { BACKGROUNDS } from "@/lib/backgrounds";
import { ALL_FRAMES } from "@/lib/frames";
import { getShipByCode } from "@/lib/ships";

type ItemMeta = { name: string; image?: string; emoji?: string };
const ITEM_META: Record<string, ItemMeta> = {};
CREWS.forEach((c) => { ITEM_META[c.id] = { name: c.name, image: c.image, emoji: c.emoji }; });
WEAPONS.forEach((w) => { ITEM_META[w.id] = { name: w.name, image: w.image, emoji: w.emoji }; });
BACKGROUNDS.forEach((b) => { ITEM_META[b.id] = { name: b.name, image: b.image, emoji: "🌅" }; });
ALL_FRAMES.forEach((f) => { ITEM_META[f.id] = { name: f.name, image: f.imageUrl, emoji: f.preview }; });

function getItemMeta(code: string, kind?: string): ItemMeta {
  if (ITEM_META[code]) return ITEM_META[code];
  if (kind === "ship") {
    try { const s = getShipByCode(code); return { name: s.name ?? code, image: s.image, emoji: "⛵" }; } catch { /* ignore */ }
  }
  return { name: code, emoji: kind === "ship" ? "⛵" : "📦" };
}

type GiftMeta = {
  code?: string;
  coins?: number;
  gems?: number;
  xp?: number;
  items?: { id: string; kind: string; qty: number }[];
  ships?: { id: string; qty: number }[];
  shields?: { id: string; hours: number }[];
};

type GiftNotif = {
  id: string;
  title: string;
  body: string;
  kind: string;
  recipient_id: string | null;
  meta: GiftMeta | null;
};

export function GiftPopup() {
  const { user } = useAuth();
  const [queue, setQueue] = useState<GiftNotif[]>([]);
  const current = queue[0] ?? null;

  useEffect(() => {
    if (!user) return;
    const seenKey = `gift-shown:${user.id}`;
    const seen: Set<string> = new Set(
      JSON.parse(localStorage.getItem(seenKey) || "[]"),
    );

    const enqueue = (n: GiftNotif) => {
      if (seen.has(n.id)) return;
      seen.add(n.id);
      const arr = Array.from(seen).slice(-200);
      localStorage.setItem(seenKey, JSON.stringify(arr));
      setQueue((q) => [...q, n]);
      try { sound.play("coin"); } catch {}
      refreshProfile();
    };

    // Pick up any gifts that arrived while offline (last 24h)
    (async () => {
      const sinceIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data } = await supabase
        .from("notifications")
        .select("id,title,body,kind,recipient_id,meta")
        .eq("recipient_id", user.id)
        .eq("kind", "gift")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: true })
        .limit(10);
      for (const n of (data || []) as GiftNotif[]) enqueue(n);
    })();

    const ch = supabase
      .channel(`gift-pop:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${user.id}` },
        (payload) => {
          const n = payload.new as GiftNotif;
          if (n.kind !== "gift") return;
          enqueue(n);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]);

  if (!current) return null;
  const m = current.meta || {};

  const close = () => setQueue((q) => q.slice(1));

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in" dir="rtl">
      {/* glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(252,191,73,0.35),transparent_60%)]" />
      <div
        onClick={close}
        className="relative w-full max-w-sm rounded-3xl overflow-hidden border-4 border-amber-300 shadow-[0_0_60px_rgba(252,191,73,0.7)] animate-in zoom-in-95"
        style={{
          background:
            "linear-gradient(180deg, #4a2a06 0%, #2a1606 55%, #0a0502 100%)",
        }}
      >
        {/* shimmer */}
        <div className="absolute inset-0 pointer-events-none opacity-30 bg-[linear-gradient(120deg,transparent_40%,rgba(255,236,179,0.6)_50%,transparent_60%)] bg-[length:200%_100%] animate-[shimmer_2.4s_linear_infinite]" />

        <div className="relative px-5 pt-6 pb-4 text-center">
          <div className="text-6xl drop-shadow-[0_4px_8px_rgba(0,0,0,0.7)] animate-bounce">🎁</div>
          <div className="mt-2 text-xs font-black text-amber-300 tracking-[0.3em]">هدية من الإدارة</div>
          <div className="mt-1 text-xl font-extrabold text-amber-100 drop-shadow">
            كود <span className="text-amber-300 font-mono">{m.code || "—"}</span>
          </div>
          <div className="mx-auto mt-2 w-28 h-px bg-gradient-to-l from-transparent via-amber-300 to-transparent" />
        </div>

        <div className="relative px-4 pb-4 space-y-2">
          {(m.coins ?? 0) > 0 && (
            <RewardRow icon="💰" label="عملة ذهبية" value={m.coins!} color="from-amber-400 to-amber-700" />
          )}
          {(m.gems ?? 0) > 0 && (
            <RewardRow icon="💎" label="جوهرة" value={m.gems!} color="from-cyan-300 to-cyan-700" />
          )}
          {(m.xp ?? 0) > 0 && (
            <RewardRow icon="✨" label="خبرة" value={m.xp!} color="from-violet-300 to-violet-700" />
          )}
          {(m.items || []).map((it, i) => {
            const meta = getItemMeta(it.id, it.kind);
            return (
              <RewardRow
                key={`it${i}`}
                icon={meta.emoji ?? "📦"}
                image={meta.image}
                label={meta.name}
                value={it.qty}
                color="from-emerald-400 to-emerald-800"
              />
            );
          })}
          {(m.ships || []).map((s, i) => {
            const meta = getItemMeta(s.id, "ship");
            return (
              <RewardRow
                key={`sh${i}`}
                icon={meta.emoji ?? "⛵"}
                image={meta.image}
                label={meta.name}
                value={s.qty}
                color="from-sky-400 to-sky-800"
              />
            );
          })}
          {(m.shields || []).map((s, i) => (
            <RewardRow key={`sd${i}`} icon="🛡" label="درع حماية" value={s.hours} unit="ساعة" color="from-indigo-300 to-indigo-700" />
          ))}
          {!m.coins && !m.gems && !m.xp && !(m.items?.length) && !(m.ships?.length) && !(m.shields?.length) && (
            <div className="text-amber-200/80 text-sm text-center py-3">{current.body}</div>
          )}
        </div>

        <button
          onClick={close}
          className="relative w-full py-3.5 text-amber-950 font-black text-base tracking-wider bg-gradient-to-b from-amber-300 via-amber-500 to-amber-700 border-t-4 border-amber-200 hover:brightness-110 active:brightness-95 transition shadow-[inset_0_2px_0_rgba(255,255,255,0.5)]"
        >
          ⚓ تسلّم الكنز
        </button>
      </div>

      <style>{`
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
}

function RewardRow({ icon, image, label, value, color, unit }: { icon: string; image?: string; label: string; value: number; color: string; unit?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border-2 border-amber-700/60 bg-black/40 px-3 py-2 shadow-inner">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl bg-gradient-to-b ${color} shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] border border-white/20 overflow-hidden`}>
        {image ? <img src={image} alt={`صورة هدية ${label}`} className="w-full h-full object-contain" /> : icon}
      </div>
      <div className="flex-1 text-right text-amber-100 font-bold text-sm truncate">{label}</div>
      <div className="text-amber-300 font-black text-lg drop-shadow">
        +{value.toLocaleString()}{unit ? ` ${unit}` : ""}
      </div>
    </div>
  );
}
