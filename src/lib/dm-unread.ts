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
  // Zero unread for this peer in the cache without a network round-trip.
  const hit = DM_CACHE.get(uid);
  if (hit) {
    const entry = hit.data.map.get(peerId);
    if (entry && entry.count > 0) {
      const nextMap = new Map(hit.data.map);
      nextMap.set(peerId, { ...entry, count: 0 });
      const total = Math.max(0, hit.data.total - entry.count);
      DM_CACHE.set(uid, { ...hit, data: { map: nextMap, total } });
    }
  }
}

export function markAllDmRead(uid: string) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(GLOBAL_KEY(uid), new Date().toISOString());
  const hit = DM_CACHE.get(uid);
  if (hit) {
    const nextMap = new Map<string, DmEntry>();
    hit.data.map.forEach((v, k) => nextMap.set(k, { ...v, count: 0 }));
    DM_CACHE.set(uid, { ...hit, data: { map: nextMap, total: 0 } });
  }
}

// Module-level TTL cache: BottomNav + chat + index all call this; without a
// shared cache we run the same 4-query batch on every navigation. 30s is short
// enough that unread counts stay accurate (realtime channels invalidate on new
// INSERT and force=true bypasses on demand).
type CacheEntry = { data: { map: Map<string, DmEntry>; total: number }; ts: number; promise?: Promise<{ map: Map<string, DmEntry>; total: number }> };
const DM_CACHE = new Map<string, CacheEntry>();
const DM_TTL_MS = 30_000;

export function invalidateDmUnread(uid?: string) {
  if (uid) DM_CACHE.delete(uid); else DM_CACHE.clear();
}

// Load latest DM activity (last 100 messages) grouped per peer with unread counts.
// Excludes anyone in either direction of user_blocks. Results cached for 30s.
export async function loadDmUnreadMap(uid: string, opts?: { force?: boolean }): Promise<{
  map: Map<string, DmEntry>;
  total: number;
}> {
  const now = Date.now();
  const hit = DM_CACHE.get(uid);
  if (!opts?.force && hit && now - hit.ts < DM_TTL_MS) return hit.data;
  if (hit?.promise) return hit.promise;
  const p = (async () => {
    const [{ data: msgs }, { data: a }, { data: b }, { data: friends }] = await Promise.all([
      supabase
        .from("messages")
        .select("id, sender_id, recipient_id, body, audio_url, created_at")
        .eq("channel", "dm")
        .or(`recipient_id.eq.${uid},sender_id.eq.${uid}`)
        .order("created_at", { ascending: false })
        .limit(100),
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
    const result = { map, total };
    DM_CACHE.set(uid, { data: result, ts: Date.now() });
    return result;
  })();
  DM_CACHE.set(uid, { data: hit?.data ?? { map: new Map(), total: 0 }, ts: hit?.ts ?? 0, promise: p });
  return p;
}
