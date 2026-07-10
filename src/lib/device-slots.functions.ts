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


// Fingerprint algorithm version. Bump when signal collection or weighting changes
// so the server can support old + new devices concurrently and migrate gradually.
export const FINGERPRINT_VERSION = 1;


// Weighted fuzzy match — server-side second pass when exact hash doesn't match.
// Weights sum ≈ 100. If similarity ≥ 90%, we treat it as the same physical device.
const WEIGHTS: Record<string, number> = {
  webglRenderer: 20,
  webglVendor: 8,
  webglParams: 5,
  canvas: 12,
  audio: 15,
  cores: 8,
  memory: 8,
  fonts: 10,
  screen: 4,
  platform: 4,
  tz: 2,
  media: 4,
};

function similarity(a: Record<string, any>, b: Record<string, any>): number {
  let score = 0, total = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    total += w;
    const va = a?.[k], vb = b?.[k];
    if (va != null && vb != null && String(va) === String(vb)) score += w;
  }
  return total > 0 ? (score / total) * 100 : 0;
}

function svc() {
  const { createClient } = require("@supabase/supabase-js");
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * Given a client-provided hash + raw signals, return the canonical device hash
 * (server-authoritative). If a similar existing device is found via weighted
 * fuzzy match (≥90%), reuses its hash. Otherwise persists the new one.
 */
async function resolveDeviceHash(clientHash: string, signals: Record<string, any>): Promise<string> {
  const sb = svc();
  if (!clientHash || clientHash.length < 16) return clientHash || "";

  // Exact hit
  const { data: exact } = await sb.from("device_fingerprints").select("hardware_hash").eq("hardware_hash", clientHash).maybeSingle();
  if (exact) {
    await sb.from("device_fingerprints").update({ last_seen: new Date().toISOString(), signals }).eq("hardware_hash", clientHash);
    return clientHash;
  }

  // Fuzzy: only compare to devices seen recently (last 90 days) to bound work
  const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString();
  const { data: recent } = await sb
    .from("device_fingerprints")
    .select("hardware_hash, signals")
    .gte("last_seen", cutoff)
    .limit(500);

  let best: { hash: string; score: number } | null = null;
  for (const row of recent || []) {
    const s = similarity(signals, row.signals || {});
    if (s >= 90 && (!best || s > best.score)) best = { hash: row.hardware_hash, score: s };
  }

  if (best) {
    await sb.from("device_fingerprints").update({ last_seen: new Date().toISOString(), signals }).eq("hardware_hash", best.hash);
    return best.hash;
  }

  await sb.from("device_fingerprints").insert({ hardware_hash: clientHash, signals, fingerprint_version: FINGERPRINT_VERSION });
  return clientHash;
}

// ---------- Public server functions ----------

export const deviceSlotCheck = createServerFn({ method: "POST" })
  .inputValidator((i: { hardwareHash: string; signals?: Record<string, any>; userId?: string | null; email?: string | null }) => ({
    hardwareHash: (i?.hardwareHash ?? "").trim(),
    signals: i?.signals || {},
    userId: i?.userId ?? null,
    email: i?.email ?? null,
  }))
  .handler(async ({ data }) => {
    if (!data.hardwareHash) return { action: "allowed", reason: "no_fingerprint", canonicalHash: null };
    const sb = svc();
    const canonicalHash = await resolveDeviceHash(data.hardwareHash, data.signals);
    const { data: res, error } = await sb.rpc("device_slot_check", {
      _hardware_hash: canonicalHash,
      _user_id: data.userId,
      _email: data.email,
      _fingerprint_version: FINGERPRINT_VERSION,
    });
    if (error) return { action: "allowed", reason: "check_error", canonicalHash, error: error.message };
    return { ...(res as any), canonicalHash };
  });

export const deviceAssignSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { hardwareHash: string }) => ({ hardwareHash: (i?.hardwareHash ?? "").trim() }))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await context.supabase.rpc("device_assign_slot", {
      _hardware_hash: data.hardwareHash,
      _user_id: context.userId,
      _fingerprint_version: FINGERPRINT_VERSION,
    });
    if (error) return { ok: false, error: error.message };
    return res as any;
  });

export const deviceMigrationCandidates = createServerFn({ method: "POST" })
  .inputValidator((i: { hardwareHash: string }) => ({ hardwareHash: (i?.hardwareHash ?? "").trim() }))
  .handler(async ({ data }) => {
    const sb = svc();
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
    const sb = svc();
    const { data: res, error } = await sb.rpc("device_migrate_choose", {
      _hardware_hash: data.hardwareHash,
      _user_a: data.userA,
      _user_b: data.userB,
      _fingerprint_version: FINGERPRINT_VERSION,
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
    const sb = svc();
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
    const sb = svc();
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
