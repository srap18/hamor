import { createFileRoute, Link } from "@tanstack/react-router";
import { BackButton } from "@/components/BackButton";
import { STORE_PACKS, type PackCategory } from "@/lib/store-catalog";
import { formatSarFromUsd } from "@/lib/currency";
import { isNativeApp } from "@/lib/platform";
import { NativePurchaseBlock } from "@/components/NativePurchaseButton";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "الأسعار والباقات — ملوك القراصنة (هامور شابك)" },
      { name: "description", content: "باقات الجواهر، اشتراك VIP، الدروع، وعروض ملوك القراصنة (هامور شابك). دفع آمن عبر Paddle." },
      { property: "og:title", content: "الأسعار — ملوك القراصنة (هامور شابك)" },
      { property: "og:description", content: "جميع باقات الجواهر و VIP والدروع في ملوك القراصنة." },
      { property: "og:url", content: "https://www.molok-alqarasna.com/pricing" },
    ],
    links: [{ rel: "canonical", href: "https://www.molok-alqarasna.com/pricing" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "OfferCatalog",
          name: "باقات ملوك القراصنة",
          url: "https://www.molok-alqarasna.com/pricing",
          inLanguage: "ar",
          itemListElement: STORE_PACKS.map((p) => ({
            "@type": "Offer",
            name: p.label,
            category: p.category,
            price: p.priceUSD,
            priceCurrency: "USD",
            availability: "https://schema.org/InStock",
          })),
        }),
      },
    ],
  }),
  component: PricingPage,
});

const CATEGORY_LABEL: Record<PackCategory, string> = {
  offers: "العروض",
  bundle: "الباقات",
  vip: "اشتراك VIP",
  gems: "الجواهر",
  coins: "الذهب",
  shield: "الدروع",
  weapon: "الأسلحة",
  crew: "الطواقم",
};

const CATEGORIES: PackCategory[] = ["offers", "bundle", "gems", "coins", "crew", "weapon", "shield"];

function PricingPage() {
  if (isNativeApp()) {
    return (
      <div dir="rtl" className="min-h-screen text-amber-50 flex flex-col items-center justify-center px-4" style={{
        background: "radial-gradient(ellipse at top, #0c4a6e 0%, #082f49 55%, #020617 100%)",
      }}>
        <div className="mb-6">
          <BackButton className="text-amber-300 text-sm">← الرئيسية</BackButton>
        </div>
        <NativePurchaseBlock />
      </div>
    );
  }

  return (
    <div className="min-h-screen text-amber-50" dir="rtl" style={{
      background: "radial-gradient(ellipse at top, #0c4a6e 0%, #082f49 55%, #020617 100%)",
    }}>
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <BackButton className="text-amber-300 text-sm">← الرئيسية</BackButton>
          <div className="text-xs text-amber-100/60 flex gap-3">
            <Link to="/terms" className="hover:text-amber-300">الشروط</Link>
            <Link to="/privacy" className="hover:text-amber-300">الخصوصية</Link>
            <Link to="/refund" className="hover:text-amber-300">الاسترداد</Link>
          </div>
        </div>

        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-amber-300 mb-2">الأسعار</h1>
          <p className="text-amber-100/80 text-sm max-w-2xl mx-auto">
            جميع الأسعار بالريال السعودي وتشمل الضرائب المعمول بها. تتم معالجة المدفوعات بأمان عبر
            شريكنا Paddle.
          </p>
        </div>

        {CATEGORIES.map((cat) => {
          const packs = STORE_PACKS.filter((p) => p.category === cat);
          if (packs.length === 0) return null;
          return (
            <section key={cat} className="mb-10">
              <h2 className="text-xl font-bold text-amber-200 mb-4">{CATEGORY_LABEL[cat]}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {packs.map((p) => (
                  <div key={p.id} className="rounded-xl bg-stone-950/70 border-2 border-amber-700/50 p-4 backdrop-blur">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-bold text-amber-100">{p.label}</div>
                      <div className="text-amber-300 font-extrabold whitespace-nowrap">
                        {formatSarFromUsd(p.priceUSD)}
                        {p.subscription && <span className="text-xs text-amber-100/60">/شهر</span>}
                        <span className="block text-[10px] text-amber-100/50 font-normal">شامل الضريبة</span>
                      </div>
                    </div>
                    {p.description && (
                      <div className="text-xs text-amber-100/70 mt-2">{p.description}</div>
                    )}
                    <div className="text-[11px] text-amber-100/50 mt-2 flex flex-wrap gap-2">
                      {p.tag && <span className="px-1.5 py-0.5 rounded bg-amber-700/30">{p.tag}</span>}
                      {p.bonus && <span className="px-1.5 py-0.5 rounded bg-emerald-700/30">{p.bonus}</span>}
                      {p.oneTime && <span className="px-1.5 py-0.5 rounded bg-rose-700/30">لمرة واحدة</span>}
                      {p.weeklyLimit && <span className="px-1.5 py-0.5 rounded bg-sky-700/30">حد {p.weeklyLimit}/أسبوع</span>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        <div className="mt-8 rounded-xl bg-stone-950/60 border border-amber-700/40 p-4 text-sm text-amber-100/80 space-y-2">
          <p>
            🛒 للشراء، يجب{" "}
            <Link to="/signup" className="text-amber-300 font-bold">إنشاء حساب</Link> أو{" "}
            <Link to="/login" className="text-amber-300 font-bold">تسجيل الدخول</Link>.
          </p>
          <p>
            💳 تتم معالجة المدفوعات بأمان عبر <strong>Paddle</strong> (تاجر التسجيل).
          </p>
          <p>
            ↩️ مدعومة بضمان <Link to="/refund" className="text-amber-300">استرداد 14 يومًا</Link>.
          </p>
          <p>
            👑 تتجدّد اشتراكات VIP تلقائيًا شهريًا حتى يتم إلغاؤها من إعدادات الحساب.
          </p>
        </div>

        <div className="mt-6 text-center text-xs text-amber-100/50">
          البائع: Amira Qailan Dakhil Allah Alsharari
        </div>
      </div>
    </div>
  );
}
