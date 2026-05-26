import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sound } from "@/lib/sound";

type BannerPayload = {
  attacker_name: string;
  target_name: string;
  message: string;
};

export function GlobalBanner() {
  const [banner, setBanner] = useState<BannerPayload | null>(null);
  const [visible, setVisible] = useState(false);

  const showBanner = useCallback((payload: BannerPayload) => {
    setBanner(payload);
    setVisible(true);
    sound.play("click");
    // Hide after 5 seconds
    setTimeout(() => {
      setVisible(false);
      setTimeout(() => setBanner(null), 600); // clear after exit animation
    }, 5000);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("global:nuke", { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "nuke_alert" }, (msg) => {
        const payload = (msg.payload ?? {}) as BannerPayload;
        if (payload.attacker_name && payload.target_name) {
          showBanner(payload);
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [showBanner]);

  if (!banner) return null;

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
          “{banner.message}”
        </div>
      </div>
    </div>
  );
}
