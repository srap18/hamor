import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sound } from "@/lib/sound";

type NukePayload = {
  kind?: "nuke";
  attacker_name: string;
  target_name: string;
  message: string;
};

type AdminPayload = {
  kind: "admin";
  title: string;
  message: string;
  emoji?: string;
};

type BannerState =
  | ({ _t: "nuke" } & NukePayload)
  | ({ _t: "admin" } & AdminPayload);

export function GlobalBanner() {
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const clearTimer = useRef<number | null>(null);

  const show = useCallback((state: BannerState, durationMs: number) => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    if (clearTimer.current) window.clearTimeout(clearTimer.current);
    setBanner(state);
    setVisible(true);
    sound.play("click");
    hideTimer.current = window.setTimeout(() => {
      setVisible(false);
      clearTimer.current = window.setTimeout(() => setBanner(null), 600);
    }, durationMs);
  }, []);

  useEffect(() => {
    const nukeCh = supabase
      .channel("global:nuke", { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "nuke_alert" }, (msg) => {
        const p = (msg.payload ?? {}) as NukePayload;
        if (p.attacker_name && p.target_name) {
          show({ _t: "nuke", ...p }, 5000);
        }
      })
      .subscribe();

    const adminCh = supabase
      .channel("global:admin", { config: { broadcast: { self: true } } })
      .on("broadcast", { event: "admin_banner" }, (msg) => {
        const p = (msg.payload ?? {}) as AdminPayload;
        if (p.title || p.message) {
          show({ _t: "admin", kind: "admin", title: p.title || "", message: p.message || "", emoji: p.emoji || "📢" }, 8000);
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(nukeCh);
      void supabase.removeChannel(adminCh);
    };
  }, [show]);

  if (!banner) return null;

  if (banner._t === "admin") {
    return (
      <div
        className={`fixed inset-x-0 top-0 z-[100] flex items-center justify-center pointer-events-none transition-all duration-500 ease-out ${
          visible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
        }`}
      >
        <div className="mx-2 mt-2 w-full max-w-md rounded-xl border-2 border-amber-400/80 bg-gradient-to-b from-amber-950 to-stone-950 shadow-[0_0_30px_rgba(251,191,36,0.5)] p-3 text-center">
          <div className="text-2xl mb-1">{banner.emoji || "📢"}</div>
          {banner.title && (
            <div className="text-amber-200 font-extrabold text-sm leading-tight">{banner.title}</div>
          )}
          {banner.message && (
            <div className="text-amber-100/90 text-xs mt-1 leading-snug whitespace-pre-wrap break-words">{banner.message}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`fixed inset-x-0 top-0 z-[100] flex items-center justify-center pointer-events-none transition-all duration-500 ease-out ${
        visible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
      }`}
    >
      <div className="mx-2 mt-2 w-full max-w-md rounded-xl border-2 border-red-500/80 bg-gradient-to-b from-stone-900 to-stone-950 shadow-[0_0_30px_rgba(220,38,38,0.5)] p-3 text-center">
        <div className="text-2xl mb-1">☢️</div>
        <div className="text-red-300 font-extrabold text-sm leading-tight">
          {banner.attacker_name} فجّر {banner.target_name} بقنبلة ذرية!
        </div>
        <div className="text-amber-200/90 text-xs mt-1 leading-tight truncate">
          "{banner.message}"
        </div>
      </div>
    </div>
  );
}
