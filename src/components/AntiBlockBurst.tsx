import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { sound } from "@/lib/sound";


// Dragon stage images (1..15)
import dragon1 from "@/assets/dragon-stage-1.png";
import dragon2 from "@/assets/dragon-stage-2.png";
import dragon3 from "@/assets/dragon-stage-3.png";
import dragon4 from "@/assets/dragon-stage-4.png";
import dragon5 from "@/assets/dragon-stage-5.png";
import dragon6 from "@/assets/dragon-stage-6.png";
import dragon7 from "@/assets/dragon-stage-7.png";
import dragon8 from "@/assets/dragon-stage-8.png";
import dragon9 from "@/assets/dragon-stage-9.png";
import dragon10 from "@/assets/dragon-stage-10.png";
import dragon11 from "@/assets/dragon-stage-11.png";
import dragon12 from "@/assets/dragon-stage-12.png";
import dragon13 from "@/assets/dragon-stage-13.png";
import dragon14 from "@/assets/dragon-stage-14.png";
import dragon15 from "@/assets/dragon-stage-15.png";

const DRAGON_IMAGES = [
  dragon1, dragon2, dragon3, dragon4, dragon5,
  dragon6, dragon7, dragon8, dragon9, dragon10,
  dragon11, dragon12, dragon13, dragon14, dragon15,
];

type Burst = {
  id: string;
  weapon: string;
  attacker: string;
  dragonStage: number | null;
  dragonLevel: number | null;
};

/**
 * Full-screen shield burst overlay shown on the defender's perimeter when one
 * of their anti-weapon defenses successfully blocks an incoming attack.
 *
 * If the defender has a Guardian Dragon, the dragon swoops in with a fiery
 * roar and physically "guards" the player — the higher its level, the more
 * dramatic the entrance.
 */
export function AntiBlockBurst({ defenderId }: { defenderId: string | null | undefined }) {
  const [burst, setBurst] = useState<Burst | null>(null);

  useEffect(() => {
    if (!defenderId) return;
    const seen = new Set<string>();

    const ch = supabase
      .channel(`anti-burst:${defenderId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "global_banners", filter: `target_id=eq.${defenderId}` },
        async (payload) => {
          const row = payload.new as {
            id: string; kind: string; target_id: string; attacker_name: string | null; message: string | null; created_at: string;
          };
          if (!row?.id || seen.has(row.id)) return;
          if (row.kind !== "anti_block") return;
          if (Date.now() - new Date(row.created_at).getTime() > 30_000) { seen.add(row.id); return; }
          seen.add(row.id);

          // Fetch defender's dragon stage + overall level (best-effort, non-blocking visual)
          let dragonStage: number | null = null;
          let dragonLevel: number | null = null;
          try {
            const [{ data: drg }, { data: lvl }] = await Promise.all([
              supabase.from("dragons").select("stage").eq("user_id", defenderId).maybeSingle(),
              supabase.rpc("dragon_overall_level", { _user_id: defenderId }),
            ]);
            if (drg?.stage) dragonStage = Math.max(1, Math.min(15, drg.stage));
            if (typeof lvl === "number") dragonLevel = lvl;
          } catch { /* noop */ }

          setBurst({
            id: row.id,
            weapon: row.message || "هجوم",
            attacker: row.attacker_name || "لاعب",
            dragonStage,
            dragonLevel,
          });
          try { sound.play("click"); } catch { /* noop */ }
          window.setTimeout(() => setBurst((b) => (b && b.id === row.id ? null : b)), 3000);
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(ch); };
  }, [defenderId]);

  if (!burst) return null;

  const dragonImg = burst.dragonStage ? DRAGON_IMAGES[burst.dragonStage - 1] : null;
  const isHighTier = (burst.dragonStage ?? 0) >= 10;
  // Show guardian dragon whenever the defender owns one (stage exists),
  // even if the overall-level RPC failed or returned 0/null.
  const hasGuardian = !!dragonImg;

  return (
    <div onClick={() => setBurst(null)} className="pointer-events-auto cursor-pointer fixed inset-0 z-[80] flex items-center justify-center overflow-hidden">
      {/* dark vignette */}
      <div className="absolute inset-0 z-0 bg-gradient-radial from-transparent via-black/30 to-black/70 animate-[fadeIn_0.25s_ease-out]" />

      {/* expanding shield ripples (behind dragon) */}
      <div className="absolute z-[1] h-72 w-72 rounded-full border-4 border-emerald-300/80 animate-[ping_1.2s_ease-out_2]" />
      <div className="absolute z-[1] h-48 w-48 rounded-full border-2 border-cyan-300/80 animate-[ping_1.5s_ease-out_2]" />
      <div className="absolute z-[1] h-32 w-32 rounded-full bg-emerald-400/20 blur-2xl animate-pulse" />

      {hasGuardian && (
        <>
          {/* fiery radial glow behind dragon */}
          <div
            className={`absolute z-[2] h-[28rem] w-[28rem] rounded-full blur-3xl animate-pulse ${
              isHighTier ? "bg-orange-500/40" : "bg-amber-400/25"
            }`}
          />
          {/* dragon roar particles (ember dots) — in front of shield, behind dragon */}
          {Array.from({ length: isHighTier ? 14 : 8 }).map((_, i) => (
            <span
              key={i}
              className="absolute z-[3] h-2 w-2 rounded-full bg-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.9)]"
              style={{
                left: `${50 + (Math.cos((i / 14) * Math.PI * 2) * 35)}%`,
                top: `${50 + (Math.sin((i / 14) * Math.PI * 2) * 35)}%`,
                animation: `ping ${1 + (i % 3) * 0.3}s ease-out infinite`,
                animationDelay: `${i * 0.08}s`,
              }}
            />
          ))}

          {/* dragon swoops in — ALWAYS in front of shield rings & block effect */}
          <img
            src={dragonImg!}
            alt="Guardian Dragon"
            className="relative z-[10] h-80 w-80 object-contain drop-shadow-[0_0_40px_rgba(251,146,60,0.95)] animate-[dragonSwoop_0.7s_cubic-bezier(0.34,1.56,0.64,1)_forwards]"
            style={{
              filter: isHighTier ? "drop-shadow(0 0 24px rgba(239,68,68,0.9))" : undefined,
            }}
          />
        </>
      )}

      {/* center plate with weapon + dragon level */}
      <div className="absolute z-[11] bottom-[18%] flex flex-col items-center gap-2 animate-[fadeIn_0.4s_ease-out_0.3s_both]">
        {!hasGuardian && (
          <div className="text-7xl drop-shadow-[0_0_18px_rgba(16,185,129,0.9)] animate-bounce">🛡️</div>
        )}
        <div className="rounded-xl border-2 border-emerald-400/70 bg-stone-950/90 px-5 py-2.5 text-center shadow-[0_0_28px_rgba(16,185,129,0.6)]">
          {hasGuardian && (
            <div className="text-orange-300 font-extrabold text-xs mb-1 animate-pulse">
              🐉 التنين الحارس · مستوى {burst.dragonLevel}
            </div>
          )}
          <div className="text-emerald-200 font-extrabold text-sm">صدّ {burst.weapon}!</div>
          <div className="text-emerald-100/80 text-[11px] mt-0.5">من {burst.attacker}</div>
        </div>
      </div>

      <style>{`
        @keyframes dragonSwoop {
          0% { transform: translateY(-120vh) scale(0.4) rotate(-15deg); opacity: 0; }
          60% { transform: translateY(20px) scale(1.15) rotate(5deg); opacity: 1; }
          80% { transform: translateY(-10px) scale(1.0) rotate(-2deg); }
          100% { transform: translateY(0) scale(1.05) rotate(0deg); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/**
 * Root-mounted version that subscribes to the currently signed-in user's
 * block events, so the dragon guardian effect always appears wherever the
 * user is in the app (not only on the profile page).
 */
export function SelfAntiBlockBurst() {
  const { user } = useAuth();
  return <AntiBlockBurst defenderId={user?.id ?? null} />;
}

/**
 * Attacker-side burst: shows the DEFENDER's guardian dragon rising in front
 * of the attacker when one of the attacker's own attacks is blocked by the
 * defender's anti-weapon. Subscribes to `notifications` where
 * `recipient_id = me` and `kind = 'anti_block_attacker'`.
 */
export function AttackerAntiBlockBurst() {
  const { user } = useAuth();
  const [burst, setBurst] = useState<Burst | null>(null);

  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    const seen = new Set<string>();

    const ch = supabase
      .channel(`anti-burst-attacker:${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${uid}` },
        async (payload) => {
          const row = (payload.new ?? payload.old) as {
            id: string; kind: string; recipient_id: string; created_by: string | null; created_at: string;
            title?: string | null; body?: string | null; meta?: Record<string, unknown> | null;
          } | null;
          if (!row?.id) return;
          if (row.kind !== "anti_block_attacker") return;
          // Only trigger on fresh events (INSERT or a bumped UPDATE)
          if (Date.now() - new Date(row.created_at).getTime() > 15_000) return;
          // De-dup within this session by (id + count) so a bump also shows the burst
          const meta = (row.meta || {}) as { defender_id?: string; count?: number; weapon_label?: string };
          const key = `${row.id}:${meta.count ?? 1}`;
          if (seen.has(key)) return;
          seen.add(key);

          const defenderId = meta.defender_id;
          if (!defenderId) return;

          let dragonStage: number | null = null;
          let dragonLevel: number | null = null;
          let defenderName = "الخصم";
          try {
            const [{ data: drg }, { data: lvl }, { data: prof }] = await Promise.all([
              supabase.from("dragons").select("stage").eq("user_id", defenderId).maybeSingle(),
              supabase.rpc("dragon_overall_level", { _user_id: defenderId }),
              supabase.from("profiles").select("display_name").eq("id", defenderId).maybeSingle(),
            ]);
            if (drg?.stage) dragonStage = Math.max(1, Math.min(15, drg.stage));
            if (typeof lvl === "number") dragonLevel = lvl;
            if (prof?.display_name) defenderName = prof.display_name;
          } catch { /* noop */ }

          setBurst({
            id: key,
            weapon: (meta.weapon_label as string) || "هجوم",
            attacker: defenderName, // shown as "من X" — here X is the defender who blocked
            dragonStage,
            dragonLevel,
          });
          try { sound.play("click"); } catch { /* noop */ }
          window.setTimeout(() => setBurst((b) => (b && b.id === key ? null : b)), 3000);
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(ch); };
  }, [user?.id]);

  if (!burst) return null;

  const dragonImg = burst.dragonStage ? DRAGON_IMAGES[burst.dragonStage - 1] : null;
  const isHighTier = (burst.dragonStage ?? 0) >= 10;
  const hasGuardian = !!dragonImg;

  return (
    <div onClick={() => setBurst(null)} className="pointer-events-auto cursor-pointer fixed inset-0 z-[80] flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 z-0 bg-gradient-radial from-transparent via-black/30 to-black/70 animate-[fadeIn_0.25s_ease-out]" />
      <div className="absolute z-[1] h-72 w-72 rounded-full border-4 border-rose-300/80 animate-[ping_1.2s_ease-out_2]" />
      <div className="absolute z-[1] h-48 w-48 rounded-full border-2 border-orange-300/80 animate-[ping_1.5s_ease-out_2]" />
      <div className="absolute z-[1] h-32 w-32 rounded-full bg-rose-400/20 blur-2xl animate-pulse" />

      {hasGuardian && (
        <>
          <div className={`absolute z-[2] h-[28rem] w-[28rem] rounded-full blur-3xl animate-pulse ${isHighTier ? "bg-red-600/40" : "bg-orange-500/25"}`} />
          <img
            src={dragonImg!}
            alt="Enemy Guardian Dragon"
            className="relative z-[10] h-80 w-80 object-contain drop-shadow-[0_0_40px_rgba(239,68,68,0.95)] animate-[dragonSwoopAtk_0.7s_cubic-bezier(0.34,1.56,0.64,1)_forwards]"
            style={{ filter: isHighTier ? "drop-shadow(0 0 24px rgba(239,68,68,0.95))" : undefined }}
          />
        </>
      )}

      <div className="absolute z-[11] bottom-[18%] flex flex-col items-center gap-2 animate-[fadeIn_0.4s_ease-out_0.3s_both]">
        {!hasGuardian && (
          <div className="text-7xl drop-shadow-[0_0_18px_rgba(239,68,68,0.9)] animate-bounce">🛡️</div>
        )}
        <div className="rounded-xl border-2 border-rose-400/70 bg-stone-950/90 px-5 py-2.5 text-center shadow-[0_0_28px_rgba(239,68,68,0.6)]">
          {hasGuardian && (
            <div className="text-orange-300 font-extrabold text-xs mb-1 animate-pulse">
              🐉 تنين الخصم الحارس {burst.dragonLevel ? `· مستوى ${burst.dragonLevel}` : ""}
            </div>
          )}
          <div className="text-rose-200 font-extrabold text-sm">صدّ {burst.weapon}!</div>
          <div className="text-rose-100/80 text-[11px] mt-0.5">مضاد {burst.attacker} أوقف هجومك</div>
        </div>
      </div>

      <style>{`
        @keyframes dragonSwoopAtk {
          0% { transform: translateY(120vh) scale(0.4) rotate(15deg); opacity: 0; }
          60% { transform: translateY(-20px) scale(1.15) rotate(-5deg); opacity: 1; }
          80% { transform: translateY(10px) scale(1.0) rotate(2deg); }
          100% { transform: translateY(0) scale(1.05) rotate(0deg); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

