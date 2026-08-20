import { createClient } from "@supabase/supabase-js";

const FINGERPRINT_WEIGHTS: Record<string, number> = {
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

function similarity(a: Record<string, unknown>, b: Record<string, unknown>): number {
  let score = 0;
  let total = 0;
  for (const [key, weight] of Object.entries(FINGERPRINT_WEIGHTS)) {
    total += weight;
    const left = a[key];
    const right = b[key];
    if (left != null && right != null && String(left) === String(right)) score += weight;
  }
  return total > 0 ? (score / total) * 100 : 0;
}

function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Device verification is temporarily unavailable");
  return createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export async function resolveDeviceHash(
  clientHash: string,
  signals: Record<string, unknown>,
  fingerprintVersion: number,
): Promise<string> {
  const sb = serviceClient();
  if (!clientHash || clientHash.length < 16) return clientHash || "";

  const { data: exact } = await sb
    .from("device_fingerprints")
    .select("hardware_hash")
    .eq("hardware_hash", clientHash)
    .maybeSingle();
  if (exact) {
    void sb
      .from("device_fingerprints")
      .update({ last_seen: new Date().toISOString(), signals })
      .eq("hardware_hash", clientHash);
    return clientHash;
  }

  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data: recent } = await sb
    .from("device_fingerprints")
    .select("hardware_hash, signals")
    .gte("last_seen", cutoff)
    .order("last_seen", { ascending: false })
    .limit(150);

  let best: { hash: string; score: number } | null = null;
  for (const row of recent ?? []) {
    const savedSignals = row.signals && typeof row.signals === "object"
      ? row.signals as Record<string, unknown>
      : {};
    const score = similarity(signals, savedSignals);
    if (score >= 90 && (!best || score > best.score)) best = { hash: row.hardware_hash, score };
  }

  if (best) {
    void sb
      .from("device_fingerprints")
      .update({ last_seen: new Date().toISOString(), signals })
      .eq("hardware_hash", best.hash);
    return best.hash;
  }

  const { error } = await sb.from("device_fingerprints").insert({
    hardware_hash: clientHash,
    signals,
    fingerprint_version: fingerprintVersion,
  });
  if (error && error.code !== "23505") throw error;
  return clientHash;
}

export function getDeviceSlotServiceClient() {
  return serviceClient();
}

/* ------------------------------------------------------------------ *
 * High-precision device identity
 * ------------------------------------------------------------------
 * Accuracy first: an identity is created/matched ONLY from hardware-bound
 * signals. IP address, network and any shared/environmental data are never
 * used. Two accounts are considered the same physical device only when:
 *   - the native OS device id matches (confidence 100), or
 *   - the hardware key AND the Canvas/Audio entropy key both match
 *     (confidence 96).
 * Anything below 95 is stored for reference but never triggers a ban.
 * ------------------------------------------------------------------ */

export interface IdentityInput {
  stableKey?: string | null;
  noiseKey?: string | null;
  nativeId?: string | null;
  signals?: Record<string, unknown>;
  strong?: boolean;
  hardwareHash?: string | null;
  userId?: string | null;
}

export interface IdentityResult {
  identityId: string | null;
  confidence: number;
  generic: boolean;
  /** Shared device code for this physical device (merges extra installs). */
  canonicalHash?: string | null;
}


const clean = (v: unknown, min = 16) => {
  const s = String(v ?? "").trim();
  return s.length >= min ? s : "";
};

export async function resolveDeviceIdentity(input: IdentityInput): Promise<IdentityResult> {
  const none: IdentityResult = { identityId: null, confidence: 0, generic: false };
  const stableKey = clean(input.stableKey, 32);
  const noiseKey = clean(input.noiseKey, 32);
  const nativeId = clean(input.nativeId, 8);

  // Weak / incomplete fingerprints must never link or ban anyone.
  if (!input.strong || !stableKey || (!noiseKey && !nativeId)) return none;

  const sb = serviceClient();
  const now = new Date().toISOString();
  const signals = input.signals ?? {};

  let row: { id: string; is_generic: boolean } | null = null;
  let confidence = 0;

  if (nativeId) {
    confidence = 100;
    const { data: found } = await sb
      .from("device_identities")
      .select("id, is_generic")
      .eq("native_id", nativeId)
      .maybeSingle();
    row = (found as any) ?? null;
    if (!row) {
      const { data: created } = await sb
        .from("device_identities")
        .insert({ stable_key: stableKey, noise_key: noiseKey || null, native_id: nativeId, signals })
        .select("id, is_generic")
        .maybeSingle();
      row = (created as any) ?? null;
    }
  } else {
    confidence = 96;
    const { data: found } = await sb
      .from("device_identities")
      .select("id, is_generic")
      .eq("stable_key", stableKey)
      .eq("noise_key", noiseKey)
      .is("native_id", null)
      .maybeSingle();
    row = (found as any) ?? null;
    if (!row) {
      const { data: created } = await sb
        .from("device_identities")
        .insert({ stable_key: stableKey, noise_key: noiseKey, signals })
        .select("id, is_generic")
        .maybeSingle();
      row = (created as any) ?? null;
    }
  }

  if (!row) return none;

  void sb.from("device_identities").update({ last_seen: now, signals }).eq("id", row.id);

  if (input.userId) {
    await sb.from("device_identity_users").upsert(
      {
        identity_id: row.id,
        user_id: input.userId,
        confidence,
        hardware_hash: input.hardwareHash ?? null,
        last_seen: now,
      },
      { onConflict: "identity_id,user_id" },
    );
  }

  // Every extra install (browser tab, "add to home screen" shortcut, re-install)
  // produces a different composite hash on the same phone. Fold them all onto a
  // single canonical device code so the 2-accounts-per-device rule cannot be
  // bypassed by installing the app again.
  let canonicalHash: string | null = null;
  try {
    const { data: canon } = await sb.rpc("device_identity_canonical", {
      _identity: row.id,
      _hash: input.hardwareHash ?? null,
    });
    const c = typeof canon === "string" ? canon.trim() : "";
    if (c.length >= 16) canonicalHash = c;
  } catch {}

  return { identityId: row.id, confidence, generic: !!row.is_generic, canonicalHash };

}

/** True only when a confirmed (>=95) account on this exact identity is banned. */
export async function identityIsBanned(identityId: string): Promise<boolean> {
  const sb = serviceClient();
  const { data } = await sb.rpc("device_identity_is_banned", { _identity: identityId });
  return data === true;
}
