import { siteUrl } from "@/lib/site-url";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { LegalFooter } from "@/components/LegalFooter";
import { MfaChallenge, mfaStepUpRequired } from "@/components/MfaChallenge";
import { useDeviceSlotGate } from "@/components/useDeviceSlotGate";


export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "تسجيل الدخول — ملوك القراصنة (هامور شابك)" },
      { name: "description", content: "ادخل إلى حسابك في ملوك القراصنة (هامور شابك) — لعبة القراصنة العربية متعددة اللاعبين." },
      { property: "og:title", content: "تسجيل الدخول — ملوك القراصنة" },
      { property: "og:description", content: "ادخل وأبحر فوراً في لعبة ملوك القراصنة (هامور شابك)." },
      { property: "og:url", content: "https://www.molok-alqarasna.com/login" },
    ],
    links: [{ rel: "canonical", href: "https://www.molok-alqarasna.com/login" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsMfa, setNeedsMfa] = useState(false);
  const slotGate = useDeviceSlotGate();
  // Stable device key used by the anti-guessing throttle (set during preflight).
  const guardDeviceRef = useRef<string>("");
  const [savedAccounts, setSavedAccounts] = useState<{ userId: string; username: string | null; email: string | null; emoji: string | null }[]>([]);
  const [switching, setSwitching] = useState(false);
  const [pendingBack, setPendingBack] = useState<{ userId: string; username: string | null; email: string | null; emoji: string | null } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { listAccounts, pendingAddOrigin } = await import("@/lib/account-switch");
        setSavedAccounts(listAccounts().map((a) => ({ userId: a.userId, username: a.username, email: a.email, emoji: a.emoji })));
        const o = pendingAddOrigin();
        if (o) setPendingBack({ userId: o.userId, username: o.username, email: o.email, emoji: o.emoji });
      } catch {}
    })();
  }, []);

  const cancelAdd = async () => {
    if (switching) return;
    setSwitching(true); setErr(null);
    const { cancelAddAccount } = await import("@/lib/account-switch");
    const res = await cancelAddAccount();
    if (res.ok) { window.location.replace("/"); return; }
    setSwitching(false);
    setPendingBack(null);
    setErr("انتهت صلاحية جلسة الحساب السابق — سجل الدخول له مرة واحدة");
  };

  const quickSwitch = async (userId: string) => {
    if (switching) return;
    setSwitching(true); setErr(null);
    const { switchToAccount, listAccounts, clearPendingAdd } = await import("@/lib/account-switch");
    const res = await switchToAccount(userId);
    if (res.ok) { clearPendingAdd(); window.location.replace("/"); return; }
    setSwitching(false);
    setSavedAccounts(listAccounts().map((a) => ({ userId: a.userId, username: a.username, email: a.email, emoji: a.emoji })));
    setErr(res.reason);
  };



  const waitAtMost = <T,>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error(message)), timeoutMs)),
    ]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      if (await mfaStepUpRequired()) { setNeedsMfa(true); return; }
      const { clearPendingAdd } = await import("@/lib/account-switch");
      clearPendingAdd();
      nav({ to: "/" });
    });
  }, [nav]);


  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setResendMsg(null); setNeedsConfirm(false); setLoading(true);
    try {
      const deviceId = (typeof localStorage !== "undefined" ? localStorage.getItem("hamor_device_id") : null) || "";
      const { getDeviceFingerprint } = await import("@/lib/device-fingerprint");
      const fp = await waitAtMost(getDeviceFingerprint(), 4000, "fingerprint_timeout");
      const hardwareId = fp.hash;
      guardDeviceRef.current = (fp.stableKey || hardwareId || deviceId || "").slice(0, 200);

      const { authPreflight } = await import("@/lib/auth-preflight.functions");
      const pre = await waitAtMost(authPreflight({ data: {
        email, deviceId, hardwareId,
        stableKey: fp.stableKey, noiseKey: fp.noiseKey, nativeId: fp.nativeId,
        signals: fp.signals as unknown as Record<string, unknown>, strong: fp.strong,
      } }), 8000, "preflight_timeout");
      if (pre.blocked) {
        setLoading(false);
        setErr(pre.reason || "ممنوع تسجيل الدخول");
        return;
      }
    } catch {
      setLoading(false);
      setErr("تعذر التحقق الأمني من الجهاز. تأكد من الاتصال ثم حاول مجددًا");
      return;
    }
    // Anti-guessing throttle: 5 free tries, then a short growing cooldown.
    const guardKey = { email: email.trim().toLowerCase(), device: guardDeviceRef.current };
    try {
      const { loginGuardCheck } = await import("@/lib/login-guard.functions");
      const g = await waitAtMost(loginGuardCheck({ data: guardKey }), 6000, "guard_timeout");
      if (g.blocked) {
        setLoading(false);
        const mins = Math.ceil(g.retryAfterSec / 60);
        setErr(
          g.retryAfterSec >= 60
            ? `محاولات دخول كثيرة خاطئة — حاول بعد ${mins} دقيقة`
            : `محاولات دخول كثيرة خاطئة — حاول بعد ${g.retryAfterSec} ثانية`,
        );
        return;
      }
    } catch { /* guard is best-effort; never block a real player on infra error */ }

    try {
      const signInOnce = () => supabase.auth.signInWithPassword({ email, password });
      let result: Awaited<ReturnType<typeof signInOnce>>;
      try {
        result = await waitAtMost(signInOnce(), 30000, "__retry__");
      } catch {
        // one silent retry — iOS Safari sometimes drops the first fetch on custom domains
        result = await waitAtMost(signInOnce(), 30000, "تعذر الاتصال بخدمة الدخول، حاول مرة أخرى");
      }
      const { data, error } = result;

      const record = async (success: boolean) => {
        try {
          const { loginGuardRecord } = await import("@/lib/login-guard.functions");
          return await loginGuardRecord({ data: { ...guardKey, success } });
        } catch { return { retryAfterSec: 0 }; }
      };

      if (error) {
        const msg = (error.message || "").toLowerCase();
        if (msg.includes("not confirmed") || msg.includes("email not confirmed") || (error as any).code === "email_not_confirmed") {
          setNeedsConfirm(true);
          setErr("يرجى تأكيد حسابك عبر الرابط المرسل إلى بريدك الإلكتروني");
          return;
        }
        const bad = msg.includes("invalid login") || msg.includes("invalid credentials") || (error as any).code === "invalid_credentials";
        if (bad) {
          const r = await record(false);
          // Generic message on purpose: never reveal whether the email exists.
          setErr(
            r.retryAfterSec > 0
              ? `البريد الإلكتروني أو كلمة المرور غير صحيحة — انتظر ${r.retryAfterSec >= 60 ? Math.ceil(r.retryAfterSec / 60) + " دقيقة" : r.retryAfterSec + " ثانية"} قبل المحاولة`
              : "البريد الإلكتروني أو كلمة المرور غير صحيحة",
          );
          return;
        }
        setErr(error.message); return;
      }
      void record(true);

      if (await mfaStepUpRequired()) { setNeedsMfa(true); return; }
      const ok = await waitAtMost(
        slotGate.checkAndProceed(data.session!.user.id, data.session!.user.email || null),
        20000,
        "device_check_timeout",
      ).catch(() => false);
      if (!ok) {
        try { await supabase.auth.signOut(); } catch {}
        setErr("تعذر التحقق من صلاحية هذا الجهاز. حاول مجددًا");
        return;
      }
      if (ok) {
        const { clearPendingAdd } = await import("@/lib/account-switch");
        clearPendingAdd();
        nav({ to: "/" });
      }

    } catch (error) {
      setErr(error instanceof Error ? error.message : "تعذر تسجيل الدخول، حاول مرة أخرى");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (!email || resending) return;
    setResending(true); setResendMsg(null);
    const { error } = await supabase.auth.resend({
      type: "signup", email,
      options: { emailRedirectTo: `${siteUrl()}/auth/confirm?type=signup&next=/` },
    });
    setResending(false);
    setResendMsg(error ? "تعذر الإرسال: " + error.message : "تم إرسال رابط جديد إلى بريدك ✓");
  };

  const google = async () => {
    setErr(null);
    const { signInWithGoogleSmart } = await import("@/lib/native-google-auth");
    const result = await signInWithGoogleSmart(window.location.origin);
    if (!result.ok) {
      if (result.error) setErr(result.error);
      return;
    }
    if (await mfaStepUpRequired()) { setNeedsMfa(true); return; }
    const { data: sd } = await supabase.auth.getSession();
    const uid = sd.session?.user.id;
    if (uid) {
      const ok = await slotGate.checkAndProceed(uid, sd.session?.user.email || null);
      if (ok) nav({ to: "/" });
    } else {
      nav({ to: "/" });
    }
  };




  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 text-white" dir="rtl" style={{
      background: "radial-gradient(ellipse at top, #0c4a6e 0%, #082f49 55%, #020617 100%)",
    }}>
      <div className="w-full max-w-sm rounded-2xl bg-stone-950/80 backdrop-blur border-2 border-amber-700/60 p-6 shadow-2xl">
        <div className="text-center mb-5">
          <div className="text-5xl mb-1">⛵</div>
          <div className="text-xl font-extrabold text-amber-300">Ocean Catch</div>
          <div className="text-xs text-amber-100/70">سجل دخولك واركب البحر</div>
        </div>
        {pendingBack && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-950/50 border border-emerald-600/50 text-center space-y-2">
            <div className="text-[11px] text-emerald-100/80">
              أنت في وضع «إضافة حساب». إذا ما تبي تضيف حساب جديد، ارجع لحسابك:
            </div>
            <button type="button" disabled={switching} onClick={cancelAdd}
              className="w-full py-2 rounded-lg bg-gradient-to-b from-emerald-500 to-emerald-700 text-white text-sm font-extrabold active:scale-95 disabled:opacity-50">
              {switching ? "..." : `↩︎ رجوع إلى ${pendingBack.username || pendingBack.email || "حسابي"}`}
            </button>
          </div>
        )}
        {savedAccounts.length > 0 && (

          <div className="mb-4 space-y-2">
            <div className="text-[11px] text-amber-100/70 text-center">حسابات محفوظة على هذا الجهاز</div>
            {savedAccounts.map((a) => (
              <button key={a.userId} type="button" disabled={switching} onClick={() => quickSwitch(a.userId)}
                className="w-full flex items-center gap-2 p-2 rounded-lg bg-stone-900 border border-amber-700/40 text-right active:scale-95 disabled:opacity-50">
                <span className="text-lg">{a.emoji || "🏴‍☠️"}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-bold text-white truncate">{a.username || a.email || "حساب"}</span>
                  <span className="block text-[10px] text-amber-100/60 truncate">{a.email || ""}</span>
                </span>
                <span className="text-[11px] font-bold text-amber-300">{switching ? "..." : "دخول"}</span>
              </button>
            ))}
          </div>
        )}
        <form onSubmit={submit} className="space-y-3">
          <input type="email" required placeholder="الإيميل" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-amber-700/40 text-white text-sm focus:outline-none focus:border-amber-400" />
          <input type="password" required placeholder="كلمه المرور" value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-amber-700/40 text-white text-sm focus:outline-none focus:border-amber-400" />
          {err && <div className="text-amber-300 text-xs text-center">{err}</div>}
          {needsConfirm && (
            <div className="p-3 rounded-lg bg-amber-900/40 border border-amber-700/50 space-y-2 text-center">
              <div className="text-xs text-amber-100">حسابك يحتاج تأكيد. أرسلنا رابطاً مؤقتاً إلى بريدك.</div>
              <button type="button" onClick={() => nav({ to: "/signup" })}
                className="w-full py-1.5 rounded bg-amber-600 text-white text-xs font-bold active:scale-95">
                صفحة تأكيد الحساب
              </button>
              <button type="button" onClick={resend} disabled={resending || !email}
                className="w-full py-1.5 rounded bg-emerald-600 text-white text-xs font-bold active:scale-95 disabled:opacity-50">
                {resending ? "جاري الإرسال..." : "🔁 إعادة إرسال الرابط"}
              </button>
              {resendMsg && <div className="text-[11px] text-emerald-300 text-center">{resendMsg}</div>}
            </div>
          )}
          <button disabled={loading} type="submit" className="w-full py-2 rounded-lg bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 font-extrabold active:scale-95 disabled:opacity-60">
            {loading ? "..." : "دخول"}
          </button>
        </form>
        <div className="my-4 flex items-center gap-2 text-amber-200/40 text-xs">
          <div className="flex-1 h-px bg-amber-700/40" />أو<div className="flex-1 h-px bg-amber-700/40" />
        </div>
        <button onClick={google} className="w-full py-2 rounded-lg bg-white text-stone-900 font-bold flex items-center justify-center gap-2 active:scale-95">
          <span>G</span> الدخول بـ Google
        </button>
        <div className="mt-4 text-center text-xs text-amber-100/70">
          ما عندك حساب؟ <Link to="/signup" className="text-amber-300 font-bold">سجّل الآن</Link>
        </div>
        <div className="mt-2 text-center text-xs">
          <Link to="/forgot-password" className="text-amber-200/80 hover:text-amber-300">نسيت كلمة المرور؟</Link>
        </div>
        <LegalFooter />
      </div>
      {needsMfa && <MfaChallenge onVerified={() => nav({ to: "/" })} onCancel={() => setNeedsMfa(false)} />}
      {slotGate.node}
    </div>
  );
}
