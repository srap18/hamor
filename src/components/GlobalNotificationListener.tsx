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

const iconFor = (kind: string) =>
  kind === "nuke" ? "☢️"
  : kind === "attack" ? "⚔️"
  : kind === "support" ? "🛠️"
  : kind === "support_reply" ? "🛡️"
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
      // Don't show toast for the user's own actions (created_by === self isn't tracked
      // here; we rely on recipient_id matching to filter).
      const title = `${iconFor(n.kind)} ${n.title}`;
      const opts: any = { duration: 6000 };
      if (n.body) opts.description = n.body;
      // Sonner: use info as default; attack uses warning style.
      if (n.kind === "attack" || n.kind === "nuke") {
        toast.error(title, opts);
      } else if (n.kind === "support" || n.kind === "support_reply" || n.kind === "ship" || n.kind === "friend") {
        toast.success(title, opts);
      } else {
        toast(title, opts);
      }
      try { sound.play("click"); } catch { /* noop */ }
    };

    const channel = supabase
      .channel(`global-notifs:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const n = payload.new as Notif;
          if (!n) return;
          // Only show to the recipient (don't toast global broadcasts here -
          // GlobalBanner handles those).
          if (n.recipient_id !== user.id) return;
          showToast(n);
        },
      )
      .subscribe();

    // Safety net: poll every 20s in case realtime drops a message.
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
    const interval = setInterval(poll, 20000);
    const onVis = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [user]);

  return null;
}
