import { createFileRoute, Link } from "@tanstack/react-router";

const news = [
  { date: "2026-06-10", title: "إطلاق نظام التحالفات الجديد", body: "أصبح بإمكانك تكوين تحالف مع أصدقائك والسيطرة على مناطق البحر معاً." },
  { date: "2026-05-22", title: "سفن جديدة في المتجر", body: "أضفنا مجموعة سفن أسطورية بقدرات قتالية فريدة." },
  { date: "2026-05-01", title: "مسابقة الصيد الكبرى", body: "جوائز ذهبية ضخمة لأفضل الصيادين هذا الموسم." },
];

export const Route = createFileRoute("/news")({
  head: () => ({
    meta: [
      { title: "أخبار اللعبة | ملوك القراصنة" },
      { name: "description", content: "آخر أخبار وتحديثات لعبة ملوك القراصنة: ميزات جديدة، مسابقات، وعروض حصرية." },
      { property: "og:title", content: "أخبار ملوك القراصنة" },
      { property: "og:url", content: "https://www.molok-alqarasna.com/news" },
    ],
    links: [{ rel: "canonical", href: "https://www.molok-alqarasna.com/news" }],
  }),
  component: NewsPage,
});

function NewsPage() {
  return (
    <main dir="rtl" className="min-h-screen bg-[#061826] text-amber-100 px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <Link to="/" className="text-amber-300 text-sm hover:underline">← العودة للرئيسية</Link>
        <h1 className="text-3xl font-black mt-4 mb-6 text-amber-300">أخبار ملوك القراصنة</h1>
        <div className="space-y-5">
          {news.map((n, i) => (
            <article key={i} className="rounded-lg bg-amber-950/30 border border-amber-700/30 p-4">
              <time className="text-xs text-amber-100/60">{n.date}</time>
              <h2 className="text-lg font-bold text-amber-200 mt-1">{n.title}</h2>
              <p className="mt-2 text-amber-100/90 leading-relaxed">{n.body}</p>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
