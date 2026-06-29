import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/forgot-password")({
  ssr: false,
  head: () => ({ meta: [{ title: "استعادة كلمة المرور — ملوك القراصنة" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setMsg(null); setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/confirm?type=recovery&next=/reset-password`,
    });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setMsg("تم إرسال رابط الاستعادة إلى بريدك ✓");
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 text-white" dir="rtl" style={{
      background: "radial-gradient(ellipse at top, #0c4a6e 0%, #082f49 55%, #020617 100%)",
    }}>
      <div className="w-full max-w-sm rounded-2xl bg-stone-950/80 backdrop-blur border-2 border-amber-700/60 p-6 shadow-2xl">
        <div className="text-center mb-5">
          <div className="text-5xl mb-1">🔑</div>
          <div className="text-xl font-extrabold text-amber-300">استعادة كلمة المرور</div>
          <div className="text-xs text-amber-100/70">سنرسل لك رابطاً مؤقتاً لإعادة التعيين</div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input type="email" required placeholder="الإيميل" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-amber-700/40 text-white text-sm focus:outline-none focus:border-amber-400" />
          {err && <div className="text-rose-400 text-xs text-center">{err}</div>}
          {msg && <div className="text-emerald-400 text-xs text-center">{msg}</div>}
          <button disabled={loading} type="submit" className="w-full py-2 rounded-lg bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 font-extrabold active:scale-95 disabled:opacity-60">
            {loading ? "..." : "إرسال الرابط"}
          </button>
        </form>
        <div className="mt-4 text-center text-xs text-amber-100/70">
          <Link to="/login" className="text-amber-300 font-bold">← العودة للدخول</Link>
        </div>
      </div>
    </div>
  );
}