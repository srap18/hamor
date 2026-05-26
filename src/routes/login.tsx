import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "تسجيل الدخول — Ocean Catch" }] }),
  component: LoginPage,
});

function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) nav({ to: "/" }); });
  }, [nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    nav({ to: "/" });
  };

  const google = async () => {
    setErr(null);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) setErr(result.error.message ?? "فشل تسجيل الدخول");
    if (!result.redirected && !result.error) nav({ to: "/" });
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
          {err && <div className="text-rose-400 text-xs text-center">{err}</div>}
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
      </div>
    </div>
  );
}
