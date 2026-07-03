import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { overallLevel, getStage, type Dragon } from "@/lib/dragon";
import { useDragonUnlocked } from "@/lib/dragon-access";
import { DragonEvolutionVideo } from "@/components/DragonEvolutionVideo";
import { RARITY_COLOR, RARITY_LABEL, SLOT_IMG, SLOT_LABEL, type Rarity, type Slot } from "@/lib/dragon-equipment";
import nestImg from "@/assets/dragon-nest-only.png";
import hatchVideo from "@/assets/dragon-hatch.mp4.asset.json";

type InspectInfo = {
  dragon: { stage: number; dp: number; total_boss_damage: number; pvp_wins: number; pvp_losses: number; name: string } | null;
  equipment: { slot: Slot; rarity: Rarity; name: string; stats: Record<string, number | boolean> }[];
  achievements_unlocked: number;
  achievements_total: number;
};

type Props = {
  /** If provided, show this user's dragon (read-only). Otherwise shows the current user's. */
  userId?: string;
  /** When false, disables the "coming soon" popup (e.g. visiting another player). */
  interactive?: boolean;
};

function KeyedWhiteVideo({
  src,
  className,
  style,
  loop = true,
  onEnded,
}: {
  src: string;
  className?: string;
  style?: CSSProperties;
  loop?: boolean;
  onEnded?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [canvasDisabled, setCanvasDisabled] = useState(false);

  useEffect(() => {
    if (canvasDisabled) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!video || !canvas || !ctx) return;

    let raf = 0;
    let cancelled = false;

    const draw = () => {
      if (cancelled) return;
      if (video.readyState >= 2) {
        const width = video.videoWidth || 512;
        const height = video.videoHeight || 512;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }

        try {
          ctx.drawImage(video, 0, 0, width, height);
          const frame = ctx.getImageData(0, 0, width, height);
          const pixels = frame.data;
          for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            // Remove green-screen background (dominant green pixels).
            if (g > 70 && g > r * 1.2 && g > b * 1.2) {
              pixels[i + 3] = 0;
            } else if (g > r && g > b) {
              // De-spill: dampen green tint on the subject's edges.
              pixels[i + 1] = Math.min(g, Math.round((r + b) / 2) + 12);
            }
          }
          ctx.putImageData(frame, 0, 0);
          setCanvasReady(true);
        } catch {
          cancelled = true;
          setCanvasDisabled(true);
          return;
        }
      }
      raf = requestAnimationFrame(draw);
    };

    video.play().catch(() => {});
    raf = requestAnimationFrame(draw);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [src, canvasDisabled]);

  return (
    <span className={className} style={{ ...style, display: "block", position: "relative" }}>
      <video
        ref={videoRef}
        src={src}
        autoPlay
        loop={loop}
        muted
        playsInline
        onEnded={onEnded}
        onError={() => setCanvasDisabled(true)}
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ objectFit: "contain", objectPosition: "center", opacity: canvasDisabled ? 1 : canvasReady ? 0 : 0 }}
      />
      {!canvasDisabled && (
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ objectFit: "contain", objectPosition: "center", opacity: canvasReady ? 1 : 0 }}
          aria-hidden
        />
      )}
    </span>
  );
}

const HATCH_KEY = (uid: string) => `dragon-hatched-v1:${uid}`;
const CACHE_KEY = (uid: string) => `dragon-cache-v1:${uid}`;

function readCachedDragon(uid: string | undefined): { stage: number; dp: number } | null {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.stage === "number" && typeof parsed?.dp === "number") return parsed;
  } catch {}
  return null;
}

export function DragonShoreCreature({ userId, interactive = true }: Props = {}) {
  // Hydrate instantly from cached dragon data so refreshes don't flicker
  // back to "egg" before the DB query resolves.
  const initialCache = typeof window !== "undefined" ? readCachedDragon(userId) : null;
  const [stage, setStage] = useState<number>(initialCache?.stage ?? 1);
  const [dp, setDp] = useState<number>(initialCache?.dp ?? 0);
  const [uid, setUid] = useState<string | null>(userId ?? null);
  const [hatched, setHatched] = useState<boolean>(() => {
    if (typeof window === "undefined" || !userId) return false;
    try { return localStorage.getItem(HATCH_KEY(userId)) === "1"; } catch { return false; }
  });
  const [playingHatch, setPlayingHatch] = useState(false);

  useEffect(() => {
    let alive = true;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const load = async () => {
      let u = userId;
      if (!u) {
        const { data: au } = await supabase.auth.getUser();
        u = au.user?.id;
      }
      if (!u) return;
      if (alive) setUid(u);
      const cached = readCachedDragon(u);
      if (alive && cached) {
        setStage(cached.stage);
        setDp(cached.dp);
      }
      if (alive) {
        try {
          setHatched(localStorage.getItem(HATCH_KEY(u)) === "1");
        } catch {}
      }
      const { data } = await supabase.from("dragons").select("stage, dp").eq("user_id", u).maybeSingle();
      if (alive && data) {
        const nextStage = data.stage ?? 1;
        const nextDp = typeof data.dp === "number" ? data.dp : 0;
        setStage(nextStage);
        setDp(nextDp);
        try { localStorage.setItem(CACHE_KEY(u), JSON.stringify({ stage: nextStage, dp: nextDp })); } catch {}
      }

      // Subscribe to realtime row changes so /dragon edits show on the shore instantly.
      if (!channel && alive && u) {
        const userKey = u;
        channel = supabase
          .channel(`dragon-shore-${userKey}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "dragons", filter: `user_id=eq.${userKey}` },
            (payload) => {
              const row = (payload.new ?? payload.old) as { stage?: number; dp?: number } | null;
              if (!row || !alive) return;
              const nextStage = row.stage ?? 1;
              const nextDp = typeof row.dp === "number" ? row.dp : 0;
              setStage(nextStage);
              setDp(nextDp);
              try { localStorage.setItem(CACHE_KEY(userKey), JSON.stringify({ stage: nextStage, dp: nextDp })); } catch {}
            },
          )
          .subscribe();
      }
    };
    load();
    // Light poll so in-app SPA navigation (e.g. back from /dragon) refreshes quickly.
    pollTimer = setInterval(() => { if (!document.hidden) load(); }, 30000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      if (pollTimer) clearInterval(pollTimer);
      if (channel) supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", load);
    };
  }, [userId]);

  // Real overall level 1..150 — this is the visible level shown to the player.
  const realLevel = Math.max(1, overallLevel({ stage, dp } as Dragon));

  // Hatch as soon as the player reaches overall level 3, even if the DB stage
  // is still 1 (DB stage only bumps when DP crosses each form threshold).
  const hatchedByLevel = realLevel >= 3;

  // Auto-hatch flag: persist once the dragon has visibly hatched in the ocean.
  useEffect(() => {
    if (hatchedByLevel && !hatched && uid) {
      try { localStorage.setItem(HATCH_KEY(uid), "1"); } catch {}
      setHatched(true);
    }
  }, [hatchedByLevel, hatched, uid]);

  const canHatch = false; // hatching is automatic — no manual tap required
  const showEgg = !hatchedByLevel;

  // While the egg hasn't hatched yet, clamp the displayed clip to 1-2 (egg).
  const displayLevel = showEgg ? Math.min(2, realLevel) : realLevel;
  const stageMode = showEgg ? "egg" : "adult";



  const navigate = useNavigate();
  const unlocked = useDragonUnlocked();

  // Inspect modal for visitors (non-interactive mode on someone else's profile)
  const [inspectOpen, setInspectOpen] = useState(false);
  const [inspectInfo, setInspectInfo] = useState<InspectInfo | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);

  const openInspect = async () => {
    if (!userId) return;
    setInspectOpen(true);
    if (inspectInfo) return;
    setInspectLoading(true);
    try {
      const { data } = await (supabase as never as {
        rpc: (n: string, p: Record<string, string>) => Promise<{ data: InspectInfo | null }>;
      }).rpc("get_player_dragon_public_info", { _uid: userId });
      if (data) setInspectInfo(data);
    } finally {
      setInspectLoading(false);
    }
  };

  const handleTap = () => {
    if (!interactive) {
      // Visitor mode: show inspection popup (weapons + level + achievements).
      if (userId) openInspect();
      return;
    }
    if (canHatch) {
      setPlayingHatch(true);
      return;
    }
    if (unlocked) {
      navigate({ to: "/dragon" });
    }
  };

  const finishHatch = () => {
    setPlayingHatch(false);
    if (uid) {
      try { localStorage.setItem(HATCH_KEY(uid), "1"); } catch {}
      setHatched(true);
    }
  };

  return (
    <>
      {/* SVG filter — turns near-white pixels in the video into transparent alpha
          while keeping the dragon's colors fully opaque. */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id="dsc-key-white" colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      -8 -8 -8 0 22.5"
            />
          </filter>
        </defs>
      </svg>
      <style>{`
        @keyframes dsc-rock { 0%,100%{transform:rotate(-3deg)} 50%{transform:rotate(3deg)} }
        @keyframes dsc-breathe { 0%,100%{transform:translateY(0) scale(1)} 50%{transform:translateY(-1.6%) scale(1.018)} }
        @keyframes dsc-shadow { 0%,100%{transform:scaleX(1);opacity:.76} 50%{transform:scaleX(.94);opacity:.6} }
        @keyframes dsc-hatch-pulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 0 rgba(251,191,36,0.7), 0 0 24px rgba(251,146,60,0.6); }
          50%      { transform: translate(-50%, -50%) scale(1.08); box-shadow: 0 0 0 14px rgba(251,191,36,0), 0 0 36px rgba(251,146,60,0.9); }
        }
      `}</style>
      <div
        className="absolute z-20"
        style={{
          left: "6%",
          bottom: "6%",
          width: "54%",
          maxWidth: "360px",
          aspectRatio: "1 / 1",
          pointerEvents: "none",
        }}
      >
        <span
          className="absolute pointer-events-none"
          style={{
            left: "-6%",
            right: "6%",
            bottom: "-2%",
            height: "14%",
            background:
              "radial-gradient(ellipse at 55% 50%, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.32) 48%, rgba(0,0,0,0) 84%)",
            filter: "blur(10px)",
            transform: "skewX(-14deg)",
          }}
        />

        <img
          src={nestImg}
          alt=""
          draggable={false}
          className="absolute pointer-events-none"
          style={{
            left: "-20%",
            right: "20%",
            bottom: "0%",
            width: "100%",
            height: "78%",
            objectFit: "contain",
            objectPosition: "bottom center",
            filter: "drop-shadow(0 10px 16px rgba(0,0,0,0.6))",
            zIndex: 1,
          }}
        />

        <button
          type="button"
          onClick={(e) => {
            // Only accept taps on the dragon's opaque pixels so the empty area
            // around it (which covers a big chunk of the shore) doesn't trigger.
            const btn = e.currentTarget as HTMLElement;
            const canvas = btn.querySelector("canvas") as HTMLCanvasElement | null;
            if (canvas && canvas.width > 0 && canvas.height > 0) {
              const rect = canvas.getBoundingClientRect();
              // The canvas uses object-fit: contain, so the visible pixels are
              // letterboxed inside the element. Map click coords into the
              // intrinsic pixel space accounting for that centering.
              const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
              const contentW = canvas.width * scale;
              const contentH = canvas.height * scale;
              const offsetX = (rect.width - contentW) / 2;
              const offsetY = (rect.height - contentH) / 2;
              const localX = e.clientX - rect.left - offsetX;
              const localY = e.clientY - rect.top - offsetY;
              if (localX < 0 || localY < 0 || localX >= contentW || localY >= contentH) return;
              const x = localX / scale;
              const y = localY / scale;
              try {
                const ctx = canvas.getContext("2d", { willReadFrequently: true });
                const alpha = ctx?.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3] ?? 0;
                if (alpha < 64) return;
              } catch {
                return;
              }
            } else {
              // Canvas not ready yet — ignore the tap rather than opening on empty space.
              return;
            }
            handleTap();
          }}
          aria-label={canHatch ? "اضغط لفقس التنين" : stageMode === "egg" ? "بيضة التنين" : "تنيني"}
          className="absolute bg-transparent border-0 p-0 active:scale-95 transition-transform"
          style={{
            left: "30%",
            bottom: "21%",
            width: showEgg ? "48%" : `${66 * Math.pow(1.05, Math.max(0, stage - 3))}%`,
            height: showEgg ? "48%" : `${66 * Math.pow(1.05, Math.max(0, stage - 3))}%`,
            transform: "translateX(-50%)",
            zIndex: 2,
            pointerEvents: "auto",
          }}
        >
          <div
            className="relative h-full w-full"
            style={{
              animation:
                stageMode === "egg"
                  ? "dsc-rock 2.8s ease-in-out infinite"
                  : stageMode === "adult"
                    ? "dsc-breathe 4s ease-in-out infinite"
                    : undefined,
              transformOrigin: "50% 95%",
            }}
          >
            <div
              className="absolute inset-0 h-full w-full"
              style={{
                filter:
                  "drop-shadow(0 6px 10px rgba(0,0,0,0.58)) drop-shadow(0 18px 28px rgba(0,0,0,0.36)) saturate(1.05) contrast(1.05)",
              }}
            >
              <DragonEvolutionVideo
                stage={showEgg ? Math.min(2, stage) : stage}
                className="absolute inset-0 h-full w-full"
                style={{ objectFit: "contain", objectPosition: "bottom center" }}
              />
            </div>

            {canHatch && (
              <span
                aria-hidden
                className="absolute pointer-events-none"
                style={{
                  left: "50%",
                  top: "50%",
                  width: "56%",
                  height: "56%",
                  borderRadius: "9999px",
                  background:
                    "radial-gradient(circle, rgba(251,191,36,0.55) 0%, rgba(251,146,60,0.25) 55%, rgba(251,146,60,0) 75%)",
                  animation: "dsc-hatch-pulse 1.6s ease-in-out infinite",
                }}
              />
            )}
          </div>
        </button>

        {canHatch && (
          <div
            className="absolute pointer-events-none text-center"
            style={{
              left: "50%",
              bottom: "60%",
              transform: "translateX(-50%)",
              zIndex: 3,
            }}
          >
            <div
              className="rounded-full bg-gradient-to-r from-amber-500 to-orange-600 px-3 py-1 text-xs font-black text-white shadow-lg"
              style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
            >
              اضغط للفقس!
            </div>
          </div>
        )}
      </div>

      {playingHatch && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          onClick={finishHatch}
          dir="rtl"
          style={{ pointerEvents: "auto" }}
        >
          <div className="absolute inset-0 bg-black/70" />
          <KeyedWhiteVideo
            src={hatchVideo.url}
            loop={false}
            onEnded={finishHatch}
            className="relative h-screen w-screen"
          />
          <button
            type="button"
            onClick={finishHatch}
            className="absolute top-4 right-4 z-10 rounded-full bg-black/60 px-4 py-2 text-sm font-bold text-white"
          >
            تخطي
          </button>
        </div>
      )}

      {inspectOpen && (
        <div
          className="fixed inset-0 z-[2147483600] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          dir="rtl"
          onClick={() => setInspectOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border-2 border-amber-400/70 bg-gradient-to-b from-stone-900 to-stone-950 p-4 shadow-[0_0_60px_rgba(251,191,36,0.5)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-extrabold text-amber-200">🐉 معلومات التنين</h2>
              <button
                onClick={() => setInspectOpen(false)}
                className="rounded-full bg-stone-800 px-2 py-0.5 text-xs text-stone-300"
              >
                ✕
              </button>
            </div>

            {inspectLoading && !inspectInfo && (
              <div className="text-center text-stone-400 text-sm py-6">جاري التحميل…</div>
            )}

            {inspectInfo && (() => {
              const d = inspectInfo.dragon;
              const lvl = d ? overallLevel(d as Dragon) : 0;
              const stageName = d ? getStage(d.stage).name : "—";
              return (
                <div className="space-y-3">
                  <div className="rounded-xl bg-stone-800/70 border border-stone-700 px-3 py-2 flex items-center justify-between">
                    <div>
                      <div className="text-[11px] text-stone-400">الطور</div>
                      <div className="text-sm font-extrabold text-amber-200">{stageName}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-stone-400">المستوى</div>
                      <div className="text-lg font-extrabold text-amber-300">{lvl}/150</div>
                    </div>
                  </div>

                  <div>
                    <div className="text-[12px] font-bold text-stone-300 mb-1.5">🗡️ العدّة الملبوسة</div>
                    {inspectInfo.equipment.length === 0 ? (
                      <div className="rounded-xl bg-stone-800/40 border border-dashed border-stone-700 px-3 py-3 text-center text-[12px] text-stone-500">
                        لا يلبس أي عدّة
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {(["weapon","armor","talisman"] as Slot[]).map((slot) => {
                          const it = inspectInfo.equipment.find((e) => e.slot === slot);
                          if (!it) {
                            return (
                              <div key={slot} className="rounded-xl border border-dashed border-stone-700 bg-stone-900/40 px-2 py-2 text-center">
                                <div className="text-2xl opacity-30">∅</div>
                                <div className="text-[10px] text-stone-500 mt-1">{SLOT_LABEL[slot]}</div>
                              </div>
                            );
                          }
                          const c = RARITY_COLOR[it.rarity];
                          return (
                            <div
                              key={slot}
                              className={`rounded-xl border-2 ${c.ring} bg-gradient-to-b ${c.bg} px-2 py-2 text-center`}
                              style={{ boxShadow: `0 0 14px ${c.glow}` }}
                            >
                              <img src={SLOT_IMG[slot]} alt="" className="w-9 h-9 mx-auto object-contain" />
                              <div className={`text-[10px] font-bold mt-1 ${c.text}`}>{RARITY_LABEL[it.rarity]}</div>
                              <div className="text-[10px] text-stone-300 truncate">{SLOT_LABEL[slot]}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-stone-800/70 border border-stone-700 px-3 py-2">
                      <div className="text-[11px] text-stone-400">🏆 الإنجازات</div>
                      <div className="text-sm font-extrabold text-emerald-300">
                        {inspectInfo.achievements_unlocked} / {inspectInfo.achievements_total}
                      </div>
                    </div>
                    <div className="rounded-xl bg-stone-800/70 border border-stone-700 px-3 py-2">
                      <div className="text-[11px] text-stone-400">⚔️ ضرر البوس</div>
                      <div className="text-sm font-extrabold text-rose-300">
                        {(d?.total_boss_damage ?? 0).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </>

  );
}
