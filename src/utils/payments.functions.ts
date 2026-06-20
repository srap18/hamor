import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gatewayFetch, type PaddleEnv } from "@/lib/paddle.server";
import { STORE_PACKS } from "@/lib/store-catalog";

const OFFICIAL_PAYMENT_ORIGIN = "https://www.molok-alqarasna.com";

function isKnownExternalPriceId(priceId: string) {
  return STORE_PACKS.some((p) => p.id === priceId) || /^elite_vip_[1-5]_monthly$/.test(priceId);
}

async function lookupPaddlePriceId(externalPriceId: string, environment: PaddleEnv) {
  if (externalPriceId.startsWith("pri_")) return externalPriceId;

  const lookup = async (env: PaddleEnv) => {
    const res = await gatewayFetch(
      env,
      `/prices?external_id=${encodeURIComponent(externalPriceId)}`,
    );
    const result = await res.json();
    return result.data?.[0]?.id as string | undefined;
  };

  let id = await lookup(environment);
  if (!id) {
    const other: PaddleEnv = environment === "sandbox" ? "live" : "sandbox";
    try { id = await lookup(other); } catch { /* ignore */ }
  }
  return id;
}

export const resolvePaddlePrice = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { priceId: string; environment: PaddleEnv }) => {
    if (!data?.priceId || typeof data.priceId !== "string" || data.priceId.length > 200) {
      throw new Error("invalid priceId");
    }
    if (data.environment !== "sandbox" && data.environment !== "live") {
      throw new Error("invalid environment");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const id = await lookupPaddlePriceId(data.priceId, data.environment);
    if (!id) throw new Error("Price not found");
    return id;
  });

export const createPaddleCheckoutTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { priceId: string; environment: PaddleEnv }) => {
    if (!data?.priceId || typeof data.priceId !== "string" || data.priceId.length > 200) {
      throw new Error("invalid priceId");
    }
    if (!isKnownExternalPriceId(data.priceId)) {
      throw new Error("unknown priceId");
    }
    if (data.environment !== "sandbox" && data.environment !== "live") {
      throw new Error("invalid environment");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const priceId = await lookupPaddlePriceId(data.priceId, data.environment);
    if (!priceId) throw new Error("Price not found");

    const res = await gatewayFetch(data.environment, "/transactions", {
      method: "POST",
      body: JSON.stringify({
        items: [{ price_id: priceId, quantity: 1 }],
        collection_mode: "automatic",
        custom_data: {
          packId: data.priceId,
          userId: context.userId,
        },
        checkout: {
          url: `${OFFICIAL_PAYMENT_ORIGIN}/pay`,
        },
      }),
    });
    const result = await res.json();
    if (!res.ok) {
      const detail = result?.error?.detail || result?.error?.code || `HTTP ${res.status}`;
      throw new Error(`تعذّر إنشاء رابط الدفع: ${detail}`);
    }

    const transactionId = result?.data?.id as string | undefined;
    const checkoutUrl = result?.data?.checkout?.url as string | undefined;
    if (!transactionId || !checkoutUrl) throw new Error("تعذّر إنشاء رابط الدفع");
    return { transactionId, checkoutUrl, priceId };
  });
