import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const activateGoldenFisher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await (supabase as any).rpc("activate_golden_fisher");
    if (error) throw new Error(error.message);
    return data as {
      ok: boolean;
      until: string;
      already_active?: boolean;
      tick?: { ok?: boolean; reason?: string; cycles?: number; ships?: number; launched?: number; fish_added?: number; market_full?: boolean; waiting_for_space?: number };
    };
  });

export const tickGoldenFisher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as any).rpc("golden_fisher_tick", { _user: userId });
    if (error) throw new Error(error.message);
    return data as { ok?: boolean; reason?: string; cycles?: number; ships?: number; launched?: number; fish_added?: number; market_full?: boolean; waiting_for_space?: number };
  });

export const removeGoldenFisher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await (supabase as any).rpc("remove_golden_fisher");
    if (error) throw new Error(error.message);
    return data as { ok: boolean };
  });

export const pauseGoldenFisher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await (supabase as any).rpc("pause_golden_fisher");
    if (error) throw new Error(error.message);
    return data as { ok: boolean; paused: boolean; until: string };
  });

export const resumeGoldenFisher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await (supabase as any).rpc("resume_golden_fisher");
    if (error) throw new Error(error.message);
    return data as { ok: boolean; paused: boolean; until: string; tick?: unknown };
  });
