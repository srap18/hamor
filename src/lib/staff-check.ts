import { supabase } from "@/integrations/supabase/client";

/**
 * Fail-closed staff check.
 *
 * Returns true when the target account is admin/moderator, false only when the
 * server explicitly says it is NOT staff. Any failure (offline, timeout, RPC
 * error) resolves to `true` so the "visit ocean" surface stays hidden instead
 * of being unlocked by simply killing the network for a moment.
 */
export async function isStaffAccount(userId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await (supabase as any).rpc("is_staff", { _user_id: userId });
      if (!error && typeof data === "boolean") return data;
    } catch {
      /* retry */
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
  }
  return true; // unknown → treat as staff (hidden)
}
