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
  shared_ips: string[];
  link_via: ("device" | "ip")[];
};

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

    // 1) Devices this user used
    const { data: myDevices } = await supabaseAdmin
      .from("device_accounts")
      .select("device_id, created_at, updated_at")
      .eq("user_id", data.userId);
    const myDeviceIds = (myDevices ?? []).map((d) => d.device_id);

    // 2) IPs this user used
    const { data: myIps } = await supabaseAdmin
      .from("user_ips")
      .select("ip, first_seen, last_seen, hits")
      .eq("user_id", data.userId);
    const myIpList = (myIps ?? []).map((r) => r.ip);

    // 3) Other users on the same devices
    const deviceMap = new Map<string, Set<string>>(); // user_id -> shared device ids
    if (myDeviceIds.length > 0) {
      const { data: others } = await supabaseAdmin
        .from("device_accounts")
        .select("device_id, user_id")
        .in("device_id", myDeviceIds);
      for (const r of others ?? []) {
        if (r.user_id === data.userId) continue;
        if (!deviceMap.has(r.user_id)) deviceMap.set(r.user_id, new Set());
        deviceMap.get(r.user_id)!.add(r.device_id);
      }
    }

    // 4) Other users on the same IPs
    const ipMap = new Map<string, Set<string>>();
    if (myIpList.length > 0) {
      const { data: others } = await supabaseAdmin
        .from("user_ips")
        .select("ip, user_id")
        .in("ip", myIpList);
      for (const r of others ?? []) {
        if (r.user_id === data.userId) continue;
        if (!ipMap.has(r.user_id)) ipMap.set(r.user_id, new Set());
        ipMap.get(r.user_id)!.add(r.ip);
      }
    }

    const userIds = Array.from(new Set([...deviceMap.keys(), ...ipMap.keys()]));
    let profiles: Array<{ id: string; display_name: string | null; username: string | null; avatar_url: string | null; level: number | null; coins: number | null; created_at: string | null }> = [];
    const emails: Record<string, string | null> = {};

    if (userIds.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, display_name, username, avatar_url, level, coins, created_at")
        .in("id", userIds);
      profiles = (profs ?? []) as typeof profiles;

      // emails (best effort)
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

    // Also include the target user's email for context
    let selfEmail: string | null = null;
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(data.userId);
      selfEmail = u?.user?.email ?? null;
    } catch {}

    const linked: LinkedAccount[] = profiles.map((p) => {
      const devs = Array.from(deviceMap.get(p.id) ?? []);
      const ips = Array.from(ipMap.get(p.id) ?? []);
      const via: ("device" | "ip")[] = [];
      if (devs.length) via.push("device");
      if (ips.length) via.push("ip");
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
        shared_ips: ips,
        link_via: via,
      };
    });

    // Sort: device matches first, then more shared signals
    linked.sort((a, b) => {
      const aScore = a.shared_devices.length * 10 + a.shared_ips.length;
      const bScore = b.shared_devices.length * 10 + b.shared_ips.length;
      return bScore - aScore;
    });

    return {
      self: {
        user_id: data.userId,
        email: selfEmail,
        devices: (myDevices ?? []).map((d) => ({
          device_id: d.device_id,
          created_at: d.created_at,
          updated_at: d.updated_at,
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
