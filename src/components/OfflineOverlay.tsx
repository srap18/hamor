import { useEffect, useRef, useState } from "react";
import { syncServerTime } from "@/lib/server-time";

/**
 * Custom offline UI shown whenever the device loses network.
 * Uses both navigator.onLine events AND active pings, because Android
 * WebView does not always fire 'online'/'offline' reliably when the
 * user toggles wifi/mobile-data while the app is already open.
 */
export function OfflineOverlay() {
  const [offline, setOffline] = useState<boolean>(false);
  const [mounted, setMounted] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const checkingRef = useRef(false);

  const probe = async (): Promise<boolean> => {
    if (checkingRef.current) return !offline;
    checkingRef.current = true;
    // Tolerate weak networks: up to 3 retries with generous 15s timeout each.
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 15000);
          const res = await fetch(
            window.location.origin + "/manifest.json?_=" + Date.now(),
            { cache: "no-store", method: "GET", signal: ctrl.signal },
          );
          clearTimeout(t);
          if (res && (res.ok || res.status < 500)) return true;
        } catch {
          // fall through to retry
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      return false;
    } finally {
      checkingRef.current = false;
    }
  };

  useEffect(() => {
    setMounted(true);
    setOffline(!navigator.onLine);

    const goOnline = async () => {
      if (await probe()) {
        setOffline(false);
        try { syncServerTime(true); } catch {}
      }
    };
    const goOffline = () => setOffline(true);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    // Active poll every 6s — catches Android WebView cases where the
    // browser events never fire after toggling wifi / mobile data.
    const interval = window.setInterval(async () => {
      const online = navigator.onLine && (await probe());
      setOffline((prev) => {
        if (prev && online) {
          try { syncServerTime(true); } catch {}
          return false;
        }
        if (!prev && !online) return true;
        return prev;
      });
    }, 6000);

    // Also re-check whenever the app returns to the foreground.
    const onVisible = () => {
      if (document.visibilityState === "visible") void goOnline();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = async () => {
    setRetrying(true);
    try {
      if (await probe()) {
        setOffline(false);
        try { syncServerTime(true); } catch {}
      }
    } finally {
      setTimeout(() => setRetrying(false), 400);
    }
  };

  if (!mounted || !offline) return null;

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[2147483646] flex flex-col items-center justify-center gap-4 px-6 text-center text-white"
      style={{
        background:
          "radial-gradient(ellipse at center, #0d3a5c 0%, #061826 60%, #020a13 100%)",
      }}
    >
      <div className="text-6xl">📡</div>
      <h1 className="text-2xl font-extrabold text-amber-300">لا يوجد اتصال بالإنترنت</h1>
      <p className="max-w-xs text-sm text-amber-100/80">
        تحقّق من اتصالك بالشبكة ثم اضغط إعادة المحاولة للعودة إلى اللعبة.
      </p>
      <button
        onClick={retry}
        disabled={retrying}
        className="mt-2 rounded-lg bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 px-6 py-2 font-extrabold text-amber-950 active:scale-95 disabled:opacity-60"
      >
        {retrying ? "..." : "🔁 إعادة المحاولة"}
      </button>
    </div>
  );
}
