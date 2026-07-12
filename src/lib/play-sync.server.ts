/**
 * Google Play Publisher API — server-only helpers.
 *
 * Uses the new Monetization API (monetization.onetimeproducts) — the legacy
 * inappproducts endpoints have been deprecated by Google.
 *
 * Uses Web Crypto via `jose` (Workers-compatible; no Node-only deps).
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

// Best-effort currency → default region mapping for the required regional
// pricing entry. `newRegionsConfig` covers everything else.
const CURRENCY_TO_REGION: Record<string, string> = {
  USD: "US",
  SAR: "SA",
  AED: "AE",
  KWD: "KW",
  QAR: "QA",
  BHD: "BH",
  OMR: "OM",
  JOD: "JO",
  EGP: "EG",
  EUR: "DE",
  GBP: "GB",
  TRY: "TR",
  INR: "IN",
  IDR: "ID",
  BRL: "BR",
  JPY: "JP",
  KRW: "KR",
  CNY: "CN",
  CAD: "CA",
  AUD: "AU",
};

function microsToMoney(micros: number | string, currencyCode: string) {
  const n = BigInt(String(micros));
  const units = n / 1_000_000n;
  const remainder = n % 1_000_000n;
  const nanos = Number(remainder) * 1000; // micros → nanos
  return {
    currencyCode,
    units: units.toString(),
    nanos,
  };
}

function buildOneTimeProductBody(pkg: string, row: PlayProductRow) {
  const currency = (row.default_currency || "USD").toUpperCase();
  const region = CURRENCY_TO_REGION[currency] || "US";
  const price = microsToMoney(row.price_micros, currency);
  const state = row.status === "active" ? "ACTIVE" : "INACTIVE";

  return {
    packageName: pkg,
    productId: row.sku,
    listings: [
      {
        languageCode: "en-US",
        title: row.title_en || row.sku,
        description: row.description_en || row.title_en || row.sku,
      },
      {
        languageCode: "ar",
        title: row.title_ar || row.title_en || row.sku,
        description: row.description_ar || row.title_ar || row.title_en || row.sku,
      },
    ],
    taxAndComplianceSettings: {
      eeaWithdrawalRightType: "WITHDRAWAL_RIGHT_DIGITAL_CONTENT",
    },
    purchaseOptions: [
      {
        purchaseOptionId: "default",
        state,
        buyOption: {
          legacyCompatible: true,
          multiQuantityEnabled: false,
        },
        regionalPricingAndAvailabilityConfigs: [
          {
            regionCode: region,
            price,
            availability: "AVAILABLE",
          },
        ],
        newRegionsConfig: {
          newRegionsPrice: price,
          availability: "AVAILABLE",
        },
      },
    ],
  };
}

/**
 * Create or update a managed one-time product via monetization.onetimeproducts.
 * Google's PATCH route is intentionally lowercase `onetimeproducts`, unlike
 * the camel-cased read/delete/list routes. allowMissing=true makes it an upsert.
 */
export async function upsertInAppProduct(row: PlayProductRow): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const pkg = getPackageName();
    const token = await getAccessToken();
    const body = buildOneTimeProductBody(pkg, row);

    const params = new URLSearchParams({
      updateMask: "*",
      allowMissing: "true",
      "regionsVersion.version": "2022/02",
      latencyTolerance: "PRODUCT_UPDATE_LATENCY_TOLERANCE_LATENCY_SENSITIVE",
    });
    const url =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(pkg)}/onetimeproducts/${encodeURIComponent(row.sku)}?${params.toString()}`;

    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) return { ok: true };
    const errBody = await res.text();
    // Log full details server-side for debugging.
    console.error("[play-sync] upsert failed", {
      sku: row.sku,
      url,
      status: res.status,
      body: errBody,
      requestBody: body,
    });
    return {
      ok: false,
      error: `PATCH ${url}\nHTTP ${res.status}\n${errBody}\n\nREQUEST BODY:\n${JSON.stringify(body, null, 2)}`,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/**
 * Delete a managed one-time product from Play Console (new Monetization API).
 */
export async function deleteInAppProduct(sku: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const pkg = getPackageName();
    const token = await getAccessToken();
    const url =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(pkg)}/oneTimeProducts/${encodeURIComponent(sku)}`;
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
