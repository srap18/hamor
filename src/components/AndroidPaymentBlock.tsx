/**
 * Replacement for any payment UI when the app is running inside the
 * Android Capacitor build. Google Play requires digital-goods purchases
 * to go through Google Play Billing — third-party payment SDKs are not
 * allowed. Until Google Play Billing is wired in, we show a friendly
 * "coming soon" message instead of the Paddle checkout.
 */
export function AndroidPaymentBlock({
  title = "الشحن قريباً عبر Google Play",
  description = "نعمل حالياً على ربط الدفع عبر Google Play داخل تطبيق أندرويد. مؤقتاً تقدر تشحن من المتصفح على نفس حسابك وراح يوصلك الرصيد فوراً.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div dir="rtl" className="mx-auto max-w-md p-4">
      <div className="rounded-2xl border-2 border-amber-400/50 bg-gradient-to-b from-slate-900 to-slate-950 p-6 text-center shadow-2xl">
        <div className="text-5xl mb-3">🛒</div>
        <div className="text-amber-300 font-extrabold text-lg mb-2">
          {title}
        </div>
        <div className="text-amber-50/80 text-sm leading-relaxed mb-4">
          {description}
        </div>
        <div className="text-amber-200/70 text-xs">
          📱 افتح اللعبة من متصفح الجوال للشحن مؤقتاً
        </div>
      </div>
    </div>
  );
}
