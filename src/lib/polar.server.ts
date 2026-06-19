// Polar REST API helpers — server-only.
// Used by createPolarCheckout, verifyPolarCheckout, and the webhook handler.

export type PolarEnv = "sandbox" | "live";

export function getPolarEnv(): PolarEnv {
  const v = (process.env.POLAR_ENV || "").toLowerCase();
  return v === "live" || v === "production" ? "live" : "sandbox";
}

export function getPolarBase(): string {
  return getPolarEnv() === "live"
    ? "https://api.polar.sh/v1"
    : "https://sandbox-api.polar.sh/v1";
}

function authHeaders(): Record<string, string> {
  const tok = process.env.POLAR_ACCESS_TOKEN;
  if (!tok) throw new Error("POLAR_ACCESS_TOKEN not configured");
  return {
    Authorization: `Bearer ${tok}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function polarFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${getPolarBase()}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Polar ${init.method || "GET"} ${path} failed: ${res.status} ${body}`);
  }
  return (await res.json()) as T;
}

// ───── Product cache keyed by metadata.pack_id ────────────────────────────
type PolarProduct = {
  id: string;
  name: string;
  is_archived: boolean;
  metadata?: Record<string, unknown> | null;
  prices?: Array<{ id: string; amount_type?: string; price_amount?: number | null }>;
};

type ProductsListResponse = {
  items: PolarProduct[];
  pagination?: { total_count?: number; max_page?: number };
};

let cache: { at: number; map: Map<string, PolarProduct> } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchAllProducts(): Promise<PolarProduct[]> {
  const all: PolarProduct[] = [];
  let page = 1;
  for (;;) {
    const res = await polarFetch<ProductsListResponse>(
      `/products?is_archived=false&limit=100&page=${page}`,
    );
    const items = res.items || [];
    all.push(...items);
    const maxPage = res.pagination?.max_page ?? 1;
    if (page >= maxPage || items.length === 0) break;
    page += 1;
    if (page > 20) break; // safety
  }
  return all;
}

async function ensureCache(force = false): Promise<Map<string, PolarProduct>> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.map;
  const products = await fetchAllProducts();
  const map = new Map<string, PolarProduct>();
  for (const p of products) {
    if (p.is_archived) continue;
    const md = p.metadata as Record<string, unknown> | null | undefined;
    const packId = md?.pack_id;
    if (typeof packId === "string" && packId.length > 0) {
      map.set(packId, p);
    }
  }
  cache = { at: Date.now(), map };
  return map;
}

export async function findProductByPackId(
  packId: string,
): Promise<PolarProduct | null> {
  let map = await ensureCache(false);
  let hit = map.get(packId) || null;
  if (!hit) {
    // refresh in case product was just added
    map = await ensureCache(true);
    hit = map.get(packId) || null;
  }
  return hit;
}

// ───── Checkout ───────────────────────────────────────────────────────────
export type CreateCheckoutInput = {
  productId: string;
  productPriceId?: string;
  externalCustomerId: string;
  customerEmail?: string;
  successUrl: string;
  metadata?: Record<string, string>;
};

export type PolarCheckout = {
  id: string;
  url: string;
  status: string;
  customer_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function createCheckout(input: CreateCheckoutInput): Promise<PolarCheckout> {
  const body: Record<string, unknown> = {
    products: [input.productId],
    external_customer_id: input.externalCustomerId,
    success_url: input.successUrl,
    metadata: input.metadata ?? {},
  };
  if (input.customerEmail) body.customer_email = input.customerEmail;
  if (input.productPriceId) body.product_price_id = input.productPriceId;

  return polarFetch<PolarCheckout>("/checkouts/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getCheckout(checkoutId: string): Promise<PolarCheckout & {
  product_id?: string;
  amount?: number | null;
  customer_external_id?: string | null;
}> {
  return polarFetch(`/checkouts/${encodeURIComponent(checkoutId)}`);
}
