/**
 * Deep-link handler for OAuth returns into the native app.
 *
 * The browser-side bounce page (/auth/native) redirects to
 * `com.hamor.game://auth#access_token=...&refresh_token=...` (or `?code=...`).
 * Capacitor delivers that URL via the `appUrlOpen` event; here we extract the
 * session tokens, persist the Supabase session, and land on the home page.
 */
import { isNativeApp } from "@/lib/platform";
import { supabase } from "@/integrations/supabase/client";

function parseParams(url: string): URLSearchParams {
  // Tokens may arrive in the hash (implicit) or the query (code flow).
  const hashIndex = url.indexOf("#");
  const queryIndex = url.indexOf("?");
  let raw = "";
  if (hashIndex !== -1) raw = url.slice(hashIndex + 1);
  else if (queryIndex !== -1) raw = url.slice(queryIndex + 1);
  return new URLSearchParams(raw);
}

async function handleAuthUrl(url: string): Promise<void> {
  const params = parseParams(url);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const code = params.get("code");

  try {
    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) return;
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return;
    } else {
      return;
    }
  } catch {
    return;
  }

  // Session persisted — go home with a clean URL.
  window.location.replace("/");
}

let installed = false;

export function installNativeAuthDeepLink(): void {
  if (installed || typeof window === "undefined" || !isNativeApp()) return;
  installed = true;
  void (async () => {
    try {
      const { App } = await import("@capacitor/app");
      await App.addListener("appUrlOpen", ({ url }) => {
        if (typeof url === "string" && url.startsWith("com.hamor.game://auth")) {
          void handleAuthUrl(url);
        }
      });
    } catch {
      /* plugin unavailable — ignore */
    }
  })();
}
