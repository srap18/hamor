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
 * Device IDs shared by MORE than this many distinct users are treated as
 * fallback/collision fingerprints (e.g. from webviews/incognito where the
 * fingerprint APIs were blocked and every device produced the same hash).
 * They are excluded from the "same device" match to prevent false positives.
 */
const COLLISION_THRESHOLD = 10;

/** Minimum length for a device_id to be considered a real fingerprint. */
const MIN_DEVICE_ID_LEN = 32;

function isRealDeviceId(id: string | null | undefined): id is string {
  if (!id) return false;
  const s = String(id).trim().toLowerCase();
  if (s.length < MIN_DEVICE_ID_LEN) return false;
  if (s === "unknown" || s === "null" || s === "undefined" || s === "none") return false;
  // reject the legacy "fb********************************" fallback hash from
  // device-fingerprint.ts sha256Hex catch-branch (deterministic per empty input)
  if (s.startsWith("fb") && /^fb[0-9a-f]+$/.test(s) && s.length <= 34) return false;
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

    // 1) Real devices this user used (filter garbage / defaults)
    const { data: myDevicesRaw } = await supabaseAdmin
      .from("device_history")
      .select("device_id, first_seen, last_seen, hits")
      .eq("user_id", data.userId);
    const myDevices = (myDevicesRaw ?? []).filter((d) => isRealDeviceId(d.device_id));
    const myDeviceIds = Array.from(new Set(myDevices.map((d) => d.device_id)));

    // 2) IPs — collected for the "self" panel only, NEVER used to link accounts.
    const { data: myIps } = await supabaseAdmin
      .from("user_ips")
      .select("ip, first_seen, last_seen, hits")
      .eq("user_id", data.userId);

    // 3) Other users on the SAME real devices — with collision filter
    const deviceMap = new Map<string, Set<string>>();
    if (myDeviceIds.length > 0) {
      const { data: others } = await supabaseAdmin
        .from("device_history")
        .select("device_id, user_id")
        .in("device_id", myDeviceIds);

      // Count distinct users per device_id to detect collision fingerprints.
      const usersPerDevice = new Map<string, Set<string>>();
      for (const r of others ?? []) {
        if (!isRealDeviceId(r.device_id)) continue;
        if (!usersPerDevice.has(r.device_id)) usersPerDevice.set(r.device_id, new Set());
        usersPerDevice.get(r.device_id)!.add(r.user_id);
      }

      // Build linked accounts, excluding devices flagged as collision fingerprints.
      for (const r of others ?? []) {
        if (r.user_id === data.userId) continue;
        if (!isRealDeviceId(r.device_id)) continue;
        const distinctUsers = usersPerDevice.get(r.device_id)?.size ?? 0;
        if (distinctUsers > COLLISION_THRESHOLD) continue; // fallback hash, ignore
        if (!deviceMap.has(r.user_id)) deviceMap.set(r.user_id, new Set());
        deviceMap.get(r.user_id)!.add(r.device_id);
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
