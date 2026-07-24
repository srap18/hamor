import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type LinkedAccount = {
  user_id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  email: string | null;
  level: number | null;
  coins: number | null;
  created_at: string | null;
  shared_devices: string[];
  shared_ips: string[]; // kept for schema compatibility; always empty now
  link_via: ("device" | "ip")[]; // always ["device"] now
};

/**
 * A hardware_hash / device_id shared by MORE than this many distinct users
 * is considered a fallback/collision fingerprint (webview/incognito where the
 * fingerprint APIs are blocked and everyone produces the same hash) and is
 * NEVER used to link accounts.
 */
const COLLISION_THRESHOLD = 5;

/** Minimum length for an id to be considered a real fingerprint. */
const MIN_ID_LEN = 32;

/** Minimum hit count required on device_history before we trust a match. */
const MIN_HITS = 2;

function isRealId(id: string | null | undefined): id is string {
  if (!id) return false;
  const s = String(id).trim().toLowerCase();
  if (s.length < MIN_ID_LEN) return false;
  if (s === "unknown" || s === "null" || s === "undefined" || s === "none" || s === "default") return false;
  // reject the legacy "fb********************************" fallback hash from
  // device-fingerprint.ts sha256Hex catch-branch (deterministic per empty input)
  if (s.startsWith("fb") && /^fb[0-9a-f]+$/.test(s) && s.length <= 34) return false;
  // all-zero / all-same-char hashes = broken fingerprint
  if (/^(.)\1+$/.test(s)) return false;
  return true;
}

export const adminGetLinkedAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    if (!input?.userId) throw new Error("userId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Authorize
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .in("role", ["admin", "moderator"]);
    if (!roles || roles.length === 0) throw new Error("forbidden");

    // ------------------------------------------------------------------
    // AUTHORITATIVE SOURCE: device_slots.hardware_hash ONLY.
    // A device_slots row is written only after the client passes the full
    // hardware-fingerprint challenge and the account occupies a physical
    // slot on that device for 14+ days. This is the ONLY signal strong
    // enough to say "same device" with 100% confidence.
    //
    // device_history.device_id is deliberately NOT used here — soft
    // browser fingerprints collide across truly-different devices
    // (school wifi, incognito, webviews) and cause false positives.
    // ------------------------------------------------------------------
    const { data: mySlots } = await supabaseAdmin
      .from("device_slots")
      .select("hardware_hash, assigned_at, locked_until")
      .eq("user_id", data.userId);
    const myHardwareHashes = Array.from(
      new Set((mySlots ?? []).map((r) => r.hardware_hash).filter(isRealId)),
    );

    // device_history is kept for the "self" panel display only.
    const { data: myDevicesRaw } = await supabaseAdmin
      .from("device_history")
      .select("device_id, first_seen, last_seen, hits")
      .eq("user_id", data.userId);
    const myDevices = (myDevicesRaw ?? []).filter(
      (d) => isRealId(d.device_id) && (d.hits ?? 0) >= MIN_HITS,
    );

    // IPs — displayed in the "self" panel only, NEVER used to link accounts.
    const { data: myIps } = await supabaseAdmin
      .from("user_ips")
      .select("ip, first_seen, last_seen, hits")
      .eq("user_id", data.userId);

    const deviceMap = new Map<string, Set<string>>();

    // Match strictly on device_slots.hardware_hash (authoritative hardware id)
    if (myHardwareHashes.length > 0) {
      const { data: slotOthers } = await supabaseAdmin
        .from("device_slots")
        .select("hardware_hash, user_id")
        .in("hardware_hash", myHardwareHashes);

      const usersPerHash = new Map<string, Set<string>>();
      for (const r of slotOthers ?? []) {
        if (!isRealId(r.hardware_hash)) continue;
        if (!usersPerHash.has(r.hardware_hash)) usersPerHash.set(r.hardware_hash, new Set());
        usersPerHash.get(r.hardware_hash)!.add(r.user_id);
      }
      for (const r of slotOthers ?? []) {
        if (r.user_id === data.userId) continue;
        if (!isRealId(r.hardware_hash)) continue;
        const distinct = usersPerHash.get(r.hardware_hash)?.size ?? 0;
        if (distinct > COLLISION_THRESHOLD) continue;
        if (!deviceMap.has(r.user_id)) deviceMap.set(r.user_id, new Set());
        deviceMap.get(r.user_id)!.add(r.hardware_hash);
      }
    }



    const userIds = Array.from(deviceMap.keys());
    let profiles: Array<{
      id: string;
      display_name: string | null;
      username: string | null;
      avatar_url: string | null;
      level: number | null;
      coins: number | null;
      created_at: string | null;
    }> = [];
    const emails: Record<string, string | null> = {};

    if (userIds.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, display_name, username, avatar_url, level, coins, created_at")
        .in("id", userIds);
      profiles = (profs ?? []) as typeof profiles;

      await Promise.all(
        userIds.map(async (uid) => {
          try {
            const { data: u } = await supabaseAdmin.auth.admin.getUserById(uid);
            emails[uid] = u?.user?.email ?? null;
          } catch {
            emails[uid] = null;
          }
        }),
      );
    }

    let selfEmail: string | null = null;
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(data.userId);
      selfEmail = u?.user?.email ?? null;
    } catch {}

    const linked: LinkedAccount[] = profiles.map((p) => {
      const devs = Array.from(deviceMap.get(p.id) ?? []);
      return {
        user_id: p.id,
        display_name: p.display_name,
        username: p.username,
        avatar_url: p.avatar_url,
        email: emails[p.id] ?? null,
        level: p.level,
        coins: p.coins,
        created_at: p.created_at,
        shared_devices: devs,
        shared_ips: [],
        link_via: devs.length ? ["device"] : [],
      };
    });

    linked.sort((a, b) => b.shared_devices.length - a.shared_devices.length);

    return {
      self: {
        user_id: data.userId,
        email: selfEmail,
        devices: myDevices.map((d) => ({
          device_id: d.device_id,
          created_at: d.first_seen,
          updated_at: d.last_seen,
        })),
        ips: (myIps ?? []).map((r) => ({
          ip: r.ip,
          first_seen: r.first_seen,
          last_seen: r.last_seen,
          hits: r.hits,
        })),
      },
      linked,
    };
  });
