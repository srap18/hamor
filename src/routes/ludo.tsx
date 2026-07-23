import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useIsAdmin } from "@/hooks/use-admin";

const LudoPanel = lazy(() =>
  import("@/components/LudoPanel").then((m) => ({ default: m.LudoPanel }))
);

export const Route = createFileRoute("/ludo")({
  component: LudoFullscreen,
  ssr: false,
  head: () => ({ meta: [{ title: "لعبة لودو" }] }),
});

function LudoFullscreen() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const navigate = useNavigate();

  if (authLoading || adminLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#0a1730] text-amber-200 text-sm">
        جاري التحميل...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#0a1730] text-amber-200 text-sm">
        يجب تسجيل الدخول أولاً
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#0a1730] text-amber-200 text-sm p-6 text-center">
        هذه اللعبة متاحة حالياً للإدارة فقط (نسخة تجريبية).
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-[#0a1730] via-[#0c1f3e] to-[#050b1a] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-amber-500/30 bg-black/40 backdrop-blur">
        <button
          onClick={() => navigate({ to: "/chat" })}
          className="px-3 py-1.5 rounded-lg bg-stone-800 border border-amber-700/50 text-amber-200 text-xs font-black active:scale-95">
          ← رجوع
        </button>
        <div className="text-sm font-black text-amber-200 flex items-center gap-1.5">
          <span>🎲</span> لعبة لودو
        </div>
        <div className="w-14" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <Suspense fallback={<div className="min-h-[60vh] grid place-items-center text-amber-200 text-sm">جاري تحميل اللعبة...</div>}>
          <LudoPanel userId={user.id} fullscreen />
        </Suspense>
      </div>
    </div>
  );
}
