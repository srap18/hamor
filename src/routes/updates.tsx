import { createFileRoute, Link } from "@tanstack/react-router";

const updates = [
  { version: "v2.6.0", date: "2026-06-12", changes: ["تحسين أداء المعارك البحرية", "إصلاح مشاكل الاتصال", "واجهة جديدة للسوق"] },
  { version: "v2.5.0", date: "2026-05-15", changes: ["إضافة نظام التحالفات", "سفن جديدة", "تحسينات على نظام الصيد"] },
  { version: "v2.4.0", date: "2026-04-20", changes: ["موسم جديد من المسابقات", "خلفيات حصرية", "تحسين توازن اللعبة"] },
];

export const Route = createFileRoute("/updates")({
  head: () => ({
    meta: [
      { title: "تحديثات اللعبة | ملوك القراصنة" },
      { name: "description", content: "سجل تحديثات لعبة ملوك القراصنة: إضافات جديدة، إصلاحات، وتحسينات على الأداء." },
      { property: "og:title", content: "تحديثات ملوك القراصنة" },
      { property: "og:url", content: "https://www.molok-alqarasna.com/updates" },
    ],
    links: [{ rel: "canonical", href: "https://www.molok-alqarasna.com/updates" }],
  }),
  component: UpdatesPage,
});

function UpdatesPage() {
  return (
    <main dir="rtl" className="min-h-screen bg-[#061826] text-amber-100 px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <Link to="/" className="text-amber-300 text-sm hover:underline">← العودة للرئيسية</Link>
        <h1 className="text-3xl font-black mt-4 mb-6 text-amber-300">تحديثات اللعبة</h1>
        <div className="space-y-5">
          {updates.map((u, i) => (
            <article key={i} className="rounded-lg bg-amber-950/30 border border-amber-700/30 p-4">
              <div className="flex justify-between items-baseline">
                <h2 className="text-lg font-bold text-amber-200">{u.version}</h2>
                <time className="text-xs text-amber-100/60">{u.date}</time>
              </div>
              <ul className="mt-3 space-y-1 text-amber-100/90 list-disc list-inside">
                {u.changes.map((c, j) => <li key={j}>{c}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
