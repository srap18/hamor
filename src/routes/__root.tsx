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
import { AdminLayoutEditorProvider, AdminEditToggle } from "@/components/AdminLayoutEditor";
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
    // Double-tap zoom is already disabled via the viewport meta
    // (maximum-scale=1, user-scalable=no) — no touchend handler needed.
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
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            if(document.getElementById('app-splash'))return;
            var TOTAL=2;
            var s=document.createElement('div');s.id='app-splash';s.setAttribute('aria-hidden','true');
            s.innerHTML='<div class="splash-logo">ملوك القراصنة</div><div class="splash-ring"></div><div class="splash-count">'+TOTAL+'</div>';
            (document.body||document.documentElement).appendChild(s);
            var hidden=false,t0=Date.now(),timer;
            function hide(){if(hidden)return;hidden=true;clearInterval(timer);s.classList.add('hide');setTimeout(function(){s&&s.parentNode&&s.parentNode.removeChild(s)},400)}
            window.__hideSplash=hide;
            var c=s.querySelector('.splash-count');
            timer=setInterval(function(){
              var left=Math.max(0,TOTAL-Math.floor((Date.now()-t0)/1000));
              if(c)c.textContent=left;
              if(left<=0)hide();
            },200);
            setTimeout(hide,TOTAL*1000);
          })();
        `}} />
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
  // Hide splash screen as soon as React is mounted and one frame has rendered.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try { (window as any).__hideSplash?.(); } catch {}
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
      <AdminLayoutEditorProvider>
        <MobileFrame>
          <GlobalBanner />
          <LastAttackTicker />

          <Outlet />

          <AdminEditToggle />
          <Toaster position="top-center" richColors />
        </MobileFrame>
      </AdminLayoutEditorProvider>
    </QueryClientProvider>
  );
}

