import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useIsAdmin } from "@/hooks/use-admin";
import { LudoPanel } from "@/components/LudoPanel";
import { verifyAdminAccess } from "@/lib/admin-check.functions";

export const Route = createFileRoute("/ludo")({
  component: LudoFullscreen,
  ssr: false,
  beforeLoad: async () => {
    try { await verifyAdminAccess(); } catch { throw redirect({ to: "/" }); }
  },
  head: () => ({ meta: [{ title: "لعبة لودو" }] }),
});

function LudoFullscreen() {
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();

  if (!isAdmin) {
    return <div className="min-h-screen grid place-items-center text-amber-200">غير مصرح</div>;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-[#0a1730] via-[#0c1f3e] to-[#050b1a] overflow-hidden">
      {/* Top bar */}
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
        <LudoPanel userId={user?.id || ""} fullscreen />
      </div>
    </div>
  );
}
