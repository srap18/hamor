import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useSecurityEnforcement } from "@/hooks/use-security-enforcement";


export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, loading, user } = useAuth();
  const navigate = useNavigate();
  const [banInfo, setBanInfo] = useState<{ reason: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const securityBlock = useSecurityEnforcement();


  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/login" });
    }
  }, [loading, session, navigate]);

  useEffect(() => {
    if (!user) { setChecking(false); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("bans")
        .select("reason, expires_at")
        .eq("user_id", user.id)
        .eq("active", true)
        .order("banned_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data && (!data.expires_at || new Date(data.expires_at) > new Date())) {
        setBanInfo({ reason: data.reason });
      }
      setChecking(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (loading || checking) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-stone-950 text-amber-200">
        <div className="animate-pulse text-lg">جاري التحميل...</div>
      </div>
    );
  }
  if (!session) return null;

  if (banInfo) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-red-950 text-red-100 p-6 gap-4 text-center">
        <div className="text-6xl">🚫</div>
        <h1 className="text-2xl font-bold">تم حظر حسابك</h1>
        <p className="text-red-200/80 max-w-md">{banInfo.reason || "تواصل مع الإدارة لمزيد من التفاصيل"}</p>
        <button
          onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login" }); }}
          className="px-4 py-2 rounded-lg bg-red-800 hover:bg-red-700"
        >
          تسجيل خروج
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
