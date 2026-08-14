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
import { toPlayId } from "./iap-play-ids";

let cachedToken: { token: string; expiresAt: number } | null = null;

const PRODUCT_UPDATE_MASK = "listings,purchaseOptions";
const LATENCY_TOLERANT = "PRODUCT_UPDATE_LATENCY_TOLERANCE_LATENCY_TOLERANT";
const BATCH_SIZE = 5;
const BATCH_THROTTLE_MS = 1_500;

function isGoogleQuotaError(status: number, body: string): boolean {
  if (status !== 403 && status !== 429) return false;
  const normalized = body.toLowerCase();
  return normalized.includes("quota exceeded")
    || normalized.includes("rate_limit_exceeded")
    || normalized.includes("resource_exhausted");
}

async function fetchGoogleWithQuotaRetry(
  url: string,
  init: RequestInit,
  maxAttempts = 5,
): Promise<Response> {
  let response: Response | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    response = await fetch(url, init);
    const responseText = await response.clone().text();
    if (!isGoogleQuotaError(response.status, responseText) || attempt === maxAttempts - 1) return response;

    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(retryAfterSeconds * 1000, 30_000)
      : Math.min(2_000 * 2 ** attempt + Math.floor(Math.random() * 750), 30_000);
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

async function fetchExistingPurchaseOptions(
  pkg: string,
  playSku: string,
  token: string,
): Promise<any[] | null> {
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(pkg)}/oneTimeProducts/${encodeURIComponent(playSku)}`;
  const res = await fetchGoogleWithQuotaRetry(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const body = (await res.json()) as { purchaseOptions?: any[] };
  return body.purchaseOptions ?? [];
}

function buildOneTimeProductBody(
  pkg: string,
  row: PlayProductRow,
  existingPurchaseOptions?: any[] | null,
) {
  const playSku = toPlayId(row.sku);
  const currency = (row.default_currency || "USD").toUpperCase();
  const region = CURRENCY_TO_REGION[currency] || "US";
  const price = microsToMoney(row.price_micros, currency);
  const titleEn = truncateText(row.title_en || row.sku, 55);
  const titleAr = truncateText(row.title_ar || row.title_en || row.sku, 55);
  const descriptionEn = truncateText(row.description_en || titleEn, 200);
  const descriptionAr = truncateText(row.description_ar || titleAr, 200);

  // Auto-conversion only works when the base price is in USD (Google's
  // NewRegionsConfig expects `usdPrice` in USD). For any other base currency
  // we skip auto-conversion and just publish in the base region.
  const usdPriceForAutoConvert =
    currency === "USD" ? price : microsToMoney(row.price_micros, "USD");
  const eurPriceForAutoConvert = microsToMoney(row.price_micros, "EUR");
  const canAutoConvert = currency === "USD";

  // Google rejects any update that drops a region that already exists on the
  // product ("Cannot remove region once it has been added"). So we always start
  // from the regions Play already has and only override the base region price.
  const mergeRegions = (existingConfigs: any[] | undefined | null) => {
    const byRegion = new Map<string, any>();
    for (const cfg of existingConfigs ?? []) {
      if (cfg?.regionCode) byRegion.set(cfg.regionCode, { ...cfg });
    }
    byRegion.set(region, { regionCode: region, price, availability: "AVAILABLE" });
    return Array.from(byRegion.values());
  };

  const existingDefault = (existingPurchaseOptions ?? []).find(
    (opt) => opt?.purchaseOptionId === "default",
  );

  const defaultOption: any = {
    purchaseOptionId: "default",
    buyOption: {
      legacyCompatible: true,
      multiQuantityEnabled: false,
    },
    regionalPricingAndAvailabilityConfigs: mergeRegions(
      existingDefault?.regionalPricingAndAvailabilityConfigs,
    ),
    taxAndComplianceSettings: {
      withdrawalRightType: "WITHDRAWAL_RIGHT_DIGITAL_CONTENT",
    },
  };
  if (canAutoConvert) {
    defaultOption.newRegionsConfig = {
      availability: "AVAILABLE",
      usdPrice: usdPriceForAutoConvert,
      eurPrice: eurPriceForAutoConvert,
    };
  } else if (existingDefault?.newRegionsConfig) {
    defaultOption.newRegionsConfig = existingDefault.newRegionsConfig;
  }

  const preserved = (existingPurchaseOptions ?? [])
    .filter((opt) => opt?.purchaseOptionId && opt.purchaseOptionId !== "default")
    .map((opt) => {
      const cleaned: any = { ...opt };
      if (cleaned.buyOption) {
        cleaned.buyOption = { ...cleaned.buyOption, legacyCompatible: false };
      }
      if (cleaned.rentOption) {
        cleaned.rentOption = { ...cleaned.rentOption, legacyCompatible: false };
      }
      cleaned.regionalPricingAndAvailabilityConfigs = mergeRegions(
        opt.regionalPricingAndAvailabilityConfigs,
      );
      if (canAutoConvert) {
        cleaned.newRegionsConfig = {
          availability: "AVAILABLE",
          usdPrice: usdPriceForAutoConvert,
          eurPrice: eurPriceForAutoConvert,
        };
      }
      return cleaned;
    });



  return {
    packageName: pkg,
    productId: playSku,
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
    purchaseOptions: [defaultOption, ...preserved],
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
    const playSku = toPlayId(row.sku);
    const existing = await fetchExistingPurchaseOptions(pkg, playSku, token);
    const body = buildOneTimeProductBody(pkg, row, existing);

    const params = new URLSearchParams({
      updateMask: PRODUCT_UPDATE_MASK,
      allowMissing: "true",
      "regionsVersion.version": "2022/02",
      latencyTolerance: LATENCY_TOLERANT,
    });
    const url =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(pkg)}/onetimeproducts/${encodeURIComponent(playSku)}?${params.toString()}`;

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
        `${encodeURIComponent(pkg)}/oneTimeProducts/${encodeURIComponent(playSku)}/purchaseOptions:batchUpdateStates`;
      const stateRequestKey = needsActivation
        ? "activatePurchaseOptionRequest"
        : "deactivatePurchaseOptionRequest";
      const stateBody = {
        requests: [
          {
            [stateRequestKey]: {
              packageName: pkg,
              productId: playSku,
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
        sku: row.sku, playSku, url: stateUrl, status: stateRes.status, body: stateResponseText,
      });
      return {
        ok: false,
        error: `PATCH ${url}\nHTTP ${res.status}\n${responseText}\n\nPOST ${stateUrl}\nHTTP ${stateRes.status}\n${stateResponseText}\n\nSTATE REQUEST BODY:\n${JSON.stringify(stateBody, null, 2)}`,
      };
    }
    const errBody = responseText;
    console.error("[play-sync] upsert failed", {
      sku: row.sku, playSku, url, status: res.status, body: errBody, requestBody: body,
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

export type BatchPlaySyncResult = {
  results: Map<string, PlaySyncResult>;
  quotaBlocked: boolean;
};

/**
 * Synchronize a catalog in small batches. Google counts every product edit
 * inside a batch, so small chunks prevent one quota response from failing the
 * entire catalog and allow successful chunks to remain committed.
 */
export async function batchSyncPlayProducts(
  rows: PlayProductRow[],
): Promise<BatchPlaySyncResult> {
  const results = new Map<string, PlaySyncResult>();
  let quotaBlocked = false;
  const pkg = getPackageName();
  const token = await getAccessToken();

  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    if (offset > 0) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_THROTTLE_MS));
    }
    const chunk = rows.slice(offset, offset + BATCH_SIZE);
    const chunkPlaySkus = chunk.map((row) => toPlayId(row.sku));
    const existingByChunkIndex = await Promise.all(
      chunk.map((_, idx) => fetchExistingPurchaseOptions(pkg, chunkPlaySkus[idx], token).catch(() => null)),
    );
    const updateUrl =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(pkg)}/oneTimeProducts:batchUpdate`;
    const updateBody = {
      requests: chunk.map((row, idx) => ({
        oneTimeProduct: buildOneTimeProductBody(pkg, row, existingByChunkIndex[idx]),
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
      const quotaExceeded = isGoogleQuotaError(updateResponse.status, updateResponseText);
      const error =
        `POST ${updateUrl}\nHTTP ${updateResponse.status}\n${updateResponseText}` +
        `\n\nUPDATE MASK: ${PRODUCT_UPDATE_MASK}\nBATCH SIZE: ${chunk.length}` +
        (quotaExceeded
          ? "\n\nتم إيقاف بقية المزامنة لحماية الحصة. انتظر إعادة فتح حصة Google ثم اضغط مزامنة الكل مرة واحدة."
          : "");
      console.error("[play-sync] batch upsert failed", {
        url: updateUrl,
        status: updateResponse.status,
        body: updateResponseText,
        skus: chunk.map((row) => row.sku),
        playSkus: chunkPlaySkus,
      });
      for (const row of chunk) results.set(row.sku, { ok: false, error });
      if (quotaExceeded) {
        quotaBlocked = true;
        for (const row of rows.slice(offset + chunk.length)) {
          results.set(row.sku, {
            ok: false,
            error: "تم إيقاف المنتج مؤقتًا دون إرسال طلب له لأن حصة تعديلات Google Play ممتلئة. انتظر إعادة فتح الحصة ثم أعد المزامنة.",
          });
        }
        break;
      }
      continue;
    }

    const responseJson = JSON.parse(updateResponseText || "{}") as {
      oneTimeProducts?: {
        productId?: string;
        purchaseOptions?: { purchaseOptionId?: string; state?: string }[];
      }[];
    };
    const returnedByPlaySku = new Map(
      (responseJson.oneTimeProducts ?? [])
        .filter((product) => product.productId)
        .map((product) => [product.productId!, product]),
    );
    const stateRequests: Record<string, unknown>[] = [];
    const stateSkus: string[] = []; // DB skus (for results map keying)

    for (let i = 0; i < chunk.length; i++) {
      const row = chunk[i];
      const playSku = chunkPlaySkus[i];
      const currentState = returnedByPlaySku.get(playSku)?.purchaseOptions
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
          productId: playSku,
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

    if (isGoogleQuotaError(stateResponse.status, stateResponseText)) {
      quotaBlocked = true;
      for (const row of rows.slice(offset + chunk.length)) {
        results.set(row.sku, {
          ok: false,
          error: "تم إيقاف المنتج مؤقتًا دون إرسال طلب له لأن حصة تعديلات Google Play ممتلئة. انتظر إعادة فتح الحصة ثم أعد المزامنة.",
        });
      }
      break;
    }
  }

  return { results, quotaBlocked };
}

/**
 * Delete a managed one-time product from Play Console (new Monetization API).
 */
export async function deleteInAppProduct(sku: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const pkg = getPackageName();
    const token = await getAccessToken();
    const playSku = toPlayId(sku);
    const url =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(pkg)}/oneTimeProducts/${encodeURIComponent(playSku)}`;
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

// ═══════════════════════════════════════════════════════════════════════════
// SUBSCRIPTIONS (androidpublisher v3 monetization.subscriptions)
// ═══════════════════════════════════════════════════════════════════════════

const SUB_UPDATE_MASK = "listings,taxAndComplianceSettings";
const BASE_PLAN_UPDATE_MASK = "autoRenewingBasePlanType,regionalConfigs,otherRegionsConfig";

export type SubscriptionSyncDetail = {
  ok: boolean;
  error?: string;
  subscriptionExisted?: boolean;
  basePlanId?: string;
  basePlanState?: string;
};

async function fetchSubscription(
  pkg: string,
  productId: string,
  token: string,
): Promise<any | null> {
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(pkg)}/subscriptions/${encodeURIComponent(productId)}`;
  const res = await fetchGoogleWithQuotaRetry(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return await res.json();
}

function buildSubscriptionBody(pkg: string, row: PlayProductRow) {
  const playSku = toPlayId(row.sku);
  const titleEn = truncateText(row.title_en || row.sku, 55);
  const titleAr = truncateText(row.title_ar || titleEn, 55);
  const descriptionEn = truncateText(row.description_en || titleEn, 200);
  const descriptionAr = truncateText(row.description_ar || titleAr, 200);
  return {
    packageName: pkg,
    productId: playSku,
    listings: [
      { languageCode: "en-US", title: titleEn, description: descriptionEn, benefits: [] },
      { languageCode: "ar", title: titleAr, description: descriptionAr, benefits: [] },
    ],
    taxAndComplianceSettings: {
      eeaWithdrawalRightType: "WITHDRAWAL_RIGHT_SERVICE",
    },
  };
}

function buildBasePlanBody(row: PlayProductRow, basePlanId: string) {
  const currency = (row.default_currency || "USD").toUpperCase();
  const region = CURRENCY_TO_REGION[currency] || "US";
  const price = microsToMoney(row.price_micros, currency);
  const usdPrice = currency === "USD" ? price : microsToMoney(row.price_micros, "USD");
  const eurPrice = microsToMoney(row.price_micros, "EUR");
  return {
    basePlanId,
    autoRenewingBasePlanType: {
      billingPeriodDuration: "P1M",
      gracePeriodDuration: "P7D",
      accountHoldDuration: "P30D",
      resubscribeState: "RESUBSCRIBE_STATE_ACTIVE",
      prorationMode: "SUBSCRIPTION_PRORATION_MODE_CHARGE_ON_NEXT_BILLING_DATE",
      legacyCompatible: true,
    },
    regionalConfigs: [
      { regionCode: region, price, newSubscriberAvailability: true },
    ],
    otherRegionsConfig: {
      usdPrice,
      eurPrice,
      newSubscriberAvailability: true,
    },
  };
}

export async function upsertSubscription(
  row: PlayProductRow & { base_plan_id?: string | null },
): Promise<SubscriptionSyncDetail> {
  try {
    const pkg = getPackageName();
    const token = await getAccessToken();
    const playSku = toPlayId(row.sku);
    const basePlanId = (row.base_plan_id || "monthly")
      .toLowerCase().replace(/[^a-z0-9-]/g, "-");

    const existing = await fetchSubscription(pkg, playSku, token);
    const subscriptionExisted = existing !== null;

    // 1) Upsert the subscription "product" (listings + tax settings).
    const subBody = buildSubscriptionBody(pkg, row);
    const subParams = new URLSearchParams({
      updateMask: SUB_UPDATE_MASK,
      allowMissing: "true",
      "regionsVersion.version": "2022/02",
      latencyTolerance: LATENCY_TOLERANT,
    });
    const subUrl =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(pkg)}/subscriptions/${encodeURIComponent(playSku)}?${subParams.toString()}`;
    const subRes = await fetchGoogleWithQuotaRetry(subUrl, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(subBody),
    });
    const subText = await subRes.text();
    if (!subRes.ok) {
      console.error("[play-sync] subscription upsert failed", { sku: row.sku, playSku, status: subRes.status, body: subText });
      return {
        ok: false, subscriptionExisted, basePlanId,
        error: `PATCH ${subUrl}\nHTTP ${subRes.status}\n${subText}\n\nREQUEST BODY:\n${JSON.stringify(subBody, null, 2)}`,
      };
    }

    // 2) Read the current base plan state.
    //
    // Google Play's Monetization API does NOT expose PATCH/CREATE on the
    // individual `subscriptions/{sku}/basePlans/{id}` resource — that URL
    // returns an HTML 404 from Google's frontend, not a JSON API error.
    // Base plans are created inside Play Console (or via the parent
    // subscription payload with `basePlans` in the updateMask, but that
    // combination often collides with existing plans). Since our earlier
    // sync run already created + activated the `monthly` plan for every
    // subscription, we skip the PATCH and rely on the existing plan.
    // Pricing changes on already-published subscriptions must go through
    // `subscriptions.basePlans.migratePrices` and are not attempted here.
    const existingBasePlan = (existing?.basePlans ?? []).find(
      (b: any) => b?.basePlanId === basePlanId,
    );
    let currentState: string | undefined = existingBasePlan?.state;
    if (!existingBasePlan) {
      return {
        ok: false, subscriptionExisted, basePlanId,
        error:
          `Base plan "${basePlanId}" is missing on subscription "${playSku}" in Play Console.\n` +
          `Google's API does not allow creating base plans over REST. Create it manually in Play Console (Monetization → Subscriptions → ${playSku}) as a monthly (P1M) auto-renewing plan, then press "مزامنة الكل" again.\n\n` +
          `REQUEST BODY (for reference):\n${JSON.stringify(buildBasePlanBody(row, basePlanId), null, 2)}`,
      };
    }

    // 3) Activate / deactivate.
    const desired = row.status === "active" ? "ACTIVE" : "INACTIVE";
    if (desired === "ACTIVE" && currentState !== "ACTIVE") {
      const actUrl =
        `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
        `${encodeURIComponent(pkg)}/subscriptions/${encodeURIComponent(playSku)}` +
        `/basePlans/${encodeURIComponent(basePlanId)}:activate`;
      const actRes = await fetchGoogleWithQuotaRetry(actUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ packageName: pkg, productId: playSku, basePlanId, latencyTolerance: LATENCY_TOLERANT }),
      });
      const actText = await actRes.text();
      if (!actRes.ok) {
        console.error("[play-sync] base plan activate failed", { sku: row.sku, playSku, status: actRes.status, body: actText });
        return {
          ok: false, subscriptionExisted, basePlanId, basePlanState: currentState,
          error: `POST ${actUrl}\nHTTP ${actRes.status}\n${actText}`,
        };
      }
      currentState = "ACTIVE";
    } else if (desired === "INACTIVE" && currentState === "ACTIVE") {
      const deactUrl =
        `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
        `${encodeURIComponent(pkg)}/subscriptions/${encodeURIComponent(playSku)}` +
        `/basePlans/${encodeURIComponent(basePlanId)}:deactivate`;
      const deactRes = await fetchGoogleWithQuotaRetry(deactUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ packageName: pkg, productId: playSku, basePlanId, latencyTolerance: LATENCY_TOLERANT }),
      });
      if (deactRes.ok) currentState = "INACTIVE";
    }

    return { ok: true, subscriptionExisted, basePlanId, basePlanState: currentState };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export async function batchGetSubscriptions(skus: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (skus.length === 0) return found;
  const pkg = getPackageName();
  const token = await getAccessToken();
  for (const sku of skus) {
    const sub = await fetchSubscription(pkg, toPlayId(sku), token);
    if (sub) found.add(sku);
    await new Promise((r) => setTimeout(r, 150));
  }
  return found;
}

/**
 * Dispatch one product row to Play (upsert or delete based on status/product_type).
 */
export async function syncPlayProduct(row: PlayProductRow & { base_plan_id?: string | null }) {
  if (row.product_type === "subs") {
    const detail = await upsertSubscription(row);
    if (detail.ok) return { ok: true as const, detail };
    return { ok: false as const, error: detail.error ?? "subscription sync failed", detail };
  }
  return upsertInAppProduct(row);
}

