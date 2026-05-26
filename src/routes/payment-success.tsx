import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { verifyStripePayment } from "@/lib/stripe-checkout.functions";
import { refreshProfile } from "@/hooks/use-auth";
import { sound } from "@/lib/sound";

export const Route = createFileRoute("/payment-success")({
  ssr: false,
  head: () => ({
    meta: [{ title: "تم الدفع — Ocean Catch" }],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    session_id: typeof s.session_id === "string" ? s.session_id : "",
  }),
  component: PaymentSuccess,
});

function PaymentSuccess() {
  const { session_id } = Route.useSearch();
  const nav = useNavigate();
  const verify = useServerFn(verifyStripePayment);
  const [state, setState] = useState<"loading" | "ok" | "fail">("loading");
  const [reward, setReward] = useState<Record<string, number> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!session_id) {
      setState("fail");
      setErr("معرّف الجلسة مفقود");
      return;
    }
    (async () => {
      try {
        const res = await verify({ data: { sessionId: session_id } });
        if (res.ok) {
          setReward(res.reward as Record<string, number>);
          setState("ok");
          refreshProfile();
          sound.play("coin");
        } else {
          setState("fail");
          setErr("لم يكتمل الدفع");
        }
      } catch (e) {
        setState("fail");
        setErr(e instanceof Error ? e.message : "خطأ غير متوقع");
      }
    })();
  }, [session_id, verify]);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-6 text-white"
      dir="rtl"
      style={{
        background:
          "radial-gradient(ellipse at top, #1e293b 0%, #0c1424 50%, #050912 100%)",
      }}
    >
      <div className="w-full max-w-sm rounded-3xl border-2 border-amber-400/50 bg-gradient-to-b from-stone-900 to-stone-950 p-6 text-center shadow-[0_0_60px_rgba(251,191,36,0.4)]">
        {state === "loading" && (
          <>
            <div className="text-6xl mb-3 animate-pulse">⏳</div>
            <h1 className="text-xl font-extrabold mb-1">جاري تأكيد الدفع...</h1>
            <p className="text-sm text-stone-300">لحظات من فضلك</p>
          </>
        )}
        {state === "ok" && (
          <>
            <div className="text-7xl mb-3">🎉</div>
            <h1 className="text-2xl font-extrabold mb-2 text-emerald-300 text-glow">
              تم الدفع بنجاح!
            </h1>
            <p className="text-sm text-stone-200 mb-4">المكافآت أُضيفت لحسابك:</p>
            <div className="flex flex-wrap justify-center gap-2 mb-5">
              {reward?.gems ? (
                <span className="px-3 py-1.5 rounded-lg bg-cyan-900/60 border border-cyan-400/50 font-bold text-cyan-100">
                  +{reward.gems.toLocaleString()} 💎
                </span>
              ) : null}
              {reward?.coins ? (
                <span className="px-3 py-1.5 rounded-lg bg-amber-900/60 border border-amber-400/50 font-bold text-amber-100">
                  +{reward.coins.toLocaleString()} 🪙
                </span>
              ) : null}
              {reward?.rubies ? (
                <span className="px-3 py-1.5 rounded-lg bg-rose-900/60 border border-rose-400/50 font-bold text-rose-100">
                  +{reward.rubies} 🔴
                </span>
              ) : null}
              {reward?.shieldDays ? (
                <span className="px-3 py-1.5 rounded-lg bg-sky-900/60 border border-sky-400/50 font-bold text-sky-100">
                  +{reward.shieldDays} أيام 🛡️
                </span>
              ) : null}
              {reward?.vipDays ? (
                <span className="px-3 py-1.5 rounded-lg bg-violet-900/60 border border-violet-400/50 font-bold text-violet-100">
                  VIP {reward.vipDays} يوم 👑
                </span>
              ) : null}
            </div>
            <button
              onClick={() => nav({ to: "/" })}
              className="w-full py-3 rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200 font-extrabold active:scale-95"
            >
              العودة للعبة
            </button>
          </>
        )}
        {state === "fail" && (
          <>
            <div className="text-6xl mb-3">⚠️</div>
            <h1 className="text-xl font-extrabold mb-1 text-rose-300">
              تعذّر تأكيد الدفع
            </h1>
            <p className="text-sm text-stone-300 mb-4">{err}</p>
            <Link
              to="/recharge"
              className="block w-full py-3 rounded-xl bg-stone-800 border border-stone-600 font-bold active:scale-95"
            >
              الرجوع للمتجر
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
