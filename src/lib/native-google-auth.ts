/**
 * Native Google Sign-In on Capacitor (Android/iOS).
 *
 * On the native app we open Google's native sign-in sheet directly and
 * exchange the returned id token for a Supabase session — the user never
 * leaves the app. This is required by Google Play policy (no external
 * browser redirect) and gives a smoother UX.
 *
 * On the web we fall back to the standard Lovable OAuth flow.
 *
 * Configuration: set VITE_GOOGLE_WEB_CLIENT_ID to your Web OAuth Client ID
 * (from Google Cloud Console → Credentials). The same Web Client ID is used
 * as `serverClientId` on Android/iOS.
 */
import { isNativeApp } from "@/lib/platform";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

const WEB_CLIENT_ID = (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined) || "";

let initialized = false;

async function ensureInit() {
  if (initialized) return;
  if (!WEB_CLIENT_ID) {
    throw new Error(
      "لم يتم إعداد Google Client ID. يرجى إضافة VITE_GOOGLE_WEB_CLIENT_ID.",
    );
  }
  const { GoogleAuth } = await import("@codetrix-studio/capacitor-google-auth");
  try {
    await GoogleAuth.initialize({
      clientId: WEB_CLIENT_ID,
      scopes: ["profile", "email"],
      grantOfflineAccess: false,
    });
  } catch {
    /* second init is safe to ignore */
  }
  initialized = true;
}

type Result =
  | { ok: true; redirected?: false }
  | { ok: false; error: string };

export async function signInWithGoogleSmart(redirectUri: string): Promise<Result> {
  // Web / PWA → keep existing OAuth flow.
  if (!isNativeApp()) {
    try {
      const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: redirectUri });
      if (r.error) return { ok: false, error: r.error.message ?? "فشل تسجيل الدخول" };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "فشل تسجيل الدخول" };
    }
  }

  // Native → open Google's in-app native sheet and exchange the id token.
  try {
    await ensureInit();
    const { GoogleAuth } = await import("@codetrix-studio/capacitor-google-auth");
    const user = await GoogleAuth.signIn();
    const idToken = user?.authentication?.idToken;
    if (!idToken) return { ok: false, error: "لم يتم استلام رمز تحقق من Google" };

    const { error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    // User cancelled → treat silently.
    const msg = String(e?.message || e || "").toLowerCase();
    if (msg.includes("cancel") || msg.includes("12501")) {
      return { ok: false, error: "" };
    }
    // If the plugin isn't configured yet, fall back to the web OAuth flow
    // inside the WebView so the user isn't blocked.
    try {
      const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: redirectUri });
      if (r.error) return { ok: false, error: r.error.message ?? "فشل تسجيل الدخول" };
      return { ok: true };
    } catch {
      return { ok: false, error: e?.message ?? "فشل تسجيل الدخول بجوجل" };
    }
  }
}
