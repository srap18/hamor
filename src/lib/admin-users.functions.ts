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
    if (input.display_name !== undefined && (input.display_name.trim().length < 2 || input.display_name.trim().length > 15)) {
      throw new Error("الاسم يجب أن يكون بين 2 و 15 حرف");
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
      if (error) {
        const m = String(error.message || "");
        if (m.includes("display_name_taken")) throw new Error("هذا الاسم محجوز لاعب آخر");
        if (m.includes("display_name_invalid_chars")) throw new Error("الاسم يحتوي رموز أو زخارف غير مسموحة");
        if (m.includes("display_name_must_have_letter")) throw new Error("الاسم لازم يحتوي على حرف واحد على الأقل");
        if (m.includes("display_name_disallowed_religious")) throw new Error("هذا الاسم الديني غير مسموح");
        if (m.includes("too long")) throw new Error("الاسم أطول من 15 حرف");
        if (m.includes("too short")) throw new Error("الاسم قصير جداً (حد أدنى حرفين)");
        throw new Error(`فشل تحديث الملف: ${m}`);
      }
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

    // Hard-wipe every trace of this user across all known tables
    const { error: wipeErr } = await (supabaseAdmin as any).rpc("admin_hard_delete_user", { _uid: data.userId });
    if (wipeErr) throw new Error(`فشل حذف بيانات اللاعب: ${wipeErr.message}`);

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

    const reason = data.reason || "حظر نهائي";

    await (supabaseAdmin as any).rpc("admin_permanent_ban", {
      _uid: data.userId,
      _reason: reason,
    } as never);

    // Permanent ban now ALSO bans the device(s), IP(s) and email — same as hard ban.
    const { data: hard } = await (supabaseAdmin as any).rpc("admin_hard_ban", {
      _uid: data.userId,
      _reason: reason,
      _admin: context.userId,
    });

    await supabaseAdmin.auth.admin.updateUserById(data.userId, { ban_duration: "87600h" } as never);
    await supabaseAdmin.from("profiles").update({ active_session_id: `banned-${Date.now()}` }).eq("id", data.userId);

    return { ok: true, ...(hard as { email?: string | null; devices?: number; ips?: number } | null ?? {}) };
  });

export const adminBlockLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; hours?: number; unblock?: boolean; reason?: string }) => {
    if (!input?.userId) throw new Error("userId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId) throw new Error("لا يمكن منع حسابك");

    if (data.unblock) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { ban_duration: "none" } as never);
      if (error) throw new Error(error.message);
      await supabaseAdmin.from("bans").update({ active: false }).eq("user_id", data.userId).eq("active", true);
      // Also fully reverse any hard-ban (email + devices + IPs) — one button lifts everything
      await (supabaseAdmin as any).rpc("admin_unhard_ban", { _uid: data.userId, _admin: context.userId });
      await supabaseAdmin.from("admin_audit").insert({
        admin_id: context.userId,
        action: "admin_unblock_login",
        target_user_id: data.userId,
        details: { ban_duration: "none", hard_ban_cleared: true } as never,
      });
      return { ok: true };
    }

    const hours = Math.max(1, Math.min(8760 * 10, data.hours ?? 87600));
    const ban_duration = `${hours}h`;
    const expires_at = hours >= 87600 ? null : new Date(Date.now() + hours * 3600_000).toISOString();
    const reason = data.reason?.trim() || "منع تسجيل الدخول";

    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { ban_duration } as never);
    if (error) throw new Error(error.message);

    // Surface this in the Sanctions page by recording a ban row.
    // Only this auth account is affected — no devices, IPs, or linked accounts are touched.
    await supabaseAdmin.from("bans").update({ active: false }).eq("user_id", data.userId).eq("active", true);
    await supabaseAdmin.from("bans").insert({
      user_id: data.userId,
      reason,
      banned_by: context.userId,
      expires_at,
      active: true,
    });

    await supabaseAdmin.from("admin_audit").insert({
      admin_id: context.userId,
      action: "admin_block_login",
      target_user_id: data.userId,
      details: { ban_duration, hours, reason } as never,
    });
    return { ok: true };
  });

/**
 * Hard ban — blocks creating a new account AND blocks changing the connection.
 * Bans this user's email + every device_id they've used + every IP they've used,
 * then activates a permanent ban row and Auth ban_duration.
 */
export const adminHardBan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; reason?: string }) => {
    if (!input?.userId) throw new Error("userId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId) throw new Error("لا يمكن حظر حسابك");

    const reason = data.reason?.trim() || "حظر قوي";
    const { data: result, error } = await (supabaseAdmin as any).rpc("admin_hard_ban", {
      _uid: data.userId,
      _reason: reason,
      _admin: context.userId,
    });
    if (error) throw new Error(error.message);

    // Lock the Auth account permanently as well
    await supabaseAdmin.auth.admin.updateUserById(data.userId, { ban_duration: "87600h" } as never);

    return { ok: true, ...(result as { email: string | null; devices: number; ips: number }) };
  });
