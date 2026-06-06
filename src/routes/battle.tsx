import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/battle")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    vs: typeof s.vs === "string" ? s.vs : undefined,
  }),
  head: () => ({ meta: [{ title: "⚔️ معركة التنين — مقفلة" }] }),
  component: BattlePage,
});

function BattlePage() {
  return (
    <div className="fixed inset-0 overflow-y-auto flex items-center justify-center" dir="rtl"
      style={{ background: "radial-gradient(ellipse at top, #1a1a2e 0%, #0a0a14 60%, #000 100%)" }}>
      <div className="absolute top-4 right-3">
        <Link to="/" className="glass-hud rounded-full px-3 py-1.5 text-cyan-200 text-sm font-bold border border-cyan-500/40">← رجوع</Link>
      </div>
      <div className="max-w-sm mx-auto px-6 text-center">
        <div className="text-7xl mb-4">🔒</div>
        <div className="text-2xl font-black text-amber-200 mb-2">المعركة مقفلة مؤقتاً</div>
        <div className="text-cyan-300/70 text-sm">سنفتحها قريباً بتحديث جديد. ترقّبوا!</div>
      </div>
    </div>
  );
}
