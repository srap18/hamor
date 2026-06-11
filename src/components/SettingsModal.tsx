import { useState, useEffect } from "react";
import { sound } from "@/lib/sound";
import { supabase } from "@/integrations/supabase/client";
import { rateLimit } from "@/lib/rate-limit";
import { MfaSetupSection } from "@/components/MfaSetupSection";

import { useNavigate } from "@tanstack/react-router";
import { confirmDialog } from "@/components/ConfirmDialog";
import { getLiteMode, setLiteMode } from "@/lib/perf-mode";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [sfx, setSfx] = useState(true);
  const [music, setMusic] = useState(true);
  const [showDeathBanner, setShowDeathBanner] = useState(true);
  const [lite, setLite] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [changingEmail, setChangingEmail] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000); };

  useEffect(() => {
    setSfx(sound.getSfx());
    setMusic(sound.getMusic());
    try { setShowDeathBanner(localStorage.getItem("death-banner-hidden") !== "1"); } catch { /* noop */ }
    setLite(getLiteMode());
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      if (!u) return;
      setEmail(u.email ?? null);
      setVerified(!!u.email_confirmed_at || !!(u as any).confirmed_at);
    });
  }, []);

  const resend = async () => {
    if (!email || sending) return;
    if (!(await rateLimit("settings", 1500))) { flash("تمهّل قليلاً قبل المحاولة مجدداً"); return; }
    setSending(true);

    setMsg(null);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setSending(false);
    setMsg(error ? "تعذر الإرسال: " + error.message : "تم إرسال رابط التوثيق إلى بريدك ✓");
    setTimeout(() => setMsg(null), 4000);
  };

  const changeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || changingEmail) return;
    if (!(await rateLimit("settings", 1500))) { flash("تمهّل قليلاً قبل المحاولة مجدداً"); return; }
    setChangingEmail(true);
    const { error } = await supabase.auth.updateUser({ email: newEmail });

    setChangingEmail(false);
    if (error) { flash("فشل التغيير: " + error.message); return; }
    flash("تم إرسال رابط التأكيد إلى البريد الجديد ✓");
    setShowEmailForm(false);
    setNewEmail("");
  };

  const sendReset = async () => {
    if (!email) return;
    if (!(await rateLimit("settings", 1500))) { flash("تمهّل قليلاً قبل المحاولة مجدداً"); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {

      redirectTo: `${window.location.origin}/reset-password`,
    });
    flash(error ? "تعذر الإرسال: " + error.message : "تم إرسال رابط استعادة كلمة المرور ✓");
  };

  const signOut = async () => {
    const ok = await confirmDialog({
      title: "تسجيل الخروج",
      message: "هل أنت متأكد من تسجيل الخروج؟",
      confirmText: "خروج",
      danger: true,
    });
    if (!ok) return;
    await supabase.auth.signOut();
    onClose();
    nav({ to: "/login" });
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="glass-hud rounded-2xl border-2 border-accent/60 p-5 max-w-sm w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-accent font-bold text-base mb-4 text-center">⚙️ الإعدادات</div>

        {/* Account verification */}
        <div className="mb-4 p-3 rounded-lg bg-black/30 border border-accent/30">
          <div className="text-xs text-accent/80 mb-1">🛡️ توثيق الحساب</div>
          {email ? (
            <>
              <div className="text-[11px] text-accent/70 mb-2 break-all">{email}</div>
              {verified ? (
                <div className="text-sm font-bold text-emerald-400 flex items-center gap-1">
                  ✅ الحساب موثّق
                </div>
              ) : (
                <>
                  <div className="text-sm font-bold text-amber-300 mb-2">⚠️ غير موثّق</div>
                  <button
                    onClick={resend}
                    disabled={sending}
                    className="w-full py-2 rounded-lg bg-gradient-to-b from-emerald-500 to-emerald-700 text-white text-xs font-bold active:scale-95 disabled:opacity-50"
                  >
                    {sending ? "جاري الإرسال..." : "📧 إرسال رابط التوثيق"}
                  </button>
                </>
              )}
              {msg && <div className="mt-2 text-[11px] text-accent text-center">{msg}</div>}
            </>
          ) : (
            <div className="text-xs text-accent/60">لم يتم تسجيل الدخول</div>
          )}
        </div>

        <ToggleRow
          label="🎵 الموسيقى الخلفية"
          value={music}
          onChange={(v) => { setMusic(v); sound.setMusic(v); }}
        />
        <ToggleRow
          label="🔊 المؤثرات الصوتية"
          value={sfx}
          onChange={(v) => { setSfx(v); sound.setSfx(v); sound.play("click"); }}
        />
        <ToggleRow
          label="💀 إظهار لافتات الموت"
          value={showDeathBanner}
          onChange={(v) => {
            setShowDeathBanner(v);
            try {
              if (v) localStorage.removeItem("death-banner-hidden");
              else localStorage.setItem("death-banner-hidden", "1");
              window.dispatchEvent(new Event("death-banner-pref"));
            } catch { /* noop */ }
          }}
        />
        <ToggleRow
          label="🔋 موفر البطارية (يقلل تسخين الجوال)"
          value={lite}
          onChange={(v) => {
            setLite(v);
            setLiteMode(v); // reloads the page to apply
          }}
        />
        <div className="-mt-1 mb-2 px-1 text-[10px] text-amber-300/70 leading-snug">
          يوقف الخلفيات المتحركة، اللهب، حركات السفن، والفيديو. يخفض حرارة الجهاز ويوفر شحن البطارية بشكل كبير — مناسب للايفون والاندرويد لما يسخن.
        </div>

        {email && (
          <button
            onClick={() => {
              window.dispatchEvent(new Event("open-layout-editor"));
              onClose();
            }}
            className="w-full py-2.5 mb-2 rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-700 text-white text-xs font-bold active:scale-95"
          >
            🎯 تخصيص مواقع الأيقونات
          </button>
        )}

        {email && (
          <div className="mt-3 space-y-2">
            <button
              onClick={() => setShowEmailForm((v) => !v)}
              className="w-full py-2 rounded-lg bg-gradient-to-b from-sky-500 to-sky-700 text-white text-xs font-bold active:scale-95"
            >
              ✉️ تغيير البريد الإلكتروني
            </button>
            {showEmailForm && (
              <form onSubmit={changeEmail} className="space-y-2 p-2 rounded-lg bg-black/30 border border-accent/30">
                <input
                  type="email"
                  required
                  placeholder="البريد الجديد"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-stone-900 border border-amber-700/40 text-white text-xs"
                />
                <button
                  type="submit"
                  disabled={changingEmail}
                  className="w-full py-1.5 rounded bg-emerald-600 text-white text-xs font-bold active:scale-95 disabled:opacity-50"
                >
                  {changingEmail ? "جاري الإرسال..." : "تأكيد التغيير"}
                </button>
                <div className="text-[10px] text-accent/60 text-center">سيُرسَل رابط التأكيد إلى البريد الجديد</div>
              </form>
            )}
            <button
              onClick={sendReset}
              className="w-full py-2 rounded-lg bg-gradient-to-b from-amber-500 to-amber-700 text-white text-xs font-bold active:scale-95"
            >
              🔑 استعادة / تغيير كلمة المرور
            </button>
            <button
              onClick={signOut}
              className="w-full py-2 rounded-lg bg-gradient-to-b from-rose-600 to-rose-800 text-white text-xs font-bold active:scale-95"
            >
              🚪 تسجيل الخروج
            </button>
          </div>
        )}

        <button
          onClick={async () => {
            sound.play("click");
            try {
              if ("caches" in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map((k) => caches.delete(k)));
              }
              if ("serviceWorker" in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map((r) => r.unregister()));
              }
            } catch { /* noop */ }
            // Hard reload, bypassing the browser cache.
            const u = new URL(window.location.href);
            u.searchParams.set("__v", String(Date.now()));
            window.location.replace(u.toString());
          }}
          className="w-full py-2 mt-2 rounded-lg bg-gradient-to-b from-cyan-500 to-cyan-700 text-white text-xs font-bold active:scale-95"
        >
          🔄 تحديث اللعبة لآخر إصدار
        </button>
        <div className="mt-1 px-1 text-[10px] text-cyan-300/70 text-center leading-snug">
          اضغط هذا الزر إذا ما يظهر عندك آخر تحديث للعبة.
        </div>

        <div className="mt-4 text-[10px] text-accent/60 text-center">
          الإصدار 1.0 — Ocean Catch
        </div>

        <button
          className="mt-4 w-full py-2.5 rounded-lg bg-gradient-to-b from-amber-500 to-amber-700 text-white text-sm font-bold active:scale-95"
          onClick={() => { sound.play("click"); onClose(); }}
        >إغلاق</button>
      </div>
    </div>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="w-full flex items-center justify-between p-3 mb-2 rounded-lg bg-black/30 border border-accent/30 active:scale-[0.98]"
    >
      <span className="text-sm text-accent font-medium">{label}</span>
      <span className={`w-12 h-6 rounded-full relative transition-colors ${value ? "bg-emerald-500" : "bg-secondary/60"}`}>
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${value ? "right-0.5" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}
