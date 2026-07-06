import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const DEVICE_KEY = "oc_device_id";
const SESSION_KEY = "oc_session_token";

function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID() + "-" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "fallback-" + Math.random().toString(36).slice(2);
  }
}

function getOrCreateSessionToken(): string {
  try {
    let t = localStorage.getItem(SESSION_KEY);
    if (!t) {
      t = crypto.randomUUID() + "-" + Date.now().toString(36);
      localStorage.setItem(SESSION_KEY, t);
    }
    return t;
  } catch {
    return crypto.randomUUID();
  }
}

export type SecurityBlock =
  | { kind: "device_taken"; message: string }
  | { kind: "kicked"; message: string }
  | { kind: "duplicate_tab"; message: string };

/**
 * Enforces:
 *  - One active session per account (kicks older sessions)
 *  - One active tab/window per account (BFCache-safe heartbeat)
 */
export function useSecurityEnforcement(): SecurityBlock | null {
  const { user } = useAuth();
  const [block, setBlock] = useState<SecurityBlock | null>(null);

  useEffect(() => {
    if (!user) { setBlock(null); return; }
    let cancelled = false;
    const localToken = getOrCreateSessionToken();

    // ===== Single-tab-per-account guard =====
    // BFCache-safe: uses localStorage heartbeat with a short freshness window
    // and re-checks on pageshow/visibilitychange. Never signs the user out —
    // shows an overlay with "use this window" so the user can always recover.
    const HB_KEY = `oc_tab_owner_${user.id}`;
    const TAKEOVER_KEY = `oc_tab_takeover_${user.id}`;
    const HB_INTERVAL = 1500;
    const HB_STALE_MS = 4000;

    let tabId: string;
    try {
      tabId = sessionStorage.getItem("oc_tab_id") || "";
      if (!tabId) {
        tabId = crypto.randomUUID() + "-" + Math.random().toString(36).slice(2, 8);
        sessionStorage.setItem("oc_tab_id", tabId);
      }
    } catch {
      tabId = crypto.randomUUID();
    }

    let hbTimer: number | null = null;
    let checkTimer: number | null = null;
    let isDuplicate = false;

    const readOwner = (): { tabId: string; ts: number } | null => {
      try {
        const raw = localStorage.getItem(HB_KEY);
        if (!raw) return null;
        const j = JSON.parse(raw);
        if (!j?.tabId || typeof j.ts !== "number") return null;
        return j;
      } catch { return null; }
    };
    const writeOwner = () => {
      try { localStorage.setItem(HB_KEY, JSON.stringify({ tabId, ts: Date.now() })); } catch {}
    };
    const clearOwnerIfMine = () => {
      const o = readOwner();
      if (o && o.tabId === tabId) {
        try { localStorage.removeItem(HB_KEY); } catch {}
      }
    };

    const claimOrCheck = () => {
      if (cancelled) return;
      const owner = readOwner();
      const now = Date.now();
      if (!owner || owner.tabId === tabId || (now - owner.ts) > HB_STALE_MS) {
        writeOwner();
        if (isDuplicate) {
          isDuplicate = false;
          setBlock(null);
        }
      } else {
        if (!isDuplicate) {
          isDuplicate = true;
          setBlock({ kind: "duplicate_tab", message: "لا يمكن فتح اللعبة في أكثر من نافذة على نفس الحساب. أغلق النوافذ الأخرى، أو اضغط \"استخدم هذه النافذة\" لنقل الجلسة إلى هنا." });
        }
      }
    };

    const onStorage = (e: StorageEvent) => {
      if (cancelled) return;
      if (e.key === TAKEOVER_KEY && e.newValue) {
        try {
          const j = JSON.parse(e.newValue);
          if (j?.tabId && j.tabId !== tabId) {
            isDuplicate = true;
            setBlock({ kind: "duplicate_tab", message: "تم فتح اللعبة في نافذة أخرى. هذه النافذة معطّلة." });
            if (hbTimer) { window.clearInterval(hbTimer); hbTimer = null; }
          }
        } catch {}
      } else if (e.key === HB_KEY) {
        claimOrCheck();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") claimOrCheck();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) claimOrCheck();
    };
    const onBeforeUnload = () => { clearOwnerIfMine(); };

    claimOrCheck();
    hbTimer = window.setInterval(() => { if (!isDuplicate) writeOwner(); }, HB_INTERVAL);
    checkTimer = window.setInterval(claimOrCheck, HB_INTERVAL);

    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onBeforeUnload);

    (window as any).__ocTakeoverTab = () => {
      try {
        localStorage.setItem(TAKEOVER_KEY, JSON.stringify({ tabId, ts: Date.now() }));
        writeOwner();
        isDuplicate = false;
        setBlock(null);
        if (!hbTimer) hbTimer = window.setInterval(() => writeOwner(), HB_INTERVAL);
      } catch {}
    };

    (async () => {
      const { error: sessErr } = await (supabase as any).rpc("claim_session", { _token: localToken });
      if (cancelled) return;
      if (sessErr) {
        const msg = sessErr.message || "";
        if (msg.includes("banned")) {
          setBlock({ kind: "kicked", message: "هذا الحساب محظور نهائياً من الدخول" });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (hbTimer) window.clearInterval(hbTimer);
      if (checkTimer) window.clearInterval(checkTimer);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onBeforeUnload);
      clearOwnerIfMine();
      try { delete (window as any).__ocTakeoverTab; } catch {}
    };
  }, [user?.id]);

  return block;
}
