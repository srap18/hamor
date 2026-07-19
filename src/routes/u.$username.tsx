import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { BackButton } from "@/components/BackButton";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getProfileByUsername, type PublicProfile } from "@/lib/profiles-public";
import { frameById } from "@/lib/frames";
import { getTribeBanner } from "@/lib/tribe-banners";
import ProfileAlbum from "@/components/ProfileAlbum";

type TribeInfo = { id: string; name: string; level: number; emblem: string | null };

export const Route = createFileRoute("/u/$username")({
  ssr: false,
  head: ({ params }) => ({
    meta: [
      { title: `ملف اللاعب ${params.username} — ملوك القراصنة` },
      { name: "description", content: `صفحة اللاعب ${params.username} في لعبة ملوك القراصنة — السفن، الإنجازات، القبيلة، والترتيب.` },
      { property: "og:title", content: `ملف اللاعب ${params.username} — ملوك القراصنة` },
      { property: "og:description", content: `استعرض ملف اللاعب ${params.username} في ملوك القراصنة: السفن، الإنجازات، القبيلة، والترتيب على لوحة الصدارة.` },
      { property: "og:url", content: `https://www.molok-alqarasna.com/u/${params.username}` },
      { property: "og:type", content: "profile" },
    ],
    links: [{ rel: "canonical", href: `https://www.molok-alqarasna.com/u/${params.username}` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "ProfilePage",
          name: `ملف اللاعب ${params.username}`,
          url: `https://www.molok-alqarasna.com/u/${params.username}`,
          inLanguage: "ar",
          mainEntity: { "@type": "Person", name: params.username, alternateName: params.username },
        }),
      },
    ],
  }),
  component: UserProfilePage,
});

function UserProfilePage() {
  const { username } = useParams({ from: "/u/$username" });
  const nav = useNavigate();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [friendStatus, setFriendStatus] = useState<"none" | "pending_out" | "pending_in" | "accepted" | "self">("none");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [tribe, setTribe] = useState<TribeInfo | null>(null);
  const [albumPrivacy, setAlbumPrivacy] = useState<"public" | "friends">("public");

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 1800); };

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: u } = await supabase.auth.getUser();
      setMe(u.user?.id ?? null);
      const p = await getProfileByUsername(username);
      setProfile(p);
      if (p?.tribe_id) {
        const { data: t } = await supabase.from("tribes").select("id,name,level,emblem").eq("id", p.tribe_id).maybeSingle();
        if (t) setTribe(t as TribeInfo);
        else setTribe(null);
      } else setTribe(null);
      if (p) {
        const { data: pr } = await supabase.from("profiles").select("album_privacy").eq("id", p.id).maybeSingle();
        setAlbumPrivacy(((pr as any)?.album_privacy === "friends" ? "friends" : "public"));
      }
      if (p && u.user) {
        if (p.id === u.user.id) setFriendStatus("self");
        else {
          const { data: fr } = await supabase
            .from("friends")
            .select("*")
            .or(`and(requester_id.eq.${u.user.id},addressee_id.eq.${p.id}),and(requester_id.eq.${p.id},addressee_id.eq.${u.user.id})`)
            .maybeSingle();
          if (!fr) setFriendStatus("none");
          else if (fr.status === "accepted") setFriendStatus("accepted");
          else if (fr.requester_id === u.user.id) setFriendStatus("pending_out");
          else setFriendStatus("pending_in");
        }
      }
      setLoading(false);
    })();
  }, [username]);

  const sendFriend = async () => {
    if (!me || !profile) return;
    setBusy(true);
    const { error } = await supabase.from("friends").insert({ requester_id: me, addressee_id: profile.id, status: "pending" } as any);
    setBusy(false);
    if (error) { flash("فشل إرسال الطلب"); return; }
    setFriendStatus("pending_out");
    flash("تم إرسال طلب الصداقة");
  };

  const acceptFriend = async () => {
    if (!me || !profile) return;
    setBusy(true);
    await supabase.from("friends").update({ status: "accepted" } as any).eq("requester_id", profile.id).eq("addressee_id", me);
    setBusy(false);
    setFriendStatus("accepted");
    flash("تمت إضافة الصديق");
  };

  const openDM = () => {
    if (!profile) return;
    nav({ to: "/chat", search: { dm: profile.id } as any });
  };

  if (loading) {
    return <div className="fixed inset-0 flex items-center justify-center bg-stone-950 text-amber-200">جاري التحميل…</div>;
  }
  if (!profile) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-stone-950 text-foreground gap-3" dir="rtl">
        <div className="text-lg">لا يوجد لاعب بهذا اليوزر</div>
        <Link to="/" className="px-4 py-2 rounded-xl bg-secondary">العودة للرئيسية</Link>
      </div>
    );
  }

  const equippedAvatarFrame = frameById(profile.avatar_frame);
  const equippedNameFrame = frameById(profile.name_frame);
  const equippedProfileFrame = frameById(profile.profile_frame);
  const isSelf = friendStatus === "self";

  return (
    <div className="min-h-screen w-full text-foreground" dir="rtl"
      style={{ background: "radial-gradient(ellipse at top, oklch(0.30 0.12 260) 0%, oklch(0.10 0.06 250) 100%)", WebkitOverflowScrolling: "touch" }}>
      <header className="sticky top-0 z-20 glass-hud border-b border-accent/30 px-3 pb-3 flex items-center gap-3" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <BackButton aria-label="العودة للصفحة السابقة" className="w-10 h-10 rounded-xl glass-hud flex items-center justify-center text-lg active:scale-95">←</BackButton>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-glow">ملف اللاعب</h1>
          <p className="text-[10px] text-muted-foreground">@{profile.username}</p>
        </div>
      </header>

      <main className="p-3 pb-32 space-y-4 max-w-md mx-auto">
        {/* Luxurious tribe banner */}
        {tribe && (() => {
          const tier = getTribeBanner(tribe.level || 1);
          return (
            <section className="relative w-full h-28 rounded-2xl overflow-hidden border-2 border-amber-500/60 shadow-[0_0_30px_rgba(251,191,36,0.35)]">
              <img src={tier.url} alt={`بنر ${tier.name}`} className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
              <div className="absolute inset-0 flex items-center gap-3 px-4">
                <div className="relative w-16 h-16 shrink-0">
                  <img src={tier.emblemUrl} alt="" className="absolute inset-[14%] w-[72%] h-[72%] object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]" />
                  <img src={tier.frameUrl} alt="" aria-hidden className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-amber-100 font-extrabold text-base truncate drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">🏴‍☠️ {tribe.name}</div>
                  <div className="text-[11px] text-amber-200/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">⭐ مستوى {tribe.level} · {tier.name}</div>
                </div>
              </div>
            </section>
          );
        })()}

        {/* Profile card — luxurious */}
        <section className={equippedProfileFrame?.profileClass ?? ""}>
          <div className="relative rounded-2xl p-4 border-2 border-amber-500/50 shadow-[0_0_24px_rgba(251,191,36,0.25)] overflow-hidden"
            style={{ background: "linear-gradient(135deg, oklch(0.18 0.04 60) 0%, oklch(0.12 0.03 280) 100%)" }}>
            <div aria-hidden className="absolute inset-0 pointer-events-none opacity-30"
              style={{ background: "radial-gradient(circle at top right, rgba(251,191,36,0.35), transparent 60%)" }} />
            <div className="relative flex items-center gap-4">
              <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
                <div className={`relative w-20 h-20 rounded-full overflow-hidden ${equippedAvatarFrame?.imageUrl ? "" : equippedAvatarFrame?.ring ?? "ring-2 ring-amber-400/60"}`}>
                  {profile.avatar_url ? (
                    <img src={profile.avatar_url} alt={`Player avatar — ${profile.display_name ?? profile.username}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-secondary text-4xl">{profile.avatar_emoji ?? "🧙"}</div>
                  )}
                </div>
                {equippedAvatarFrame?.imageUrl && (
                  <img src={equippedAvatarFrame.imageUrl} alt="" className={`absolute inset-0 w-full h-full object-contain pointer-events-none drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)] ${equippedAvatarFrame.animClass ?? ""}`} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`inline-block px-3 py-1 rounded-md font-extrabold text-lg ${equippedNameFrame?.nameClass ?? "bg-gradient-to-r from-amber-500/30 to-amber-700/30 border border-amber-400/60 text-amber-100"}`}>
                  {profile.display_name || "—"}
                </div>
                <div className="text-[11px] text-amber-200/80 mt-1 truncate">@{profile.username}</div>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-amber-700 text-amber-950 border border-amber-300 shadow">
                    ⭐ مستوى {profile.level ?? 1}
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-900/70 text-indigo-100 border border-indigo-400/60">
                    ✨ {profile.xp ?? 0} XP
                  </span>
                  {equippedAvatarFrame && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-fuchsia-900/70 text-fuchsia-100 border border-fuchsia-400/60">
                      🖼️ {equippedAvatarFrame.name ?? "إطار"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Action buttons — placed BEFORE bio so they're visible without scrolling */}
        {!isSelf && (
          <section className="grid grid-cols-3 gap-2">
            <Link
              to="/players/$playerId"
              params={{ playerId: profile.id }}
              className="rounded-xl p-3 bg-gradient-to-b from-sky-400 to-sky-700 border-2 border-sky-200 text-white text-xs font-bold text-center active:scale-95 shadow"
            >
              🌊 زيارة المحيط
            </Link>
            <button
              onClick={() => { if (!me) { flash("سجّل الدخول أولاً"); return; } openDM(); }}
              className="rounded-xl p-3 bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200 text-white text-xs font-bold active:scale-95 shadow"
            >
              💬 رسالة
            </button>
            {(!me || friendStatus === "none") && (
              <button onClick={() => { if (!me) { flash("سجّل الدخول أولاً"); return; } sendFriend(); }} disabled={busy} className="rounded-xl p-3 bg-gradient-to-b from-fuchsia-400 to-rose-700 border-2 border-fuchsia-200 text-white text-xs font-bold active:scale-95 shadow disabled:opacity-50">
                ➕ إضافة صديق
              </button>
            )}
            {me && friendStatus === "pending_out" && (
              <div className="rounded-xl p-3 bg-stone-700 border-2 border-stone-500 text-white/70 text-xs font-bold text-center">⏳ بانتظار الرد</div>
            )}
            {me && friendStatus === "pending_in" && (
              <button onClick={acceptFriend} disabled={busy} className="rounded-xl p-3 bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 text-xs font-bold active:scale-95 shadow disabled:opacity-50">
                ✓ قبول
              </button>
            )}
            {me && friendStatus === "accepted" && (
              <div className="rounded-xl p-3 bg-emerald-900/60 border-2 border-emerald-500/50 text-emerald-200 text-xs font-bold text-center">✓ صديق</div>
            )}
          </section>
        )}

        {isSelf && (
          <Link to="/profile" className="block text-center rounded-2xl px-4 py-3 bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 font-extrabold shadow-lg active:scale-95">
            ✏️ تعديل ملفي الشخصي
          </Link>
        )}

        {/* Bio */}
        <section className="rounded-2xl p-4 glass-hud border border-accent/30">
          <div className="text-xs font-bold text-accent mb-2">📝 الوصف</div>
          <div className="text-sm text-foreground whitespace-pre-wrap break-words">
            {profile.bio?.trim() ? profile.bio : <span className="text-muted-foreground">لم يضف وصف</span>}
          </div>
        </section>


        {/* Album */}
        {albumPrivacy === "friends" && (
          <div className="text-[11px] text-amber-200 bg-amber-900/30 border border-amber-500/40 rounded-xl px-3 py-2 text-center">
            🔒 الألبوم خاص بالأصدقاء — لن يظهر إلا للأصدقاء المقبولين والإدارة.
          </div>
        )}
        <ProfileAlbum userId={profile.id} isOwner={isSelf} />
      </main>

      {toast && (
        <div className="fixed left-1/2 top-20 -translate-x-1/2 z-50 text-base font-bold text-amber-200 text-glow bg-stone-900/90 px-4 py-2 rounded-xl border border-amber-400/50">
          {toast}
        </div>
      )}
    </div>
  );
}
