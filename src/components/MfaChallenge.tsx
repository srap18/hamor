import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function MfaChallenge({ onVerified, onCancel }: { onVerified: () => void; onCancel: () => void }) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) { setErr(error.message); setLoading(false); return; }
      const totp = data?.totp?.find((f: any) => f.status === "verified") || data?.totp?.[0];
      if (!totp) { setErr("لم يتم العثور على وسيلة تحقق"); setLoading(false); return; }
      setFactorId(totp.id);
      const ch = await supabase.auth.mfa.challenge({ factorId: totp.id });
      if (ch.error) { setErr(ch.error.message); setLoading(false); return; }
      setChallengeId(ch.data!.id);
      setLoading(false);
    })();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId || !challengeId || code.length !== 6) return;
    setErr(null); setLoading(true);
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
    setLoading(false);
    if (error) { setErr(error.message); setCode(""); return; }
    onVerified();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/80" dir="rtl">
      <div className="w-full max-w-sm rounded-2xl bg-stone-950/95 border-2 border-amber-700/60 p-6 shadow-2xl">
        <div className="text-center mb-4">
          <div className="text-4xl mb-1">🔐</div>
          <div className="text-lg font-extrabold text-amber-300">التحقق بخطوتين</div>
          <div className="text-xs text-amber-100/70 mt-1">أدخل رمز 6 أرقام من تطبيق المصادقة</div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input
            inputMode="numeric" pattern="[0-9]*" autoFocus maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="w-full px-3 py-3 rounded-lg bg-stone-900 border border-amber-700/40 text-white text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:border-amber-400"
          />
          {err && <div className="text-rose-400 text-xs text-center">{err}</div>}
          <button disabled={loading || code.length !== 6} type="submit"
            className="w-full py-2 rounded-lg bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 font-extrabold active:scale-95 disabled:opacity-60">
            {loading ? "..." : "تأكيد"}
          </button>
          <button type="button" onClick={async () => { await supabase.auth.signOut(); onCancel(); }}
            className="w-full py-2 rounded-lg bg-stone-800 text-amber-200/70 text-xs">
            إلغاء وتسجيل خروج
          </button>
        </form>
      </div>
    </div>
  );
}

/** MFA disabled globally — always returns false and silently unenrolls any existing factors. */
export async function mfaStepUpRequired(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.mfa.listFactors();
    const all = [...(data?.totp ?? []), ...((data as any)?.phone ?? [])];
    for (const f of all) {
      try { await supabase.auth.mfa.unenroll({ factorId: f.id }); } catch { /* noop */ }
    }
  } catch { /* noop */ }
  return false;
}
