/**
 * Delete-account control. Required for App Store / Play Store compliance.
 * Lives inside SettingsModal under the "Danger zone" section.
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

  const onDelete = async () => {
    const ok = await confirmDialog({
      title: "حذف الحساب نهائياً",
      message:
        "سيتم حذف حسابك وجميع بياناتك (السفن، الجواهر، الإنجازات، الرسائل) بشكل نهائي ولا يمكن استرجاعها. هل أنت متأكد؟",
      confirmText: "نعم، احذف حسابي",
      danger: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      await deleteFn({});
      await supabase.auth.signOut().catch(() => null);
      toast.success("تم حذف حسابك");
      nav({ to: "/" });
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر حذف الحساب — حاول لاحقاً");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 p-3 rounded-lg bg-rose-950/40 border border-rose-700/50">
      <div className="text-rose-200 font-bold text-xs mb-1">منطقة الخطر</div>
      <div className="text-rose-100/70 text-[11px] mb-2 leading-snug">
        يحذف حسابك وكل بياناتك بشكل دائم. لا يمكن التراجع.
      </div>
      <button
        onClick={onDelete}
        disabled={busy}
        className="w-full py-2 rounded-lg bg-gradient-to-b from-rose-600 to-rose-800 text-white text-xs font-bold active:scale-95 disabled:opacity-60"
      >
        {busy ? "جاري الحذف..." : "🗑️ حذف الحساب نهائياً"}
      </button>
    </div>
  );
}
