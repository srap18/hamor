/**
 * Device Slot & Fingerprint System — Core Rules
 *
 * 1. Two accounts per device maximum (Slots A/B).
 * 2. No limit on how many devices a single account may use.
 * 3. Each device keeps its own independent pair of Slots.
 * 4. New phone/tablet/browser does not affect the account; the new device gets its own 2 slots.
 * 5. Deleting app or browser data on the same device does not bypass the system if the same hardware fingerprint is recognized.
 * 6. A third account on a full device is blocked until the 14-day lock expires or an admin resets slots.
 * 7. Admin accounts are exempt from all device-slot and fingerprint restrictions.
 * 8. All verification, assignment, migration, and appeal decisions are enforced server-side via RPC.
 *
 * See mem://features/device-slot-system for full specification.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const deviceSlotCheck = createServerFn({ method: "POST" })
  .inputValidator((i: {
    hardwareHash: string;
    signals?: Record<string, any>;
    userId?: string | null;
    email?: string | null;
    stableKey?: string | null;
    noiseKey?: string | null;
    nativeId?: string | null;
    strong?: boolean;
  }) => ({
    hardwareHash: (i?.hardwareHash ?? "").trim(),
    signals: i?.signals || {},
    userId: i?.userId ?? null,
    email: i?.email ?? null,
    stableKey: i?.stableKey ?? null,
    noiseKey: i?.noiseKey ?? null,
    nativeId: i?.nativeId ?? null,
    strong: !!i?.strong,
  }))
  .handler(async ({ data }) => {
    const { getDeviceSlotServiceClient, resolveDeviceHash, resolveDeviceIdentity } =
      await import("./device-slots.server");
    const fingerprintVersion = 1;
    if (!data.hardwareHash) return { action: "allowed", reason: "no_fingerprint", canonicalHash: null };
    const sb = getDeviceSlotServiceClient();
    let canonicalHash = await resolveDeviceHash(data.hardwareHash, data.signals, fingerprintVersion);
    // Record the high-precision hardware identity for this account (accuracy
    // first: weak fingerprints are ignored and nothing network-based is used).
    try {
      const identity = await resolveDeviceIdentity({
        stableKey: data.stableKey,
        noiseKey: data.noiseKey,
        nativeId: data.nativeId,
        signals: data.signals,
        strong: data.strong,
        hardwareHash: canonicalHash,
        userId: data.userId,
      });
      // A confirmed physical device always uses one shared device code, so
      // repeated installs / home-screen shortcuts cannot mint new slots.
      if (!identity.generic && identity.canonicalHash && identity.canonicalHash.length >= 16) {
        canonicalHash = identity.canonicalHash;
      }
    } catch {}
    const { data: res, error } = await sb.rpc("device_slot_check", {
      _hardware_hash: canonicalHash,
      _user_id: data.userId,
      _email: data.email,
      _fingerprint_version: fingerprintVersion,
    });
    if (error) return { action: "allowed", reason: "check_error", canonicalHash, error: error.message };
    return { ...(res as any), canonicalHash };

  });

/**
 * Re-registers the physical device identity for an already signed-in account.
 * Needed so device-wide moderation (mute/ban) also covers accounts that stay
 * logged in and never pass through the login/signup slot check again.
 */
export const deviceIdentityTouch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: {
    hardwareHash?: string | null;
    signals?: Record<string, any>;
    stableKey?: string | null;
    noiseKey?: string | null;
    nativeId?: string | null;
    strong?: boolean;
  }) => ({
    hardwareHash: (i?.hardwareHash ?? "").trim() || null,
    signals: i?.signals || {},
    stableKey: i?.stableKey ?? null,
    noiseKey: i?.noiseKey ?? null,
    nativeId: i?.nativeId ?? null,
    strong: !!i?.strong,
  }))
  .handler(async ({ data, context }) => {
    try {
      const { resolveDeviceIdentity } = await import("./device-slots.server");
      const res = await resolveDeviceIdentity({
        stableKey: data.stableKey,
        noiseKey: data.noiseKey,
        nativeId: data.nativeId,
        signals: data.signals,
        strong: data.strong,
        hardwareHash: data.hardwareHash,
        userId: context.userId,
      });
      return { ok: true, ...res };
    } catch {
      return { ok: false };
    }
  });


export const deviceAssignSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { hardwareHash: string }) => ({ hardwareHash: (i?.hardwareHash ?? "").trim() }))
  .handler(async ({ data, context }) => {
    const fingerprintVersion = 1;
    const { data: res, error } = await context.supabase.rpc("device_assign_slot", {
      _hardware_hash: data.hardwareHash,
      _user_id: context.userId,
      _fingerprint_version: fingerprintVersion,
    });
    if (error) return { ok: false, error: error.message };
    return res as any;
  });

export const deviceMigrationCandidates = createServerFn({ method: "POST" })
  .inputValidator((i: { hardwareHash: string }) => ({ hardwareHash: (i?.hardwareHash ?? "").trim() }))
  .handler(async ({ data }) => {
    const { getDeviceSlotServiceClient } = await import("./device-slots.server");
    const sb = getDeviceSlotServiceClient();
    const { data: res, error } = await sb.rpc("device_migration_candidates", { _hardware_hash: data.hardwareHash });
    if (error) return { candidates: [], error: error.message };
    return res as { candidates: Array<{ user_id: string; display_name: string; email: string; last_seen: string }> };
  });

export const deviceMigrateChoose = createServerFn({ method: "POST" })
  .inputValidator((i: { hardwareHash: string; userA: string; userB?: string | null }) => ({
    hardwareHash: (i?.hardwareHash ?? "").trim(),
    userA: i.userA,
    userB: i?.userB ?? null,
  }))
  .handler(async ({ data }) => {
    const { getDeviceSlotServiceClient } = await import("./device-slots.server");
    const sb = getDeviceSlotServiceClient();
    const { data: res, error } = await sb.rpc("device_migrate_choose", {
      _hardware_hash: data.hardwareHash,
      _user_a: data.userA,
      _user_b: data.userB,
      _fingerprint_version: 1,
    });
    if (error) return { ok: false, error: error.message };
    return res as any;
  });

export const deviceSubmitAppeal = createServerFn({ method: "POST" })
  .inputValidator((i: { hardwareHash: string; email?: string | null; message: string }) => ({
    hardwareHash: (i?.hardwareHash ?? "").trim(),
    email: (i?.email ?? "").trim().toLowerCase() || null,
    message: (i?.message ?? "").trim().slice(0, 2000),
  }))
  .handler(async ({ data }) => {
    const { getDeviceSlotServiceClient } = await import("./device-slots.server");
    const sb = getDeviceSlotServiceClient();
    const { data: res, error } = await sb.rpc("device_submit_appeal", {
      _hardware_hash: data.hardwareHash,
      _email: data.email,
      _message: data.message,
    });
    if (error) return { ok: false, error: error.message };
    return res as any;
  });

// ---------- Admin ----------
export const adminListDeviceAppeals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isPriv } = await context.supabase.rpc("device_is_privileged", { _uid: context.userId });
    if (!isPriv) return { appeals: [], error: "forbidden" };
    const { getDeviceSlotServiceClient } = await import("./device-slots.server");
    const sb = getDeviceSlotServiceClient();
    const { data: appeals } = await sb
      .from("device_appeals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    // Attach slot info
    const hashes = Array.from(new Set((appeals || []).map((a: any) => a.hardware_hash)));
    const { data: slots } = hashes.length
      ? await sb.from("device_slots").select("hardware_hash, slot_index, user_id, locked_until").in("hardware_hash", hashes)
      : { data: [] };
    const userIds = Array.from(new Set([
      ...(slots || []).map((s: any) => s.user_id),
      ...(appeals || []).map((a: any) => a.user_id).filter(Boolean),
    ]));
    const { data: profiles } = userIds.length
      ? await sb.from("profiles").select("id, display_name, username").in("id", userIds)
      : { data: [] };
    return {
      appeals: appeals || [],
      slots: slots || [],
      profiles: profiles || [],
    };
  });

export const adminResolveDeviceAppeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { appealId: string; approve: boolean }) => i)
  .handler(async ({ data, context }) => {
    const rpc = data.approve ? "device_admin_approve_appeal" : "device_admin_reject_appeal";
    const { data: res, error } = await context.supabase.rpc(rpc, { _appeal_id: data.appealId });
    if (error) return { ok: false, error: error.message };
    return res as any;
  });

export const adminListDeviceAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { hardwareHash?: string | null; limit?: number }) => ({
    hardwareHash: (i?.hardwareHash ?? "").trim() || null,
    limit: Math.min(Math.max(i?.limit ?? 100, 1), 500),
  }))
  .handler(async ({ data, context }) => {
    const { data: isPriv } = await context.supabase.rpc("device_is_privileged", { _uid: context.userId });
    if (!isPriv) return { entries: [], error: "forbidden" };
    const { getDeviceSlotServiceClient } = await import("./device-slots.server");
    const sb = getDeviceSlotServiceClient();
    let q = sb.from("device_slot_audit").select("*").order("created_at", { ascending: false }).limit(data.limit);
    if (data.hardwareHash) q = q.eq("hardware_hash", data.hardwareHash);
    const { data: entries, error } = await q;
    if (error) return { entries: [], error: error.message };
    return { entries: entries || [] };
  });

export const adminDeviceSlotMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { days?: number }) => ({ days: Math.min(Math.max(i?.days ?? 7, 1), 90) }))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await context.supabase.rpc("device_slot_metrics", { _days: data.days });
    if (error) return { error: error.message };
    return res as any;
  });

