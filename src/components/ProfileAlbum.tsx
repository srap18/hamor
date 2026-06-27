import { useEffect, useRef, useState } from "react";
import { useIsAdmin } from "@/hooks/use-admin";
import {
  listProfileMedia,
  deleteProfileMedia,
  uploadProfileMedia,
  extractVideoFrames,
  fileToBase64,
  ALBUM_LIMIT,
  VIDEO_MAX_MS,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  type ProfileMedia,
} from "@/lib/profile-media";

type Props = {
  userId: string;
  isOwner: boolean;
};

export default function ProfileAlbum({ userId, isOwner }: Props) {
  const [items, setItems] = useState<ProfileMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ProfileMedia | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProfileMedia | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { isAdmin } = useIsAdmin();

  const flash = (m: string) => { setStatus(m); window.setTimeout(() => setStatus(null), 2500); };

  const reload = async () => {
    setLoading(true);
    try {
      setItems(await listProfileMedia(userId));
    } catch {
      flash("فشل تحميل الألبوم");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [userId]);

  const onPick = () => fileRef.current?.click();

  const onFile = async (file: File) => {
    if (!isOwner) return;
    if (items.length >= ALBUM_LIMIT) { flash(`الحد الأقصى ${ALBUM_LIMIT} عنصر`); return; }
    const isImg = file.type.startsWith("image/");
    const isVid = file.type.startsWith("video/");
    if (!isImg && !isVid) { flash("نوع غير مدعوم"); return; }
    if (isImg && file.size > IMAGE_MAX_BYTES) { flash("الصورة كبيرة (5 ميجا حد أقصى)"); return; }
    if (isVid && file.size > VIDEO_MAX_BYTES) { flash("الفيديو كبير (25 ميجا حد أقصى)"); return; }

    setUploading(true);
    try {
      const { moderateImage, moderateFrames } = await import("@/lib/moderation.functions");
      if (isImg) {
        flash("جاري فحص الصورة...");
        const b64 = await fileToBase64(file);
        try {
          const verdict = await moderateImage({ data: { imageBase64: b64, mimeType: file.type || "image/jpeg" } });
          if (!verdict.safe) { flash("⚠️ الصورة مرفوضة: محتوى غير لائق"); return; }
        } catch (modErr: any) {
          // Fail-open if moderation can't run
          console.warn("[album image moderation skipped]", modErr?.message || modErr);
        }
        flash("جاري الرفع...");
        await uploadProfileMedia({ userId, file, mediaType: "image" });
      } else {
        flash("جاري تحليل الفيديو...");
        const { frames, duration, firstThumb } = await extractVideoFrames(file, 3);
        if (duration > VIDEO_MAX_MS + 500) {
          flash(`الفيديو لا يتجاوز ${VIDEO_MAX_MS / 1000} ثانية`);
          return;
        }
        flash("جاري فحص المحتوى...");
        try {
          const verdict = await moderateFrames({ data: { framesBase64: frames, mimeType: "image/jpeg" } });
          if (!verdict.safe) { flash("⚠️ الفيديو مرفوض: محتوى غير لائق"); return; }
        } catch (modErr: any) {
          console.warn("[album video moderation skipped]", modErr?.message || modErr);
        }
        flash("جاري الرفع...");
        await uploadProfileMedia({
          userId,
          file,
          mediaType: "video",
          durationMs: Math.round(duration),
          thumbBlob: firstThumb,
        });
      }

      flash("تمت الإضافة ✓");
      await reload();
    } catch (e: any) {
      console.error("[album upload]", e);
      const msg = String(e?.message || e || "");
      if (msg.includes("ALBUM_FULL") || msg.includes("ALBUM_LIMIT_EXCEEDED")) flash(`الألبوم ممتلئ (${ALBUM_LIMIT} عنصر)`);
      else if (msg.includes("VIDEO_TOO_LONG")) flash("الفيديو لا يتجاوز 30 ثانية");
      else if (msg.includes("MEDIA_BANNED")) flash("🚫 الإدارة منعتك من رفع الصور والمقاطع");
      else flash(`فشل الرفع: ${msg.slice(0, 80) || "خطأ غير معروف"}`);
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (item: ProfileMedia) => {
    try {
      await deleteProfileMedia(item);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      setConfirmDelete(null);
      setViewer(null);
      flash("تم الحذف");
    } catch {
      flash("فشل الحذف");
    }
  };

  return (
    <section className="rounded-2xl p-4 glass-hud border border-accent/30 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-accent">📷 الألبوم ({items.length}/{ALBUM_LIMIT})</div>
        {isOwner && (
          <button
            onClick={onPick}
            disabled={uploading || items.length >= ALBUM_LIMIT}
            className="px-3 py-1.5 rounded-lg bg-gradient-to-b from-fuchsia-400 to-rose-700 border border-fuchsia-200 text-white text-xs font-bold active:scale-95 disabled:opacity-50"
          >
            {uploading ? "..." : "+ إضافة"}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
        />
      </div>

      {status && <div className="text-[11px] text-amber-200">{status}</div>}

      {loading ? (
        <div className="text-xs text-muted-foreground py-4 text-center">جاري التحميل...</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">لا توجد عناصر في الألبوم بعد</div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {items.map((m) => {
            const thumb = m.signedThumb || m.signedUrl;
            return (
              <button
                key={m.id}
                onClick={() => setViewer(m)}
                className="relative aspect-square rounded-lg overflow-hidden bg-stone-800 border border-border active:scale-95"
              >
                {thumb && <img src={thumb} alt="" loading="lazy" className="w-full h-full object-cover" />}
                {m.media_type === "video" && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center text-white text-lg">▶</div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {viewer && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setViewer(null)}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setViewer(null); }}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white text-lg"
          >×</button>
          <div className="max-w-full max-h-full" onClick={(e) => e.stopPropagation()}>
            {viewer.media_type === "image" ? (
              <img src={viewer.signedUrl} alt="" className="max-w-full max-h-[80vh] object-contain rounded-lg" />
            ) : (
              <video src={viewer.signedUrl} controls autoPlay playsInline className="max-w-full max-h-[80vh] rounded-lg" />
            )}
            {viewer.caption && <div className="text-white text-sm mt-2 text-center">{viewer.caption}</div>}
            {(isOwner || isAdmin) && (
              <div className="mt-3 flex justify-center">
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(viewer); }}
                  className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-bold active:scale-95"
                >🗑️ حذف</button>
              </div>
            )}
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-[110] bg-black/80 flex items-center justify-center p-4" onClick={() => setConfirmDelete(null)}>
          <div className="bg-stone-900 border border-border rounded-2xl p-5 max-w-xs w-full" onClick={(e) => e.stopPropagation()}>
            <div className="text-foreground font-bold mb-2">حذف العنصر؟</div>
            <div className="text-xs text-muted-foreground mb-4">لا يمكن التراجع.</div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 px-3 py-2 rounded-lg bg-secondary text-foreground text-sm">إلغاء</button>
              <button onClick={() => onDelete(confirmDelete)} className="flex-1 px-3 py-2 rounded-lg bg-rose-600 text-white text-sm font-bold">حذف</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

