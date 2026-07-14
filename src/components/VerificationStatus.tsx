/**
 * Account verification badge + resend email + phone OTP + 500-gem reward.
 * Renders inside the profile page.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function VerificationStatus() {
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [phoneVerified, setPhoneVerified] = useState<boolean>(false);
  const [phoneRewardClaimed, setPhoneRewardClaimed] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [otpStage, setOtpStage] = useState<"idle" | "code">("idle");
  const [phoneDraft, setPhoneDraft] = useState("");

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 3500); };

  const refresh = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    setEmail(u.user.email ?? "");
    setPhone(u.user.phone ?? "");
    setEmailVerified(!!u.user.email_confirmed_at);
    try {
      const { data } = await (supabase as any).rpc("my_verification_status");
      const r = Array.isArray(data) ? data[0] : data;
      if (r) {
        setPhoneVerified(!!r.phone_verified);
        setPhoneRewardClaimed(!!r.phone_reward_claimed);
      }
    } catch {}
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

  const sendPhoneOtp = async () => {
    const p = phoneDraft.trim() || phone;
    if (!/^\+\d{8,15}$/.test(p)) { flash("أدخل رقم دولي صحيح يبدأ بـ + مثل +9665xxxxxxxx"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ phone: p });
      if (error) throw error;
      setOtpStage("code");
      flash("📱 تم إرسال كود على الجوال");
    } catch (e: any) {
      flash(e?.message ?? "تعذّر الإرسال");
    } finally { setBusy(false); }
  };

  const verifyPhoneOtp = async () => {
    if (otp.trim().length < 4) { flash("أدخل الكود"); return; }
    const p = phoneDraft.trim() || phone;
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ phone: p, token: otp.trim(), type: "phone_change" as any });
      if (error) throw error;
      flash("✅ تم توثيق الجوال");
      setOtpStage("idle");
      setOtp("");
      await refresh();
    } catch (e: any) {
      flash(e?.message ?? "الكود غير صحيح");
    } finally { setBusy(false); }
  };

  const claimReward = async () => {
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("claim_phone_verification_reward");
      if (error) throw error;
      flash(`💎 تم إضافة ${data?.gems_awarded ?? 500} جوهرة`);
      setPhoneRewardClaimed(true);
    } catch (e: any) {
      const m = String(e?.message ?? "");
      if (m.includes("already_claimed")) flash("سبق واستلمت المكافأة");
      else if (m.includes("phone_not_verified")) flash("وثّق جوالك أولاً");
      else flash("تعذّر استلام المكافأة");
    } finally { setBusy(false); }
  };

  if (emailVerified === null) return null;

  return (
    <section className="rounded-2xl p-4 glass-hud border border-accent/30 space-y-3" dir="rtl">
      <div className="flex items-center gap-2">
        <div className="text-sm font-bold text-accent">🔐 حالة توثيق الحساب</div>
      </div>

      {/* Email status */}
      <div className={`rounded-xl p-3 border ${emailVerified ? "bg-emerald-950/40 border-emerald-700/50" : "bg-rose-950/40 border-rose-700/50"}`}>
        <div className="flex items-center gap-2 text-sm font-bold">
          {emailVerified ? "🟢" : "🔴"} البريد الإلكتروني {emailVerified ? "موثق" : "غير موثق"}
        </div>
        <div className="text-[11px] text-stone-300 mt-1 break-all">{email || "—"}</div>
        {!emailVerified && (
          <>
            <div className="text-[11px] text-rose-200/90 mt-1 leading-snug">
              حسابك غير موثق. لا يمكنك الهجوم أو دعم اللاعبين حتى توثق بريدك.
            </div>
            <button onClick={resendEmail} disabled={busy}
              className="w-full mt-2 py-2 rounded-lg bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 text-xs font-bold active:scale-95 disabled:opacity-60">
              {busy ? "..." : "✉️ إعادة إرسال رابط التأكيد"}
            </button>
          </>
        )}
      </div>

      {/* Phone status + reward */}
      <div className={`rounded-xl p-3 border ${phoneVerified ? "bg-emerald-950/40 border-emerald-700/50" : "bg-stone-900/60 border-stone-700/60"}`}>
        <div className="flex items-center gap-2 text-sm font-bold">
          {phoneVerified ? "🟢" : "⚪"} توثيق الجوال {phoneVerified ? "مُوثّق" : "(اختياري — 500 💎 مرة واحدة)"}
        </div>
        <div className="text-[11px] text-stone-300 mt-1" dir="ltr">{phone || "—"}</div>

        {!phoneVerified && otpStage === "idle" && (
          <div className="mt-2 space-y-2">
            <input
              type="tel"
              dir="ltr"
              value={phoneDraft}
              onChange={(e) => setPhoneDraft(e.target.value.replace(/[^\d+]/g, ""))}
              placeholder="+9665xxxxxxxx"
              className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-stone-600 text-white text-sm"
            />
            <button onClick={sendPhoneOtp} disabled={busy}
              className="w-full py-2 rounded-lg bg-gradient-to-b from-sky-400 to-sky-700 border-2 border-sky-200 text-white text-xs font-bold active:scale-95 disabled:opacity-60">
              {busy ? "..." : "📱 إرسال كود التحقق"}
            </button>
          </div>
        )}

        {!phoneVerified && otpStage === "code" && (
          <div className="mt-2 space-y-2">
            <input
              type="text" inputMode="numeric" maxLength={8}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-stone-600 text-white text-center tracking-[0.5em] font-bold"
            />
            <div className="flex gap-2">
              <button onClick={verifyPhoneOtp} disabled={busy}
                className="flex-1 py-2 rounded-lg bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200 text-white text-xs font-bold active:scale-95 disabled:opacity-60">
                {busy ? "..." : "✓ تأكيد الكود"}
              </button>
              <button onClick={() => { setOtpStage("idle"); setOtp(""); }}
                className="px-3 py-2 rounded-lg bg-stone-700 text-white text-xs font-bold active:scale-95">
                إلغاء
              </button>
            </div>
          </div>
        )}

        {phoneVerified && !phoneRewardClaimed && (
          <button onClick={claimReward} disabled={busy}
            className="w-full mt-2 py-2 rounded-lg bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 text-xs font-bold active:scale-95 disabled:opacity-60">
            {busy ? "..." : "💎 استلام مكافأة 500 جوهرة"}
          </button>
        )}
        {phoneVerified && phoneRewardClaimed && (
          <div className="mt-2 text-[11px] text-emerald-300 font-bold">✅ تم استلام مكافأة توثيق الجوال</div>
        )}
        {!phoneVerified && (
          <div className="text-[10px] text-stone-400 mt-2 leading-snug">
            المكافأة تُمنح مرة واحدة فقط لكل حساب — حتى لو غيّرت الرقم لاحقاً لن تُمنح مجدداً.
          </div>
        )}
      </div>
    </section>
  );
}
