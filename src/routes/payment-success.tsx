import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { refreshProfile } from "@/hooks/use-auth";
import { sound } from "@/lib/sound";
import { claimPaddleTransaction } from "@/lib/paddle-claim.functions";
import { reconcileMyPaddlePurchases } from "@/lib/paddle-reconcile.functions";
import { getPaddleEnvironment } from "@/lib/paddle";
import { getPack, type StorePack } from "@/lib/store-catalog";
import { RewardPopup } from "@/components/RewardPopup";

export const Route = createFileRoute("/payment-success")({
  ssr: false,
  head: () => ({ meta: [{ title: "تم الدفع — ملوك القراصنة" }] }),
  component: PaymentSuccess,
});

// Paddle webhooks grant rewards asynchronously. We poll the profile briefly
// so the user sees their new balance before navigating home.
function PaymentSuccess() {
  const nav = useNavigate();
  const claimTxn = useServerFn(claimPaddleTransaction);
  const reconcile = useServerFn(reconcileMyPaddlePurchases);
  const [status, setStatus] = useState<"waiting" | "done">("waiting");
  const [reward, setReward] = useState<StorePack | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recoverMsg, setRecoverMsg] = useState<string | null>(null);

  const notifyVipRefresh = () => {
    try { window.dispatchEvent(new Event("paddle-purchase-completed")); } catch { /* noop */ }
  };

  const runRecovery = async () => {
    setRecovering(true);
    setRecoverMsg(null);
    try {
      const r = await reconcile({ data: { environment: getPaddleEnvironment() } });
      refreshProfile();
      notifyVipRefresh();
      if (r?.grantedCount && r.grantedCount > 0) {
        setRecoverMsg(`✅ تم استرجاع ${r.grantedCount} شحنة. تحقق من حسابك الآن.`);
        sound.play("coin");
      } else {
        setRecoverMsg("لا توجد شحنات معلقة. كل شي وصلك بالفعل.");
      }
    } catch (e) {
      setRecoverMsg("تعذر الاسترجاع. حاول بعد لحظات أو راسل الدعم.");
      console.error(e);
    } finally {
      setRecovering(false);
    }
  };


  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const params = new URLSearchParams(window.location.search);
      const txnId =
        params.get("_ptxn") || params.get("transaction_id") || params.get("txn_id");
      const env = getPaddleEnvironment();

      // 1) Try instant claim when Paddle returned us with a txn id.
      if (txnId) {
        try {
          const claimed = await claimTxn({
            data: { transactionId: txnId, environment: env },
          });
          // A transaction can exist while Paddle is still finalizing it.
          // Never tell the player rewards were added until delivery is confirmed.
          if (claimed?.granted) {
            const pack = claimed.packId ? getPack(claimed.packId) : null;
            if (!cancelled) {
              if (pack) setReward(pack);
              setStatus("done");
              await refreshProfile();
              sound.play("coin");
            }
            return;
          }
        } catch (e) {
          console.error("[payment-success] instant claim failed", e);
        }
      }

      // 2) No txn id (or claim failed) → auto-reconcile by email, retrying
      // for ~60s to handle webhook delay and slow PayPal settlements.
      for (let i = 0; i < 12 && !cancelled; i++) {
        try {
          const r = await reconcile({ data: { environment: env } });
          if (r?.grantedCount && r.grantedCount > 0) {
            const firstPack = r.granted?.[0] ? getPack(r.granted[0]) : null;
            if (!cancelled) {
              if (firstPack) setReward(firstPack);
              setStatus("done");
              refreshProfile();
              sound.play("coin");
            }
            return;
          }
        } catch (e) {
          console.error("[payment-success] reconcile attempt failed", e);
        }
        await new Promise((res) => setTimeout(res, 5000));
      }

      // 3) Give up waiting — keep wording honest and provide manual recovery.
      if (!cancelled) {
        setStatus("done");
        refreshProfile();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [claimTxn, reconcile]);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-6 text-white"
      dir="rtl"
      style={{
        background: "radial-gradient(ellipse at top, #1e293b 0%, #0c1424 50%, #050912 100%)",
      }}
    >
      {reward && <RewardPopup pack={reward} onClose={() => setReward(null)} />}
      <div className="w-full max-w-sm rounded-3xl border-2 border-amber-400/50 bg-gradient-to-b from-stone-900 to-stone-950 p-6 text-center shadow-[0_0_60px_rgba(251,191,36,0.4)]">
        {status === "waiting" ? (
          <>
            <div className="text-6xl mb-3 animate-pulse">⏳</div>
            <h1 className="text-xl font-extrabold mb-1">جاري إضافة المكافآت...</h1>
            <p className="text-sm text-stone-300">لحظات من فضلك</p>
          </>
        ) : (
          <>
            <div className="text-7xl mb-3">🎉</div>
            <h1 className="text-2xl font-extrabold mb-2 text-emerald-300 text-glow">
              اكتمل فحص عملية الدفع
            </h1>
            <p className="text-sm text-stone-200 mb-5">إذا لم تظهر المكافأة، اضغط التحقق أدناه لإتمام التسليم.</p>
            <button
              onClick={() => nav({ to: "/" })}
              className="w-full py-3 rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200 font-extrabold active:scale-95"
            >
              العودة للعبة
            </button>
            <Link
              to="/recharge"
              className="block w-full py-2 mt-2 rounded-xl bg-stone-800 border border-stone-600 text-sm font-bold"
            >
              للمتجر
            </Link>
            <button
              onClick={runRecovery}
              disabled={recovering}
              className="w-full py-2 mt-3 rounded-xl bg-amber-600/20 border border-amber-400/50 text-amber-100 text-xs font-bold disabled:opacity-50"
            >
              {recovering ? "جاري التحقق..." : "ما وصلتك المكافأة؟ اضغط هنا"}
            </button>
            {recoverMsg && (
              <p className="mt-2 text-[11px] text-amber-100/80">{recoverMsg}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
