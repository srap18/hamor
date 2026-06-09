import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const activateGoldenFisher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    const { supabase } = context;
    // Cast to any: RPC name may not be in generated types until regeneration.
    const { data, error } = await (supabase as any).rpc("activate_golden_fisher");
    if (error) throw new Error(error.message);
    return data as { ok: boolean; until: string; already_active?: boolean; tick?: unknown };
  });
