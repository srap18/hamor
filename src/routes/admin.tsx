import { createFileRoute, Outlet, Link, useNavigate, useRouterState, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { useIsAdmin } from "@/hooks/use-admin";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { confirmDialog } from "@/components/ConfirmDialog";
import { verifyAdminAccess } from "@/lib/admin-check.functions";

async function confirmSignOut(after: () => void) {
  const ok = await confirmDialog({
    title: "تسجيل الخروج",
    message: "هل أنت متأكد من تسجيل الخروج؟",
    confirmText: "خروج",
    danger: true,
  });
  if (!ok) return;
  await supabase.auth.signOut();
  after();
}

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
  ssr: false,
  beforeLoad: async () => {
    try {
      await verifyAdminAccess();
    } catch {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({ meta: [{ title: "لوحة التحكم — Admin" }] }),
});


const NAV: Array<{ to: string; label: string; icon: string; exact?: boolean }> = [
  { to: "/admin", label: "نظرة عامة", icon: "📊", exact: true },
  { to: "/admin/players", label: "اللاعبون", icon: "👥" },
  { to: "/admin/sanctions", label: "العقوبات", icon: "🚫" },
  { to: "/admin/tickets", label: "تذاكر الدعم", icon: "🛟" },
  { to: "/admin/broadcasts", label: "الإشعارات", icon: "📢" },
  { to: "/admin/content", label: "محتوى اللعبة", icon: "🎮" },
  { to: "/admin/fish", label: "أسعار السمك", icon: "🐟" },
  { to: "/admin/codes", label: "أكواد الاستعمال", icon: "🎟️" },
  { to: "/admin/competitions", label: "الفعاليات", icon: "🏆" },
  { to: "/admin/arena", label: "الأرينا", icon: "🏟️" },
  { to: "/admin/lucky-box", label: "صندوق الحظ", icon: "🎁" },
  { to: "/admin/tribe-events", label: "فعاليات القبائل", icon: "🎣" },
  { to: "/admin/weekly-xp", label: "مسابقة XP الأسبوعية", icon: "⭐" },
  { to: "/admin/community", label: "القبائل والغرف", icon: "🏴‍☠️" },
  { to: "/admin/voice-rooms", label: "الغرف الصوتية", icon: "🎙️" },
  { to: "/admin/audit", label: "سجل العمليات", icon: "📋" },
];

// Moderators with limited admin access — only allowed these sections
const LIMITED_MODERATORS: Record<string, string[]> = {
  "ce5a35be-41fc-4d66-b47c-ac9ace216b8b": [
    "/admin/tickets",
    "/admin/codes",
    "/admin/players",
    "/admin/sanctions",
  ],
};

function AdminLayout() {
  const { isAdmin, loading } = useIsAdmin();
  const { session, user, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const allowedPaths = user ? LIMITED_MODERATORS[user.id] : undefined;
  const isLimited = !!allowedPaths;
  const visibleNav = isLimited ? NAV.filter((n) => allowedPaths!.includes(n.to)) : NAV;

  useEffect(() => {
    if (!authLoading && !session) nav({ to: "/login" });
  }, [session, authLoading, nav]);

  useEffect(() => {
    if (!isLimited) return;
    const ok = allowedPaths!.some((p) => pathname === p || pathname.startsWith(p + "/"));
    if (!ok) nav({ to: allowedPaths![0] as "/admin" });
  }, [isLimited, allowedPaths, pathname, nav]);

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
    <div dir="rtl" className="h-screen overflow-hidden flex flex-col md:flex-row bg-slate-950 text-slate-100">
      {/* Sidebar / Topbar */}
      <aside className="w-full md:w-60 md:shrink-0 md:h-screen md:overflow-y-auto shrink-0 z-30 border-b md:border-b-0 md:border-l border-slate-800 bg-slate-900/95 backdrop-blur flex flex-col">
        <div className="p-3 md:p-4 border-b border-slate-800 flex items-center justify-between gap-2">
          <div className="text-base md:text-lg font-bold flex items-center gap-2">
            <span>⚓</span> Admin Panel
          </div>
          <div className="flex md:hidden items-center gap-1.5">
            <Link to="/" className="text-xs px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700">🎮</Link>
            <button
              onClick={() => confirmSignOut(() => nav({ to: "/login" }))}
              className="text-xs px-2.5 py-1.5 rounded-md bg-red-900/40 hover:bg-red-900/60 text-red-200"
            >خروج</button>
          </div>
        </div>
        <nav className="flex md:flex-col gap-1 p-2 overflow-x-auto md:overflow-x-visible md:flex-1">
          {visibleNav.map((item) => {
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
            onClick={() => confirmSignOut(() => nav({ to: "/login" }))}
            className="w-full text-center text-xs px-3 py-2 rounded-lg bg-red-900/40 hover:bg-red-900/60 text-red-200"
          >
            تسجيل خروج
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto min-w-0 pb-24 md:pb-6">
        {isLimited && !allowedPaths!.some((p) => pathname === p || pathname.startsWith(p + "/")) ? (
          <div className="min-h-[60vh] flex flex-col items-center justify-center text-slate-300 gap-3 p-6">
            <div className="text-5xl">🔒</div>
            <div className="text-lg font-bold">لا تملك صلاحية لهذه الصفحة</div>
            <p className="text-sm text-slate-400">صلاحياتك تقتصر على: اللاعبون، العقوبات، تذاكر الدعم، أكواد الاستعمال.</p>
          </div>
        ) : (
          <Outlet />
        )}
      </main>

    </div>
  );
}

