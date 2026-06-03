import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getProfileByUsername, type PublicProfile } from "@/lib/profiles-public";
import { frameById } from "@/lib/frames";
import { getTribeBanner } from "@/lib/tribe-banners";
import ProfileAlbum from "@/components/ProfileAlbum";

type TribeInfo = { id: string; name: string; level: number; emblem: string | null };

export const Route = createFileRoute("/u/$username")({
  ssr: false,
  head: () => ({ meta: [{ title: "ملف اللاعب — Ocean Catch" }] }),
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

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 1800); };

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: u } = await supabase.auth.getUser();
      setMe(u.user?.id ?? null);
      const p = await getProfileByUsername(username);
      setProfile(p);
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
    <div className="fixed inset-0 overflow-y-auto text-foreground" dir="rtl"
      style={{ background: "radial-gradient(ellipse at top, oklch(0.30 0.12 260) 0%, oklch(0.10 0.06 250) 100%)" }}>
      <header className="sticky top-0 z-20 glass-hud border-b border-accent/30 px-3 pb-3 flex items-center gap-3" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <Link to="/" className="w-10 h-10 rounded-xl glass-hud flex items-center justify-center text-lg active:scale-95">←</Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-glow">ملف اللاعب</h1>
          <p className="text-[10px] text-muted-foreground">@{profile.username}</p>
        </div>
      </header>

      <main className="p-3 pb-20 space-y-4 max-w-md mx-auto">
        {/* Profile card */}
        <section className={equippedProfileFrame?.profileClass ?? ""}>
          <div className="rounded-2xl p-4 glass-hud border border-accent/40 flex items-center gap-4">
            <div className="relative w-20 h-20 flex items-center justify-center shrink-0">
              <div className={`relative w-16 h-16 rounded-full overflow-hidden ${equippedAvatarFrame?.imageUrl ? "" : equippedAvatarFrame?.ring ?? "ring-2 ring-border"}`}>
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-secondary text-3xl">{profile.avatar_emoji ?? "🧙"}</div>
                )}
              </div>
              {equippedAvatarFrame?.imageUrl && (
                <img src={equippedAvatarFrame.imageUrl} alt="" className={`absolute inset-0 w-full h-full object-contain pointer-events-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)] ${equippedAvatarFrame.animClass ?? ""}`} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className={`inline-block px-3 py-1 rounded-md font-bold text-base ${equippedNameFrame?.nameClass ?? "bg-secondary/60 border border-border text-foreground"}`}>
                {profile.display_name || "—"}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1 truncate">@{profile.username}</div>
              <div className="text-[10px] text-amber-200 mt-1">المستوى {profile.level ?? 1} · {profile.xp ?? 0} XP</div>
            </div>
          </div>
        </section>

        {/* Bio */}
        <section className="rounded-2xl p-4 glass-hud border border-accent/30">
          <div className="text-xs font-bold text-accent mb-2">📝 الوصف</div>
          <div className="text-sm text-foreground whitespace-pre-wrap break-words">
            {profile.bio?.trim() ? profile.bio : <span className="text-muted-foreground">لم يضف وصف</span>}
          </div>
        </section>

        {/* Action buttons */}
        {!isSelf && me && (
          <section className="grid grid-cols-3 gap-2">
            <Link
              to="/players/$playerId"
              params={{ playerId: profile.id }}
              className="rounded-xl p-3 bg-gradient-to-b from-sky-400 to-sky-700 border-2 border-sky-200 text-white text-xs font-bold text-center active:scale-95 shadow"
            >
              🌊 زيارة المحيط
            </Link>
            <button
              onClick={openDM}
              className="rounded-xl p-3 bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200 text-white text-xs font-bold active:scale-95 shadow"
            >
              💬 رسالة
            </button>
            {friendStatus === "none" && (
              <button onClick={sendFriend} disabled={busy} className="rounded-xl p-3 bg-gradient-to-b from-fuchsia-400 to-rose-700 border-2 border-fuchsia-200 text-white text-xs font-bold active:scale-95 shadow disabled:opacity-50">
                ➕ إضافة صديق
              </button>
            )}
            {friendStatus === "pending_out" && (
              <div className="rounded-xl p-3 bg-stone-700 border-2 border-stone-500 text-white/70 text-xs font-bold text-center">⏳ بانتظار الرد</div>
            )}
            {friendStatus === "pending_in" && (
              <button onClick={acceptFriend} disabled={busy} className="rounded-xl p-3 bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 text-xs font-bold active:scale-95 shadow disabled:opacity-50">
                ✓ قبول
              </button>
            )}
            {friendStatus === "accepted" && (
              <div className="rounded-xl p-3 bg-emerald-900/60 border-2 border-emerald-500/50 text-emerald-200 text-xs font-bold text-center">✓ صديق</div>
            )}
          </section>
        )}

        {isSelf && (
          <Link to="/profile" className="block text-center rounded-2xl px-4 py-3 bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 font-extrabold shadow-lg active:scale-95">
            ✏️ تعديل ملفي الشخصي
          </Link>
        )}

        {/* Album */}
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
