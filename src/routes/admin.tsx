import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useIsAdmin } from "@/hooks/use-admin";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
  ssr: false,
  head: () => ({ meta: [{ title: "لوحة التحكم — Admin" }] }),
});

const NAV: Array<{ to: string; label: string; icon: string; exact?: boolean }> = [
  { to: "/admin", label: "نظرة عامة", icon: "📊", exact: true },
  { to: "/admin/players", label: "اللاعبون", icon: "👥" },
  { to: "/admin/broadcasts", label: "الإشعارات", icon: "📢" },
  { to: "/admin/content", label: "محتوى اللعبة", icon: "🎮" },
  { to: "/admin/audit", label: "سجل العمليات", icon: "📋" },
];

function AdminLayout() {
  const { isAdmin, loading } = useIsAdmin();
  const { session, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!authLoading && !session) nav({ to: "/login" });
  }, [session, authLoading, nav]);

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-200">
        جاري التحقق...
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-200 p-6 gap-4">
        <div className="text-6xl">🔒</div>
        <h1 className="text-2xl font-bold">صفحة محظورة</h1>
        <p className="text-slate-400">هذه الصفحة مخصصة للمشرفين فقط</p>
        <Link to="/" className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500">العودة للعبة</Link>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen flex flex-col md:flex-row bg-slate-950 text-slate-100">
      {/* Sidebar / Topbar */}
      <aside className="w-full md:w-60 md:shrink-0 border-b md:border-b-0 md:border-l border-slate-800 bg-slate-900/60 backdrop-blur flex flex-col">
        <div className="p-3 md:p-4 border-b border-slate-800 flex items-center justify-between md:block">
          <div className="text-base md:text-lg font-bold flex items-center gap-2">
            <span>⚓</span> Admin Panel
          </div>
          <div className="text-xs text-slate-500 md:mt-1">Ocean Catch</div>
        </div>
        <nav className="flex md:flex-col gap-1 p-2 overflow-x-auto md:overflow-x-visible md:flex-1">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to as "/admin"}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition shrink-0 ${
                  active
                    ? "bg-indigo-600/20 text-indigo-200 border border-indigo-500/40"
                    : "text-slate-300 hover:bg-slate-800/60"
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="hidden md:block p-3 border-t border-slate-800 space-y-2">
          <Link to="/" className="block text-center text-xs px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700">
            🎮 الذهاب للعبة
          </Link>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              nav({ to: "/login" });
            }}
            className="w-full text-center text-xs px-3 py-2 rounded-lg bg-red-900/40 hover:bg-red-900/60 text-red-200"
          >
            تسجيل خروج
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto min-w-0">
        <Outlet />
      </main>
    </div>
  );
}

