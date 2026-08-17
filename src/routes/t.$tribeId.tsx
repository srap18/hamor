import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getTribeBanner } from "@/lib/tribe-banners";
import { BackButton } from "@/components/BackButton";
import { TribeRoleBadge } from "@/components/TribeRoleBadge";

export const Route = createFileRoute("/t/$tribeId")({
  head: () => ({
    meta: [
      { title: "قبيلة — ملوك القراصنة" },
      { name: "description", content: "استعرض القبيلة: مستواها، وصفها، أعضاؤها، وزر زيارة محيط كل عضو." },
      { property: "og:title", content: "قبيلة — ملوك القراصنة" },
      { property: "og:description", content: "مستوى القبيلة وأعضاؤها وزيارة محيط الأعضاء." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TribePage,
});

type TribeRow = { id: string; name: string; emblem: string | null; level: number; description: string | null; total_donations: number | null };
type Member = {
  user_id: string; role: string; donation_coins: number;
  display_name: string | null; username: string | null; avatar_emoji: string | null; avatar_url: string | null; level: number | null;
};

function TribePage() {
  const { tribeId } = useParams({ from: "/t/$tribeId" });
  const [tribe, setTribe] = useState<TribeRow | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [staff, setStaff] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: u } = await supabase.auth.getUser();
      setMe(u.user?.id ?? null);
      const [{ data: t }, { data: ms }] = await Promise.all([
        supabase.from("tribes").select("id,name,emblem,level,description,total_donations").eq("id", tribeId).maybeSingle(),
        supabase.from("tribe_members").select("user_id,role,donation_coins").eq("tribe_id", tribeId),
      ]);
      setTribe((t as any) || null);
      const ids = ((ms || []) as any[]).map(m => m.user_id);
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id,display_name,username,avatar_emoji,avatar_url,level").in("id", ids)
        : { data: [] as any[] };
      const pmap = new Map(((profs || []) as any[]).map(p => [p.id, p]));
      const list: Member[] = ((ms || []) as any[]).map(m => ({
        user_id: m.user_id,
        role: m.role,
        donation_coins: m.donation_coins || 0,
        display_name: pmap.get(m.user_id)?.display_name ?? null,
        username: pmap.get(m.user_id)?.username ?? null,
        avatar_emoji: pmap.get(m.user_id)?.avatar_emoji ?? null,
        avatar_url: pmap.get(m.user_id)?.avatar_url ?? null,
        level: pmap.get(m.user_id)?.level ?? null,
      })).sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : b.donation_coins - a.donation_coins));
      setMembers(list);
      // hide "visit ocean" for staff accounts
      const flags = await Promise.all(ids.map(async id => {
        try {
          const { data } = await (supabase as any).rpc("is_staff", { _user_id: id });
          return data === true ? id : null;
        } catch { return null; }
      }));
      setStaff(new Set(flags.filter(Boolean) as string[]));
      setLoading(false);
    })();
  }, [tribeId]);

  if (loading) return <div className="fixed inset-0 flex items-center justify-center bg-stone-950 text-amber-200">جاري التحميل…</div>;
  if (!tribe) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-stone-950 text-amber-200" dir="rtl">
        <div>لا توجد قبيلة بهذا المعرّف</div>
        <Link to="/" className="px-4 py-2 rounded-xl bg-stone-800">العودة للرئيسية</Link>
      </div>
    );
  }

  const tier = getTribeBanner(tribe.level || 1);

  return (
    <div className="min-h-screen w-full text-foreground" dir="rtl"
      style={{ background: "radial-gradient(ellipse at top, oklch(0.30 0.12 260) 0%, oklch(0.10 0.06 250) 100%)" }}>
      <header className="sticky top-0 z-20 glass-hud border-b border-accent/30 px-3 pb-3 flex items-center gap-3" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <BackButton aria-label="رجوع" className="w-10 h-10 rounded-xl glass-hud flex items-center justify-center text-lg active:scale-95">←</BackButton>
        <h1 className="text-lg font-bold text-glow flex-1 truncate">🏴‍☠️ {tribe.name}</h1>
      </header>

      <main className="p-3 pb-24 space-y-4 max-w-md mx-auto">
        <section className="relative w-full h-28 rounded-2xl overflow-hidden border-2 border-amber-500/60 shadow-[0_0_30px_rgba(251,191,36,0.35)]">
          <img decoding="async" src={tier.url} alt={`بنر ${tier.name}`} className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="absolute inset-0 flex items-center gap-3 px-4">
            <div className="relative w-16 h-16 shrink-0">
              <img decoding="async" src={tier.emblemUrl} alt="" className="absolute inset-[14%] w-[72%] h-[72%] object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]" />
              <img decoding="async" src={tier.frameUrl} alt="" aria-hidden className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-amber-100 font-extrabold text-base truncate drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">{tribe.emblem || "🏴‍☠️"} {tribe.name}</div>
              <div className="text-[11px] text-amber-200/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">⭐ مستوى {tribe.level} · {tier.name}</div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl p-4 glass-hud border border-accent/30 space-y-2">
          <div className="text-xs font-bold text-accent">📝 وصف القبيلة</div>
          <div className="text-sm whitespace-pre-wrap break-words">
            {tribe.description?.trim() ? tribe.description : <span className="text-muted-foreground">لا يوجد وصف</span>}
          </div>
          <div className="text-[10px] text-amber-300/70">💰 إجمالي التبرعات: {(tribe.total_donations || 0).toLocaleString()}</div>
        </section>

        <section className="space-y-1.5">
          <div className="text-xs font-bold text-amber-300">👥 الأعضاء ({members.length})</div>
          {members.map(m => (
            <div key={m.user_id} className="flex items-center gap-2 p-2 rounded-xl bg-stone-900/70 border border-amber-700/30">
              {m.avatar_url
                ? <img decoding="async" src={m.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
                : <span className="w-9 h-9 rounded-full bg-sky-800 flex items-center justify-center text-lg">{m.avatar_emoji || "🏴‍☠️"}</span>}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-amber-100 truncate">
                  {m.display_name || "قرصان"} {m.role === "owner" ? "👑" : m.role === "moderator" ? "🛡️" : ""}
                </div>
                <div className="text-[10px] text-amber-300/70">⭐ {m.level ?? 1} · 🤝 {m.donation_coins.toLocaleString()}</div>
              </div>
              {m.username && (
                <Link to="/u/$username" params={{ username: m.username }}
                  className="px-2 py-1 rounded-lg bg-stone-800 border border-amber-600/40 text-amber-200 text-[10px] font-bold">👤</Link>
              )}
              {m.user_id !== me && !staff.has(m.user_id) && (
                <Link to="/players/$playerId" params={{ playerId: m.user_id }}
                  className="px-2 py-1 rounded-lg bg-gradient-to-b from-sky-400 to-sky-700 border border-sky-200 text-white text-[10px] font-bold">🌊 محيطه</Link>
              )}
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
