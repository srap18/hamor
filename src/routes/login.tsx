import { siteUrl } from "@/lib/site-url";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { LegalFooter } from "@/components/LegalFooter";
import { MfaChallenge, mfaStepUpRequired } from "@/components/MfaChallenge";


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

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      if (await mfaStepUpRequired()) { setNeedsMfa(true); return; }
      if (!data.session.user.email_confirmed_at) { setNeedsConfirm(true); return; }
      nav({ to: "/" });
    });
  }, [nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setResendMsg(null); setNeedsConfirm(false); setLoading(true);
    try {
      const deviceId = (typeof localStorage !== "undefined" ? localStorage.getItem("hamor_device_id") : null) || "";
      const { authPreflight } = await import("@/lib/auth-preflight.functions");
      const pre = await authPreflight({ data: { email, deviceId } });
      if (pre.blocked) {
        setLoading(false);
        setErr(pre.reason || "ممنوع تسجيل الدخول");
        return;
      }
    } catch {}
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("not confirmed") || msg.includes("email not confirmed") || (error as any).code === "email_not_confirmed") {
        setNeedsConfirm(true);
        setErr("يرجى تأكيد حسابك عبر الرابط المرسل إلى بريدك الإلكتروني");
        return;
      }
      setErr(error.message); return;
    }
    if (!data.session?.user.email_confirmed_at) {
      setNeedsConfirm(true);
      setErr("يرجى تأكيد حسابك عبر الرابط المرسل إلى بريدك الإلكتروني");
      return;
    }
    if (await mfaStepUpRequired()) { setNeedsMfa(true); return; }
    nav({ to: "/" });
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
    nav({ to: "/" });
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
    </div>
  );
}
