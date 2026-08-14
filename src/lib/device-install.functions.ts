import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";

const COOKIE = "mq_iid";
const MAX_AGE = 60 * 60 * 24 * 365 * 5; // 5 years

function secret(): string {
  return (
    process.env["DEVICE_INSTALL_SECRET"] ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
    process.env["SUPABASE_URL"] ||
    "molok-device-install"
  );
}

function sign(raw: string): string {
  return createHmac("sha256", secret()).update(raw).digest("hex").slice(0, 32);
}

function verify(value: string | null): string | null {
  if (!value) return null;
  const idx = value.lastIndexOf(".");
  if (idx <= 0) return null;
  const raw = value.slice(0, idx);
  const mac = value.slice(idx + 1);
  if (raw.length < 24 || raw.length > 120) return null;
  const a = Buffer.from(mac);
  const b = Buffer.from(sign(raw));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return raw;
}

function readCookie(req: Request | null, name: string): string | null {
  const header = req?.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/**
 * Server-issued install identity.
 *
 * A signed HttpOnly cookie (or, inside the mobile app, a native id supplied by
 * the client) that identifies one browser install / app install. It survives
 * localStorage wipes, IP / VPN / network changes and new account creation, but
 * it is deliberately NOT derived from network or hardware-model signals, so it
 * can never link two different devices that merely share a Wi-Fi, an IP, a VPN
 * or a phone model.
 */
export const registerInstallIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { nativeId?: string | null } | undefined) => ({
    nativeId: input?.nativeId ?? null,
  }))
  .handler(async ({ data, context }) => {
    let req: Request | null = null;
    try {
      req = getRequest();
    } catch {}

    // Native app identity wins: it is stable across browsers and storage wipes.
    const native =
      data.nativeId && data.nativeId.length >= 16 && data.nativeId.length <= 120
        ? `native:${data.nativeId}`
        : null;

    let installId = native ?? verify(readCookie(req, COOKIE));
    let issued = false;

    if (!installId) {
      installId = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 8);
      issued = true;
    }

    if (!native) {
      const cookie = `${COOKIE}=${encodeURIComponent(`${installId}.${sign(installId)}`)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
      try {
        setResponseHeader("Set-Cookie", cookie);
      } catch {}
    }

    try {
      await context.supabase.rpc("device_install_register", { _install_id: installId });
    } catch {}

    return { ok: true, issued, native: !!native };
  });
