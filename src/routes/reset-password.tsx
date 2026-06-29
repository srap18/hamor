import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({ meta: [{ title: "تعيين كلمة مرور جديدة — ملوك القراصنة" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const code = search.get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) setErr("رابط الاستعادة غير صالح أو انتهت مدته");
        else setReady(true);
      });
    }
    // Supabase places a recovery token in the URL hash; the SDK exchanges it
    // automatically and fires PASSWORD_RECOVERY via onAuthStateChange.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    return () => subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setMsg(null);
    if (password.length < 6) { setErr("كلمة المرور قصيرة (6 أحرف على الأقل)"); return; }
    if (password !== confirm) { setErr("كلمتا المرور غير متطابقتين"); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setMsg("تم تغيير كلمة المرور ✓");
    setTimeout(() => nav({ to: "/" }), 1200);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 text-white" dir="rtl" style={{
      background: "radial-gradient(ellipse at top, #0c4a6e 0%, #082f49 55%, #020617 100%)",
    }}>
      <div className="w-full max-w-sm rounded-2xl bg-stone-950/80 backdrop-blur border-2 border-amber-700/60 p-6 shadow-2xl">
        <div className="text-center mb-5">
          <div className="text-5xl mb-1">🔒</div>
          <div className="text-xl font-extrabold text-amber-300">كلمة مرور جديدة</div>
        </div>
        {!ready ? (
          <div className="text-center text-xs text-amber-100/70">جاري التحقق من الرابط...</div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input type="password" required placeholder="كلمة المرور الجديدة" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-amber-700/40 text-white text-sm focus:outline-none focus:border-amber-400" />
            <input type="password" required placeholder="تأكيد كلمة المرور" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-amber-700/40 text-white text-sm focus:outline-none focus:border-amber-400" />
            {err && <div className="text-rose-400 text-xs text-center">{err}</div>}
            {msg && <div className="text-emerald-400 text-xs text-center">{msg}</div>}
            <button disabled={loading} type="submit" className="w-full py-2 rounded-lg bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 font-extrabold active:scale-95 disabled:opacity-60">
              {loading ? "..." : "حفظ كلمة المرور"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}