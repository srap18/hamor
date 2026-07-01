import { supabase } from "@/integrations/supabase/client";

export type DmEntry = {
  peerId: string;
  count: number;
  lastAt: string;
  lastBody: string;
  lastFromMe: boolean;
};

const GLOBAL_KEY = (uid: string) => `dm-last-seen:${uid}`;
const PEER_KEY = (uid: string, peer: string) => `dm-last-seen:${uid}:${peer}`;

// Read the per-peer last-seen, falling back to the global key, falling back
// to "now" (initialized once so old messages don't inflate the badge).
export function getPeerLastSeen(uid: string, peer: string): string {
  if (typeof localStorage === "undefined") return new Date().toISOString();
  const peerVal = localStorage.getItem(PEER_KEY(uid, peer));
  if (peerVal) return peerVal;
  let global = localStorage.getItem(GLOBAL_KEY(uid));
  if (!global) {
    global = new Date().toISOString();
    localStorage.setItem(GLOBAL_KEY(uid), global);
  }
  if (!peerVal) return global;
  return peerVal > global ? peerVal : global;
}

export function markDmRead(uid: string, peerId: string) {
  if (typeof localStorage === "undefined") return;
  const now = new Date().toISOString();
  localStorage.setItem(PEER_KEY(uid, peerId), now);
  localStorage.setItem(GLOBAL_KEY(uid), now);
}

export function markAllDmRead(uid: string) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(GLOBAL_KEY(uid), new Date().toISOString());
}

// Load latest DM activity (last 300 messages) grouped per peer with unread counts.
// Excludes anyone in either direction of user_blocks.
export async function loadDmUnreadMap(uid: string): Promise<{
  map: Map<string, DmEntry>;
  total: number;
}> {
  const [{ data: msgs }, { data: a }, { data: b }, { data: friends }] = await Promise.all([
    supabase
      .from("messages")
      .select("id, sender_id, recipient_id, body, audio_url, created_at")
      .eq("channel", "dm")
      .or(`recipient_id.eq.${uid},sender_id.eq.${uid}`)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("user_blocks").select("blocked_id").eq("blocker_id", uid),
    supabase.from("user_blocks").select("blocker_id").eq("blocked_id", uid),
    supabase.from("friends").select("requester_id,addressee_id").eq("status", "accepted").or(`requester_id.eq.${uid},addressee_id.eq.${uid}`),
  ]);
  const blocked = new Set<string>([
    ...(((a as any[]) || []).map((r) => r.blocked_id)),
    ...(((b as any[]) || []).map((r) => r.blocker_id)),
  ]);
  const acceptedFriends = new Set<string>(
    ((friends as any[]) || []).map((f) => (f.requester_id === uid ? f.addressee_id : f.requester_id)).filter(Boolean),
  );

  const map = new Map<string, DmEntry>();
  for (const m of (msgs || []) as any[]) {
    const peer = m.sender_id === uid ? m.recipient_id : m.sender_id;
    if (!peer || blocked.has(peer) || !acceptedFriends.has(peer)) continue;
    const body = m.audio_url ? "🎤 رسالة صوتية" : m.body;
    if (!map.has(peer)) {
      map.set(peer, {
        peerId: peer,
        count: 0,
        lastAt: m.created_at,
        lastBody: body,
        lastFromMe: m.sender_id === uid,
      });
    }
    if (m.sender_id === peer) {
      const seen = getPeerLastSeen(uid, peer);
      if (m.created_at > seen) map.get(peer)!.count++;
    }
  }
  let total = 0;
  for (const e of map.values()) total += e.count;
  return { map, total };
}
