import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { rateLimit } from "@/lib/rate-limit";

export function MfaSetupSection() {
  const [factors, setFactors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000); };

  const refresh = async () => {
    setLoading(true);
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(data?.totp || []);
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const verified = factors.find((f) => f.status === "verified");

  const startEnroll = async () => {
    if (!(await rateLimit("settings", 1500))) { flash("تمهّل قليلاً"); return; }
    setBusy(true);
    // Clean stale unverified factors first
    for (const f of factors.filter((f) => f.status !== "verified")) {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setBusy(false);
    if (error || !data) { flash("تعذر التفعيل: " + (error?.message || "")); return; }
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };

  const verifyEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrolling || code.length !== 6) return;
    setBusy(true);
    const ch = await supabase.auth.mfa.challenge({ factorId: enrolling.factorId });
    if (ch.error) { setBusy(false); flash("خطأ: " + ch.error.message); return; }
    const v = await supabase.auth.mfa.verify({ factorId: enrolling.factorId, challengeId: ch.data!.id, code });
    setBusy(false);
    if (v.error) { flash("الرمز غير صحيح"); setCode(""); return; }
    flash("تم تفعيل التحقق بخطوتين ✓");
    setEnrolling(null); setCode(""); refresh();
  };

  const disable = async () => {
    if (!verified) return;
    if (!confirm("تعطيل التحقق بخطوتين؟")) return;
    setBusy(true);
    await supabase.auth.mfa.unenroll({ factorId: verified.id });
    setBusy(false);
    flash("تم التعطيل");
    refresh();
  };

  return (
    <div className="mb-4 p-3 rounded-lg bg-black/30 border border-accent/30">
      <div className="text-xs text-accent/80 mb-2">🔐 التحقق بخطوتين (2FA)</div>
      {loading ? (
        <div className="text-xs text-accent/60">جار التحميل...</div>
      ) : verified ? (
        <>
          <div className="text-sm font-bold text-emerald-400 mb-2">✅ مفعّل</div>
          <button onClick={disable} disabled={busy}
            className="w-full py-1.5 rounded bg-rose-700 text-white text-xs font-bold active:scale-95 disabled:opacity-50">
            تعطيل
          </button>
        </>
      ) : enrolling ? (
        <form onSubmit={verifyEnroll} className="space-y-2">
          <div className="text-[11px] text-accent/80 mb-1">امسح هذا الرمز بتطبيق Google Authenticator أو Authy</div>
          <div className="flex justify-center bg-white p-2 rounded">
            <img src={enrolling.qr} alt="QR" className="w-40 h-40" />
          </div>
          <div className="text-[10px] text-accent/60 text-center break-all">
            أو أدخل المفتاح يدوياً: <span className="font-mono text-amber-300">{enrolling.secret}</span>
          </div>
          <input
            inputMode="numeric" maxLength={6} value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="رمز 6 أرقام"
            className="w-full px-2 py-2 rounded bg-stone-900 border border-amber-700/40 text-white text-center font-mono tracking-widest"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || code.length !== 6}
              className="flex-1 py-1.5 rounded bg-emerald-600 text-white text-xs font-bold active:scale-95 disabled:opacity-50">
              تأكيد
            </button>
            <button type="button" onClick={async () => {
              await supabase.auth.mfa.unenroll({ factorId: enrolling.factorId });
              setEnrolling(null); setCode(""); refresh();
            }} className="flex-1 py-1.5 rounded bg-stone-700 text-white text-xs">إلغاء</button>
          </div>
        </form>
      ) : (
        <>
          <div className="text-[11px] text-accent/70 mb-2">أضف طبقة حماية إضافية لحسابك عبر تطبيق المصادقة.</div>
          <button onClick={startEnroll} disabled={busy}
            className="w-full py-2 rounded-lg bg-gradient-to-b from-emerald-500 to-emerald-700 text-white text-xs font-bold active:scale-95 disabled:opacity-50">
            🔐 تفعيل التحقق بخطوتين
          </button>
        </>
      )}
      {msg && <div className="mt-2 text-[11px] text-accent text-center">{msg}</div>}
    </div>
  );
}
