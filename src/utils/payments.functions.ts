import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gatewayFetch, type PaddleEnv } from "@/lib/paddle.server";

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
    const res = await gatewayFetch(
      data.environment,
      `/prices?external_id=${encodeURIComponent(data.priceId)}`,
    );
    const result = await res.json();
    if (!result.data?.length) throw new Error("Price not found");
    return result.data[0].id as string;
  });
