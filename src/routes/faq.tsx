import { createFileRoute, Link } from "@tanstack/react-router";

const faqs = [
  {
    q: "ما هي لعبة ملوك القراصنة؟",
    a: "ملوك القراصنة هي أفضل لعبة قراصنة عربية أونلاين مجانية. خض المعارك البحرية، اجمع الذهب، طور سفينتك، كوّن التحالفات وسيطر على البحار.",
  },
  {
    q: "كيف ألعب ملوك القراصنة؟",
    a: "سجّل حساباً مجانياً، اختر سفينتك الأولى، ثم ابدأ بالصيد ومهاجمة اللاعبين الآخرين لجمع الذهب وتطوير أسطولك والانضمام إلى التحالفات.",
  },
  {
    q: "هل لعبة ملوك القراصنة مجانية؟",
    a: "نعم، اللعب مجاني بالكامل. تتوفر مشتريات اختيارية لتسريع التطور والحصول على مزايا VIP.",
  },
  {
    q: "كيف أطور سفينتي؟",
    a: "تستطيع تطوير سفينتك من خلال سوق السفن وشراء الترقيات والأسلحة باستخدام الذهب الذي تجمعه من المعارك والصيد.",
  },
  {
    q: "كيف أحصل على الذهب؟",
    a: "تحصل على الذهب من صيد الأسماك، مهاجمة اللاعبين، إنجاز المهام اليومية، المشاركة في المسابقات، وبيع الأسماك في السوق.",
  },
];

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "الأسئلة الشائعة | ملوك القراصنة" },
      { name: "description", content: "إجابات على الأسئلة الأكثر شيوعاً حول لعبة ملوك القراصنة: كيفية اللعب، تطوير السفينة، جمع الذهب، وأكثر." },
      { property: "og:title", content: "الأسئلة الشائعة | ملوك القراصنة" },
      { property: "og:description", content: "كل ما تريد معرفته عن لعبة ملوك القراصنة العربية المجانية." },
      { property: "og:url", content: "https://www.molok-alqarasna.com/faq" },
    ],
    links: [{ rel: "canonical", href: "https://www.molok-alqarasna.com/faq" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqs.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }),
      },
    ],
  }),
  component: FaqPage,
});

function FaqPage() {
  return (
    <main dir="rtl" className="min-h-screen bg-[#061826] text-amber-100 px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <Link to="/" className="text-amber-300 text-sm hover:underline">← العودة للرئيسية</Link>
        <h1 className="text-3xl font-black mt-4 mb-2 text-amber-300">الأسئلة الشائعة عن ملوك القراصنة</h1>
        <p className="text-amber-100/70 mb-6">كل ما تريد معرفته عن أفضل لعبة قراصنة عربية أونلاين.</p>
        <div className="space-y-4">
          {faqs.map((f, i) => (
            <details key={i} className="rounded-lg bg-amber-950/30 border border-amber-700/30 p-4 group" open={i === 0}>
              <summary className="cursor-pointer font-bold text-amber-200 text-lg">
                <h2 className="inline">{f.q}</h2>
              </summary>
              <p className="mt-3 text-amber-100/90 leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
        <section className="mt-10">
          <h2 className="text-xl font-bold text-amber-300 mb-3">عن اللعبة</h2>
          <p className="text-amber-100/80 leading-relaxed">
            ملوك القراصنة لعبة بحرية استراتيجية عربية أونلاين، تجمع بين القتال، الصيد، التحالفات، وحروب السفن.
            انضم لآلاف اللاعبين العرب وكوّن إمبراطوريتك البحرية الآن.
          </p>
        </section>
      </div>
    </main>
  );
}
