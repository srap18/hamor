import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/battle")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    vs: typeof s.vs === "string" ? s.vs : undefined,
  }),
  head: () => ({ meta: [{ title: "⚔️ معركة الأرينا" }] }),
  component: BattlePage,
});

const BATTLE_ALLOWED_USERS = new Set<string>([
  "7035f6b9-7bb2-41e2-a8b8-050d0e7f41c0", // جاك سبارو (تجربة)
]);

function BattlePage() {
  const [checked, setChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      let ok = !!user?.id && BATTLE_ALLOWED_USERS.has(user.id);
      if (!ok && user?.id) {
        const { data: roles } = await supabase
          .from("user_roles").select("role").eq("user_id", user.id)
          .in("role", ["admin", "moderator"]);
        ok = !!roles && roles.length > 0;
      }
      setAllowed(ok);
      setChecked(true);
    })();
  }, []);

  if (!checked) return null;

  if (!allowed) {
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

  return (
    <div className="fixed inset-0 overflow-y-auto flex items-center justify-center" dir="rtl"
      style={{ background: "radial-gradient(ellipse at top, #1a1a2e 0%, #0a0a14 60%, #000 100%)" }}>
      <div className="absolute top-4 right-3">
        <Link to="/" className="glass-hud rounded-full px-3 py-1.5 text-cyan-200 text-sm font-bold border border-cyan-500/40">← رجوع</Link>
      </div>
      <div className="max-w-sm mx-auto px-6 text-center">
        <div className="text-7xl mb-4">⚔️</div>
        <div className="text-2xl font-black text-amber-200 mb-2">وضع التجربة</div>
        <div className="text-cyan-300/70 text-sm">المعركة قيد التطوير — وضع تجريبي للأدمن.</div>
      </div>
    </div>
  );
}
