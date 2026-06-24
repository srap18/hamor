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

function BattlePage() {
  const [checked, setChecked] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [lockedTitle, setLockedTitle] = useState("🔒 الأرينا مقفلة مؤقتاً");
  const [lockedMessage, setLockedMessage] = useState("سنفتحها قريباً بتحديث جديد. ترقّبوا!");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("arena_settings")
        .select("enabled, locked_title, locked_message").maybeSingle();
      if (data) {
        setEnabled(!!data.enabled);
        setLockedTitle(data.locked_title);
        setLockedMessage(data.locked_message);
      }
      setChecked(true);
    })();
  }, []);

  if (!checked) return null;

  if (!enabled) {
    return (
      <div className="fixed inset-0 overflow-y-auto flex items-center justify-center" dir="rtl"
        style={{ background: "radial-gradient(ellipse at top, #1a1a2e 0%, #0a0a14 60%, #000 100%)" }}>
        <div className="absolute top-4 right-3">
          <Link to="/" className="glass-hud rounded-full px-3 py-1.5 text-cyan-200 text-sm font-bold border border-cyan-500/40">← رجوع</Link>
        </div>
        <div className="max-w-sm mx-auto px-6 text-center">
          <div className="text-7xl mb-4">🔒</div>
          <div className="text-2xl font-black text-amber-200 mb-2">{lockedTitle}</div>
          <div className="text-cyan-300/70 text-sm">{lockedMessage}</div>
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
        <div className="text-2xl font-black text-amber-200 mb-2">قريباً</div>
        <div className="text-cyan-300/70 text-sm">واجهة المعركة قيد التطوير — الترتيب والجوائز شغّالة من صفحة الأرينا.</div>
      </div>
    </div>
  );
}
