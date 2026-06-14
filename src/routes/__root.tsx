import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,

  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { GlobalBanner } from "@/components/GlobalBanner";
import { LastAttackTicker } from "@/components/LastAttackTicker";
import { GlobalNotificationListener } from "@/components/GlobalNotificationListener";
import { GiftPopup } from "@/components/GiftPopup";
import { EliteVipLoginOverlay } from "@/components/EliteVipLoginOverlay";
import { useEffect, useState } from "react";
import { loadEconomyOverrides } from "@/lib/economy-overrides";
import { MobileFrame } from "@/components/MobileFrame";
import { AdminLayoutEditorProvider, AdminEditToggle } from "@/components/AdminLayoutEditor";
import { sound } from "@/lib/sound";
import { installServerClock, syncServerTime } from "@/lib/server-time";
import { SoftProtection } from "@/components/SoftProtection";
import { I18nProvider } from "@/lib/i18n";
import { NetworkRecovery } from "@/components/NetworkRecovery";
import { installNativeShell } from "@/lib/native-shell";


// Install the server-time clock as early as possible on the client so every
// Date.now() / new Date() call across the app reflects server time, not the
// user's (potentially tampered) device clock.
if (typeof window !== "undefined") {
  installServerClock();
  // Re-sync whenever the tab regains focus or comes back from background.
  try {
    window.addEventListener("focus", () => syncServerTime(true));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") syncServerTime(true);
    });
  } catch {}

  // Disable browser zoom (Ctrl+wheel, Ctrl/Cmd +/-, pinch gestures, double-tap).
  try {
    window.addEventListener("wheel", (e) => {
      if (e.ctrlKey) e.preventDefault();
    }, { passive: false });
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && ["=", "+", "-", "_", "0"].includes(e.key)) {
        e.preventDefault();
      }
    });
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("gesturechange", (e) => e.preventDefault());
    document.addEventListener("gestureend", (e) => e.preventDefault());
    // Double-tap zoom is already disabled via the viewport meta
    // (maximum-scale=1, user-scalable=no) — no touchend handler needed.
  } catch {}

  // Auto-recovery: if a dynamic chunk fails to load (network blip, tab was
  // backgrounded for a long time and the deployed bundle changed), reload
  // the page once instead of leaving the app stuck on a blank/frozen screen.
  try {
    const RELOAD_KEY = "__chunk_reload_at";
    const isChunkError = (msg: string) =>
      /Failed to fetch dynamically imported module/i.test(msg) ||
      /Importing a module script failed/i.test(msg) ||
      /ChunkLoadError/i.test(msg) ||
      /Loading chunk \d+ failed/i.test(msg) ||
      /error loading dynamically imported module/i.test(msg);

    const tryReload = () => {
      try {
        const last = Number(sessionStorage.getItem(RELOAD_KEY) || "0");
        // Throttle to avoid infinite reload loops (max once per 10s)
        if (Date.now() - last < 10_000) return;
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch {}
      window.location.reload();
    };

    window.addEventListener("error", (e) => {
      const msg = (e?.message || (e?.error && (e.error.message || String(e.error))) || "") + "";
      if (isChunkError(msg)) tryReload();
    });
    window.addEventListener("unhandledrejection", (e) => {
      const reason: any = e?.reason;
      const msg = (reason && (reason.message || String(reason))) || "";
      if (isChunkError(msg)) tryReload();
    });

    // When the tab comes back online or becomes visible after a long offline,
    // ping the network. If the app is in a broken state, the next failed
    // dynamic import will trigger the recovery above.
    let wasOffline = !navigator.onLine;
    window.addEventListener("offline", () => { wasOffline = true; });
    window.addEventListener("online", () => {
      if (wasOffline) {
        wasOffline = false;
        // Soft re-sync; if any pending dynamic import was stuck, the next
        // navigation will retry naturally.
        try { syncServerTime(true); } catch {}
      }
    });
  } catch {}

  // Unregister any leftover service workers so the app never serves a stale
  // shell to returning users. We don't ship a SW, so any registration we find
  // is leftover from an earlier deploy and is the most common cause of
  // "I don't see the latest update".
  try {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => { try { r.unregister(); } catch {} });
      }).catch(() => {});
    }
  } catch {}

  // Auto-clear stale browser caches once per deployed build. We compare the
  // build id baked into the bundle against what's stored locally; on mismatch
  // we wipe Cache Storage and reload once so the user always runs the latest
  // version without needing to hit the manual "تحديث اللعبة" button.
  try {
    const BUILD_ID = (import.meta as any).env?.VITE_BUILD_ID
      || (import.meta as any).env?.MODE + ":" + ((import.meta as any).env?.DEV ? "dev" : "prod");
    const KEY = "oc-build-id";
    const prev = localStorage.getItem(KEY);
    if (prev && prev !== BUILD_ID) {
      localStorage.setItem(KEY, BUILD_ID);
      (async () => {
        try {
          if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
        } catch {}
        // Avoid infinite reload loops with a one-shot URL flag.
        const u = new URL(window.location.href);
        if (!u.searchParams.has("__v")) {
          u.searchParams.set("__v", String(Date.now()));
          window.location.replace(u.toString());
        }
      })();
    } else if (!prev) {
      localStorage.setItem(KEY, BUILD_ID);
    }
  } catch {}
}



import appCss from "../styles.css?url";


function NotFoundComponent() {
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.pathname === "/index") {
      window.location.replace("/");
    }
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content" },
      { title: "ملوك القراصنة - لعبة ملوك القراصنة | هامور شابك" },
      { name: "description", content: "ملوك القراصنة - لعبة المغامرات البحرية العربية الأولى. اصطد، اغزُ، وكوّن إمبراطوريتك البحرية. تُعرف أيضاً باسم هامور شابك، هامور 360، شابك 360." },
      { name: "keywords", content: "ملوك القراصنة, لعبة ملوك القراصنة, ملوك القراصنه, هامور شابك, هامور 360, شابك 360, لعبة قراصنة, لعبة صيد سمك, لعبة بحرية, pirates kings, mulook al qarasna" },
      { name: "author", content: "ملوك القراصنة" },
      { name: "application-name", content: "ملوك القراصنة" },
      { name: "robots", content: "index, follow, max-image-preview:large" },
      { property: "og:site_name", content: "ملوك القراصنة" },
      { property: "og:title", content: "ملوك القراصنة - لعبة المغامرات البحرية" },
      { property: "og:description", content: "ملوك القراصنة (هامور شابك) - لعبة قراصنة وصيد بحري عربية. ابنِ أسطولك واغزُ البحار." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.molok-alqarasna.com/" },
      { property: "og:locale", content: "ar_SA" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "ملوك القراصنة - لعبة المغامرات البحرية" },
      { name: "twitter:description", content: "ملوك القراصنة (هامور شابك) - لعبة قراصنة وصيد بحري عربية." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/28BjizFYbZY4r6R7g9uwXqykIuC2/social-images/social-1779659939703-598384.webp" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/28BjizFYbZY4r6R7g9uwXqykIuC2/social-images/social-1779659939703-598384.webp" },
      { name: "theme-color", content: "#0a1929" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "ملوك القراصنة" },
      { name: "google-site-verification", content: "googlebc65e091428a2851" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icon-512.png" },
      { rel: "preconnect", href: "https://qjwbfkpudysxqtkeouwu.supabase.co", crossOrigin: "" },
      { rel: "dns-prefetch", href: "https://qjwbfkpudysxqtkeouwu.supabase.co" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "VideoGame",
          name: "ملوك القراصنة",
          alternateName: ["لعبة ملوك القراصنة", "ملوك القراصنه", "هامور شابك", "هامور 360", "شابك 360", "Mulook Al Qarasna", "Pirate Kings"],
          url: "https://www.molok-alqarasna.com/",
          inLanguage: "ar",
          genre: ["Adventure", "Strategy", "Multiplayer"],
          gamePlatform: ["Web Browser"],
          applicationCategory: "Game",
          operatingSystem: "Any",
          description: "ملوك القراصنة - لعبة المغامرات البحرية العربية الأولى. تُعرف أيضاً باسم هامور شابك.",
          image: "https://www.molok-alqarasna.com/icon-512.png",
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "ملوك القراصنة",
          alternateName: "هامور شابك",
          url: "https://www.molok-alqarasna.com/",
          inLanguage: "ar",
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <HeadContent />
        <style dangerouslySetInnerHTML={{ __html: `
          #app-splash{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:20px;background:radial-gradient(ellipse at center,#0d3a5c 0%,#061826 60%,#020a13 100%);transition:opacity .35s ease-out;will-change:opacity;backface-visibility:hidden;transform:translateZ(0)}
          #app-splash.hide{opacity:0;pointer-events:none}
          #app-splash .splash-logo{font-family:'Cairo','Tajawal',system-ui,sans-serif;font-weight:900;font-size:clamp(28px,7vw,44px);letter-spacing:.02em;text-align:center;background:linear-gradient(180deg,#ffe9a8 0%,#f5c45e 45%,#b8841f 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 2px 8px rgba(245,196,94,.35)) drop-shadow(0 0 24px rgba(245,196,94,.2));text-shadow:0 1px 0 rgba(0,0,0,.3)}
          #app-splash .splash-ring{width:38px;height:38px;border-radius:50%;border:2px solid rgba(245,196,94,.18);border-top-color:#f5c45e;animation:splash-spin .8s linear infinite;will-change:transform}
          #app-splash .splash-count{font-family:'Cairo','Tajawal',system-ui,sans-serif;color:#f5c45e;font-size:14px;font-weight:700;letter-spacing:.05em;min-width:32px;text-align:center;font-variant-numeric:tabular-nums}
          @keyframes splash-spin{to{transform:rotate(360deg)}}
          @media (prefers-reduced-motion:reduce){#app-splash .splash-ring{animation-duration:2s}}
        `}} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashMounted, setSplashMounted] = useState(true);

  useEffect(() => {
    loadEconomyOverrides();
    installNativeShell();
    // Track player session + online heartbeat for accurate admin online count.
    let disposed = false;
    let cleanupSessionTracking: (() => void) | undefined;
    (async () => {
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const { recordSession } = await import("@/lib/session-track.functions");
        if (disposed) return;
        const ensureDeviceId = (): string => {
          try {
            const k = "hamor_device_id";
            let v = localStorage.getItem(k);
            if (!v) {
              v = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, "");
              localStorage.setItem(k, v);
            }
            return v;
          } catch { return ""; }
        };
        let inFlight = false;
        const fire = async () => {
          if (inFlight || document.visibilityState === "hidden") return;
          inFlight = true;
          try {
            const { data } = await supabase.auth.getSession();
            if (!data.session?.user) return;
            await recordSession({ data: { deviceId: ensureDeviceId() } });
          } catch {}
          finally { inFlight = false; }
        };
        fire();
        const heartbeat = window.setInterval(fire, 60_000);
        const onVisible = () => { if (document.visibilityState === "visible") fire(); };
        const onFocus = () => fire();
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", onFocus);
        const { data: authSub } = supabase.auth.onAuthStateChange((e) => {
          if (e === "SIGNED_IN" || e === "TOKEN_REFRESHED") fire();
        });
        cleanupSessionTracking = () => {
          window.clearInterval(heartbeat);
          document.removeEventListener("visibilitychange", onVisible);
          window.removeEventListener("focus", onFocus);
          authSub.subscription.unsubscribe();
        };
      } catch {}
    })();
    return () => { disposed = true; cleanupSessionTracking?.(); };
  }, []);

  // Hide splash after the first paint (two rAFs ensures the app has rendered).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSplashVisible(false);
        // Remove from DOM after fade-out transition.
        setTimeout(() => setSplashMounted(false), 400);
      });
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const idle = (cb: () => void) =>
      (window as any).requestIdleCallback
        ? (window as any).requestIdleCallback(cb, { timeout: 1500 })
        : setTimeout(cb, 400);
    const handle = idle(() => {
      const tabs = ["/shop", "/friends", "/chat", "/fish-market", "/"] as const;
      for (const to of tabs) {
        router.preloadRoute({ to }).catch(() => {});
      }
    });
    return () => {
      try { (window as any).cancelIdleCallback?.(handle); } catch {}
    };
  }, [router]);

  // Bootstrap background sea music on the first user gesture, on every page
  useEffect(() => {
    const start = () => {
      sound.resume();
      if (sound.getMusic()) sound.startMusic();
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
      <AdminLayoutEditorProvider>
        <MobileFrame>
          <GlobalBanner />
          <SoftProtection />

          <LastAttackTicker />
          <GlobalNotificationListener />
          <NetworkRecovery />
          <EliteVipLoginOverlay />

          <Outlet />

          <AdminEditToggle />
          <Toaster position="top-center" richColors />
        </MobileFrame>
        {splashMounted && (
          <div id="app-splash" aria-hidden="true" className={splashVisible ? "" : "hide"}>
            <div className="splash-logo">ملوك القراصنة</div>
            <div className="splash-ring"></div>
          </div>
        )}
      </AdminLayoutEditorProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

