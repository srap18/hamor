/**
 * Google Play — purchase & subscription verification helpers (server-only).
 *
 * Reuses the same service-account OAuth flow as `play-sync.server.ts` but
 * exposes:
 *   - verifyPlayProduct(sku, purchaseToken)      — one-shot in-app products
 *   - verifyPlaySubscription(sku, purchaseToken) — subscriptions
 *   - acknowledgePlayProduct / acknowledgePlaySubscription
 *
 * Docs: https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/get
 *       https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/get
 */
import { SignJWT, importPKCS8 } from "jose";

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

let cachedToken: { token: string; expiresAt: number } | null = null;

function getServiceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON not configured");
  const sa = JSON.parse(raw);
  if (!sa.client_email || !sa.private_key) {
    throw new Error("Invalid service account JSON");
  }
  return sa;
}

export function getPlayPackageName(): string {
  const pkg = process.env.GOOGLE_PLAY_PACKAGE_NAME;
  if (!pkg) throw new Error("GOOGLE_PLAY_PACKAGE_NAME not configured");
  return pkg;
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.token;

  const sa = getServiceAccount();
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const pem = sa.private_key.replace(/\\n/g, "\n");
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
  if (!res.ok) throw new Error(`Google OAuth failed [${res.status}]: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: now + json.expires_in };
  return json.access_token;
}

export type PlayProductPurchase = {
  purchaseState: number; // 0 = purchased, 1 = canceled, 2 = pending
  consumptionState?: number;
  acknowledgementState: number; // 0 = yet to be acknowledged, 1 = acknowledged
  orderId?: string;
  purchaseTimeMillis?: string;
  productId?: string;
  kind?: string;
};

export type PlaySubscriptionPurchase = {
  startTimeMillis?: string;
  expiryTimeMillis?: string;
  autoRenewing?: boolean;
  paymentState?: number; // 0=pending,1=received,2=free trial,3=deferred upgrade
  cancelReason?: number;
  acknowledgementState: number;
  orderId?: string;
  linkedPurchaseToken?: string;
};

/** Verify a one-shot / consumable in-app product purchase. */
export async function verifyPlayProduct(
  sku: string,
  purchaseToken: string,
): Promise<PlayProductPurchase> {
  const pkg = getPlayPackageName();
  const token = await getAccessToken();
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(pkg)}/purchases/products/${encodeURIComponent(sku)}` +
    `/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Play verify (product) ${res.status}: ${await res.text()}`);
  return (await res.json()) as PlayProductPurchase;
}

/** Verify a subscription purchase. */
export async function verifyPlaySubscription(
  subscriptionId: string,
  purchaseToken: string,
): Promise<PlaySubscriptionPurchase> {
  const pkg = getPlayPackageName();
  const token = await getAccessToken();
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(pkg)}/purchases/subscriptions/${encodeURIComponent(subscriptionId)}` +
    `/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Play verify (subscription) ${res.status}: ${await res.text()}`);
  return (await res.json()) as PlaySubscriptionPurchase;
}

/** Acknowledge a product purchase (required within 3 days). */
export async function acknowledgePlayProduct(sku: string, purchaseToken: string): Promise<void> {
  const pkg = getPlayPackageName();
  const token = await getAccessToken();
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(pkg)}/purchases/products/${encodeURIComponent(sku)}` +
    `/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok && res.status !== 409)
    throw new Error(`Play ack (product) ${res.status}: ${await res.text()}`);
}

/** Acknowledge a subscription purchase. */
export async function acknowledgePlaySubscription(
  subscriptionId: string,
  purchaseToken: string,
): Promise<void> {
  const pkg = getPlayPackageName();
  const token = await getAccessToken();
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(pkg)}/purchases/subscriptions/${encodeURIComponent(subscriptionId)}` +
    `/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok && res.status !== 409)
    throw new Error(`Play ack (subscription) ${res.status}: ${await res.text()}`);
}
