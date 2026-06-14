/**
 * Permanent account deletion endpoint.
 *
 * Required by Apple App Store (guideline 5.1.1(v)) and Google Play (User
 * Data policy) for any app that lets users create an account. The signed-in
 * user can wipe their own data without contacting support.
 *
 * The actual cascade lives in the database — `auth.users` has ON DELETE
 * CASCADE on every user-owned table — so calling `auth.admin.deleteUser`
 * removes the profile, inventory, ships, messages, etc. in one shot.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Best-effort: clear identifying profile fields BEFORE deleting auth.user,
    // so anything stuck behind a non-cascading FK is at least scrubbed.
    try {
      await supabaseAdmin
        .from("profiles")
        .update({
          username: `deleted-${userId.slice(0, 8)}`,
          avatar_url: null,
          bio: null,
        } as never)
        .eq("id", userId);
    } catch {
      /* noop — non-critical */
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);

    return { ok: true };
  });
