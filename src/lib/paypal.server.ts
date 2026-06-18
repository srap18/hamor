// PayPal Live REST helpers — server-only.
// Used by createOrder / captureOrder server fns + webhook verifier.

const PAYPAL_BASE = "https://api-m.paypal.com"; // live

function authHeader(): string {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PayPal credentials not configured");
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

let cachedToken: { token: string; exp: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.exp) return cachedToken.token;
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PayPal auth failed: ${res.status} ${txt}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    exp: Date.now() + (json.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

export type CreateOrderInput = {
  packId: string;
  userId: string;
  amountUsd: number;
  description: string;
  returnUrl: string;
  cancelUrl: string;
};

export async function createOrder(input: CreateOrderInput): Promise<{
  id: string;
  approveUrl: string;
}> {
  const token = await getAccessToken();
  const body = {
    intent: "CAPTURE",
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "Molok Alqarasna",
          locale: "ar-SA",
          payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
          landing_page: "GUEST_CHECKOUT",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
        },
      },
    },
    // Keep the legacy context too: PayPal still uses BILLING on some hosted
    // checkout variants to surface card/guest checkout instead of account login.
    application_context: {
      brand_name: "Molok Alqarasna",
      locale: "ar-SA",
      landing_page: "BILLING",
      shipping_preference: "NO_SHIPPING",
      user_action: "PAY_NOW",
      return_url: input.returnUrl,
      cancel_url: input.cancelUrl,
    },
    purchase_units: [
      {
        reference_id: input.packId,
        custom_id: `${input.userId}|${input.packId}`,
        description: input.description.slice(0, 127),
        amount: {
          currency_code: "USD",
          value: input.amountUsd.toFixed(2),
        },
      },
    ],
  };
  const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    id?: string;
    links?: Array<{ rel: string; href: string }>;
    message?: string;
    name?: string;
  };
  if (!res.ok || !json.id) {
    throw new Error(`PayPal createOrder failed: ${json.message ?? json.name ?? res.status}`);
  }
  const approveUrl = json.links?.find((l) => l.rel === "payer-action")?.href
    ?? json.links?.find((l) => l.rel === "approve")?.href;
  if (!approveUrl) throw new Error("PayPal createOrder: no approve link");
  return { id: json.id, approveUrl };
}

export type CaptureResult = {
  orderId: string;
  captureId: string;
  status: string;
  amountUsd: number;
  packId: string;
  userId: string;
};

export async function captureOrder(orderId: string): Promise<CaptureResult> {
  const token = await getAccessToken();
  const res = await fetch(
    `${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );
  const json = (await res.json()) as any;
  // 422 with ORDER_ALREADY_CAPTURED is fine — fetch order details instead
  if (!res.ok) {
    const alreadyCaptured =
      json?.details?.some((d: any) => d?.issue === "ORDER_ALREADY_CAPTURED");
    if (!alreadyCaptured) {
      throw new Error(
        `PayPal capture failed: ${json?.message ?? json?.name ?? res.status}`,
      );
    }
    return await getOrder(orderId);
  }
  return extractCaptureResult(json);
}

export async function getOrder(orderId: string): Promise<CaptureResult> {
  const token = await getAccessToken();
  const res = await fetch(
    `${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const json = (await res.json()) as any;
  if (!res.ok) throw new Error(`PayPal getOrder failed: ${json?.message ?? res.status}`);
  return extractCaptureResult(json);
}

function extractCaptureResult(orderJson: any): CaptureResult {
  const pu = orderJson?.purchase_units?.[0];
  const cap = pu?.payments?.captures?.[0];
  const custom = (cap?.custom_id ?? pu?.custom_id ?? "") as string;
  const [userId = "", packId = ""] = custom.split("|");
  return {
    orderId: orderJson?.id,
    captureId: cap?.id ?? orderJson?.id,
    status: cap?.status ?? orderJson?.status ?? "UNKNOWN",
    amountUsd: Number(cap?.amount?.value ?? pu?.amount?.value ?? 0),
    packId,
    userId,
  };
}

// Webhook signature verification via PayPal API
export async function verifyWebhookSignature(
  headers: Headers,
  rawBody: string,
): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    console.error("PAYPAL_WEBHOOK_ID not configured");
    return false;
  }
  const token = await getAccessToken();
  const payload = {
    auth_algo: headers.get("paypal-auth-algo"),
    cert_url: headers.get("paypal-cert-url"),
    transmission_id: headers.get("paypal-transmission-id"),
    transmission_sig: headers.get("paypal-transmission-sig"),
    transmission_time: headers.get("paypal-transmission-time"),
    webhook_id: webhookId,
    webhook_event: JSON.parse(rawBody),
  };
  const res = await fetch(
    `${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) return false;
  const json = (await res.json()) as { verification_status?: string };
  return json.verification_status === "SUCCESS";
}
