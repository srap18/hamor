import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ALL_FRAMES, AVATAR_FRAMES, NAME_FRAMES, frameById, type Frame } from "@/lib/frames";

export const Route = createFileRoute("/profile")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ملفي الشخصي — Ocean Catch" },
      { name: "description", content: "غيّر اسمك وصورتك وإطاراتك" },
    ],
  }),
  component: ProfilePage,
});

const EMOJIS = ["🧙","🧑‍✈️","👨‍🚀","👩‍🚀","🧜‍♂️","🧜‍♀️","🦸","🦸‍♀️","🥷","🧛","👨‍🎤","👩‍🎤","🦹","🤴","👸"];

function ProfilePage() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState("🧙");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarFrame, setAvatarFrame] = useState<string | null>(null);
  const [nameFrame, setNameFrame] = useState<string | null>(null);
  const [ownedFrameIds, setOwnedFrameIds] = useState<Set<string>>(new Set());
  const [pop, setPop] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (m: string) => { setPop(m); setTimeout(() => setPop(null), 1800); };

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { nav({ to: "/login" }); return; }
      setUserId(u.user.id);
      const [{ data: p }, { data: inv }] = await Promise.all([
        supabase.from("profiles").select("display_name,avatar_emoji,avatar_url,avatar_frame,name_frame").eq("id", u.user.id).maybeSingle(),
        supabase.from("inventory").select("item_id").eq("user_id", u.user.id).eq("item_type", "frame"),
      ]);
      if (p) {
        setDisplayName(p.display_name ?? "");
        setAvatarEmoji(p.avatar_emoji ?? "🧙");
        setAvatarUrl(p.avatar_url ?? null);
        setAvatarFrame(p.avatar_frame ?? null);
        setNameFrame(p.name_frame ?? null);
      }
      setOwnedFrameIds(new Set((inv ?? []).map(r => r.item_id)));
      setLoading(false);
    })();
  }, [nav]);

  const onUpload = async (file: File) => {
    if (!userId) return;
    if (file.size > 3 * 1024 * 1024) { flash("الصورة كبيرة (الحد 3 ميجا)"); return; }
    setSaving(true);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
    const path = `${userId}/avatar.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, cacheControl: "0" });
    if (error) { setSaving(false); flash("فشل الرفع"); return; }
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    const cacheBusted = `${pub.publicUrl}?t=${Date.now()}`;
    setAvatarUrl(cacheBusted);
    await supabase.from("profiles").update({ avatar_url: cacheBusted }).eq("id", userId);
    setSaving(false);
    flash("تم تحديث الصورة");
  };

  const save = async () => {
    if (!userId) return;
    if (displayName.trim().length < 2) { flash("الاسم قصير جداً"); return; }
    if (displayName.length > 24) { flash("الاسم طويل جداً"); return; }
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      display_name: displayName.trim(),
      avatar_emoji: avatarEmoji,
      avatar_frame: avatarFrame,
      name_frame: nameFrame,
    }).eq("id", userId);
    setSaving(false);
    if (error) { flash("فشل الحفظ"); return; }
    flash("تم الحفظ ✓");
  };

  const equippedAvatarFrame = frameById(avatarFrame);
  const equippedNameFrame = frameById(nameFrame);

  if (loading) {
    return <div className="fixed inset-0 flex items-center justify-center bg-stone-950 text-amber-200">جاري التحميل…</div>;
  }

  return (
    <div className="fixed inset-0 overflow-y-auto text-foreground" dir="rtl"
      style={{ background: "radial-gradient(ellipse at top, oklch(0.30 0.12 260) 0%, oklch(0.10 0.06 250) 100%)" }}>
      <header className="sticky top-0 z-20 glass-hud border-b border-accent/30 px-3 py-3 flex items-center gap-3">
        <Link to="/" className="w-10 h-10 rounded-xl glass-hud flex items-center justify-center text-lg active:scale-95">←</Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-glow flex items-center gap-2">👤 ملفي الشخصي</h1>
          <p className="text-[10px] text-muted-foreground">عدّل اسمك وصورتك وإطاراتك</p>
        </div>
        <button onClick={save} disabled={saving}
          className="px-4 py-2 rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200 text-white font-bold text-sm active:scale-95 disabled:opacity-50">
          {saving ? "..." : "حفظ"}
        </button>
      </header>

      <main className="p-3 pb-10 space-y-4">
        {/* Live preview */}
        <section className="rounded-2xl p-4 glass-hud border border-accent/40 flex items-center gap-4">
          <div className={`relative w-20 h-20 rounded-full overflow-hidden ${equippedAvatarFrame?.ring ?? "ring-2 ring-border"}`}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-secondary text-4xl">{avatarEmoji}</div>
            )}
          </div>
          <div className="flex-1">
            <div className={`inline-block px-3 py-1 rounded-md font-bold text-base ${equippedNameFrame?.nameClass ?? "bg-secondary/60 border border-border text-foreground"}`}>
              {displayName || "اسم اللاعب"}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">المعاينة المباشرة</div>
          </div>
        </section>

        {/* Name */}
        <section className="rounded-2xl p-4 glass-hud border border-accent/30 space-y-2">
          <label className="text-sm font-bold text-accent">الاسم الظاهر</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={24}
            className="w-full px-3 py-2.5 rounded-xl bg-secondary/70 border-2 border-border text-foreground text-base focus:border-accent outline-none"
            placeholder="اكتب اسمك"
          />
          <div className="text-[10px] text-muted-foreground">من 2 إلى 24 حرف</div>
        </section>

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
          <div className="text-xs text-muted-foreground">أو اختر شكل افتراضي:</div>
          <div className="flex flex-wrap gap-2">
            {EMOJIS.map(em => (
              <button key={em} onClick={() => setAvatarEmoji(em)}
                className={`w-11 h-11 rounded-xl text-2xl flex items-center justify-center border-2 transition-all active:scale-95 ${avatarEmoji === em ? "bg-amber-400/30 border-amber-300" : "bg-secondary/40 border-border"}`}>
                {em}
              </button>
            ))}
          </div>
        </section>

        {/* Owned avatar frames */}
        <FrameSection
          title="إطارات صورتي"
          frames={AVATAR_FRAMES}
          owned={ownedFrameIds}
          selected={avatarFrame}
          onSelect={setAvatarFrame}
        />

        {/* Owned name frames */}
        <FrameSection
          title="إطارات اسمي"
          frames={NAME_FRAMES}
          owned={ownedFrameIds}
          selected={nameFrame}
          onSelect={setNameFrame}
        />

        <Link to="/cosmetics" className="block text-center rounded-2xl px-4 py-3 bg-gradient-to-b from-fuchsia-500 to-rose-700 border-2 border-fuchsia-200 text-white font-bold shadow-lg active:scale-95">
          ✨ متجر الإطارات والتخصيص
        </Link>

        <Link to="/recharge" className="block text-center rounded-2xl px-4 py-3 bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 font-extrabold shadow-lg active:scale-95">
          💳 شحن جواهر وياقوت
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

function FrameSection({ title, frames, owned, selected, onSelect }: {
  title: string; frames: Frame[]; owned: Set<string>; selected: string | null; onSelect: (id: string | null) => void;
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
              className={`relative rounded-xl p-2 border-2 transition-all ${isSel ? "border-amber-300 bg-amber-400/20" : "border-border bg-secondary/40"} ${!isOwned ? "opacity-40" : "active:scale-95"}`}>
              {f.kind === "avatar" ? (
                <div className={`w-12 h-12 mx-auto rounded-full bg-stone-700 flex items-center justify-center text-xl ${f.ring}`}>👤</div>
              ) : (
                <div className={`inline-block px-2 py-1 rounded text-xs font-bold ${f.nameClass}`}>Aa</div>
              )}
              <div className="text-[10px] font-bold mt-1 truncate">{f.name}</div>
              {!isOwned && <div className="text-[9px] text-muted-foreground mt-0.5">🔒 غير مملوك</div>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
