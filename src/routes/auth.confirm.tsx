import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type EmailOtpType = "signup" | "invite" | "magiclink" | "recovery" | "email_change";

const allowedTypes = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change"]);

function safeNext(value: string | null, fallback: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

export const Route = createFileRoute("/auth/confirm")({
  ssr: false,
  head: () => ({ meta: [{ title: "تأكيد الرابط — ملوك القراصنة" }] }),
  component: AuthConfirmPage,
});

function AuthConfirmPage() {
  const nav = useNavigate();
  const [status, setStatus] = useState("جاري تأكيد الرابط...");
  const [failed, setFailed] = useState(false);

  const params = useMemo(() => {
    const search = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return {
      tokenHash: search.get("token_hash") || hashParams.get("token_hash"),
      type: search.get("type") || hashParams.get("type"),
      next: search.get("next") || hashParams.get("next"),
      code: search.get("code") || hashParams.get("code"),
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (params.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(params.code);
          if (error) throw error;
        } else {
          const type = params.type as EmailOtpType;
          if (!params.tokenHash || !allowedTypes.has(type)) throw new Error("invalid_link");
          const { error } = await supabase.auth.verifyOtp({ token_hash: params.tokenHash, type });
          if (error) throw error;
        }

        if (cancelled) return;
        const next = safeNext(params.next, params.type === "recovery" ? "/reset-password" : "/");
        setStatus(params.type === "recovery" ? "تم التحقق، افتح صفحة تغيير كلمة المرور..." : "تم تأكيد الرابط بنجاح ✓");
        window.setTimeout(() => nav({ to: next as any }), 700);
      } catch {
        if (cancelled) return;
        setFailed(true);
        setStatus("الرابط غير صالح أو انتهت مدته. اطلب رابطاً جديداً.");
      }
    })();

    return () => { cancelled = true; };
  }, [nav, params]);

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 text-white" dir="rtl" style={{
      background: "radial-gradient(ellipse at top, #0c4a6e 0%, #082f49 55%, #020617 100%)",
    }}>
      <div className="w-full max-w-sm rounded-2xl bg-stone-950/80 backdrop-blur border-2 border-amber-700/60 p-6 shadow-2xl text-center space-y-4">
        <div className="text-5xl">{failed ? "⚠️" : "⚓"}</div>
        <h1 className="text-xl font-extrabold text-amber-300">تأكيد الرابط</h1>
        <p className={failed ? "text-rose-300 text-sm" : "text-amber-100/80 text-sm"}>{status}</p>
        {failed && (
          <button
            onClick={() => nav({ to: "/login" })}
            className="w-full py-2 rounded-lg bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 font-extrabold active:scale-95"
          >
            العودة للدخول
          </button>
        )}
      </div>
    </div>
  );
}