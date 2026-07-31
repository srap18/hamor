import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Shared Realtime bus for `public.notifications` (+ inbound DM rows).
 *
 * WHY: six components (NotificationsBell, BottomNav, GlobalNotificationListener,
 * GiftPopup, LuckyBoxGlobalBanner, AttackerAntiBlockBurst) each opened their own
 * Supabase channel with the *same* server-side filters. That meant up to 6 open
 * websocket subscriptions per player and 6 duplicate WAL fan-outs of every single
 * notification row — a constant CPU/radio wakeup cost on mobile.
 *
 * This module opens ONE channel per user and dispatches the identical payloads to
 * every local listener. Nothing about the data, the filters, the event types, the
 * ordering or the timing changes — each consumer receives exactly the same
 * `payload` object it received before, at the same moment. Purely a transport
 * de-duplication layer.
 */

export type NotifPayload = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: any;
  old: any;
};

type Listener = {
  onPersonal?: (p: NotifPayload) => void;
  onBroadcast?: (p: NotifPayload) => void;
  onDmMessage?: (p: NotifPayload) => void;
};

type Bus = {
  channel: RealtimeChannel;
  listeners: Set<Listener>;
  teardown: ReturnType<typeof setTimeout> | null;
};

const buses = new Map<string, Bus>();

function createBus(key: string, userId: string | null): Bus {
  const listeners = new Set<Listener>();

  const emit = (which: keyof Listener, payload: any) => {
    const p: NotifPayload = {
      eventType: payload.eventType,
      new: payload.new,
      old: payload.old,
    };
    // Copy first: a handler may unsubscribe during dispatch.
    for (const l of Array.from(listeners)) {
      const fn = l[which];
      if (!fn) continue;
      try { fn(p); } catch { /* one bad listener must not break the rest */ }
    }
  };

  let channel = supabase.channel(`notif-bus:${key}`);

  if (userId) {
    // Personal notifications. INSERT + UPDATE mirrors the union of what the
    // previous separate channels listened for (AntiBlockBurst used event "*").
    channel = channel
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
        (payload) => emit("onPersonal", payload),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
        (payload) => emit("onPersonal", payload),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${userId}` },
        (payload) => emit("onDmMessage", payload),
      );
  }

  // Global broadcasts (recipient_id IS NULL) — visible to everyone, signed in or not.
  channel = channel.on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "notifications", filter: "recipient_id=is.null" },
    (payload) => emit("onBroadcast", payload),
  );

  channel.subscribe();
  return { channel, listeners, teardown: null };
}

/**
 * Subscribe to the shared notification bus. Returns an unsubscribe function.
 * Pass `userId = null` for broadcast-only consumers (works signed out).
 */
export function subscribeNotifBus(userId: string | null, listener: Listener): () => void {
  const key = userId ?? "anon";
  let bus = buses.get(key);
  if (!bus) {
    bus = createBus(key, userId);
    buses.set(key, bus);
  }
  if (bus.teardown) { clearTimeout(bus.teardown); bus.teardown = null; }
  bus.listeners.add(listener);

  return () => {
    const b = buses.get(key);
    if (!b) return;
    b.listeners.delete(listener);
    if (b.listeners.size === 0 && !b.teardown) {
      // Grace period so a route change / StrictMode remount reuses the same
      // socket instead of tearing it down and immediately rebuilding it.
      b.teardown = setTimeout(() => {
        const cur = buses.get(key);
        if (!cur || cur.listeners.size > 0) return;
        buses.delete(key);
        supabase.removeChannel(cur.channel);
      }, 5000);
    }
  };
}
