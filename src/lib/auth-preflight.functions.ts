import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

function pickIp(req: Request): string | null {
  const h = req.headers;
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xreal = h.get("x-real-ip");
  if (xreal) return xreal.trim();
  return null;
}

/**
 * Public preflight check for signup / login.
 * Returns { blocked, reason } based on:
 *  - banned_emails (email)
 *  - banned_devices (device_id from client)
 *  - banned_ips (request IP — anti "change connection")
 */
export const authPreflight = createServerFn({ method: "POST" })
  .inputValidator((input: { email?: string | null; deviceId?: string | null }) => ({
    email: (input?.email ?? "").trim().toLowerCase().slice(0, 255) || null,
    deviceId: (input?.deviceId ?? "").trim().slice(0, 160) || null,
  }))
  .handler(async ({ data }) => {
    let ip: string | null = null;
    try {
      const req = getRequest();
      if (req) ip = pickIp(req);
    } catch {}

    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );

    // Email
    if (data.email) {
      const { data: row } = await sb.from("banned_emails").select("email").eq("email", data.email).maybeSingle();
      if (row) return { blocked: true, reason: "هذا البريد محظور من إنشاء حساب أو الدخول" };
    }
    // Device
    if (data.deviceId) {
      const { data: row } = await sb.from("banned_devices").select("device_id").eq("device_id", data.deviceId).maybeSingle();
      if (row) return { blocked: true, reason: "هذا الجهاز محظور — لا يمكن إنشاء أو دخول حساب منه" };
    }
    // IP (anti change-of-connection)
    if (ip) {
      const { data: row } = await sb.from("banned_ips").select("ip").eq("ip", ip).maybeSingle();
      if (row) return { blocked: true, reason: "هذا الاتصال (IP) محظور — تغيير الشبكة لن يفيد" };
    }
    return { blocked: false, reason: null };
  });
