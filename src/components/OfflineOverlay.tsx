import { useEffect, useState } from "react";
import { syncServerTime } from "@/lib/server-time";

/**
 * Custom offline UI shown whenever the device loses network.
 * Replaces the browser's default "webpage not available" screen —
 * required to keep Google Play from flagging the app for poor offline UX.
 */
export function OfflineOverlay() {
  const [offline, setOffline] = useState<boolean>(false);
  const [mounted, setMounted] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    setMounted(true);
    setOffline(!navigator.onLine);
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const retry = async () => {
    setRetrying(true);
    try {
      // Ping same-origin to force a real network check.
      await fetch(window.location.origin + "/manifest.json", {
        cache: "no-store",
        method: "HEAD",
      });
      setOffline(false);
      try { syncServerTime(true); } catch {}
    } catch {
      // still offline — flash the button
    } finally {
      setTimeout(() => setRetrying(false), 400);
    }
  };

  if (!offline) return null;

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
