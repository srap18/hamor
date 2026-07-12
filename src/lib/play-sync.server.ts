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

const PRODUCT_UPDATE_MASK = "listings,purchaseOptions,taxAndComplianceSettings";
const LATENCY_TOLERANT = "PRODUCT_UPDATE_LATENCY_TOLERANCE_LATENCY_TOLERANT";
const BATCH_SIZE = 20;

async function fetchGoogleWithQuotaRetry(
  url: string,
  init: RequestInit,
  maxAttempts = 4,
): Promise<Response> {
  let response: Response | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    response = await fetch(url, init);
    if (response.status !== 429 && response.status !== 403) return response;

    const responseText = await response.clone().text();
    const quotaExceeded = responseText.includes("RATE_LIMIT_EXCEEDED") || responseText.includes("Quota exceeded");
    if (!quotaExceeded || attempt === maxAttempts - 1) return response;

    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(retryAfterSeconds * 1000, 15_000)
      : 1_500 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return response!;
}

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

function truncateText(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join("");
}

function buildOneTimeProductBody(pkg: string, row: PlayProductRow) {
  const currency = (row.default_currency || "USD").toUpperCase();
  const region = CURRENCY_TO_REGION[currency] || "US";
  const price = microsToMoney(row.price_micros, currency);
  const titleEn = truncateText(row.title_en || row.sku, 55);
  const titleAr = truncateText(row.title_ar || row.title_en || row.sku, 55);
  const descriptionEn = truncateText(row.description_en || titleEn, 200);
  const descriptionAr = truncateText(row.description_ar || titleAr, 200);

  return {
    packageName: pkg,
    productId: row.sku,
    listings: [
      {
        languageCode: "en-US",
        title: titleEn,
        description: descriptionEn,
      },
      {
        languageCode: "ar",
        title: titleAr,
        description: descriptionAr,
      },
    ],
    purchaseOptions: [
      {
        purchaseOptionId: "default",
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
        taxAndComplianceSettings: {
          withdrawalRightType: "WITHDRAWAL_RIGHT_DIGITAL_CONTENT",
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
      updateMask: PRODUCT_UPDATE_MASK,
      allowMissing: "true",
      "regionsVersion.version": "2022/02",
      latencyTolerance: LATENCY_TOLERANT,
    });
    const url =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(pkg)}/onetimeproducts/${encodeURIComponent(row.sku)}?${params.toString()}`;

    const res = await fetchGoogleWithQuotaRetry(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const responseText = await res.text();
    if (res.ok) {
      const product = JSON.parse(responseText || "{}") as {
        purchaseOptions?: { purchaseOptionId?: string; state?: string }[];
      };
      const option = product.purchaseOptions?.find((item) => item.purchaseOptionId === "default");
      const desiredState = row.status === "active" ? "ACTIVE" : "INACTIVE";
      const currentState = option?.state;
      const needsActivation = desiredState === "ACTIVE" && currentState !== "ACTIVE";
      const needsDeactivation = desiredState === "INACTIVE" && currentState === "ACTIVE";

      if (!needsActivation && !needsDeactivation) return { ok: true };

      const stateUrl =
        `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
        `${encodeURIComponent(pkg)}/oneTimeProducts/${encodeURIComponent(row.sku)}/purchaseOptions:batchUpdateStates`;
      const stateRequestKey = needsActivation
        ? "activatePurchaseOptionRequest"
        : "deactivatePurchaseOptionRequest";
      const stateBody = {
        requests: [
          {
            [stateRequestKey]: {
              packageName: pkg,
              productId: row.sku,
              purchaseOptionId: "default",
               latencyTolerance: LATENCY_TOLERANT,
            },
          },
        ],
      };
       const stateRes = await fetchGoogleWithQuotaRetry(stateUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(stateBody),
      });
      const stateResponseText = await stateRes.text();
      if (stateRes.ok) return { ok: true };
      console.error("[play-sync] purchase option state update failed", {
        sku: row.sku,
        url: stateUrl,
        status: stateRes.status,
        body: stateResponseText,
        requestBody: stateBody,
      });
      return {
        ok: false,
        error: `PATCH ${url}\nHTTP ${res.status}\n${responseText}\n\nPOST ${stateUrl}\nHTTP ${stateRes.status}\n${stateResponseText}\n\nSTATE REQUEST BODY:\n${JSON.stringify(stateBody, null, 2)}`,
      };
    }
    const errBody = responseText;
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

export type PlaySyncResult = { ok: true } | { ok: false; error: string };

/**
 * Synchronize a catalog in batches. This uses at most one catalog request and
 * one state request per 20 products instead of two API calls per product.
 */
export async function batchSyncPlayProducts(
  rows: PlayProductRow[],
): Promise<Map<string, PlaySyncResult>> {
  const results = new Map<string, PlaySyncResult>();
  const pkg = getPackageName();
  const token = await getAccessToken();

  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const chunk = rows.slice(offset, offset + BATCH_SIZE);
    const updateUrl =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(pkg)}/oneTimeProducts:batchUpdate`;
    const updateBody = {
      requests: chunk.map((row) => ({
        oneTimeProduct: buildOneTimeProductBody(pkg, row),
        updateMask: PRODUCT_UPDATE_MASK,
        regionsVersion: { version: "2022/02" },
        allowMissing: true,
        latencyTolerance: LATENCY_TOLERANT,
      })),
    };

    const updateResponse = await fetchGoogleWithQuotaRetry(updateUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updateBody),
    });
    const updateResponseText = await updateResponse.text();

    if (!updateResponse.ok) {
      const error =
        `POST ${updateUrl}\nHTTP ${updateResponse.status}\n${updateResponseText}` +
        `\n\nUPDATE MASK: ${PRODUCT_UPDATE_MASK}\nBATCH SIZE: ${chunk.length}`;
      console.error("[play-sync] batch upsert failed", {
        url: updateUrl,
        status: updateResponse.status,
        body: updateResponseText,
        skus: chunk.map((row) => row.sku),
      });
      for (const row of chunk) results.set(row.sku, { ok: false, error });
      continue;
    }

    const responseJson = JSON.parse(updateResponseText || "{}") as {
      oneTimeProducts?: {
        productId?: string;
        purchaseOptions?: { purchaseOptionId?: string; state?: string }[];
      }[];
    };
    const returnedBySku = new Map(
      (responseJson.oneTimeProducts ?? [])
        .filter((product) => product.productId)
        .map((product) => [product.productId!, product]),
    );
    const stateRequests: Record<string, unknown>[] = [];
    const stateSkus: string[] = [];

    for (const row of chunk) {
      const currentState = returnedBySku.get(row.sku)?.purchaseOptions
        ?.find((option) => option.purchaseOptionId === "default")?.state;
      const shouldActivate = row.status === "active" && currentState !== "ACTIVE";
      const shouldDeactivate = row.status === "inactive" && currentState === "ACTIVE";
      if (!shouldActivate && !shouldDeactivate) {
        results.set(row.sku, { ok: true });
        continue;
      }
      const requestKey = shouldActivate
        ? "activatePurchaseOptionRequest"
        : "deactivatePurchaseOptionRequest";
      stateRequests.push({
        [requestKey]: {
          packageName: pkg,
          productId: row.sku,
          purchaseOptionId: "default",
          latencyTolerance: LATENCY_TOLERANT,
        },
      });
      stateSkus.push(row.sku);
    }

    if (stateRequests.length === 0) continue;

    const stateUrl =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(pkg)}/oneTimeProducts/-/purchaseOptions:batchUpdateStates`;
    const stateBody = { requests: stateRequests };
    const stateResponse = await fetchGoogleWithQuotaRetry(stateUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(stateBody),
    });
    const stateResponseText = await stateResponse.text();

    if (stateResponse.ok) {
      for (const sku of stateSkus) results.set(sku, { ok: true });
      continue;
    }

    const stateError =
      `POST ${stateUrl}\nHTTP ${stateResponse.status}\n${stateResponseText}` +
      `\n\nSTATE REQUEST BODY:\n${JSON.stringify(stateBody, null, 2)}`;
    console.error("[play-sync] batch state update failed", {
      url: stateUrl,
      status: stateResponse.status,
      body: stateResponseText,
      skus: stateSkus,
    });
    for (const sku of stateSkus) results.set(sku, { ok: false, error: stateError });
  }

  return results;
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
