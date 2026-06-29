import { useState, useEffect } from "react";
import { sound } from "@/lib/sound";
import { supabase } from "@/integrations/supabase/client";
import { rateLimit } from "@/lib/rate-limit";
import { MfaSetupSection } from "@/components/MfaSetupSection";
import { DeleteAccountSection } from "@/components/DeleteAccountSection";

import { useNavigate } from "@tanstack/react-router";
import { confirmDialog } from "@/components/ConfirmDialog";
import { getLiteMode, setLiteMode } from "@/lib/perf-mode";
import { useT, type Lang } from "@/lib/i18n";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const { t, lang, setLang } = useT();
  const [sfx, setSfx] = useState(true);
  const [music, setMusic] = useState(true);
  const [showDeathBanner, setShowDeathBanner] = useState(true);
  const [showAttackBanner, setShowAttackBanner] = useState(true);
  const [showLuckyBanner, setShowLuckyBanner] = useState(true);
  const [lite, setLite] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [changingEmail, setChangingEmail] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000); };

  // Translate common Supabase auth errors to Arabic
  const arabicAuthError = (raw: string): string => {
    const m = raw || "";
    const sec = m.match(/after (\d+) seconds?/i);
    if (sec) return `لأسباب أمنية، يمكنك المحاولة مجدداً بعد ${sec[1]} ثانية`;
    if (/rate.?limit|too many/i.test(m)) return "محاولات كثيرة، انتظر قليلاً ثم حاول مرة أخرى";
    if (/invalid|not.?valid/i.test(m) && /email/i.test(m)) return "البريد الإلكتروني غير صالح";
    if (/already.*registered|already.*exists|already.*in use/i.test(m)) return "هذا البريد مستخدم بالفعل";
    if (/password/i.test(m) && /weak|short|characters/i.test(m)) return "كلمة المرور ضعيفة جداً";
    return "تعذّر إتمام العملية، حاول مرة أخرى";
  };

  useEffect(() => {
    setSfx(sound.getSfx());
    setMusic(sound.getMusic());
    try { setShowDeathBanner(localStorage.getItem("death-banner-hidden") !== "1"); } catch { /* noop */ }
    try { setShowAttackBanner(localStorage.getItem("attack-banner-hidden") !== "1"); } catch { /* noop */ }
    try { setShowLuckyBanner(localStorage.getItem("lucky-banner-hidden") !== "1"); } catch { /* noop */ }
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
    if (!(await rateLimit("settings", 1500))) { flash(t("common.slow_down")); return; }
    setSending(true);

    setMsg(null);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm?type=signup&next=/` },
    });
    setSending(false);
    setMsg(error ? t("settings.send_failed") + arabicAuthError(error.message) : t("settings.verify_sent"));
    setTimeout(() => setMsg(null), 4000);
  };

  const changeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || changingEmail) return;
    if (!(await rateLimit("settings", 1500))) { flash(t("common.slow_down")); return; }
    setChangingEmail(true);
    const { error } = await supabase.auth.updateUser(
      { email: newEmail },
      { emailRedirectTo: `${window.location.origin}/auth/confirm?type=email_change&next=/` },
    );

    setChangingEmail(false);
    if (error) { flash(t("settings.change_failed") + arabicAuthError(error.message)); return; }
    flash(t("settings.email_change_sent"));
    setShowEmailForm(false);
    setNewEmail("");
  };

  const sendReset = async () => {
    if (!email) return;
    if (!(await rateLimit("settings", 1500))) { flash(t("common.slow_down")); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {

      redirectTo: `${window.location.origin}/auth/confirm?type=recovery&next=/reset-password`,
    });
    flash(error ? t("settings.send_failed") + error.message : t("settings.reset_sent"));
  };

  const signOut = async () => {
    const ok = await confirmDialog({
      title: t("settings.sign_out_confirm_title"),
      message: t("settings.sign_out_confirm_msg"),
      confirmText: t("settings.sign_out_btn"),
      danger: true,
    });
    if (!ok) return;
    await supabase.auth.signOut();
    onClose();
    nav({ to: "/login" });
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="glass-hud rounded-2xl border-2 border-accent/60 p-5 max-w-sm w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-accent font-bold text-base mb-4 text-center">{t("settings.title")}</div>

        {/* Language switcher */}
        <div className="mb-4 p-3 rounded-lg bg-black/30 border border-accent/30">
          <div className="text-xs text-accent/80 mb-2">{t("settings.language")}</div>
          <div className="grid grid-cols-2 gap-2">
            {(["ar", "en"] as Lang[]).map((code) => (
              <button
                key={code}
                onClick={() => { sound.play("click"); setLang(code); }}
                className={`py-2 rounded-lg text-xs font-bold active:scale-95 transition-colors ${
                  lang === code
                    ? "bg-gradient-to-b from-amber-500 to-amber-700 text-white"
                    : "bg-black/40 text-accent/80 border border-accent/30"
                }`}
              >
                {t(`lang.${code}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Account verification */}
        <div className="mb-4 p-3 rounded-lg bg-black/30 border border-accent/30">
          <div className="text-xs text-accent/80 mb-1">{t("settings.account_verification")}</div>
          {email ? (
            <>
              <div className="text-[11px] text-accent/70 mb-2 break-all">{email}</div>
              {verified ? (
                <div className="text-sm font-bold text-emerald-400 flex items-center gap-1">
                  {t("settings.verified")}
                </div>
              ) : (
                <>
                  <div className="text-sm font-bold text-amber-300 mb-2">{t("settings.not_verified")}</div>
                  <button
                    onClick={resend}
                    disabled={sending}
                    className="w-full py-2 rounded-lg bg-gradient-to-b from-emerald-500 to-emerald-700 text-white text-xs font-bold active:scale-95 disabled:opacity-50"
                  >
                    {sending ? t("common.sending") : t("settings.send_verify_link")}
                  </button>
                </>
              )}
              {msg && <div className="mt-2 text-[11px] text-accent text-center">{msg}</div>}
            </>
          ) : (
            <div className="text-xs text-accent/60">{t("settings.not_signed_in")}</div>
          )}
        </div>

        {email && <MfaSetupSection />}



        <ToggleRow
          label={t("settings.music")}
          value={music}
          onChange={(v) => { setMusic(v); sound.setMusic(v); }}
        />
        <ToggleRow
          label={t("settings.sfx")}
          value={sfx}
          onChange={(v) => { setSfx(v); sound.setSfx(v); sound.play("click"); }}
        />
        <ToggleRow
          label={t("settings.death_banners")}
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
          label={t("settings.lite_mode")}
          value={lite}
          onChange={(v) => {
            setLite(v);
            setLiteMode(v); // reloads the page to apply
          }}
        />
        <div className="-mt-1 mb-2 px-1 text-[10px] text-amber-300/70 leading-snug">
          {t("settings.lite_hint")}
        </div>

        {email && (
          <button
            onClick={() => {
              window.dispatchEvent(new Event("open-layout-editor"));
              onClose();
            }}
            className="w-full py-2.5 mb-2 rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-700 text-white text-xs font-bold active:scale-95"
          >
            {t("settings.customize_icons")}
          </button>
        )}

        {email && (
          <button
            onClick={() => { sound.play("click"); onClose(); nav({ to: "/support" }); }}
            className="w-full py-2.5 mb-2 rounded-lg bg-gradient-to-b from-amber-500 to-amber-700 text-white text-xs font-bold active:scale-95"
          >
            🛟 الدعم الفني — إنشاء تذكرة
          </button>
        )}

        <a
          href="https://t.me/jbbr509"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => sound.play("click")}
          className="w-full flex items-center justify-center gap-2 py-2.5 mb-2 rounded-lg bg-gradient-to-b from-sky-400 to-sky-600 text-white text-xs font-bold active:scale-95"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden="true">
            <path d="M9.999 15.2 9.84 19.4c.23 0 .33-.1.45-.22l2.08-1.99 4.31 3.16c.79.44 1.36.21 1.57-.73l2.85-13.36c.27-1.21-.44-1.69-1.21-1.4L2.4 9.6c-1.18.46-1.17 1.12-.21 1.42l4.45 1.39 10.34-6.52c.49-.31.93-.14.57.2L9.999 15.2Z"/>
          </svg>
          راسلني على تيليجرام @jbbr509
        </a>

        {email && (
          <div className="mt-3 space-y-2">
            <button
              onClick={() => setShowEmailForm((v) => !v)}
              className="w-full py-2 rounded-lg bg-gradient-to-b from-sky-500 to-sky-700 text-white text-xs font-bold active:scale-95"
            >
              {t("settings.change_email")}
            </button>
            {showEmailForm && (
              <form onSubmit={changeEmail} className="space-y-2 p-2 rounded-lg bg-black/30 border border-accent/30">
                <input
                  type="email"
                  required
                  placeholder={t("settings.new_email")}
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-stone-900 border border-amber-700/40 text-white text-xs"
                />
                <button
                  type="submit"
                  disabled={changingEmail}
                  className="w-full py-1.5 rounded bg-emerald-600 text-white text-xs font-bold active:scale-95 disabled:opacity-50"
                >
                  {changingEmail ? t("common.sending") : t("settings.confirm_change")}
                </button>
                <div className="text-[10px] text-accent/60 text-center">{t("settings.confirm_change_hint")}</div>
              </form>
            )}
            <button
              onClick={sendReset}
              className="w-full py-2 rounded-lg bg-gradient-to-b from-amber-500 to-amber-700 text-white text-xs font-bold active:scale-95"
            >
              {t("settings.reset_password")}
            </button>
            <button
              onClick={signOut}
              className="w-full py-2 rounded-lg bg-gradient-to-b from-rose-600 to-rose-800 text-white text-xs font-bold active:scale-95"
            >
              {t("settings.sign_out")}
            </button>
            <DeleteAccountSection />
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
          {t("settings.refresh_game")}
        </button>
        <div className="mt-1 px-1 text-[10px] text-cyan-300/70 text-center leading-snug">
          {t("settings.refresh_hint")}
        </div>

        <div className="mt-4 text-[10px] text-accent/60 text-center">
          {t("settings.version")}
        </div>

        <button
          className="mt-4 w-full py-2.5 rounded-lg bg-gradient-to-b from-amber-500 to-amber-700 text-white text-sm font-bold active:scale-95"
          onClick={() => { sound.play("click"); onClose(); }}
        >{t("common.close")}</button>
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
