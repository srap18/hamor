import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "moderator"]);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("ليس لديك صلاحية");
}

export const adminUpdateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    userId: string;
    email?: string;
    display_name?: string;
    avatar_url?: string | null;
  }) => {
    if (!input?.userId) throw new Error("userId required");
    if (input.email !== undefined && (input.email.length > 255 || !input.email.includes("@"))) {
      throw new Error("Invalid email");
    }
    if (input.display_name !== undefined && (input.display_name.trim().length < 1 || input.display_name.length > 50)) {
      throw new Error("Invalid name");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    if (input_hasField(data, "email") && data.email) {
      // Skip if email matches the current one (avoids "Error updating user")
      const { data: existing } = await supabaseAdmin.auth.admin.getUserById(data.userId);
      const currentEmail = existing?.user?.email?.toLowerCase() ?? null;
      const newEmail = data.email.trim().toLowerCase();
      if (currentEmail !== newEmail) {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
          email: newEmail,
          email_confirm: true,
        });
        if (error) {
          const msg = /already|exists|registered|duplicate/i.test(error.message)
            ? "هذا الإيميل مستخدم في حساب آخر"
            : `فشل تحديث الإيميل: ${error.message}`;
          throw new Error(msg);
        }
      }
    }

    const profileUpdate: { display_name?: string; avatar_url?: string | null } = {};
    if (data.display_name !== undefined) profileUpdate.display_name = data.display_name.trim();
    if (data.avatar_url !== undefined) profileUpdate.avatar_url = data.avatar_url;
    if (Object.keys(profileUpdate).length > 0) {
      const { error } = await supabaseAdmin.from("profiles").update(profileUpdate).eq("id", data.userId);
      if (error) throw new Error(`فشل تحديث الملف: ${error.message}`);
    }

    await supabaseAdmin.from("admin_audit").insert({
      admin_id: context.userId,
      action: "admin_edit_user",
      target_user_id: data.userId,
      details: { email: data.email ?? null, display_name: data.display_name ?? null, avatar_changed: data.avatar_url !== undefined } as never,
    });

    return { ok: true };
  });

function input_hasField<T extends object>(d: T, k: string) {
  return Object.prototype.hasOwnProperty.call(d, k);
}

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; banEmail?: boolean; banDevices?: boolean; reason?: string }) => {
    if (!input?.userId) throw new Error("userId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId) throw new Error("لا يمكن حذف حسابك");

    // Fetch email first so we can block re-registration
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    const email = u?.user?.email ?? null;

    if (data.banEmail && email) {
      await supabaseAdmin.from("banned_emails").upsert(
        { email: email.toLowerCase(), reason: data.reason ?? "", banned_by: context.userId },
        { onConflict: "email" },
      );
    }

    if (data.banDevices) {
      const { data: devices } = await supabaseAdmin
        .from("device_accounts")
        .select("device_id")
        .eq("user_id", data.userId);
      if (devices && devices.length > 0) {
        await (supabaseAdmin as any).from("banned_devices").upsert(
          devices.map((d) => ({
            device_id: d.device_id,
            user_id: data.userId,
            reason: data.reason || "حذف وحظر نهائي",
            banned_by: context.userId,
          })),
          { onConflict: "device_id" },
        );
      }
    }

    await supabaseAdmin.from("bans").insert({
      user_id: data.userId,
      reason: data.reason || "حذف الحساب نهائياً",
      banned_by: context.userId,
      expires_at: null,
      active: true,
    });

    await Promise.all([
      supabaseAdmin.from("inventory").delete().eq("user_id", data.userId),
      supabaseAdmin.from("fish_caught").delete().eq("user_id", data.userId),
      supabaseAdmin.from("fish_stock").delete().eq("user_id", data.userId),
      supabaseAdmin.from("ships_owned").delete().eq("user_id", data.userId),
      supabaseAdmin.from("lootbox_owned").delete().eq("user_id", data.userId),
      supabaseAdmin.from("daily_login_streaks").delete().eq("user_id", data.userId),
      supabaseAdmin.from("quest_progress").delete().eq("user_id", data.userId),
      supabaseAdmin.from("transactions").delete().eq("user_id", data.userId),
      supabaseAdmin.from("device_accounts").delete().eq("user_id", data.userId),
      supabaseAdmin.from("friends").delete().or(`requester_id.eq.${data.userId},addressee_id.eq.${data.userId}`),
      supabaseAdmin.from("messages").delete().or(`sender_id.eq.${data.userId},recipient_id.eq.${data.userId}`),
      supabaseAdmin.from("notifications").delete().or(`recipient_id.eq.${data.userId},created_by.eq.${data.userId}`),
      supabaseAdmin.from("support_gifts").delete().or(`sender_id.eq.${data.userId},recipient_id.eq.${data.userId}`),
      supabaseAdmin.from("profiles").delete().eq("id", data.userId),
    ]);

    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("admin_audit").insert({
      admin_id: context.userId,
      action: "admin_delete_user",
      target_user_id: data.userId,
      details: { email, banEmail: !!data.banEmail, banDevices: !!data.banDevices, reason: data.reason ?? "" } as never,
    });

    return { ok: true, email };
  });

export const adminPermanentBan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; reason?: string }) => {
    if (!input?.userId) throw new Error("userId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId) throw new Error("لا يمكن حظر حسابك");

    await (supabaseAdmin as any).rpc("admin_permanent_ban", {
      _uid: data.userId,
      _reason: data.reason || "حظر نهائي",
    } as never);

    await supabaseAdmin.auth.admin.updateUserById(data.userId, { ban_duration: "87600h" } as never);
    await supabaseAdmin.from("profiles").update({ active_session_id: `banned-${Date.now()}` }).eq("id", data.userId);

    return { ok: true };
  });

export const adminBlockLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; hours?: number; unblock?: boolean }) => {
    if (!input?.userId) throw new Error("userId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const ban_duration = data.unblock ? "none" : `${Math.max(1, Math.min(8760 * 10, data.hours ?? 87600))}h`;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { ban_duration } as never);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("admin_audit").insert({
      admin_id: context.userId,
      action: data.unblock ? "admin_unblock_login" : "admin_block_login",
      target_user_id: data.userId,
      details: { ban_duration } as never,
    });
    return { ok: true };
  });
