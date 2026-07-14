/**
 * Account verification badge + resend confirmation + change email.
 * Renders inside the profile page.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function VerificationStatus() {
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showChange, setShowChange] = useState(false);
  const [newEmail, setNewEmail] = useState("");

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4500); };

  const refresh = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    setEmail(u.user.email ?? "");
    setEmailVerified(!!u.user.email_confirmed_at);
  };

  useEffect(() => { void refresh(); }, []);

  const resendEmail = async () => {
    if (!email) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
      });
      if (error) throw error;
      flash("✅ تم إرسال رابط التأكيد إلى بريدك");
    } catch (e: any) {
      flash(e?.message?.includes("rate") ? "الرجاء الانتظار قليلاً قبل إعادة الإرسال" : "تعذّر الإرسال — حاول لاحقاً");
    } finally { setBusy(false); }
  };

  const changeEmail = async () => {
    const e = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { flash("أدخل بريد إلكتروني صحيح"); return; }
    if (e === email.toLowerCase()) { flash("هذا نفس بريدك الحالي"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser(
        { email: e },
        { emailRedirectTo: `${window.location.origin}/auth/confirm` },
      );
      if (error) throw error;
      flash("✅ تم إرسال رابط التأكيد إلى البريد الجديد. افتحه لتفعيله.");
      setShowChange(false);
      setNewEmail("");
    } catch (err: any) {
      const m = String(err?.message ?? "");
      if (m.includes("rate")) flash("الرجاء الانتظار قليلاً قبل المحاولة مجدداً");
      else if (m.toLowerCase().includes("already")) flash("هذا البريد مستخدم في حساب آخر");
      else flash(m || "تعذّر تغيير البريد");
    } finally { setBusy(false); }
  };

  if (emailVerified === null) return null;

  return (
    <section className="rounded-2xl p-4 glass-hud border border-accent/30 space-y-3" dir="rtl">
      <div className="flex items-center gap-2">
        <div className="text-sm font-bold text-accent">🔐 حالة توثيق الحساب</div>
      </div>

      <div className={`rounded-xl p-3 border ${emailVerified ? "bg-emerald-950/40 border-emerald-700/50" : "bg-rose-950/40 border-rose-700/50"}`}>
        <div className="flex items-center gap-2 text-sm font-bold">
          {emailVerified ? "🟢" : "🔴"} البريد الإلكتروني {emailVerified ? "موثق" : "غير موثق"}
        </div>
        <div className="text-[11px] text-stone-300 mt-1 break-all">{email || "—"}</div>
        {!emailVerified && (
          <>
            <div className="text-[11px] text-rose-200/90 mt-1 leading-snug">
              حسابك غير موثق. لا يمكنك الهجوم أو الدعم أو الكتابة في الشات حتى توثق بريدك.
              <br />إذا كان البريد وهمي أو غلط، غيّره لبريد حقيقي واستقبل رابط التفعيل عليه.
            </div>
            <div className="flex flex-col gap-2 mt-2">
              <button onClick={resendEmail} disabled={busy}
                className="w-full py-2 rounded-lg bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 text-xs font-bold active:scale-95 disabled:opacity-60">
                {busy ? "..." : "✉️ إعادة إرسال رابط التأكيد"}
              </button>
              {!showChange ? (
                <button onClick={() => setShowChange(true)} disabled={busy}
                  className="w-full py-2 rounded-lg bg-gradient-to-b from-sky-400 to-sky-700 border-2 border-sky-200 text-white text-xs font-bold active:scale-95 disabled:opacity-60">
                  ✏️ تغيير البريد إلى بريد آخر
                </button>
              ) : (
                <div className="space-y-2">
                  <input
                    type="email" dir="ltr" value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-stone-600 text-white text-sm"
                  />
                  <div className="flex gap-2">
                    <button onClick={changeEmail} disabled={busy}
                      className="flex-1 py-2 rounded-lg bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200 text-white text-xs font-bold active:scale-95 disabled:opacity-60">
                      {busy ? "..." : "✓ إرسال رابط التأكيد للبريد الجديد"}
                    </button>
                    <button onClick={() => { setShowChange(false); setNewEmail(""); }}
                      className="px-3 py-2 rounded-lg bg-stone-700 text-white text-xs font-bold active:scale-95">
                      إلغاء
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {msg && <div className="text-[11px] text-center text-stone-100 bg-stone-900/70 rounded-lg py-1">{msg}</div>}
    </section>
  );
}
