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
import { GiftPopup } from "@/components/GiftPopup";
import { useEffect } from "react";
import { loadEconomyOverrides } from "@/lib/economy-overrides";
import { MobileFrame } from "@/components/MobileFrame";
import { sound } from "@/lib/sound";
import { installServerClock, syncServerTime } from "@/lib/server-time";

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
    let lastTouch = 0;
    document.addEventListener("touchend", (e) => {
      const now = Date.now();
      if (now - lastTouch <= 300) e.preventDefault();
      lastTouch = now;
    }, { passive: false });
  } catch {}
}

import appCss from "../styles.css?url";


function NotFoundComponent() {
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
      { property: "og:url", content: "https://hamor.lovable.app/" },
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
          url: "https://hamor.lovable.app/",
          inLanguage: "ar",
          genre: ["Adventure", "Strategy", "Multiplayer"],
          gamePlatform: ["Web Browser"],
          applicationCategory: "Game",
          operatingSystem: "Any",
          description: "ملوك القراصنة - لعبة المغامرات البحرية العربية الأولى. تُعرف أيضاً باسم هامور شابك.",
          image: "https://hamor.lovable.app/icon-512.png",
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "ملوك القراصنة",
          alternateName: "هامور شابك",
          url: "https://hamor.lovable.app/",
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

  useEffect(() => {
    loadEconomyOverrides();
  }, []);

  // Warm up the main tabs once the app is interactive — first tap on any
  // bottom-nav tab is then instant (code + data already in memory).
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
      <MobileFrame>
        <GlobalBanner />
        <LastAttackTicker />
        <GiftPopup />
        <Outlet />
        <Toaster position="top-center" richColors />
      </MobileFrame>
    </QueryClientProvider>
  );
}

