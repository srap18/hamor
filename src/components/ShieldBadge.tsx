import { useEffect, useState } from "react";
import { useProfile, refreshProfile } from "@/hooks/use-auth";
import { serverNowMs } from "@/lib/server-time";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

function fmt(ms: number) {
  if (ms <= 0) return "";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}ي ${h}س`;
  if (h > 0) return `${h}س ${m}د`;
  return `${m}د`;
}

export function ShieldBadge() {
  const { profile } = useProfile();
  const [now, setNow] = useState(serverNowMs());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(serverNowMs()), 30_000);
    return () => clearInterval(t);
  }, []);
  const until = profile?.protection_until ? new Date(profile.protection_until).getTime() : 0;
  const remain = until - now;
  if (remain <= 0) return null;

  const removeShield = async () => {
    if (busy) return;
    if (!window.confirm("هل تريد إزالة الدرع؟ سيتم إيقافه فوراً وتصير عرضة للهجمات.")) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any)
        .from("profiles")
        .update({ protection_until: null })
        .eq("id", profile.id);
      if (error) throw error;
      toast.success("🗑️ تم إزالة الدرع");
      await refresh?.();
    } catch {
      toast.error("تعذّر إزالة الدرع");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border-2 border-emerald-300 bg-gradient-to-b from-emerald-700 to-emerald-900 shadow text-[10px] font-black text-emerald-50">
      🛡️ <span className="tabular-nums">{fmt(remain)}</span>
      <button
        type="button"
        aria-label="إزالة الدرع"
        title="إزالة الدرع"
        onClick={removeShield}
        disabled={busy}
        className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-black leading-none active:scale-90 bg-emerald-950 text-emerald-200 border border-emerald-300 disabled:opacity-50"
      >×</button>
    </div>
  );
}
