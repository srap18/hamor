import { createFileRoute, Link } from "@tanstack/react-router";

const CANONICAL = "https://www.molok-alqarasna.com/guide/legacy-players";
const TITLE = "دليل لاعبي هامور شابك و شابك 360 | ملوك القراصنة";
const DESCRIPTION =
  "دليل اللاعبين القدامى للانتقال من هامور شابك و شابك 360 إلى ملوك القراصنة — نفس روح اللعبة الكلاسيكية مع تطويرات حديثة، معارك بحرية، تحالفات، ومتجر سفن.";

const sections = [
  {
    h: "من هامور شابك إلى ملوك القراصنة",
    p: "لو كنت من لاعبي هامور شابك القدامى، ستجد في ملوك القراصنة نفس الإحساس الذي أحببته: الصيد، المعارك، التحالفات، والمنافسة على الذهب — لكن بتجربة عصرية، رسوميات أوضح، وخوادم مستقرة.",
  },
  {
    h: "الفرق بين شابك 360 و ملوك القراصنة",
    p: "شابك 360 اعتمد على المعارك المباشرة وجمع الذهب. ملوك القراصنة يبني على هذه الأساسيات ويضيف: نظام تحالفات حقيقي، سوق سفن متعدد المستويات، تنانين مرافقة، ومسابقات يومية وأسبوعية بجوائز.",
  },
  {
    h: "أهم التحديثات التي طلبها لاعبو شابك",
    p: "حماية للاعبين الجدد، نظام إصلاح للسفن المدمّرة، رسائل بين اللاعبين، صيد أسماك متطور، VIP بمزايا واضحة، وإمكانية اللعب من الجوال والمتصفح بدون تحميل.",
  },
  {
    h: "كيف تبدأ خلال دقيقة",
    p: "سجّل حساباً مجانياً، اختر سفينتك الأولى، ابدأ بالصيد لجمع الذهب، ثم انضم لتحالف وشارك في المسابقات. اللاعبون القدامى يتأقلمون بسرعة لأن الميكانيكا الأساسية مألوفة.",
  },
];

export const Route = createFileRoute("/guide/legacy-players")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { name: "keywords", content: "هامور شابك, شابك 360, شابك, لعبة قراصنة, ملوك القراصنة, لعبة هامور" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:url", content: CANONICAL },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: TITLE,
          description: DESCRIPTION,
          inLanguage: "ar",
          mainEntityOfPage: CANONICAL,
          author: { "@type": "Organization", name: "ملوك القراصنة" },
          publisher: { "@type": "Organization", name: "ملوك القراصنة" },
        }),
      },
    ],
  }),
  component: LegacyPlayersGuide,
});

function LegacyPlayersGuide() {
  return (
    <main dir="rtl" className="min-h-screen bg-[#061826] text-amber-100 px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <Link to="/" className="text-amber-300 text-sm hover:underline">← العودة للرئيسية</Link>
        <h1 className="text-3xl font-black mt-4 mb-2 text-amber-300">
          دليل لاعبي هامور شابك و شابك 360 في ملوك القراصنة
        </h1>
        <p className="text-amber-100/80 mb-8">{DESCRIPTION}</p>

        {sections.map((s) => (
          <section key={s.h} className="mb-6">
            <h2 className="text-xl font-bold text-amber-200 mb-2">{s.h}</h2>
            <p className="text-amber-100/85 leading-relaxed">{s.p}</p>
          </section>
        ))}

        <div className="mt-8 flex gap-3">
          <Link to="/signup" className="px-4 py-2 rounded-xl bg-amber-500 text-stone-900 font-bold">
            ابدأ اللعب مجاناً
          </Link>
          <Link to="/faq" className="px-4 py-2 rounded-xl bg-stone-800 text-amber-200">
            الأسئلة الشائعة
          </Link>
        </div>
      </div>
    </main>
  );
}
