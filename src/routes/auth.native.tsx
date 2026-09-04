import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/**
 * OAuth bounce page used by the native Android app.
 *
 * Google sign-in on Android runs inside a Chrome Custom Tab (the system
 * browser), so after the OAuth broker finishes it redirects here with the
 * session tokens in the URL hash. This page immediately forwards those
 * tokens to the app through its custom scheme (com.hamor.game://auth),
 * which Android delivers to the app via the deep-link intent filter.
 * If the automatic handoff fails, a manual button is shown.
 */
export const Route = createFileRoute("/auth/native")({
  head: () => ({
    meta: [
      { title: "جارٍ فتح التطبيق — ملوك القراصنة" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NativeAuthReturn,
});

const APP_SCHEME = "com.hamor.game://auth";

function buildAppLink(): string {
  // Forward the hash (tokens) and query (code fallback) untouched.
  const hash = window.location.hash || "";
  const search = window.location.search || "";
  return `${APP_SCHEME}${search}${hash}`;
}

function NativeAuthReturn() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const link = buildAppLink();
    // Try to hand off to the app. Chrome fires the intent and switches apps;
    // if nothing handles it within ~2.5s we show the manual button.
    const timer = window.setTimeout(() => setFailed(true), 2500);
    try {
      window.location.replace(link);
    } catch {
      setFailed(true);
    }
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-[#082f49] px-6 text-center text-white"
    >
      <div className="max-w-xs">
        <div className="text-5xl">⛵</div>
        <h1 className="mt-4 text-lg font-bold">تم تسجيل الدخول ✓</h1>
        <p className="mt-2 text-sm text-sky-100/80">
          جارٍ إرجاعك إلى التطبيق…
        </p>
        {failed && (
          <a
            href={buildAppLink()}
            className="mt-6 inline-block rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-stone-950"
          >
            افتح التطبيق
          </a>
        )}
      </div>
    </div>
  );
}
