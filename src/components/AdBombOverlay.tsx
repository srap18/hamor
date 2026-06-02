import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAdVideo } from "@/lib/ad-videos";
import { sound } from "@/lib/sound";
import { serverNow, serverNowMs } from "@/lib/server-time";

type AdBomb = {
  id: string;
  target_user_id: string;
  attacker_id: string;
  video_key: string;
  started_at: string;
  expires_at: string;
  active: boolean;
};

const EXPLOSION_MS = 700; // brief instant flash before the video loop starts

/**
 * Renders a fullscreen ad-bomb overlay for `targetUserId`.
 * Phase 1 — bomb explosion (CSS fireball + shockwave, ~2.2s).
 * Phase 2 — semi-transparent looping video for the rest of the hour.
 * - Sits below UI controls (back, chat, nav) so they stay tappable.
 * - Pauses background music while playing; restores on dismiss/expire.
 * - If `isOwner` is true, shows a "Remove for 100💎" button.
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
  const [attackerName, setAttackerName] = useState<string>("");
  const [now, setNow] = useState(serverNowMs());
  const [removing, setRemoving] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [phase, setPhase] = useState<"explosion" | "video">("video");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastBombId = useRef<string | null>(null);

  // Look up attacker display name once per bomb
  useEffect(() => {
    if (!bomb?.attacker_id) { setAttackerName(""); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", bomb.attacker_id)
        .maybeSingle();
      if (!cancelled) setAttackerName((data as { display_name?: string } | null)?.display_name ?? "لاعب");
    })();
    return () => { cancelled = true; };
  }, [bomb?.attacker_id]);

  useEffect(() => {
    if (!targetUserId) return;
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase
        .from("ad_bombs" as never)
        .select("id,target_user_id,attacker_id,video_key,started_at,expires_at,active")
        .eq("target_user_id", targetUserId)
        .eq("active", true)
        .gt("expires_at", serverNow().toISOString())
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
    const t = setInterval(() => setNow(serverNowMs()), 1000);
    return () => clearInterval(t);
  }, []);

  const expiresMs = bomb ? new Date(bomb.expires_at).getTime() : 0;
  const startedMs = bomb ? new Date(bomb.started_at).getTime() : 0;
  const isActive = !!bomb && !dismissed && expiresMs > now;

  // Trigger the bomb explosion phase whenever a *new* bomb appears.
  // (Late visitors who join after the explosion finished skip straight to the video.)
  useEffect(() => {
    if (!bomb || !isActive) return;
    if (lastBombId.current === bomb.id) return;
    lastBombId.current = bomb.id;
    const elapsed = serverNowMs() - startedMs;
    if (elapsed < EXPLOSION_MS) {
      setPhase("explosion");
      try { sound.play("nuke"); } catch { /* noop */ }
      const t = setTimeout(() => setPhase("video"), EXPLOSION_MS - elapsed);
      return () => clearTimeout(t);
    }
    setPhase("video");
  }, [bomb, isActive, startedMs]);

  // Pause background music while the ad is on screen.
  useEffect(() => {
    if (!isActive) return;
    sound.pauseForChat();
    return () => sound.resumeForChat();
  }, [isActive]);

  // Always autoplay muted first (browsers allow it). Then try to unmute —
  // if blocked, show a tap-to-unmute button so the video itself still shows.
  useEffect(() => {
    if (!isActive || phase !== "video") return;
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    setIsMuted(true);
    const p = v.play();
    const tryUnmute = () => {
      v.muted = false;
      v.volume = 1;
      const up = v.play();
      if (up && typeof up.catch === "function") {
        up.then(() => { setIsMuted(false); setNeedsTap(false); })
          .catch(() => { v.muted = true; setIsMuted(true); setNeedsTap(true); });
      }
    };
    if (p && typeof p.catch === "function") {
      p.then(() => { tryUnmute(); }).catch(() => { setNeedsTap(true); });
    } else {
      tryUnmute();
    }
  }, [isActive, phase, bomb?.id]);

  if (!isActive || !bomb) return null;

  const video = getAdVideo(bomb.video_key);
  if (!video) return null;

  const minsLeft = Math.max(0, Math.floor((expiresMs - now) / 60_000));
  const secsLeft = Math.max(0, Math.floor(((expiresMs - now) % 60_000) / 1000));

  const handleTap = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    v.volume = 1;
    v.play().then(() => { setIsMuted(false); setNeedsTap(false); }).catch(() => {});
  };

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
      {phase === "explosion" ? (
        /* Bomb explosion — fullscreen flash + nuke fireball + shockwaves */
        <div className="fixed inset-0 z-30 pointer-events-none overflow-hidden">
          <div className="absolute inset-0 bg-white animate-fireball-nuke" style={{ opacity: 0.85 }} />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="relative w-72 h-72">
              <div className="absolute inset-0 rounded-full bg-gradient-to-b from-yellow-200 via-orange-500 to-red-700 animate-fireball-nuke shadow-[0_0_120px_60px_rgba(255,140,0,0.9)]" />
              <div className="absolute inset-[15%] rounded-full bg-gradient-to-b from-white via-yellow-300 to-orange-500 animate-fireball-nuke" />
              <div className="absolute inset-0 rounded-full border-4 border-white/90 animate-shockwave-nuke" />
              <div className="absolute inset-0 rounded-full border-2 border-orange-300/70 animate-shockwave-nuke" style={{ animationDelay: "0.15s" }} />
              <div className="absolute inset-0 rounded-full border-2 border-yellow-200/60 animate-shockwave-nuke" style={{ animationDelay: "0.3s" }} />
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-7xl animate-pulse drop-shadow-[0_0_20px_rgba(255,0,0,0.9)]">📺💥</div>
            </div>
          </div>
        </div>
      ) : (
        /* Semi-transparent looping video — harbor stays partly visible behind it */
        <div className="fixed inset-0 z-30 pointer-events-none">
          <video
            ref={videoRef}
            key={bomb.id}
            src={video.src}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            className="absolute inset-0 h-full w-full object-cover"
            style={{ opacity: 0.55 }}
          />
          <div className="absolute inset-0 bg-fuchsia-900/10" />
        </div>
      )}

      {/* Countdown + remove button (owner) — above the video, below dialogs */}
      <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[45] pointer-events-auto">
        <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-fuchsia-900/90 border border-fuchsia-400/60 backdrop-blur-sm shadow-lg">
          <span className="text-lg animate-pulse">📺</span>
          <div className="text-[11px] text-fuchsia-50 font-bold leading-tight">
            <div>📺 قنبلة إعلانية من {attackerName || "لاعب"}</div>
            <div className="text-[10px] opacity-80 tabular-nums">
              متبقي {minsLeft}د {String(secsLeft).padStart(2, "0")}ث
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
