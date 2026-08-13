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
  /** 0-100 — how certain we are it's literally the same physical device. */
  confidence: number;
  /** Human evidence labels (Arabic) describing WHY it matched. */
  evidence: string[];
};

/**
 * A hardware_hash / device_id shared by MORE than this many distinct users is
 * a model-collision fingerprint (identical phone models produce the same
 * canvas/audio/webgl signature, and blocked webviews produce a shared fallback
 * hash). The device-slot policy allows 2 accounts per device, so anything
 * above 3 users on one identifier is noise and is NEVER used to link accounts.
 */
const COLLISION_THRESHOLD = 3;

/** Matches weaker than this are dropped entirely (network / model lookalikes). */
const MIN_CONFIDENCE = 80;


/** Minimum length for an id to be considered a real fingerprint. */
const MIN_ID_LEN = 32;

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
    // PRIMARY SOURCE: device_slots (authoritative hardware bindings)
    // A row here means the account was actually seated onto that hardware.
    // ------------------------------------------------------------------
    const { data: mySlots } = await supabaseAdmin
      .from("device_slots")
      .select("hardware_hash")
      .eq("user_id", data.userId);
    const myHardwareHashes = Array.from(
      new Set((mySlots ?? []).map((r) => r.hardware_hash).filter(isRealId)),
    );

    // ------------------------------------------------------------------
    // SECONDARY SOURCE: exact device_history device_id matches. A one-shot
    // account is still relevant here because automated account creation often
    // records every throwaway account only once.
    // ------------------------------------------------------------------
    const { data: myDevicesRaw } = await supabaseAdmin
      .from("device_history")
      .select("device_id, first_seen, last_seen, hits")
      .eq("user_id", data.userId);
    const myDevices = (myDevicesRaw ?? []).filter((d) => isRealId(d.device_id));
    const myDeviceIds = Array.from(new Set(myDevices.map((d) => d.device_id!)));

    // IPs — displayed in the "self" panel only, NEVER used to link accounts.
    const { data: myIps } = await supabaseAdmin
      .from("user_ips")
      .select("ip, first_seen, last_seen, hits")
      .eq("user_id", data.userId);

    const deviceMap = new Map<string, Set<string>>();
    // per-user best confidence + human-readable evidence
    const scoreMap = new Map<string, number>();
    const evidenceMap = new Map<string, Set<string>>();
    const bump = (uid: string, score: number, label: string, ev?: string | null) => {
      scoreMap.set(uid, Math.max(scoreMap.get(uid) ?? 0, score));
      if (!evidenceMap.has(uid)) evidenceMap.set(uid, new Set());
      evidenceMap.get(uid)!.add(label);
      if (ev) {
        if (!deviceMap.has(uid)) deviceMap.set(uid, new Set());
        deviceMap.get(uid)!.add(ev);
      }
    };

    // Hardware hashes that are known model-collisions (attached to a "generic"
    // identity) must never link accounts.
    const genericHashes = new Set<string>();
    {
      const { data: genericIdents } = await supabaseAdmin
        .from("device_identities")
        .select("id")
        .eq("is_generic", true);
      const gIds = (genericIdents ?? []).map((r) => r.id);
      if (gIds.length) {
        for (let i = 0; i < gIds.length; i += 200) {
          const { data: rows } = await supabaseAdmin
            .from("device_identity_users")
            .select("hardware_hash")
            .in("identity_id", gIds.slice(i, i + 200));
          for (const r of rows ?? []) if (r.hardware_hash) genericHashes.add(r.hardware_hash);
        }
      }
    }

    // 1) device_slots hardware_hash — a real seating on that hardware.
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
        if (genericHashes.has(r.hardware_hash)) continue;
        const distinct = usersPerHash.get(r.hardware_hash)?.size ?? 0;
        if (distinct > COLLISION_THRESHOLD) continue;
        bump(r.user_id, 85, "بصمة عتاد مطابقة (خانة جهاز)", r.hardware_hash);
      }
    }

    // 2) exact device_history device_id (same browser/app storage).
    if (myDeviceIds.length > 0) {
      const { data: others } = await supabaseAdmin
        .from("device_history")
        .select("device_id, user_id, hits")
        .in("device_id", myDeviceIds);

      const usersPerDevice = new Map<string, Set<string>>();
      for (const r of others ?? []) {
        if (!isRealId(r.device_id)) continue;
        if (!usersPerDevice.has(r.device_id)) usersPerDevice.set(r.device_id, new Set());
        usersPerDevice.get(r.device_id)!.add(r.user_id);
      }
      for (const r of others ?? []) {
        if (r.user_id === data.userId) continue;
        if (!isRealId(r.device_id)) continue;
        const distinct = usersPerDevice.get(r.device_id)?.size ?? 0;
        if (distinct > COLLISION_THRESHOLD) continue;
        bump(r.user_id, 90, "نفس معرّف التطبيق/المتصفح على الجهاز", r.device_id);
      }
    }

    // 3) Hardware identities. native_id match = certain (same physical phone);
    // stable+noise match = strong but only when the identity isn't generic and
    // isn't shared by a crowd (model lookalikes on the same network).
    {
      const { data: mine } = await supabaseAdmin
        .from("device_identity_users")
        .select("identity_id, confidence")
        .eq("user_id", data.userId)
        .gte("confidence", 96);
      const identityIds = Array.from(new Set((mine ?? []).map((r) => r.identity_id)));
      if (identityIds.length) {
        const { data: idents } = await supabaseAdmin
          .from("device_identities")
          .select("id, is_generic, native_id")
          .in("id", identityIds);
        const good = (idents ?? []).filter((i) => !i.is_generic);
        const nativeById = new Map(good.map((i) => [i.id, !!i.native_id]));
        if (good.length) {
          const { data: peers } = await supabaseAdmin
            .from("device_identity_users")
            .select("identity_id, user_id, hardware_hash, confidence")
            .in("identity_id", good.map((i) => i.id))
            .gte("confidence", 96);

          const usersPerIdentity = new Map<string, Set<string>>();
          for (const r of peers ?? []) {
            if (!usersPerIdentity.has(r.identity_id)) usersPerIdentity.set(r.identity_id, new Set());
            usersPerIdentity.get(r.identity_id)!.add(r.user_id);
          }
          for (const r of peers ?? []) {
            if (r.user_id === data.userId) continue;
            const isNative = nativeById.get(r.identity_id) === true;
            const distinct = usersPerIdentity.get(r.identity_id)?.size ?? 0;
            // native id can legitimately hold several accounts (same phone);
            // fuzzy identities above the threshold are model collisions.
            if (!isNative && distinct > COLLISION_THRESHOLD) continue;
            bump(
              r.user_id,
              isNative ? 100 : 92,
              isNative ? "معرّف الجهاز من نظام التشغيل (مطابقة مؤكدة)" : "بصمة عتاد + بصمة رسم/صوت متطابقة",
              r.hardware_hash || r.identity_id,
            );
          }
        }
      }
    }

    // Drop everything below the confidence floor — those are network / same
    // phone-model lookalikes, not the same physical device.
    for (const uid of Array.from(deviceMap.keys())) {
      if ((scoreMap.get(uid) ?? 0) < MIN_CONFIDENCE) {
        deviceMap.delete(uid);
        scoreMap.delete(uid);
        evidenceMap.delete(uid);
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
