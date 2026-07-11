import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BackButton } from "@/components/BackButton";
import { LevelSkillsCard } from "@/components/LevelSkillsCard";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import ProfileAlbum from "@/components/ProfileAlbum";
import {
  AVATAR_FRAMES, NAME_FRAMES, BUBBLE_FRAMES, PROFILE_FRAMES,
  frameById, type Frame, type FrameKind,
} from "@/lib/frames";

export const Route = createFileRoute("/profile")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ملفي الشخصي — ملوك القراصنة" },
      { name: "description", content: "أدر ملفك الشخصي في ملوك القراصنة: غيّر اسمك وصورتك وإطاراتك، خصّص أفاتارك واستعرض إنجازاتك وترتيبك في اللعبة." },
      { property: "og:title", content: "ملفي الشخصي — ملوك القراصنة" },
      { property: "og:description", content: "أدر ملفك الشخصي في ملوك القراصنة: غيّر اسمك وصورتك وإطاراتك، خصّص أفاتارك واستعرض إنجازاتك." },
      { property: "og:type", content: "profile" },
      { property: "og:url", content: "https://www.molok-alqarasna.com/profile" },
    ],
    links: [{ rel: "canonical", href: "https://www.molok-alqarasna.com/profile" }],
  }),
  component: ProfilePage,
});

import av1 from "@/assets/avatars/avatar-1.jpg";
import av2 from "@/assets/avatars/avatar-2.jpg";
import av3 from "@/assets/avatars/avatar-3.jpg";
import av4 from "@/assets/avatars/avatar-4.jpg";
import av5 from "@/assets/avatars/avatar-5.jpg";
import av6 from "@/assets/avatars/avatar-6.jpg";
import av7 from "@/assets/avatars/avatar-7.jpg";
import av8 from "@/assets/avatars/avatar-8.jpg";
import av9 from "@/assets/avatars/avatar-9.jpg";
import av10 from "@/assets/avatars/avatar-10.jpg";
import av11 from "@/assets/avatars/avatar-11.jpg";
import av12 from "@/assets/avatars/avatar-12.jpg";

const PRESET_AVATARS = [av1, av2, av3, av4, av5, av6, av7, av8, av9, av10, av11, av12];

function ProfilePage() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameChangedAt, setUsernameChangedAt] = useState<string | null>(null);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [savingUsername, setSavingUsername] = useState(false);
  const [bio, setBio] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState("🧙");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarFrame, setAvatarFrame] = useState<string | null>(null);
  const [nameFrame, setNameFrame] = useState<string | null>(null);
  const [bubbleFrame, setBubbleFrame] = useState<string | null>(null);
  const [profileFrame, setProfileFrame] = useState<string | null>(null);
  const [ownedFrameIds, setOwnedFrameIds] = useState<Set<string>>(new Set());
  const [albumPrivacy, setAlbumPrivacy] = useState<"public" | "friends">("public");
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [pop, setPop] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (m: string) => { setPop(m); setTimeout(() => setPop(null), 1800); };

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { nav({ to: "/login" }); return; }
      setUserId(u.user.id);
      const [{ data: p }, { data: inv }] = await Promise.all([
        supabase
          .from("profiles")
          .select("display_name,username,username_changed_at,bio,avatar_emoji,avatar_url,avatar_frame,name_frame,bubble_frame,profile_frame,album_privacy")
          .eq("id", u.user.id).maybeSingle(),
        supabase
          .from("inventory")
          .select("item_id,item_type")
          .eq("user_id", u.user.id)
          .in("item_type", ["frame", "name_frame", "bubble_frame", "profile_frame"]),
      ]);
      if (p) {
        setDisplayName(p.display_name ?? "");
        setUsername((p as any).username ?? "");
        setUsernameDraft((p as any).username ?? "");
        setUsernameChangedAt((p as any).username_changed_at ?? null);
        setBio((p as any).bio ?? "");
        setAvatarEmoji(p.avatar_emoji ?? "🧙");
        setAvatarUrl(p.avatar_url ?? null);
        setAvatarFrame(p.avatar_frame ?? null);
        setNameFrame(p.name_frame ?? null);
        setBubbleFrame((p as any).bubble_frame ?? null);
        setProfileFrame((p as any).profile_frame ?? null);
        setAlbumPrivacy(((p as any).album_privacy === "friends" ? "friends" : "public"));
      }
      setOwnedFrameIds(new Set((inv ?? []).map((r: any) => r.item_id)));
      setLoading(false);
    })();
  }, [nav]);

  const onUpload = async (file: File) => {
    if (!userId) return;
    if (file.size > 3 * 1024 * 1024) { flash("الصورة كبيرة (الحد 3 ميجا)"); return; }
    setSaving(true);
    // Content moderation: try to block NSFW; fail-open if service unavailable.
    try {
      flash("جاري فحص الصورة...");
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const s = String(r.result || "");
          const i = s.indexOf(",");
          resolve(i >= 0 ? s.slice(i + 1) : s);
        };
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const { moderateImage } = await import("@/lib/moderation.functions");
      const verdict = await moderateImage({ data: { imageBase64: b64, mimeType: file.type || "image/jpeg" } });
      if (!verdict.safe) {
        setSaving(false);
        flash("⚠️ الصورة مرفوضة: محتوى غير لائق");
        return;
      }
    } catch (e: any) {
      // Fail-open: continue upload if moderation can't run (credits, network, etc.)
      console.warn("[avatar moderation skipped]", e?.message || e);
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
    const path = `${userId}/avatar.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, cacheControl: "0" });
    if (error) { setSaving(false); console.error("[avatar upload]", error); flash(`فشل الرفع: ${error.message}`); return; }
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    const cacheBusted = `${pub.publicUrl}?t=${Date.now()}`;
    setAvatarUrl(cacheBusted);
    const { data: updated, error: updErr } = await supabase.from("profiles").update({ avatar_url: cacheBusted }).eq("id", userId).select("id");
    setSaving(false);
    if (updErr) { console.error("[avatar profile update]", updErr); flash(`فشل الحفظ: ${updErr.message}`); return; }
    if (!updated || updated.length === 0) { console.warn("[avatar update] no rows", { userId }); flash("لم يتم حفظ الصورة"); return; }
    flash("تم تحديث الصورة");
  };

  const [savingName, setSavingName] = useState(false);

  const saveName = async () => {
    if (!userId) return;
    const trimmed = displayName.trim();
    if (trimmed.length < 2) { flash("الاسم قصير جداً"); return; }
    if (trimmed.length > 15) { flash("الاسم لا يتجاوز 15 حرف"); return; }
    if (!/^[\u0600-\u06FFA-Za-z0-9 _-]+$/.test(trimmed)) {
      flash("الاسم يحتوي رموز أو زخارف غير مسموحة");
      return;
    }
    if (!/[\u0600-\u06FFA-Za-z]/.test(trimmed)) {
      flash("الاسم لازم يحتوي على حرف واحد على الأقل");
      return;
    }
    setSavingName(true);
    try {
      const { data: bad } = await (supabase as any).rpc("is_disallowed_religious_name", { p_name: trimmed });
      if (bad === true) {
        setSavingName(false);
        flash("هذا الاسم غير مسموح. أمثلة مسموحة: بسم الله، سبحان الله، حسبي الله، لا إله إلا الله.");
        return;
      }
    } catch (e) { console.warn("[name policy check failed]", e); }
    try {
      const { data: taken } = await (supabase as any).rpc("is_display_name_taken", { p_name: trimmed, p_except: userId });
      if (taken === true) {
        setSavingName(false);
        flash("هذا الاسم محجوز");
        return;
      }
    } catch (e) { console.warn("[name uniqueness check failed]", e); }
    const { data: updated, error } = await supabase.from("profiles").update({
      display_name: trimmed,
    } as any).eq("id", userId).select("id");
    setSavingName(false);
    if (error) {
      const m = String(error.message || "");
      console.error("[name save]", error);
      if (m.includes("display_name_taken")) flash("هذا الاسم محجوز");
      else if (m.includes("display_name_invalid_chars")) flash("الاسم يحتوي رموز أو زخارف غير مسموحة");
      else if (m.includes("display_name_must_have_letter")) flash("الاسم لازم يحتوي على حرف واحد");
      else if (m.includes("display_name_disallowed_religious")) flash("هذا الاسم الديني غير مسموح");
      else if (m.includes("too long")) flash("الاسم أطول من 15 حرف");
      else if (m.includes("too short")) flash("الاسم قصير جداً");
      else flash(`فشل حفظ الاسم: ${m}`);
      return;
    }
    if (!updated || updated.length === 0) { flash("لم يتم تحديث الاسم"); return; }
    flash("تم حفظ الاسم ✓");
  };

  const save = async () => {
    if (!userId) return;
    setSaving(true);
    const { data: updated, error } = await supabase.from("profiles").update({
      bio: bio.slice(0, 200),
      avatar_emoji: avatarEmoji,
      avatar_frame: avatarFrame,
      name_frame: nameFrame,
      bubble_frame: bubbleFrame,
      profile_frame: profileFrame,
    } as any).eq("id", userId).select("id");
    setSaving(false);
    if (error) {
      console.error("[profile save]", error);
      flash(`فشل الحفظ: ${error.message}`);
      return;
    }
    if (!updated || updated.length === 0) { flash("لم يتم تحديث الملف"); return; }
    flash("تم الحفظ ✓");
  };

  const usernameCooldownLeft = (() => {
    if (!usernameChangedAt) return 0;
    const next = new Date(usernameChangedAt).getTime() + 14 * 24 * 3600 * 1000;
    return Math.max(0, next - Date.now());
  })();
  const canChangeUsername = usernameCooldownLeft === 0;

  const changeUsername = async () => {
    const v = usernameDraft.trim().toLowerCase();
    if (!/^[a-z0-9_]{5,20}$/.test(v)) { flash("اليوزر: 5-20 حرف، a-z 0-9 _ فقط"); return; }
    if (v === username) { flash("لم يتغير اليوزر"); return; }
    setSavingUsername(true);
    const { data, error } = await (supabase as any).rpc("change_username", { _new: v });
    setSavingUsername(false);
    if (error) {
      const msg = String(error.message || "");
      if (msg.includes("USERNAME_TAKEN")) flash("هذا اليوزر محجوز");
      else if (msg.includes("USERNAME_COOLDOWN")) flash("لا يمكن تغيير اليوزر إلا كل 14 يوم");
      else if (msg.includes("INVALID_USERNAME")) flash("اليوزر غير صالح");
      else flash("فشل تغيير اليوزر");
      return;
    }
    setUsername(data?.username || v);
    setUsernameChangedAt(new Date().toISOString());
    flash("تم تغيير اليوزر ✓");
  };

  const equippedAvatarFrame = frameById(avatarFrame);
  const equippedNameFrame = frameById(nameFrame);
  const equippedBubbleFrame = frameById(bubbleFrame);
  const equippedProfileFrame = frameById(profileFrame);

  if (loading) {
    return <div className="fixed inset-0 flex items-center justify-center bg-stone-950 text-amber-200">جاري التحميل…</div>;
  }

  return (
    <div className="fixed inset-0 overflow-y-auto text-foreground" dir="rtl"
      style={{ background: "radial-gradient(ellipse at top, oklch(0.30 0.12 260) 0%, oklch(0.10 0.06 250) 100%)" }}>
      <header className="sticky top-0 z-20 glass-hud border-b border-accent/30 px-3 pb-3 flex items-center gap-3" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <BackButton className="w-10 h-10 rounded-xl glass-hud flex items-center justify-center text-lg active:scale-95">←</BackButton>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-glow flex items-center gap-2">👤 ملفي الشخصي</h1>
          <p className="text-[10px] text-muted-foreground">عدّل اسمك وصورتك وإطاراتك</p>
        </div>
      </header>

      <main className="p-3 pb-10 space-y-4">
        {/* Live preview — profile card frame wraps the entire card */}
        <section className={equippedProfileFrame?.profileClass ?? ""}>
          <div className="rounded-2xl p-4 glass-hud border border-accent/40 flex items-center gap-4">
            <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
              {/* Avatar sits centered and smaller so the frame's ring surrounds it without covering the picture */}
              <div className={`relative z-20 rounded-full overflow-hidden ${equippedAvatarFrame?.imageUrl ? "w-[62%] h-[62%]" : `w-16 h-16 ${equippedAvatarFrame?.ring ?? "ring-2 ring-border"}`}`}>
                {avatarUrl ? (
                  <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-secondary text-3xl">{avatarEmoji}</div>
                )}
              </div>
              {equippedAvatarFrame?.imageUrl && (
                <img src={equippedAvatarFrame.imageUrl} alt="" className={`absolute inset-0 w-full h-full object-contain pointer-events-none z-10 drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)] ${equippedAvatarFrame.animClass ?? ""}`} />
              )}
            </div>
            <div className="flex-1">
              <div className={`inline-block px-3 py-1 rounded-md font-bold text-base ${equippedNameFrame?.nameClass ?? "bg-secondary/60 border border-border text-foreground"}`}>
                {displayName || "اسم اللاعب"}
              </div>
              <div className="mt-2">
                <div className={`inline-block px-3 py-1.5 rounded-2xl text-xs ${equippedBubbleFrame?.bubbleClass ?? "bg-secondary/60 border border-border text-foreground"}`}>
                  مرحباً 👋
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">المعاينة المباشرة</div>
            </div>
          </div>
        </section>

        {/* Save button below preview card — saves frames, avatar and bio (NOT the name) */}
        <button onClick={save} disabled={saving}
          className="w-full px-4 py-3 rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200 text-white font-bold text-base active:scale-95 disabled:opacity-50 shadow-lg">
          {saving ? "جاري الحفظ..." : "💾 حفظ الإطارات والصورة"}
        </button>

        {/* Level + Skills */}
        {userId && <LevelSkillsCard userId={userId} />}


        {/* Name */}
        <section className="rounded-2xl p-4 glass-hud border border-accent/30 space-y-2">
          <label className="text-sm font-bold text-accent">الاسم الظاهر</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={15}
            className="w-full px-3 py-2.5 rounded-xl bg-secondary/70 border-2 border-border text-foreground text-base focus:border-accent outline-none"
            placeholder="اكتب اسمك"
          />
          <div className="text-[10px] text-muted-foreground">من 2 إلى 15 حرف</div>
          <button onClick={saveName} disabled={savingName}
            className="w-full mt-2 px-4 py-2.5 rounded-xl bg-gradient-to-b from-sky-400 to-sky-700 border-2 border-sky-200 text-white font-bold text-sm active:scale-95 disabled:opacity-50 shadow">
            {savingName ? "جاري حفظ الاسم..." : "💾 حفظ الاسم"}
          </button>
        </section>

        {/* Username */}
        <section className="rounded-2xl p-4 glass-hud border border-accent/30 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-bold text-accent">اليوزر @</label>
            <span className="text-[10px] text-muted-foreground">@{username || "..."}</span>
          </div>
          <div className="flex gap-2">
            <input
              value={usernameDraft}
              onChange={(e) => setUsernameDraft(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20))}
              maxLength={20}
              dir="ltr"
              className="flex-1 px-3 py-2.5 rounded-xl bg-secondary/70 border-2 border-border text-foreground text-base focus:border-accent outline-none font-mono"
              placeholder="user_123456"
              disabled={!canChangeUsername}
            />
            <button
              onClick={changeUsername}
              disabled={savingUsername || !canChangeUsername || usernameDraft === username}
              className="px-3 py-2 rounded-xl bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 text-xs font-bold active:scale-95 disabled:opacity-50"
            >
              {savingUsername ? "..." : "تغيير"}
            </button>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {canChangeUsername
              ? "5-20 حرف، أحرف إنجليزية صغيرة وأرقام و _ فقط. يمكن تغييره مرة كل 14 يوم."
              : `يمكنك تغيير اليوزر بعد ${Math.ceil(usernameCooldownLeft / (24 * 3600 * 1000))} يوم`}
          </div>
        </section>

        {/* Bio */}
        <section className="rounded-2xl p-4 glass-hud border border-accent/30 space-y-2">
          <label className="text-sm font-bold text-accent">الوصف الشخصي</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 200))}
            maxLength={200}
            rows={3}
            className="w-full px-3 py-2 rounded-xl bg-secondary/70 border-2 border-border text-foreground text-sm focus:border-accent outline-none resize-none"
            placeholder="اكتب وصف قصير عنك..."
          />
          <div className="text-[10px] text-muted-foreground text-left">{bio.length}/200</div>
        </section>

        {/* View public profile */}
        {username && (
          <Link to="/u/$username" params={{ username }}
            className="block text-center rounded-2xl px-4 py-3 bg-gradient-to-b from-indigo-400 to-indigo-700 border-2 border-indigo-200 text-white font-bold shadow-lg active:scale-95">
            👁️ عرض ملفي الشخصي العام
          </Link>
        )}

        {/* Album: photos + short videos */}
        {userId && (
          <section className="rounded-2xl p-4 glass-hud border border-accent/30 space-y-3">
            <div>
              <h2 className="text-sm font-bold text-accent">📸 ألبومي (صور ومقاطع قصيرة)</h2>
              <p className="text-[10px] text-muted-foreground">حتى 20 عنصر • مقاطع قصيرة (≤ 30 ثانية) • فحص ذكاء اصطناعي قبل النشر</p>
            </div>

            {/* Privacy toggle */}
            <div className="rounded-xl border border-amber-500/40 bg-stone-900/60 p-3 space-y-2">
              <div className="text-xs font-bold text-amber-200">🔒 خصوصية الألبوم</div>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { v: "public", label: "🌍 عام (الكل يشوف)" },
                  { v: "friends", label: "👥 الأصدقاء فقط" },
                ] as const).map(opt => (
                  <button
                    key={opt.v}
                    disabled={savingPrivacy}
                    onClick={async () => {
                      if (albumPrivacy === opt.v || !userId) return;
                      setSavingPrivacy(true);
                      const prev = albumPrivacy;
                      setAlbumPrivacy(opt.v);
                      const { error } = await supabase.from("profiles").update({ album_privacy: opt.v } as any).eq("id", userId);
                      setSavingPrivacy(false);
                      if (error) { setAlbumPrivacy(prev); flash("فشل الحفظ"); }
                      else flash("تم تحديث الخصوصية ✓");
                    }}
                    className={`px-2 py-2 rounded-lg text-xs font-bold border active:scale-95 disabled:opacity-50 ${
                      albumPrivacy === opt.v
                        ? "bg-gradient-to-b from-amber-400 to-amber-700 border-amber-200 text-amber-950"
                        : "bg-stone-800 border-stone-600 text-stone-300"
                    }`}
                  >{opt.label}</button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {albumPrivacy === "friends"
                  ? "أصدقاؤك المقبولون فقط يشوفون الألبوم. الإدارة تشوف دائماً."
                  : "كل اللاعبين يقدرون يشوفون الألبوم."}
              </p>
            </div>

            <ProfileAlbum userId={userId} isOwner={true} />
          </section>
        )}

        {/* Avatar image */}
        <section className="rounded-2xl p-4 glass-hud border border-accent/30 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-bold text-accent">صورتي</label>
            <button onClick={() => fileRef.current?.click()}
              className="px-3 py-1.5 rounded-lg bg-gradient-to-b from-sky-400 to-sky-700 border border-sky-200 text-white text-xs font-bold active:scale-95">
              📷 رفع صورة
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
          </div>
          {avatarUrl && (
            <button onClick={async () => { setAvatarUrl(null); await supabase.from("profiles").update({ avatar_url: null }).eq("id", userId!); flash("حُذفت الصورة"); }}
              className="text-[11px] text-rose-300 underline">إزالة الصورة المرفوعة</button>
          )}
          <div className="text-xs text-muted-foreground">أو اختر شخصية جاهزة:</div>
          <div className="grid grid-cols-6 gap-2">
            {PRESET_AVATARS.map((src, i) => {
              const isSelected = avatarUrl === src;
              return (
                <button key={i} onClick={async () => {
                  setAvatarUrl(src);
                  if (userId) await supabase.from("profiles").update({ avatar_url: src }).eq("id", userId);
                  flash("تم تحديث الصورة");
                }}
                  className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all active:scale-95 ${isSelected ? "border-amber-300 ring-2 ring-amber-300/60" : "border-border"}`}>
                  <img src={src} alt={`avatar ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                </button>
              );
            })}
          </div>
        </section>

        {/* Owned frames — 4 sections */}
        <FrameSection
          title="إطارات صورتي" kind="avatar"
          frames={AVATAR_FRAMES}
          owned={ownedFrameIds} selected={avatarFrame} onSelect={setAvatarFrame}
        />
        <FrameSection
          title="إطارات اسمي" kind="name"
          frames={NAME_FRAMES}
          owned={ownedFrameIds} selected={nameFrame} onSelect={setNameFrame}
        />
        <FrameSection
          title="إطارات فقاعة الشات" kind="bubble"
          frames={BUBBLE_FRAMES}
          owned={ownedFrameIds} selected={bubbleFrame} onSelect={setBubbleFrame}
        />
        <FrameSection
          title="إطارات بطاقة البروفايل" kind="profile"
          frames={PROFILE_FRAMES}
          owned={ownedFrameIds} selected={profileFrame} onSelect={setProfileFrame}
        />

        <Link to="/cosmetics" className="block text-center rounded-2xl px-4 py-3 bg-gradient-to-b from-fuchsia-500 to-rose-700 border-2 border-fuchsia-200 text-white font-bold shadow-lg active:scale-95">
          ✨ متجر الإطارات والتخصيص
        </Link>

        <Link to="/my-vip" className="block text-center rounded-2xl px-4 py-3 bg-gradient-to-b from-yellow-400 via-amber-500 to-yellow-700 border-2 border-amber-200 text-amber-950 font-black shadow-[0_0_25px_rgba(251,191,36,0.5)] active:scale-95">
          👑 اشتراكي Elite VIP — المدة المتبقية
        </Link>

        <Link to="/recharge" className="block text-center rounded-2xl px-4 py-3 bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 font-extrabold shadow-lg active:scale-95">
          💳 شحن جواهر وياقوت
        </Link>

        <Link to="/invite" className="block text-center rounded-2xl px-4 py-3 bg-gradient-to-b from-emerald-500 to-emerald-800 border-2 border-emerald-300 text-white font-extrabold shadow-lg active:scale-95">
          🎁 ادعُ أصدقاءك — اربح 30% جواهر
        </Link>
      </main>

      {pop && (
        <div className="fixed left-1/2 top-20 -translate-x-1/2 z-50 text-base font-bold text-amber-200 text-glow pointer-events-none bg-stone-900/90 px-4 py-2 rounded-xl border border-amber-400/50 animate-float-up">
          {pop}
        </div>
      )}
    </div>
  );
}

function FrameSection({ title, kind, frames, owned, selected, onSelect }: {
  title: string; kind: FrameKind; frames: Frame[]; owned: Set<string>;
  selected: string | null; onSelect: (id: string | null) => void;
}) {
  return (
    <section className="rounded-2xl p-4 glass-hud border border-accent/30 space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-bold text-accent">{title}</label>
        <button onClick={() => onSelect(null)}
          className={`text-[10px] px-2 py-1 rounded ${selected === null ? "bg-amber-400/30 border border-amber-300 text-amber-200" : "text-muted-foreground"}`}>
          بدون إطار
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {frames.map(f => {
          const isOwned = owned.has(f.id);
          const isSel = selected === f.id;
          return (
            <button key={f.id}
              onClick={() => isOwned ? onSelect(f.id) : undefined}
              disabled={!isOwned}
              className={`relative rounded-xl p-2 border-2 min-h-[78px] flex items-center justify-center transition-all ${isSel ? "border-amber-300 bg-amber-400/20" : "border-border bg-secondary/40"} ${!isOwned ? "opacity-40" : "active:scale-95"}`}>
              {kind === "avatar" && (
                f.imageUrl ? (
                  <div className="relative w-14 h-14 flex items-center justify-center">
                    <div className="absolute w-9 h-9 rounded-full bg-stone-700 flex items-center justify-center text-base">👤</div>
                    <img src={f.imageUrl} alt="" className={`absolute inset-0 w-full h-full object-contain pointer-events-none ${f.animClass ?? ""}`} loading="lazy" />
                  </div>
                ) : (
                  <div className={`w-12 h-12 rounded-full bg-stone-700 flex items-center justify-center text-xl ${f.ring ?? ""}`}>👤</div>
                )
              )}
              {kind === "name" && (
                <div className={`inline-block px-2 py-1 rounded text-xs font-bold ${f.nameClass ?? ""}`}>Aa</div>
              )}
              {kind === "bubble" && (
                <div className={`inline-block px-2 py-1 rounded-2xl text-[11px] ${f.bubbleClass ?? ""}`}>مرحباً</div>
              )}
              {kind === "profile" && (
                <div className={`w-full ${f.profileClass ?? ""}`}>
                  <div className="bg-black/40 rounded p-1.5 flex items-center gap-1.5">
                    <div className="w-6 h-6 rounded-full bg-sky-700 text-[10px] flex items-center justify-center">🧙</div>
                    <div className="flex-1 h-1.5 bg-white/15 rounded-full" />
                  </div>
                </div>
              )}
              <div className="absolute bottom-0.5 inset-x-0 text-[9px] font-bold truncate text-center text-white/80 px-1">{f.name}</div>
              {!isOwned && <div className="absolute top-1 right-1 text-[10px]">🔒</div>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
