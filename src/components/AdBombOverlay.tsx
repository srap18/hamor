import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAdVideo } from "@/lib/ad-videos";

type AdBomb = {
  id: string;
  target_user_id: string;
  attacker_id: string;
  video_key: string;
  expires_at: string;
  active: boolean;
};

/**
 * Renders an ad-bomb video overlay above the harbor scene of `targetUserId`.
 * If `isOwner` is true, shows a "Remove for 100💎" button.
 */
export function AdBombOverlay({
  targetUserId,
  isOwner,
  onFlash,
}: {
  targetUserId: string | null;
  isOwner?: boolean;
  onFlash?: (msg: string) => void;
}) {
  const [bomb, setBomb] = useState<AdBomb | null>(null);
  const [now, setNow] = useState(Date.now());
  const [removing, setRemoving] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!targetUserId) return;
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase
        .from("ad_bombs" as never)
        .select("id,target_user_id,attacker_id,video_key,expires_at,active")
        .eq("target_user_id", targetUserId)
        .eq("active", true)
        .gt("expires_at", new Date().toISOString())
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setBomb((data as AdBomb | null) ?? null);
    };
    load();

    const ch = supabase
      .channel(`ad-bombs:${targetUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ad_bombs", filter: `target_user_id=eq.${targetUserId}` },
        () => load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [targetUserId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!bomb || dismissed) return null;
  const expiresMs = new Date(bomb.expires_at).getTime();
  if (expiresMs <= now) return null;

  const video = getAdVideo(bomb.video_key);
  if (!video) return null;

  const minsLeft = Math.max(0, Math.floor((expiresMs - now) / 60_000));
  const secsLeft = Math.max(0, Math.floor(((expiresMs - now) % 60_000) / 1000));

  const handleRemove = async () => {
    if (removing) return;
    if (!confirm("إزالة القنبلة الإعلانية مقابل 100 جوهرة؟")) return;
    setRemoving(true);
    const { error } = await (supabase as never as { rpc: (n: string) => Promise<{ error: { message: string } | null }> }).rpc("remove_ad_bombs");
    setRemoving(false);
    if (error) {
      const m = error.message || "";
      onFlash?.(m.includes("insufficient") ? "💎 جواهرك ما تكفي" : "تعذّر الإزالة");
      return;
    }
    setDismissed(true);
    onFlash?.("✅ تمت إزالة الإعلان");
  };

  return (
    <>
      {/* Video overlay — covers harbor scene, ignores pointer events except button */}
      <div className="absolute inset-0 pointer-events-none z-[55]">
        <video
          key={bomb.id}
          src={video.src}
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover opacity-80"
          style={{ mixBlendMode: "screen" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-fuchsia-900/20 via-transparent to-black/30" />
      </div>

      {/* Banner with countdown + remove button (owner only) */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[60] pointer-events-auto">
        <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-fuchsia-900/85 border border-fuchsia-400/60 backdrop-blur-sm shadow-lg">
          <span className="text-lg animate-pulse">📺</span>
          <div className="text-[11px] text-fuchsia-50 font-bold leading-tight">
            <div>قنبلة إعلانية!</div>
            <div className="text-[10px] opacity-80 tabular-nums">
              {minsLeft}د {String(secsLeft).padStart(2, "0")}ث
            </div>
          </div>
          {isOwner && (
            <button
              onClick={handleRemove}
              disabled={removing}
              className="ms-1 px-2 py-1 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 text-white text-[10px] font-extrabold active:scale-95 disabled:opacity-50"
            >
              إزالة 💎100
            </button>
          )}
        </div>
      </div>
    </>
  );
}
