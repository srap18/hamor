import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
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
  .inputValidator((input: { deviceId?: string | null; hardwareId?: string | null }) => ({
    deviceId: input?.deviceId ?? null,
    hardwareId: input?.hardwareId ?? null,
  }))
  .handler(async ({ data, context }) => {
    let ip: string | null = null;
    try {
      const req = getRequest();
      if (req) ip = pickIp(req);
    } catch {}

    const deviceId =
      data.deviceId && data.deviceId.length >= 8 && data.deviceId.length <= 160
        ? data.deviceId
        : null;
    const hardwareId =
      data.hardwareId && data.hardwareId.length >= 8 && data.hardwareId.length <= 160
        ? data.hardwareId
        : null;

    const { error } = await context.supabase.rpc("touch_session", {
      _device_id: (deviceId ?? "") as string,
      _ip: (ip ?? "") as string,
    });

    // Also record the hardware fingerprint as a second device_id entry for
    // the same user so that a future admin ban catches this physical device
    // even after the user clears storage / re-installs / signs up again.
    if (hardwareId && hardwareId !== deviceId) {
      try {
        await context.supabase.rpc("touch_session", {
          _device_id: hardwareId as string,
          _ip: (ip ?? "") as string,
        });
      } catch {}
    }

    if (error) {
      return { ok: false, ip, error: error.message };
    }
    return { ok: true, ip };
  });
