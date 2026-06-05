import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/battle")({
  ssr: false,
  head: () => ({ meta: [{ title: "تحدي — Ocean Catch" }] }),
  component: BattlePage,
});

function BattlePage() {
  return (
    <div dir="rtl" className="min-h-screen bg-gradient-to-b from-slate-950 to-black text-amber-200 flex items-center justify-center p-6">
      <div className="text-center space-y-4">
        <div className="text-3xl font-black">قريباً 🔒</div>
        <Link to="/" className="inline-block px-5 py-2 rounded-xl bg-amber-600/80 text-black font-bold">رجوع</Link>
      </div>
    </div>
  );
}
