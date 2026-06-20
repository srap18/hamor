import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "install_prompt_dismissed_at";
const DISMISS_DAYS = 7;

function isInStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  // iOS
  if ((window.navigator as any).standalone === true) return true;
  // Android / Desktop
  return window.matchMedia("(display-mode: standalone)").matches;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
}

function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
}

function recentlyDismissed(): boolean {
  try {
    const v = localStorage.getItem(DISMISS_KEY);
    if (!v) return false;
    const t = parseInt(v, 10);
    if (!t) return false;
    return Date.now() - t < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function InstallAppButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isInStandaloneMode()) return; // already installed
    if (!isMobile()) return; // only on phones
    if (recentlyDismissed()) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS doesn't fire beforeinstallprompt — show iOS hint instead
    if (isIOS()) {
      const t = setTimeout(() => setShow(true), 2500);
      return () => {
        clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", onPrompt);
      };
    }

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
    setShow(false);
    setShowIosHelp(false);
  };

  const handleInstall = async () => {
    if (deferred) {
      try {
        await deferred.prompt();
        const { outcome } = await deferred.userChoice;
        if (outcome === "accepted") {
          setShow(false);
        } else {
          dismiss();
        }
        setDeferred(null);
      } catch {
        dismiss();
      }
      return;
    }
    if (isIOS()) {
      setShowIosHelp(true);
    }
  };

  if (!show && !showIosHelp) return null;

  return (
    <>
      {show && !showIosHelp && (
        <div
          dir="rtl"
          className="fixed bottom-4 left-1/2 z-[9999] -translate-x-1/2 w-[92vw] max-w-md rounded-2xl border border-amber-500/40 bg-gradient-to-br from-slate-900/95 to-slate-950/95 px-4 py-3 shadow-2xl backdrop-blur-md"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center gap-3">
            <div className="text-3xl">⚓</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-amber-300">ثبّت اللعبة على جوالك</div>
              <div className="text-[11px] text-slate-300/90 leading-tight mt-0.5">
                ادخل اللعبة من شاشة الجوال مباشرة مثل التطبيقات
              </div>
            </div>
            <button
              onClick={handleInstall}
              className="shrink-0 rounded-xl bg-amber-500 px-3 py-2 text-sm font-bold text-slate-900 active:scale-95 transition"
            >
              تثبيت
            </button>
            <button
              onClick={dismiss}
              aria-label="إغلاق"
              className="shrink-0 rounded-lg px-2 py-1 text-slate-400 hover:text-slate-200"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {showIosHelp && (
        <div
          dir="rtl"
          className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={dismiss}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-amber-500/40 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
          >
            <div className="text-center text-3xl mb-2">📲</div>
            <div className="text-center text-base font-bold text-amber-300 mb-3">
              تثبيت اللعبة على iPhone
            </div>
            <ol className="space-y-3 text-sm text-slate-200 leading-relaxed">
              <li className="flex items-start gap-2">
                <span className="text-amber-400 font-bold">1.</span>
                <span>
                  اضغط على زر <span className="font-bold">المشاركة</span>{" "}
                  <span className="inline-block px-1.5 py-0.5 bg-slate-800 rounded text-xs">⬆️</span>{" "}
                  في الأسفل
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-400 font-bold">2.</span>
                <span>
                  اختر <span className="font-bold">"إضافة إلى الشاشة الرئيسية"</span>{" "}
                  <span className="inline-block px-1.5 py-0.5 bg-slate-800 rounded text-xs">➕</span>
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-400 font-bold">3.</span>
                <span>
                  اضغط <span className="font-bold">"إضافة"</span> في الأعلى
                </span>
              </li>
            </ol>
            <button
              onClick={dismiss}
              className="mt-5 w-full rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-slate-900 active:scale-95 transition"
            >
              تمام، فهمت
            </button>
          </div>
        </div>
      )}
    </>
  );
}
