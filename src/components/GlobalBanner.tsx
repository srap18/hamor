import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sound } from "@/lib/sound";

type NukeBannerData = {
  kind: "nuke" | "ad_bomb" | "anti_block";
  attacker_name: string;
  target_name: string;
  message: string;
  emoji?: string;
};

type AdminPayload = {
  kind: "admin";
  title: string;
  message: string;
  emoji?: string;
};

type BannerState =
  | ({ _t: "nuke" } & NukeBannerData)
  | ({ _t: "admin" } & AdminPayload);

type BannerRow = {
  id: string;
  kind: string;
  attacker_name: string | null;
  target_name: string | null;
  message: string | null;
  emoji: string | null;
  title: string | null;
  created_at: string;
};

export function GlobalBanner() {
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const clearTimer = useRef<number | null>(null);
  const seenIds = useRef<Set<string>>(new Set());

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

  const handleRow = useCallback((row: BannerRow) => {
    if (!row?.id || seenIds.current.has(row.id)) return;
    // Ignore old rows (more than 30s) on initial load
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    if (ageMs > 30_000) { seenIds.current.add(row.id); return; }
    seenIds.current.add(row.id);
    if (row.kind === "nuke" || row.kind === "ad_bomb") {
      show({
        _t: "nuke",
        kind: row.kind as "nuke" | "ad_bomb",
        attacker_name: row.attacker_name || "لاعب",
        target_name: row.target_name || "لاعب",
        message: row.message || "",
        emoji: row.emoji || (row.kind === "nuke" ? "☢️" : "📺"),
      }, 6000);
    } else if (row.kind === "admin") {
      show({
        _t: "admin", kind: "admin",
        title: row.title || "",
        message: row.message || "",
        emoji: row.emoji || "📢",
      }, 8000);
    }
  }, [show]);

  useEffect(() => {
    // Reliable cross-user banner via postgres realtime on global_banners table
    const ch = supabase
      .channel("global:banners")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "global_banners" },
        (payload) => handleRow(payload.new as BannerRow),
      )
      .subscribe();

    // Admin broadcasts still come via the old admin channel
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
      void supabase.removeChannel(ch);
      void supabase.removeChannel(adminCh);
    };
  }, [show, handleRow]);

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

  const isAd = banner.kind === "ad_bomb";
  const verb = isAd ? "ضرب إعلانية على" : "فجّر";
  const suffix = isAd ? "بقنبلة إعلانية!" : "بقنبلة ذرية!";
  const borderColor = isAd ? "border-amber-400/80" : "border-red-500/80";
  const shadow = isAd ? "shadow-[0_0_30px_rgba(251,191,36,0.5)]" : "shadow-[0_0_30px_rgba(220,38,38,0.5)]";
  const titleColor = isAd ? "text-amber-200" : "text-red-300";

  return (
    <div
      className={`fixed inset-x-0 top-0 z-[100] flex items-center justify-center pointer-events-none transition-all duration-500 ease-out ${
        visible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
      }`}
    >
      <div className={`mx-2 mt-2 w-full max-w-md rounded-xl border-2 ${borderColor} bg-gradient-to-b from-stone-900 to-stone-950 ${shadow} p-3 text-center`}>
        <div className="text-2xl mb-1">{banner.emoji || (isAd ? "📺" : "☢️")}</div>
        <div className={`${titleColor} font-extrabold text-sm leading-tight`}>
          {banner.attacker_name} {verb} {banner.target_name} {suffix}
        </div>
        {banner.message && (
          <div className="text-amber-200/90 text-xs mt-1 leading-tight truncate">
            "{banner.message}"
          </div>
        )}
      </div>
    </div>
  );
}
