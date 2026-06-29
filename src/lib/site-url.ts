// Canonical site URL for email confirmation links.
// We always send users to the custom domain so links work even if they
// originally signed up from the lovable.app preview or another mirror.
export const CANONICAL_SITE_URL = "https://molok-alqarasna.com";

/**
 * Returns the canonical origin to use in `emailRedirectTo` / `redirectTo`.
 * Falls back to `window.location.origin` on non-production hosts (e.g. preview).
 */
export function siteUrl(): string {
  if (typeof window === "undefined") return CANONICAL_SITE_URL;
  const host = window.location.hostname;
  // Use canonical for production hosts; for previews/local keep origin so dev still works
  if (
    host === "molok-alqarasna.com" ||
    host === "www.molok-alqarasna.com" ||
    host === "hamor.lovable.app"
  ) {
    return CANONICAL_SITE_URL;
  }
  // Preview / localhost — keep current origin
  return window.location.origin;
}
