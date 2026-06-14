import { createServerFn } from "@tanstack/react-start";
import { getWebRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

export const recordSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { deviceId?: string | null }) => ({
    deviceId: input?.deviceId ?? null,
  }))
  .handler(async ({ data, context }) => {
    let ip: string | null = null;
    try {
      const req = getWebRequest();
      if (req) ip = pickIp(req);
    } catch {}

    const deviceId =
      data.deviceId && data.deviceId.length >= 8 && data.deviceId.length <= 160
        ? data.deviceId
        : null;

    if (!ip && !deviceId) return { ok: false, ip: null };

    const { error } = await context.supabase.rpc("touch_session", {
      _device_id: deviceId,
      _ip: ip,
    });
    if (error) {
      // Soft failure — do not break the app
      return { ok: false, ip, error: error.message };
    }
    return { ok: true, ip };
  });
