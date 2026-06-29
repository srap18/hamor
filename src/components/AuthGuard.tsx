import { siteUrl } from "@/lib/site-url";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useSecurityEnforcement } from "@/hooks/use-security-enforcement";
import { MfaChallenge, mfaStepUpRequired } from "@/components/MfaChallenge";


export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, loading, user } = useAuth();
  const navigate = useNavigate();
  const [banInfo, setBanInfo] = useState<{ reason: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [mfaChecked, setMfaChecked] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const securityBlock = useSecurityEnforcement();

  useEffect(() => {
    if (!user) { setMfaChecked(true); return; }
    setMfaChecked(false);
    mfaStepUpRequired().then((req) => { setNeedsMfa(req); setMfaChecked(true); });
  }, [user?.id]);


  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/login" });
    }
  }, [loading, session, navigate]);

  useEffect(() => {
    if (!user) { setChecking(false); return; }
    let cancelled = false;
    setChecking(true);
    const fallback = window.setTimeout(() => {
      if (!cancelled) setChecking(false);
    }, 4000);
    (async () => {
      try {
        const { data } = await supabase
          .from("bans")
          .select("reason, expires_at")
          .eq("user_id", user.id)
          .eq("active", true)
          .order("banned_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        if (data && (!data.expires_at || new Date(data.expires_at) > new Date())) {
          setBanInfo({ reason: data.reason });
        }
      } finally {
        window.clearTimeout(fallback);
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; window.clearTimeout(fallback); };
  }, [user]);

  if (loading || checking || !mfaChecked) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-stone-950 text-amber-200">
        <div className="animate-pulse text-lg">جاري التحميل...</div>
      </div>
    );
  }
  if (!session) return null;

  // Email not confirmed → block entry, offer resend
  if (user && !user.email_confirmed_at) {
    const resend = async () => {
      if (!user.email || resending) return;
      setResending(true); setResendMsg(null);
      const { error } = await supabase.auth.resend({
        type: "signup", email: user.email,
        options: { emailRedirectTo: `${siteUrl()}/auth/confirm?type=signup&next=/` },
      });
      setResending(false);
      setResendMsg(error ? "تعذر الإرسال: " + error.message : "تم إرسال الرابط ✓ راجع بريدك");
    };
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-stone-950 text-amber-100 p-6 gap-4 text-center" dir="rtl">
        <div className="text-6xl">📧</div>
        <h1 className="text-2xl font-bold text-amber-300">يرجى تأكيد حسابك</h1>
        <p className="text-amber-200/80 max-w-md">يرجى تأكيد حسابك عبر الرابط المرسل إلى بريدك الإلكتروني <span className="text-amber-300 break-all">{user.email}</span></p>
        <div className="flex flex-col gap-2 w-full max-w-xs">
          <button onClick={resend} disabled={resending}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-50">
            {resending ? "جاري الإرسال..." : "📧 إعادة إرسال رابط التأكيد"}
          </button>
          {resendMsg && <div className="text-xs text-emerald-300">{resendMsg}</div>}
          <button onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login" }); }}
            className="px-4 py-2 rounded-lg bg-stone-800 text-amber-200/70 text-sm">
            تسجيل خروج
          </button>
          <button onClick={async () => { const { data } = await supabase.auth.refreshSession(); if (data.user?.email_confirmed_at) location.reload(); else setResendMsg("لم يتم التأكيد بعد"); }}
            className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-amber-50 text-sm font-bold">
            تحققت — حدّث الصفحة
          </button>
        </div>
      </div>
    );
  }

  // MFA step-up required (account has 2FA enabled but session is aal1)
  if (needsMfa) {
    return <MfaChallenge onVerified={() => { setNeedsMfa(false); }} onCancel={() => navigate({ to: "/login" })} />;
  }

  if (banInfo) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-red-950 text-red-100 p-6 gap-4 text-center">
        <div className="text-6xl">🚫</div>
        <h1 className="text-2xl font-bold">تم حظر حسابك</h1>
        <p className="text-red-200/80 max-w-md">{banInfo.reason || "تواصل مع الإدارة لمزيد من التفاصيل"}</p>
        <button
          onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login" }); }}
          className="px-4 py-2 rounded-lg bg-red-800 hover:bg-red-700"
        >
          تسجيل خروج
        </button>
      </div>
    );
  }

  if (securityBlock) {
    const isKicked = securityBlock.kind === "kicked";
    const isDup = securityBlock.kind === "duplicate_tab";
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-stone-950 text-amber-100 p-6 gap-4 text-center">
        <div className="text-6xl">{isDup ? "🪟" : isKicked ? "👋" : "🔒"}</div>
        <h1 className="text-2xl font-bold text-amber-300">
          {isDup ? "اللعبة مفتوحة بالفعل" : isKicked ? "تم إنهاء الجلسة" : "جهاز مرتبط بحساب آخر"}
        </h1>
        <p className="text-amber-200/80 max-w-md">{securityBlock.message}</p>
        {isDup ? (
          <button
            onClick={() => { try { window.close(); } catch {} setTimeout(() => location.reload(), 200); }}
            className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-amber-50 font-bold"
          >
            إغلاق هذه النافذة
          </button>
        ) : (
          <button
            onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login" }); }}
            className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-amber-50 font-bold"
          >
            الذهاب لتسجيل الدخول
          </button>
        )}
      </div>
    );
  }

  return <>{children}</>;

}
