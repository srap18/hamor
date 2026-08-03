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