import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gatewayFetch, type PaddleEnv } from "@/lib/paddle.server";

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
