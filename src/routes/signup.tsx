import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LegalFooter } from "@/components/LegalFooter";
import { CoinIcon } from "@/components/CurrencyIcon";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "إنشاء حساب مجاني — ملوك القراصنة (هامور شابك)" },
      { name: "description", content: "أنشئ حسابك مجاناً في ملوك القراصنة (هامور شابك) — أكبر لعبة قراصنة عربية متعددة اللاعبين. ابدأ مغامرتك البحرية الآن." },
      { name: "keywords", content: "تسجيل ملوك القراصنة, حساب جديد هامور شابك, العب قراصنة مجاناً" },
      { property: "og:title", content: "سجّل مجاناً — ملوك القراصنة (هامور شابك)" },
      { property: "og:description", content: "انضم لآلاف اللاعبين في ملوك القراصنة — لعبة قراصنة عربية مجانية." },
      { property: "og:url", content: "https://www.molok-alqarasna.com/signup" },
    ],
    links: [{ rel: "canonical", href: "https://www.molok-alqarasna.com/signup" }],
  }),
  component: SignupPage,
});

function SignupPage() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [refCode, setRefCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  // Capture ?ref=CODE from URL or localStorage
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get("ref") || params.get("invite");
      const stored = localStorage.getItem("pending_referral_code");
      const code = (fromUrl || stored || "").toUpperCase().trim();
      if (code) {
        setRefCode(code);
        localStorage.setItem("pending_referral_code", code);
      }
    } catch {}
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setLoading(true);
    try {
      const deviceId = (typeof localStorage !== "undefined" ? localStorage.getItem("hamor_device_id") : null) || "";
      const { authPreflight } = await import("@/lib/auth-preflight.functions");
      const pre = await authPreflight({ data: { email, deviceId } });
      if (pre.blocked) {
        setLoading(false);
        setErr(pre.reason || "ممنوع إنشاء حساب");
        return;
      }
    } catch {}
    // No display_name passed: DB generates a unique placeholder ("قبطانXXXXXX").
    // The user picks their real name later from inside the app (profile page).
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { referral_code: refCode || null },
      },
    });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    if (!data.session) { setPendingEmail(email); return; }
    if (refCode) {
      try {
        await (supabase as any).rpc("apply_referral_code", { p_code: refCode });
        localStorage.removeItem("pending_referral_code");
      } catch {}
    }
    nav({ to: "/" });
  };

  // Resend kept for VerifyOtpForm; no separate button here anymore.

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 text-white" dir="rtl" style={{
      background: "radial-gradient(ellipse at top, #0c4a6e 0%, #082f49 55%, #020617 100%)",
    }}>
      <div className="w-full max-w-sm rounded-2xl bg-stone-950/80 backdrop-blur border-2 border-amber-700/60 p-6 shadow-2xl">
        <div className="text-center mb-5">
          <div className="text-5xl mb-1">⚓</div>
          <div className="text-xl font-extrabold text-amber-300">حساب جديد</div>
          <div className="text-xs text-amber-100/70 inline-flex items-center justify-center gap-1 w-full">ابدأ رحلتك من 500 <CoinIcon size={12} /></div>
        </div>
        {pendingEmail ? (
          <VerifyOtpForm
            email={pendingEmail}
            refCode={refCode}
            onVerified={() => nav({ to: "/" })}
          />
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input type="email" required placeholder="الإيميل" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-amber-700/40 text-white text-sm" />
            <input type="password" required minLength={6} placeholder="كلمه المرور (6+ أحرف)" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-amber-700/40 text-white text-sm" />
            <input type="text" placeholder="🎁 كود دعوة (اختياري)" value={refCode} onChange={(e) => setRefCode(e.target.value.toUpperCase().slice(0, 12))}
              className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-emerald-700/40 text-emerald-200 text-sm tracking-widest text-center" />
            <div className="text-[11px] text-amber-100/70 text-center bg-amber-950/40 border border-amber-700/40 rounded-lg p-2">
              💡 تقدر تختار اسمك من داخل اللعبة بعد التسجيل من صفحة «الملف الشخصي».
            </div>
            {err && <div className="text-rose-400 text-xs text-center">{err}</div>}
            <button disabled={loading} type="submit" className="w-full py-2 rounded-lg bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 font-extrabold active:scale-95 disabled:opacity-60">
              {loading ? "..." : "تسجيل"}
            </button>
          </form>
        )}
        <div className="mt-4 text-center text-xs text-amber-100/70">
          عندك حساب؟ <Link to="/login" className="text-amber-300 font-bold">دخول</Link>
        </div>
        <div className="mt-2 text-center text-[10px] text-amber-100/50">
          بإنشاء حسابك فأنت توافق على <Link to="/terms" className="text-amber-300">الشروط</Link> و
          <Link to="/privacy" className="text-amber-300"> سياسة الخصوصية</Link>.
        </div>
        <LegalFooter />
      </div>
    </div>
  );
}

function VerifyOtpForm({ email, refCode, onVerified }: { email: string; refCode: string; onVerified: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const token = code.trim();
    if (token.length < 6) { setErr("أدخل الكود المكون من 6 أرقام"); return; }
    setBusy(true);
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "signup" });
    setBusy(false);
    if (error) { setErr("الكود غير صحيح أو منتهي. أعد المحاولة"); return; }
    if (!data.session) { setErr("تعذر إكمال التأكيد، حاول مرة أخرى"); return; }
    if (refCode) {
      try {
        await (supabase as any).rpc("apply_referral_code", { p_code: refCode });
        localStorage.removeItem("pending_referral_code");
      } catch {}
    }
    onVerified();
  };

  const resend = async () => {
    if (resending) return;
    setResending(true); setResendMsg(null); setErr(null);
    const { error } = await supabase.auth.resend({ type: "signup", email });
    setResending(false);
    setResendMsg(error ? "تعذر الإرسال: " + error.message : "تم إرسال كود جديد ✓");
  };

  return (
    <form onSubmit={verify} className="space-y-3 text-center">
      <div className="text-5xl">📧</div>
      <div className="text-amber-200 font-bold">أدخل كود التأكيد</div>
      <div className="text-xs text-amber-100/70">
        أرسلنا كوداً من 6 أرقام إلى <span className="text-amber-300 break-all">{email}</span>
      </div>
      <div className="text-[11px] text-amber-100/90 bg-amber-950/60 border border-amber-700/60 rounded-lg p-2 text-right leading-relaxed">
        ⚠️ <strong>لم تجد الكود؟</strong> تحقق من مجلد <strong>الرسائل غير المرغوب فيها (Spam / Junk)</strong>.
        <br />
        لتصل الرسائل القادمة لبريدك الأساسي:
        <br />
        • <strong>Gmail:</strong> افتح الرسالة ← اضغط <strong>«ليست رسالة غير مرغوب فيها» (Not spam)</strong>، ثم أضف
        <span dir="ltr" className="px-1 text-amber-300">notify@notify.www.molok-alqarasna.com</span> إلى جهات الاتصال.
        <br />
        • <strong>Outlook / Hotmail:</strong> اضغط <strong>«ليست بريدًا عشوائيًا»</strong> وأضف المرسل للمصادر الموثوقة.
      </div>

      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        required
        placeholder="------"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="w-full px-3 py-3 rounded-lg bg-stone-900 border-2 border-amber-700/50 text-white text-2xl font-bold tracking-[0.6em] text-center focus:outline-none focus:border-amber-400"
      />
      {err && <div className="text-rose-400 text-xs">{err}</div>}
      <button
        disabled={busy || code.length < 6}
        type="submit"
        className="w-full py-2 rounded-lg bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 font-extrabold active:scale-95 disabled:opacity-60"
      >
        {busy ? "جاري التأكيد..." : "✓ تأكيد الحساب"}
      </button>
      <button
        type="button"
        onClick={resend}
        disabled={resending}
        className="w-full py-2 rounded-lg bg-emerald-700/70 hover:bg-emerald-700 text-white text-xs font-bold active:scale-95 disabled:opacity-50"
      >
        {resending ? "جاري الإرسال..." : "🔁 إعادة إرسال الكود"}
      </button>
      {resendMsg && <div className="text-[11px] text-emerald-300">{resendMsg}</div>}
    </form>
  );
}
