import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAdVideo } from "@/lib/ad-videos";
import { sound } from "@/lib/sound";
import { serverNow, serverNowMs } from "@/lib/server-time";
import { useServerTick } from "@/lib/use-server-tick";
import nukeReal from "@/assets/fx/nuke-real.png";
import { ReportMessageButton } from "@/components/ReportMessageButton";
import { DraggableActionButton } from "@/components/DraggableActionButton";


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
  global = false,
}: {
  targetUserId?: string | null;
  isOwner?: boolean;
  onFlash?: (msg: string) => void;
  /** When true, show the latest active ad-bomb anywhere in the game (broadcast). */
  global?: boolean;
}) {
  const [bomb, setBomb] = useState<AdBomb | null>(null);
  const [attackerName, setAttackerName] = useState<string>("");
  const [targetName, setTargetName] = useState<string>("");
  const [meId, setMeId] = useState<string | null>(null);
  const now = useServerTick();
  const [removing, setRemoving] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [phase, setPhase] = useState<"explosion" | "video">("video");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const unmuteCleanupRef = useRef<(() => void) | null>(null);
  const lastBombId = useRef<string | null>(null);

  // Track current user (for owner detection in global mode)
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null));
  }, []);

  // Look up attacker + target display names once per bomb
  useEffect(() => {
    if (!bomb) { setAttackerName(""); setTargetName(""); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id,display_name")
        .in("id", [bomb.attacker_id, bomb.target_user_id]);
      if (cancelled) return;
      const rows = (data as { id: string; display_name?: string }[] | null) ?? [];
      const byId = Object.fromEntries(rows.map((r) => [r.id, r.display_name ?? "لاعب"]));
      setAttackerName(byId[bomb.attacker_id] ?? "لاعب");
      setTargetName(byId[bomb.target_user_id] ?? "لاعب");
    })();
    return () => { cancelled = true; };
  }, [bomb?.attacker_id, bomb?.target_user_id]);

  useEffect(() => {
    if (!global && !targetUserId) return;
    let cancelled = false;

    const load = async () => {
      let q = supabase
        .from("ad_bombs" as never)
        .select("id,target_user_id,attacker_id,video_key,started_at,expires_at,active")
        .eq("active", true)
        .gt("expires_at", serverNow().toISOString())
        .order("started_at", { ascending: false })
        .limit(1);
      if (!global && targetUserId) q = q.eq("target_user_id", targetUserId);
      const { data } = await q.maybeSingle();
      if (!cancelled) setBomb((data as AdBomb | null) ?? null);
    };
    load();
    // Poll briefly as a safety net in case Realtime is delayed.
    const poll = setInterval(() => { if (!document.hidden) load(); }, 30000);

    const channelName = global ? "ad-bombs:global" : `ad-bombs:${targetUserId}`;
    const filter = global ? undefined : `target_user_id=eq.${targetUserId}`;
    const ch = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ad_bombs", ...(filter ? { filter } : {}) },
        () => load(),
      )
      .subscribe();

    // Instant local trigger: when this device just launched a bomb, reload
    // immediately instead of waiting for Realtime to round-trip.
    const onLocal = () => load();
    window.addEventListener("ad-bomb:created", onLocal);

    return () => {
      cancelled = true;
      clearInterval(poll);
      window.removeEventListener("ad-bomb:created", onLocal);
      supabase.removeChannel(ch);
    };
  }, [targetUserId, global]);


  // (1-second tick comes from shared `useServerTick` above.)

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

  // Always start the video muted (so autoplay never gets blocked and the
  // frames are visible), then try to unmute. If the browser still blocks
  // unmuted audio, the next user gesture unlocks sound — without remounting
  // the <video> element.
  useEffect(() => {
    if (!isActive) return;
    const v = videoRef.current;
    if (!v) return;

    unmuteCleanupRef.current?.();

    v.muted = true;
    v.volume = 1;
    void v.play().catch(() => {});

    const tryUnmute = () => {
      v.muted = false;
      const p = v.play();
      const handle = (ok: boolean) => {
        if (ok) {
          setIsMuted(false);
          unmuteCleanupRef.current?.();
        } else {
          v.muted = true;
          void v.play().catch(() => {});
        }
      };
      if (p && typeof p.then === "function") {
        p.then(() => handle(true)).catch(() => handle(false));
      } else {
        handle(true);
      }
    };

    tryUnmute();

    const onGesture = () => tryUnmute();
    const cleanup = () => {
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("touchstart", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
      window.removeEventListener("click", onGesture, true);
    };
    unmuteCleanupRef.current = cleanup;
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("touchstart", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
    window.addEventListener("click", onGesture, true);

    return () => {
      unmuteCleanupRef.current?.();
      unmuteCleanupRef.current = null;
    };
  }, [isActive, bomb?.id]);

  if (!isActive || !bomb) return null;

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
      {/* Video is ALWAYS mounted while the bomb is active so it starts playing
          immediately and never gets unmounted/remounted when the explosion FX
          appears on top. Previously the explosion phase unmounted the <video>
          element for 700ms, causing the video to fail to (re)start on mobile
          browsers — user would hear the audio but never see the frames. */}
      <div className="fixed inset-0 z-30 pointer-events-none">
        <video
          ref={videoRef}
          key={bomb.id}
          src={video.src}
          autoPlay
          loop
          muted={isMuted}
          playsInline
          preload="auto"
          onEnded={() => {
            const v = videoRef.current;
            if (!v) return;
            try {
              v.currentTime = 0;
              void v.play().catch(() => {});
            } catch { /* noop */ }
          }}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity: 0.78 }}
        />
        <div className="absolute inset-0 bg-fuchsia-900/5" />
      </div>

      {phase === "explosion" && (
        /* Realistic 3D explosion — sits ABOVE the video briefly */
        <div className="fixed inset-0 z-[31] pointer-events-none overflow-hidden">
          <div
            className="absolute inset-0 animate-flash-bang"
            style={{
              background:
                "radial-gradient(circle at 50% 55%, rgba(255,245,210,0.95) 0%, rgba(255,160,60,0.5) 22%, rgba(0,0,0,0.55) 70%)",
              mixBlendMode: "screen",
            }}
          />
          <img
            src={nukeReal}
            alt=""
            aria-hidden
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[55%] animate-explosion-real-nuke select-none"
            style={{
              width: "min(110vw, 110vh)",
              height: "min(110vw, 110vh)",
              objectFit: "contain",
              filter: "drop-shadow(0 20px 40px rgba(0,0,0,0.7))",
            }}
          />
        </div>
      )}


      {/* Countdown + remove button (owner) — moved down so the top header stays clear */}
      <div className="fixed top-32 left-1/2 -translate-x-1/2 z-[45] pointer-events-auto">
        <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-fuchsia-900/90 border border-fuchsia-400/60 backdrop-blur-sm shadow-lg">
          <span className="text-lg animate-pulse">📺</span>
          <div className="text-[11px] text-fuchsia-50 font-bold leading-tight">
            <div>📺 قنبلة إعلانية من {attackerName || "لاعب"}{targetName ? ` على ${targetName}` : ""}</div>
            <div className="text-[10px] opacity-80 tabular-nums">
              متبقي {minsLeft}د {String(secsLeft).padStart(2, "0")}ث
            </div>
          </div>
          {(isOwner || (!!meId && !!bomb && meId === bomb.target_user_id)) && (
            <button
              onClick={handleRemove}
              disabled={removing}
              className="ms-1 px-2 py-1 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 text-white text-[10px] font-extrabold active:scale-95 disabled:opacity-50"
            >
              إزالة 💎100
            </button>
          )}
          {!!meId && meId !== bomb.attacker_id && (
            <ReportMessageButton
              reportedUserId={bomb.attacker_id}
              kind="ad_bomb"
              messageBody={`قنبلة إعلانية من ${attackerName || "لاعب"} على ${targetName || "لاعب"} (${bomb.video_key})`}
              sourceId={bomb.id}
            />
          )}
        </div>
      </div>


    </>
  );
}
