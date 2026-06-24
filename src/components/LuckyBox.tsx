import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Rarity = "common" | "rare" | "legendary";
type OpenResult = {
  ok: boolean;
  rarity: Rarity;
  label: string;
  icon: string;
  prize_type: string;
  amount: number;
  opens_count: number;
  gems_left: number;
};

const RARITY_STYLE: Record<Rarity, { ring: string; glow: string; text: string; emoji: string; ar: string }> = {
  common:    { ring: "#9ca3af", glow: "0 0 24px rgba(229,231,235,0.55)", text: "text-stone-100", emoji: "✨", ar: "عادية" },
  rare:      { ring: "#38bdf8", glow: "0 0 40px rgba(56,189,248,0.75)",  text: "text-sky-200",   emoji: "🔵", ar: "نادرة" },
  legendary: { ring: "#ef4444", glow: "0 0 70px rgba(239,68,68,0.9)",    text: "text-red-200",   emoji: "🔴🔥", ar: "نادرة جدًا" },
};

export function LuckyBoxButton({ onChanged }: { onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="صندوق الحظ"
        className="fixed z-30 flex flex-col items-center justify-center active:scale-95 rounded-lg"
        style={{
          left: "calc(env(safe-area-inset-left, 0px) + 8px)",
          top: "calc(env(safe-area-inset-top, 0px) + 130px)",
          width: 44,
          height: 50,
          color: "#2a1605",
          background: "radial-gradient(ellipse at 50% 0%, #fff3c0 0%, #f5c84a 30%, #c48a1a 70%, #5b2f06 100%)",
          border: "2px solid #ffe9a8",
          boxShadow:
            "inset 0 2px 0 rgba(255,243,200,0.85), inset 0 -2px 5px rgba(80,40,10,0.65), 0 3px 0 #3a1f0a, 0 4px 10px rgba(0,0,0,0.6), 0 0 16px rgba(255,200,80,0.55)",
        }}
      >
        <span
          className="pointer-events-none absolute inset-x-1 top-0.5 h-1/2 rounded-md opacity-60"
          style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.6) 0%, transparent 100%)" }}
        />
        <span className="relative text-xl animate-[lb-bob_2.4s_ease-in-out_infinite]"
              style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.4))" }}>🎁</span>
        <span className="relative text-[8px] font-black mt-0.5"
              style={{ textShadow: "0 1px 0 rgba(255,243,200,0.6)" }}>حظ</span>
        <span className="absolute -inset-1 rounded-lg pointer-events-none animate-[lb-halo_2s_ease-in-out_infinite]"
              style={{ boxShadow: "0 0 14px 2px rgba(255,210,80,0.45)" }} />
        <style>{`
          @keyframes lb-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
          @keyframes lb-halo{0%,100%{opacity:.55}50%{opacity:.95}}
        `}</style>
      </button>
      {open && <LuckyBoxModal onClose={() => { setOpen(false); onChanged?.(); }} />}
    </>
  );
}

function LuckyBoxModal({ onClose }: { onClose: () => void }) {
  const [stage, setStage] = useState<"idle" | "spinning" | "burst" | "reveal">("idle");
  const [result, setResult] = useState<OpenResult | null>(null);
  const [cost, setCost] = useState<number>(300);
  const [opensTotal, setOpensTotal] = useState<number>(0);
  const [gems, setGems] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [canSkip, setCanSkip] = useState(false);
  const skipTimer = useRef<number | null>(null);
  const stageTimer = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const [{ data: s }, { data: p }, { count }] = await Promise.all([
        supabase.from("lucky_box_settings").select("cost_gems, enabled").maybeSingle(),
        supabase.from("profiles").select("gems").eq("id", u.user.id).maybeSingle(),
        supabase.from("lucky_box_opens").select("id", { count: "exact", head: true }).eq("user_id", u.user.id),
      ]);
      if (s) { setCost(s.cost_gems ?? 300); setEnabled(s.enabled ?? true); }
      if (p) setGems((p as any).gems ?? 0);
      setOpensTotal(count ?? 0);
    })();
    return () => {
      if (skipTimer.current) window.clearTimeout(skipTimer.current);
      if (stageTimer.current) window.clearTimeout(stageTimer.current);
    };
  }, []);

  const playSound = (rarity: Rarity | "open") => {
    try {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      const ctx = new Ctx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      const freqs = rarity === "legendary" ? [220, 440, 880, 1320]
        : rarity === "rare" ? [330, 660, 990]
        : rarity === "common" ? [440, 660]
        : [200, 400, 800];
      const dur = rarity === "legendary" ? 1.8 : rarity === "rare" ? 1.2 : 0.7;
      o.type = rarity === "legendary" ? "sawtooth" : "triangle";
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.05);
      freqs.forEach((f, i) => o.frequency.setValueAtTime(f, ctx.currentTime + (i * dur / freqs.length)));
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.start(); o.stop(ctx.currentTime + dur);
    } catch { /* ignore */ }
  };

  const skipNow = () => {
    if (stageTimer.current) window.clearTimeout(stageTimer.current);
    setStage("reveal");
  };

  const openBox = async () => {
    if (busy || !enabled) return;
    if (gems < cost) { toast.error(`تحتاج ${cost} جوهرة — لديك ${gems}`); return; }
    setBusy(true);
    setResult(null);
    setCanSkip(false);
    setStage("spinning");
    playSound("open");
    skipTimer.current = window.setTimeout(() => setCanSkip(true), 1500);

    const { data, error } = await (supabase as any).rpc("open_lucky_box");
    if (error) {
      setStage("idle");
      setBusy(false);
      const msg = error.message || "";
      if (/insufficient_gems|not_enough_gems/i.test(msg)) toast.error("لا تملك جواهر كافية");
      else if (/lucky_box_disabled/i.test(msg)) toast.error("صندوق الحظ متوقف حاليًا");
      else if (/market_level_too_low/i.test(msg)) toast.error("يجب أن يكون مستوى السوق ٦ أو أعلى");
      else if (/no_prizes/i.test(msg)) toast.error("لم يتم إعداد جوائز بعد");
      else toast.error("تعذّر فتح الصندوق، حاول مرة أخرى");
      return;
    }
    const r = data as OpenResult;
    setResult(r);
    setGems(r.gems_left);
    setOpensTotal(r.opens_count);

    // Cinematic timing: spin -> burst -> reveal
    stageTimer.current = window.setTimeout(() => {
      setStage("burst");
      playSound(r.rarity);
      stageTimer.current = window.setTimeout(() => {
        setStage("reveal");
        setBusy(false);
      }, 700);
    }, r.rarity === "legendary" ? 2600 : r.rarity === "rare" ? 2000 : 1500);
  };

  const reset = () => { setStage("idle"); setResult(null); };

  const rarity = result?.rarity ?? "common";
  const rs = RARITY_STYLE[rarity];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 backdrop-blur-md"
      style={{ background: "radial-gradient(ellipse at center, rgba(20,8,40,0.85) 0%, rgba(0,0,0,0.95) 100%)" }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-3xl border-2 p-5 text-center"
        dir="rtl"
        style={{
          borderColor: "rgba(255,210,90,0.55)",
          background:
            "radial-gradient(ellipse at top, rgba(94,38,8,0.95) 0%, rgba(28,8,40,0.95) 65%, rgba(8,4,18,0.98) 100%)",
          boxShadow: "0 0 60px rgba(255,180,40,0.35), inset 0 0 40px rgba(255,180,40,0.12)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose}
          className="absolute top-3 left-3 w-8 h-8 rounded-full bg-black/60 border border-white/20 text-white text-sm font-bold">✕</button>

        <h2 className="text-2xl font-black text-amber-200 mb-1" style={{ textShadow: "0 0 12px rgba(255,180,40,0.7)" }}>
          🎁 صندوق الحظ الفاخر
        </h2>
        <div className="text-amber-100/80 text-xs mb-3">
          فتحات الحساب: <span className="font-bold">{opensTotal}</span> · رصيدك: 💎 {gems.toLocaleString()}
        </div>

        {/* Stage area */}
        <div className="relative h-64 flex items-center justify-center mb-3 select-none">
          {/* Halo */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-0 rounded-full opacity-70 animate-[lb-pulse_2.5s_ease-in-out_infinite]"
                 style={{ background: `radial-gradient(circle at center, ${stage === "reveal" ? rs.ring : "#facc15"}55 0%, transparent 70%)` }} />
          </div>

          {/* Sparkles */}
          {stage !== "idle" && (
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {Array.from({ length: 14 }).map((_, i) => (
                <span key={i} className="absolute text-amber-300 animate-[lb-spark_1.8s_linear_infinite]"
                      style={{
                        left: `${(i * 73) % 100}%`,
                        top: `${(i * 41) % 100}%`,
                        animationDelay: `${(i % 7) * 0.15}s`,
                        fontSize: `${10 + (i % 4) * 4}px`,
                        textShadow: "0 0 6px rgba(255,200,80,0.9)",
                      }}>✦</span>
              ))}
            </div>
          )}

          {/* Box / Reveal */}
          {stage !== "reveal" && (
            <div
              className={`relative text-[110px] leading-none ${
                stage === "spinning" ? "animate-[lb-shake_0.18s_linear_infinite]" : ""
              } ${stage === "burst" ? "animate-[lb-burst_0.7s_ease-out_forwards]" : ""}`}
              style={{
                filter: "drop-shadow(0 6px 14px rgba(255,180,40,0.55)) drop-shadow(0 0 30px rgba(255,200,80,0.6))",
                transform: stage === "spinning" ? "scale(1.08)" : "scale(1)",
                transition: "transform .4s ease",
              }}
            >
              🎁
            </div>
          )}

          {stage === "reveal" && result && (
            <div className="relative flex flex-col items-center animate-[lb-reveal_0.6s_cubic-bezier(.2,.9,.3,1.3)]">
              <div className="text-7xl mb-1"
                   style={{ filter: `drop-shadow(0 0 18px ${rs.ring})`, textShadow: rs.glow }}>{result.icon}</div>
              <div className={`text-xl font-black ${rs.text}`}
                   style={{ textShadow: rs.glow }}>{result.label}</div>
              <div className="text-[11px] mt-1 font-bold"
                   style={{ color: rs.ring, textShadow: `0 0 8px ${rs.ring}` }}>
                {rs.emoji} {rs.ar}
              </div>
            </div>
          )}
        </div>

        {/* CTA */}
        {stage === "idle" && (
          <button
            onClick={openBox}
            disabled={!enabled || busy || gems < cost}
            className="w-full py-3 rounded-2xl font-black text-white text-lg active:scale-95 disabled:opacity-50"
            style={{
              background: "linear-gradient(180deg,#ffd24a 0%,#ff9a1f 50%,#b94d00 100%)",
              boxShadow: "0 0 24px rgba(255,170,30,0.7), inset 0 1px 0 rgba(255,255,255,0.4)",
              border: "2px solid #ffe9a8",
              textShadow: "0 1px 2px rgba(60,20,0,0.7)",
            }}
          >
            {!enabled ? "موقوف حاليًا" : `افتح الصندوق · 💎 ${cost}`}
          </button>
        )}

        {stage !== "idle" && stage !== "reveal" && (
          <button
            onClick={skipNow}
            disabled={!canSkip}
            className="w-full py-2.5 rounded-xl text-sm font-bold text-amber-100 border border-amber-300/40 bg-black/40 disabled:opacity-30"
          >
            {canSkip ? "⏭️ تخطّي الأنيميشن" : "جاري الفتح..."}
          </button>
        )}

        {stage === "reveal" && (
          <div className="flex gap-2">
            <button
              onClick={reset}
              className="flex-1 py-3 rounded-2xl font-black text-white text-base active:scale-95"
              style={{
                background: "linear-gradient(180deg,#ffd24a 0%,#ff9a1f 50%,#b94d00 100%)",
                boxShadow: "0 0 18px rgba(255,170,30,0.55)",
                border: "2px solid #ffe9a8",
              }}
            >فتح آخر · 💎 {cost}</button>
            <button
              onClick={onClose}
              className="px-4 py-3 rounded-2xl font-bold text-sm text-amber-100 border border-amber-300/40 bg-black/40"
            >خروج</button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes lb-pulse{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:1;transform:scale(1.08)}}
        @keyframes lb-shake{0%{transform:translate(0,0) rotate(-3deg)}25%{transform:translate(2px,-2px) rotate(2deg)}50%{transform:translate(-2px,2px) rotate(-2deg)}75%{transform:translate(2px,2px) rotate(3deg)}100%{transform:translate(0,0) rotate(0)}}
        @keyframes lb-burst{0%{transform:scale(1);filter:brightness(1)}40%{transform:scale(1.6);filter:brightness(1.6)}100%{transform:scale(2.6);opacity:0;filter:brightness(2.6)}}
        @keyframes lb-reveal{0%{opacity:0;transform:scale(.4) translateY(20px)}60%{opacity:1;transform:scale(1.15) translateY(-4px)}100%{opacity:1;transform:scale(1) translateY(0)}}
        @keyframes lb-spark{0%{transform:translateY(20px) scale(.4);opacity:0}40%{opacity:1}100%{transform:translateY(-40px) scale(1.2);opacity:0}}
      `}</style>
    </div>
  );
}

/** Listens for global rare/legendary openings and shows a top banner for ~6s. */
export function LuckyBoxGlobalBanner() {
  const [items, setItems] = useState<Array<{ id: string; title: string; body: string; kind: string }>>([]);

  useEffect(() => {
    const ch = supabase
      .channel("lucky-box-global")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: "recipient_id=is.null" },
        (payload) => {
          const n = payload.new as { id: string; title: string; body: string; kind: string };
          if (n.kind !== "lucky_rare" && n.kind !== "lucky_legendary") return;
          setItems((prev) => [...prev, n].slice(-3));
          window.setTimeout(() => {
            setItems((prev) => prev.filter((x) => x.id !== n.id));
          }, 10000);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="fixed top-2 inset-x-0 z-[999] flex flex-col items-center gap-2 pointer-events-none" dir="rtl">
      {items.map((n) => {
        const legend = n.kind === "lucky_legendary";
        return (
          <div key={n.id}
               className="pointer-events-auto max-w-[92vw] px-4 py-2 rounded-2xl border-2 backdrop-blur animate-[lb-banner_.45s_ease-out]"
               style={{
                 background: legend
                   ? "linear-gradient(90deg, rgba(120,0,0,0.95), rgba(60,0,0,0.95))"
                   : "linear-gradient(90deg, rgba(0,60,120,0.95), rgba(0,30,80,0.95))",
                 borderColor: legend ? "#ef4444" : "#38bdf8",
                 boxShadow: legend
                   ? "0 0 30px rgba(239,68,68,0.7)"
                   : "0 0 24px rgba(56,189,248,0.55)",
               }}>
            <div className={`text-xs font-black ${legend ? "text-red-200" : "text-sky-200"}`}>{n.title}</div>
            <div className="text-[11px] text-white/90">{n.body}</div>
          </div>
        );
      })}
      <style>{`@keyframes lb-banner{0%{transform:translateY(-30px);opacity:0}100%{transform:translateY(0);opacity:1}}`}</style>
    </div>
  );
}
