/**
 * Delete-account control with email OTP re-authentication.
 *
 * Flow:
 *  1) User clicks "حذف الحساب" → confirm dialog.
 *  2) We call supabase.auth.reauthenticate() which emails a 6-digit code.
 *  3) User pastes the code → we verify with verifyOtp({ type: 'reauthentication' }).
 *  4) On success, we call the server fn that wipes the account.
 *
 * Required for App Store / Play Store compliance + protects against an
 * attacker with a hijacked session deleting the account.
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { confirmDialog } from "@/components/ConfirmDialog";
import { deleteMyAccount } from "@/lib/account-deletion.functions";

export function DeleteAccountSection() {
  const nav = useNavigate();
  const deleteFn = useServerFn(deleteMyAccount);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"idle" | "code">("idle");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState<string | null>(null);

  const startDelete = async () => {
    const ok = await confirmDialog({
      title: "حذف الحساب نهائياً",
      message:
        "سيتم حذف حسابك وجميع بياناتك (السفن، الجواهر، الإنجازات، الرسائل) بشكل نهائي ولا يمكن استرجاعها.\n\nسنرسل لك كود تحقق على بريدك الإلكتروني لتأكيد العملية. هل تريد المتابعة؟",
      confirmText: "نعم، أرسل الكود",
      danger: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      setEmail(u.user?.email ?? null);
      const { error } = await supabase.auth.reauthenticate();
      if (error) throw error;
      setStage("code");
      toast.success("تم إرسال كود التحقق إلى بريدك");
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر إرسال الكود — حاول لاحقاً");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!code.trim() || code.trim().length < 6) {
      toast.error("أدخل الكود المكوّن من 6 أرقام");
      return;
    }
    if (!email) {
      toast.error("لم نتمكن من تحديد بريدك");
      return;
    }
    setBusy(true);
    try {
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        type: "reauthentication",
        token: code.trim(),
        email,
      } as any);
      if (verifyErr) throw verifyErr;

      await deleteFn({});
      await supabase.auth.signOut().catch(() => null);
      toast.success("تم حذف حسابك");
      nav({ to: "/" });
    } catch (e: any) {
      toast.error(e?.message ?? "الكود غير صحيح أو منتهي");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.reauthenticate();
      if (error) throw error;
      toast.success("تم إرسال كود جديد");
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر الإرسال");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 p-3 rounded-lg bg-rose-950/40 border border-rose-700/50">
      <div className="text-rose-200 font-bold text-xs mb-1">منطقة الخطر</div>
      <div className="text-rose-100/70 text-[11px] mb-2 leading-snug">
        يحذف حسابك وكل بياناتك بشكل دائم. لا يمكن التراجع. سنطلب كود تحقق من بريدك قبل التنفيذ.
      </div>

      {stage === "idle" ? (
        <button
          onClick={startDelete}
          disabled={busy}
          className="w-full py-2 rounded-lg bg-gradient-to-b from-rose-600 to-rose-800 text-white text-xs font-bold active:scale-95 disabled:opacity-60"
        >
          {busy ? "..." : "🗑️ حذف الحساب نهائياً"}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="text-[11px] text-rose-100/80 leading-snug">
            أدخل الكود المرسل إلى:
            <div className="font-bold text-rose-200 break-all">{email}</div>
          </div>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-rose-700/60 text-white text-center text-lg tracking-[0.5em] font-bold"
          />
          <button
            onClick={confirmDelete}
            disabled={busy || code.length < 6}
            className="w-full py-2 rounded-lg bg-gradient-to-b from-rose-600 to-rose-800 text-white text-xs font-bold active:scale-95 disabled:opacity-60"
          >
            {busy ? "جاري الحذف..." : "تأكيد الحذف النهائي"}
          </button>
          <div className="flex gap-2">
            <button
              onClick={resend}
              disabled={busy}
              className="flex-1 py-1.5 rounded-lg bg-stone-800 text-white text-[11px] font-bold active:scale-95 disabled:opacity-60"
            >
              إعادة إرسال الكود
            </button>
            <button
              onClick={() => { setStage("idle"); setCode(""); }}
              disabled={busy}
              className="flex-1 py-1.5 rounded-lg bg-stone-700 text-white text-[11px] font-bold active:scale-95 disabled:opacity-60"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
