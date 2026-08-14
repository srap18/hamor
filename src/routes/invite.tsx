import { createFileRoute, Link } from "@tanstack/react-router";
import { BackButton } from "@/components/BackButton";

export const Route = createFileRoute("/invite")({
  head: () => ({
    meta: [
      { title: "نظام الدعوات متوقف | ملوك القراصنة" },
      { name: "description", content: "تم إيقاف نظام الدعوات نهائياً في ملوك القراصنة." },
      { property: "og:title", content: "نظام الدعوات متوقف | ملوك القراصنة" },
      { property: "og:description", content: "تم إيقاف نظام الدعوات نهائياً في ملوك القراصنة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InviteDisabledPage,
});

function InviteDisabledPage() {
  return (
    <div className="min-h-screen p-4 text-white" dir="rtl">
      <BackButton>رجوع</BackButton>
      <div className="max-w-md mx-auto mt-16 rounded-2xl border-2 border-stone-700 bg-stone-900/80 p-6 text-center">
        <div className="text-5xl mb-3">🚫</div>
        <h1 className="text-xl font-black text-amber-300 mb-2">نظام الدعوات متوقف</h1>
        <p className="text-sm text-stone-300 leading-relaxed">
          تم إلغاء نظام الدعوات ومكافآته نهائياً. لن تُحتسب أي أكواد دعوة جديدة.
        </p>
        <Link
          to="/"
          className="inline-block mt-5 rounded-xl px-5 py-2.5 bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 font-extrabold active:scale-95"
        >
          العودة للمحيط
        </Link>
      </div>
    </div>
  );
}
