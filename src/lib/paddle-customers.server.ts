/* eslint-disable @typescript-eslint/no-explicit-any */
import { gatewayFetch, type PaddleEnv } from "@/lib/paddle.server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim();
  if (!e || !EMAIL_RE.test(e)) return null;
  return e;
}

/**
 * Look up Paddle customers by email, tolerantly.
 * Paddle returns 400 when the `email` filter is not a valid address (spaces,
 * missing @, placeholder logins...), which used to surface as
 * `customer_lookup_400` and abort the whole reconcile. We now:
 *  1) validate/normalize the address first,
 *  2) fall back to the `search` filter when the strict filter fails.
 */
export async function findPaddleCustomers(
  env: PaddleEnv,
  rawEmail: string | null | undefined,
): Promise<{ customers: any[]; reason: string | null; email: string | null }> {
  const email = normalizeEmail(rawEmail);
  if (!email) {
    return { customers: [], reason: "invalid_email", email: (rawEmail ?? "").trim() || null };
  }

  const res = await gatewayFetch(env, `/customers?email=${encodeURIComponent(email)}`);
  if (res.ok) {
    const body = await res.json();
    const customers: any[] = body?.data ?? [];
    if (customers.length > 0) return { customers, reason: null, email };
  }

  // Fallback: free-text search (also catches archived / differently-cased records).
  const searchRes = await gatewayFetch(env, `/customers?search=${encodeURIComponent(email)}`);
  if (!searchRes.ok) {
    return { customers: [], reason: `customer_lookup_${res.ok ? searchRes.status : res.status}`, email };
  }
  const searchBody = await searchRes.json();
  const found: any[] = (searchBody?.data ?? []).filter(
    (c: any) => String(c?.email ?? "").toLowerCase() === email.toLowerCase(),
  );
  return { customers: found, reason: found.length ? null : "no_customer", email };
}
