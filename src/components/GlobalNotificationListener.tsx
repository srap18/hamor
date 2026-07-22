import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { sound } from "@/lib/sound";

type Notif = {
  id: string;
  title: string;
  body: string | null;
  kind: string;
  recipient_id: string | null;
  created_at: string;
};

type DmMsg = {
  id: string;
  channel: string;
  sender_id: string;
  recipient_id: string | null;
  body: string | null;
  audio_url: string | null;
  created_at: string;
};

const iconFor = (kind: string) =>
  kind === "nuke" ? "☢️"
  : kind === "attack" ? "⚔️"
  : kind === "support" ? "🛠️"
  : kind === "support_reply" ? "🛡️"
  : kind === "anti_block" ? "🛡️"
  : kind === "anti_block_attacker" ? "⚠️"
  : kind === "anti_disabled" ? "⚡"
  : kind === "anti_disabled_attacker" ? "⚡"
  : kind === "ship" ? "⛵"
  : kind === "friend" ? "🤝"
  : "📢";

/**
 * Global cross-page notification listener.
 * Mounted at the root so notifications pop as toasts and play a sound on
 * every page (not only on the home page where the bell is shown).
 *
 * Dedupe is per-notif-id to avoid double-toasting when both the realtime
 * channel and the safety poll deliver the same row.
 */
export function GlobalNotificationListener() {
  const { user } = useAuth();
  const seenRef = useRef<Set<string>>(new Set());
  const baselineRef = useRef<string>(new Date().toISOString());

  useEffect(() => {
    if (!user) return;
    // Reset baseline when user changes (so we don't replay old notifs on login).
    baselineRef.current = new Date().toISOString();
    seenRef.current = new Set();

    const showToast = (n: Notif) => {
      if (seenRef.current.has(n.id)) return;
      seenRef.current.add(n.id);
      try { if (localStorage.getItem("toasts-hidden") === "1") return; } catch { /* noop */ }

      const title = `${iconFor(n.kind)} ${n.title}`;
      // Reuse a single toast id so every new notification REPLACES the
      // previous one instead of stacking. Sonner updates the same toast
      // in-place → smooth, elegant, and easy on the GPU.
      const opts: any = {
        id: "oc-notif",
        duration: 3000,
        onClick: () => { try { toast.dismiss("oc-notif"); } catch { /* noop */ } },
      };
      if (n.body) opts.description = n.body;
      if (n.kind === "attack" || n.kind === "nuke") {
        toast.error(title, opts);
      } else if (n.kind === "support" || n.kind === "support_reply" || n.kind === "ship" || n.kind === "friend" || n.kind === "anti_block") {
        toast.success(title, opts);
      } else if (n.kind === "anti_block_attacker" || n.kind === "anti_disabled" || n.kind === "anti_disabled_attacker") {
        toast.warning(title, opts);
      } else {
        toast(title, opts);
      }
      try { sound.play("click"); } catch { /* noop */ }
    };

    // Realtime = instant. Server-side filter keeps this user's rows only.
    const channel = supabase
      .channel(`global-notifs:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${user.id}` },
        (payload) => {
          const n = payload.new as Notif;
          if (!n) return;
          showToast(n);
          if (n.created_at > baselineRef.current) baselineRef.current = n.created_at;
        },
      )
      .subscribe();

    // Safety-net poll: only runs if realtime drops (mobile background, network flap).
    const poll = async () => {
      const since = baselineRef.current;
      const { data, error } = await supabase
        .from("notifications")
        .select("id,title,body,kind,recipient_id,created_at")
        .eq("recipient_id", user.id)
        .gt("created_at", since)
        .order("created_at", { ascending: true })
        .limit(20);
      if (error || !data) return;
      for (const n of data as Notif[]) {
        showToast(n);
        if (n.created_at > baselineRef.current) baselineRef.current = n.created_at;
      }
    };
    // Poll every 15s in background as a safety net. Realtime is primary and instant.
    const interval = setInterval(() => { if (!document.hidden) poll(); }, 15000);
    const onVis = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    void poll();

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };

  }, [user]);

  return null;
}
