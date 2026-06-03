import { supabase } from "@/integrations/supabase/client";

export type ProfileMedia = {
  id: string;
  user_id: string;
  media_type: "image" | "video";
  media_url: string; // storage path
  thumbnail_url: string | null;
  duration_ms: number | null;
  caption: string;
  created_at: string;
  signedUrl?: string;
  signedThumb?: string;
};

export const ALBUM_LIMIT = 20;
export const VIDEO_MAX_MS = 30_000;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 25 * 1024 * 1024;

async function signMany(paths: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  if (!paths.length) return map;
  const { data } = await supabase.storage.from("profile-media").createSignedUrls(paths, 60 * 60 * 24 * 7);
  (data || []).forEach((d: any) => {
    if (d.path && d.signedUrl) map[d.path] = d.signedUrl;
  });
  return map;
}

export async function listProfileMedia(userId: string): Promise<ProfileMedia[]> {
  const { data, error } = await supabase
    .from("profile_media")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const list = (data || []) as ProfileMedia[];
  const allPaths = Array.from(new Set(list.flatMap((m) => [m.media_url, m.thumbnail_url].filter(Boolean) as string[])));
  const signed = await signMany(allPaths);
  return list.map((m) => ({
    ...m,
    signedUrl: signed[m.media_url],
    signedThumb: m.thumbnail_url ? signed[m.thumbnail_url] : undefined,
  }));
}

export async function deleteProfileMedia(item: ProfileMedia): Promise<void> {
  const paths = [item.media_url, item.thumbnail_url].filter(Boolean) as string[];
  await supabase.storage.from("profile-media").remove(paths);
  await supabase.from("profile_media").delete().eq("id", item.id);
}

export async function uploadProfileMedia(opts: {
  userId: string;
  file: File;
  mediaType: "image" | "video";
  durationMs?: number;
  thumbBlob?: Blob | null;
  caption?: string;
}): Promise<ProfileMedia> {
  const ext = (opts.file.name.split(".").pop() || (opts.mediaType === "image" ? "jpg" : "mp4")).toLowerCase();
  const base = `${opts.userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `${base}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("profile-media")
    .upload(path, opts.file, { upsert: false, cacheControl: "3600", contentType: opts.file.type });
  if (upErr) throw upErr;

  let thumbPath: string | null = null;
  if (opts.thumbBlob) {
    thumbPath = `${base}-thumb.jpg`;
    const { error: tErr } = await supabase.storage
      .from("profile-media")
      .upload(thumbPath, opts.thumbBlob, { upsert: false, cacheControl: "3600", contentType: "image/jpeg" });
    if (tErr) thumbPath = null;
  }

  const { data, error } = await supabase
    .from("profile_media")
    .insert({
      user_id: opts.userId,
      media_type: opts.mediaType,
      media_url: path,
      thumbnail_url: thumbPath,
      duration_ms: opts.durationMs ?? null,
      caption: (opts.caption || "").slice(0, 100),
    } as any)
    .select()
    .single();
  if (error) {
    // Rollback storage
    await supabase.storage.from("profile-media").remove([path, ...(thumbPath ? [thumbPath] : [])]);
    throw error;
  }
  return data as ProfileMedia;
}

// Extract N evenly-spaced frames from a video file. Returns base64 (no prefix).
export async function extractVideoFrames(file: File, count = 3): Promise<{ frames: string[]; duration: number; firstThumb: Blob | null }> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    await new Promise<void>((res, rej) => {
      video.onloadedmetadata = () => res();
      video.onerror = () => rej(new Error("video_load_error"));
    });
    const duration = video.duration || 0;
    const canvas = document.createElement("canvas");
    const w = Math.min(640, video.videoWidth || 640);
    const h = Math.round(w * ((video.videoHeight || 360) / (video.videoWidth || 640)));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    const frames: string[] = [];
    let firstThumb: Blob | null = null;
    for (let i = 0; i < count; i++) {
      const t = duration * ((i + 0.5) / count);
      await new Promise<void>((res, rej) => {
        const onSeek = () => { video.removeEventListener("seeked", onSeek); res(); };
        video.addEventListener("seeked", onSeek);
        video.currentTime = Math.min(Math.max(0.1, t), Math.max(0.1, duration - 0.1));
        setTimeout(() => { video.removeEventListener("seeked", onSeek); res(); }, 2000);
      });
      ctx.drawImage(video, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      frames.push(dataUrl.split(",")[1] || "");
      if (i === 0) {
        firstThumb = await new Promise<Blob | null>((r) => canvas.toBlob((b) => r(b), "image/jpeg", 0.7));
      }
    }
    return { frames, duration: duration * 1000, firstThumb };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
