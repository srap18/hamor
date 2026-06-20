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
    const lookup = async (env: PaddleEnv) => {
      const res = await gatewayFetch(
        env,
        `/prices?external_id=${encodeURIComponent(data.priceId)}`,
      );
      const result = await res.json();
      return result.data?.[0]?.id as string | undefined;
    };
    let id = await lookup(data.environment);
    // Fallback: if not found in the requested env, try the other env.
    // Useful when stale client bundles still send "sandbox" but only live keys exist.
    if (!id) {
      const other: PaddleEnv = data.environment === "sandbox" ? "live" : "sandbox";
      try { id = await lookup(other); } catch { /* ignore */ }
    }
    if (!id) throw new Error("Price not found");
    return id;
  });
