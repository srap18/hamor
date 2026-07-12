/**
 * Google Play Publisher API — server-only helpers.
 *
 * Uses Web Crypto via `jose` (Workers-compatible; no Node-only deps like
 * `googleapis` which requires `child_process` / native modules).
 *
 * Flow:
 *   1. Parse service-account JSON from env.
 *   2. Sign RS256 JWT (self-signed) with scope=androidpublisher.
 *   3. Exchange for OAuth2 access_token.
 *   4. Call androidpublisher.googleapis.com REST endpoints.
 */
import { SignJWT, importPKCS8 } from "jose";
import { parseServiceAccount, normalizePem, type ServiceAccount } from "./play-service-account.server";

let cachedToken: { token: string; expiresAt: number } | null = null;

function getServiceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON not configured");
  return parseServiceAccount(raw);
}


function getPackageName(): string {
  const pkg = process.env.GOOGLE_PLAY_PACKAGE_NAME;
  if (!pkg) throw new Error("GOOGLE_PLAY_PACKAGE_NAME not configured");
  return pkg;
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.token;

  const sa = getServiceAccount();
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";

  const pem = normalizePem(sa.private_key);

  const key = await importPKCS8(pem, "RS256");

  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/androidpublisher",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience(tokenUri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google OAuth failed [${res.status}]: ${body}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: now + json.expires_in };
  return json.access_token;
}

export type PlayProductRow = {
  sku: string;
  title_ar: string;
  title_en: string;
  description_ar: string;
  description_en: string;
  price_micros: number | string;
  default_currency: string;
  product_type: "inapp" | "subs";
  status: "active" | "inactive";
};

function buildInAppProductBody(pkg: string, row: PlayProductRow) {
  return {
    packageName: pkg,
    sku: row.sku,
    status: row.status === "active" ? "active" : "inactive",
    purchaseType: "managedUser",
    defaultPrice: {
      priceMicros: String(row.price_micros),
      currency: row.default_currency,
    },
    listings: {
      "en-US": { title: row.title_en, description: row.description_en || row.title_en },
      "ar": { title: row.title_ar, description: row.description_ar || row.title_ar },
    },
    defaultLanguage: "en-US",
  };
}

/**
 * Create/update a managed in-app product in Play Console.
 * Uses PATCH; falls back to POST insert if the SKU does not yet exist.
 */
export async function upsertInAppProduct(row: PlayProductRow): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const pkg = getPackageName();
    const token = await getAccessToken();
    const body = buildInAppProductBody(pkg, row);

    const putUrl =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(pkg)}/inappproducts/${encodeURIComponent(row.sku)}` +
      `?autoConvertMissingPrices=true`;

    const putRes = await fetch(putUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (putRes.ok) return { ok: true };

    // If SKU doesn't exist yet, PUT can 404 — insert instead.
    if (putRes.status === 404) {
      const insertUrl =
        `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
        `${encodeURIComponent(pkg)}/inappproducts?autoConvertMissingPrices=true`;
      const insRes = await fetch(insertUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (insRes.ok) return { ok: true };
      const errBody = await insRes.text();
      return { ok: false, error: `insert ${insRes.status}: ${errBody.slice(0, 500)}` };
    }

    const errBody = await putRes.text();
    return { ok: false, error: `update ${putRes.status}: ${errBody.slice(0, 500)}` };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/**
 * Delete a managed in-app product from Play Console.
 */
export async function deleteInAppProduct(sku: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const pkg = getPackageName();
    const token = await getAccessToken();
    const url =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(pkg)}/inappproducts/${encodeURIComponent(sku)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok || res.status === 404) return { ok: true };
    const body = await res.text();
    return { ok: false, error: `delete ${res.status}: ${body.slice(0, 500)}` };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/**
 * Dispatch one product row to Play (upsert or delete based on status/product_type).
 * Subscriptions ('subs') are not implemented yet — surfaced as an explicit error.
 */
export async function syncPlayProduct(row: PlayProductRow) {
  if (row.product_type === "subs") {
    return { ok: false as const, error: "subscriptions sync not implemented yet" };
  }
  return upsertInAppProduct(row);
}
