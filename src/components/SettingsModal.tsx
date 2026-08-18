import { siteUrl } from "@/lib/site-url";
import { useState, useEffect } from "react";
import { sound } from "@/lib/sound";
import { supabase } from "@/integrations/supabase/client";
import { rateLimit } from "@/lib/rate-limit";
import { MfaSetupSection } from "@/components/MfaSetupSection";
import { DeleteAccountSection } from "@/components/DeleteAccountSection";
import { RulesModal } from "@/components/RulesModal";

import { getBgMotionPaused, setBgMotionPaused, useBgMotionPaused } from "@/lib/bg-motion";
import { setPowerSaver, usePowerSaver } from "@/lib/power-saver";

import { useNavigate } from "@tanstack/react-router";
import { confirmDialog } from "@/components/ConfirmDialog";
import { useT, type Lang } from "@/lib/i18n";
import { useNotifEligible } from "@/hooks/use-notif-eligible";
import { forceUpdateApp } from "@/lib/force-update";
import { useUiPref } from "@/lib/ui-prefs";



export function SettingsModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const { t, lang, setLang } = useT();
  const notifEligible = useNotifEligible();
  const [sfx, setSfx] = useState(true);
  const [music, setMusic] = useState(true);
  const [deathPref, setDeathPref] = useUiPref("death-banner-hidden");
  const [attackPref, setAttackPref] = useUiPref("attack-banner-hidden");
  const [luckyPref, setLuckyPref] = useUiPref("lucky-banner-hidden");
  const [vipPref, setVipPref] = useUiPref("vip-login-hidden");
  const [toastsPref, setToastsPref] = useUiPref("toasts-hidden");


  const [email, setEmail] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [changingEmail, setChangingEmail] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [updating, setUpdating] = useState(false);


  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const pauseBg = useBgMotionPaused();
  const powerSaver = usePowerSaver();

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
    supabase.auth.getUser().then(async ({ data }) => {
      const u = data.user;
      if (!u) return;
      setEmail(u.email ?? null);
      // Server-side truth (same source used by chat/profile) so the badge never disagrees.
      const { data: ver } = await (supabase as any).rpc("is_email_verified", { _uid: u.id });
      if (typeof ver === "boolean") setVerified(ver);
      else setVerified(!!u.email_confirmed_at || !!(u as any).confirmed_at);
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
      options: { emailRedirectTo: `${siteUrl()}/auth/confirm?type=signup&next=/` },
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
      { emailRedirectTo: `${siteUrl()}/auth/confirm?type=email_change&next=/` },
    );

    setChangingEmail(false);
    if (error) { flash(t("settings.change_failed") + arabicAuthError(error.message)); return; }
    flash(t("settings.email_change_sent"));
    setShowEmailForm(false);
    setNewEmail("");
    // Reflect the new address so the "send verification link" button targets it.
    const { data: fresh } = await supabase.auth.getUser();
    if (fresh.user?.email) setEmail(fresh.user.email);
  };

  const sendReset = async () => {
    if (!email) return;
    if (!(await rateLimit("settings", 1500))) { flash(t("common.slow_down")); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {

      redirectTo: `${siteUrl()}/auth/confirm?type=recovery&next=/reset-password`,
    });
    flash(error ? t("settings.send_failed") + arabicAuthError(error.message) : t("settings.reset_sent"));
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (changingPassword) return;
    if (newPassword.length < 6) { flash(t("settings.password_short")); return; }
    if (newPassword !== confirmPassword) { flash(t("settings.password_mismatch")); return; }
    if (!(await rateLimit("settings", 1500))) { flash(t("common.slow_down")); return; }
    setChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);
    if (error) { flash(t("settings.change_failed") + arabicAuthError(error.message)); return; }
    flash(t("settings.password_changed"));
    setNewPassword(""); setConfirmPassword(""); setShowPasswordForm(false);
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
                  <div className="text-[11px] text-amber-200/80 mb-2 leading-snug">
                    إذا كان بريدك وهمي أو غير صحيح، غيّره لبريد حقيقي ثم افتح رابط التفعيل.
                  </div>
                  <button
                    onClick={resend}
                    disabled={sending}
                    className="w-full py-2 rounded-lg bg-gradient-to-b from-emerald-500 to-emerald-700 text-white text-xs font-bold active:scale-95 disabled:opacity-50"
                  >
                    {sending ? t("common.sending") : t("settings.send_verify_link")}
                  </button>
                  {!showEmailForm ? (
                    <button
                      onClick={() => setShowEmailForm(true)}
                      className="mt-2 w-full py-2 rounded-lg bg-gradient-to-b from-sky-500 to-sky-700 text-white text-xs font-bold active:scale-95"
                    >
                      {t("settings.change_email")}
                    </button>
                  ) : (
                    <form onSubmit={changeEmail} className="mt-2 space-y-2">
                      <input
                        type="email"
                        dir="ltr"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="w-full px-3 py-2 rounded-lg bg-black/50 border border-accent/30 text-white text-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={changingEmail || !newEmail}
                          className="flex-1 py-2 rounded-lg bg-gradient-to-b from-emerald-500 to-emerald-700 text-white text-xs font-bold active:scale-95 disabled:opacity-50"
                        >
                          {changingEmail ? t("common.sending") : t("settings.change_email")}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowEmailForm(false); setNewEmail(""); }}
                          className="px-3 py-2 rounded-lg bg-stone-700 text-white text-xs font-bold active:scale-95"
                        >
                          إلغاء
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}
              {msg && <div className="mt-2 text-[11px] text-accent text-center">{msg}</div>}
            </>
          ) : (
            <div className="text-xs text-accent/60">{t("settings.not_signed_in")}</div>
          )}
        </div>

        {/* MFA removed — 2FA disabled globally */}



        <ToggleRow
          label={t("settings.music")}
          value={music}
          onChange={(v) => { setMusic(v); sound.setMusic(v); }}
        />
        <ToggleRow
          label={t("settings.sfx")}
          value={sfx}
          onChange={(v) => { setSfx(v); sound.setSfx(v); if (v) sound.play("click"); }}
        />
        <ToggleRow
          label={t("settings.death_banners")}
          value={deathPref}
          onChange={setDeathPref}
        />
        <ToggleRow
          label="إظهار إشعارات الهجوم"
          value={attackPref}
          onChange={setAttackPref}
        />
        <ToggleRow
          label="إظهار إشعارات الصندوق"
          value={luckyPref}
          onChange={setLuckyPref}
        />
        <ToggleRow
          label="👑 إظهار إشعار دخول VIP"
          value={vipPref}
          onChange={setVipPref}
        />
        {notifEligible && (
          <ToggleRow
            label="🔔 إظهار التنبيهات المنبثقة"
            value={toastsPref}
            onChange={setToastsPref}
          />
        )}



        <ToggleRow
          label={t("settings.pause_bg")}
          value={pauseBg}
          onChange={(v) => { sound.play("click"); setBgMotionPaused(v); }}
        />
        <div className="px-1 text-[10px] text-accent/60 text-center leading-snug mb-2">
          {t("settings.pause_bg_hint")}
        </div>
        <ToggleRow
          label="🔋 موفر الطاقة (ضد التسخين)"
          value={powerSaver}
          onChange={(v) => { sound.play("click"); setPowerSaver(v); }}
        />
        <div className="px-1 text-[10px] text-accent/60 text-center leading-snug mb-2">
          يوقف الحركة والظلال والـ blur والفيديو — يقلل تسخين الجوال واستهلاك البطارية.
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

        <button
          onClick={() => { sound.play("click"); setShowRules(true); }}
          className="w-full py-2.5 mb-2 rounded-lg bg-gradient-to-b from-rose-600 to-rose-800 text-white text-xs font-bold active:scale-95 flex items-center justify-center gap-2"
        >
          <span>📜</span>
          <span>بنود الحظر والكتم</span>
        </button>

        <button

          onClick={() => {
            sound.play("click");
            window.open("https://whatsapp.com/channel/0029Vb8lnG647Xe7EE3yWr3G", "_blank", "noopener,noreferrer");
          }}
          className="w-full py-2.5 mb-2 rounded-lg bg-gradient-to-b from-emerald-500 to-emerald-700 text-white text-xs font-bold active:scale-95 flex items-center justify-center gap-2"
        >
          <span>💬</span>
          <span>قناة الواتساب الرسمية</span>
        </button>

        <button
          onClick={() => {
            sound.play("click");
            window.open("https://t.me/PirateKingsss", "_blank", "noopener,noreferrer");
          }}
          className="w-full py-2.5 mb-2 rounded-lg bg-gradient-to-b from-sky-500 to-sky-700 text-white text-xs font-bold active:scale-95 flex items-center justify-center gap-2"
        >
          <span>✈️</span>
          <span>قناة التليجرام الرسمية</span>
        </button>



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
              onClick={() => setShowPasswordForm((v) => !v)}
              className="w-full py-2 rounded-lg bg-gradient-to-b from-emerald-500 to-emerald-700 text-white text-xs font-bold active:scale-95"
            >
              {t("settings.change_password")}
            </button>
            {showPasswordForm && (
              <form onSubmit={changePassword} className="space-y-2 p-2 rounded-lg bg-black/30 border border-accent/30">
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder={t("settings.new_password")}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-stone-900 border border-amber-700/40 text-white text-xs"
                />
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder={t("settings.confirm_password")}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-stone-900 border border-amber-700/40 text-white text-xs"
                />
                <button
                  type="submit"
                  disabled={changingPassword}
                  className="w-full py-1.5 rounded bg-emerald-600 text-white text-xs font-bold active:scale-95 disabled:opacity-50"
                >
                  {changingPassword ? t("common.sending") : t("settings.save_password")}
                </button>
                <div className="text-[10px] text-accent/60 text-center leading-snug">{t("settings.forgot_hint")}</div>
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
          disabled={updating}
          onClick={async () => {
            sound.play("click");
            setUpdating(true);
            await forceUpdateApp();
          }}
          className="w-full py-2 mt-2 rounded-lg bg-gradient-to-b from-cyan-500 to-cyan-700 text-white text-xs font-bold active:scale-95 disabled:opacity-60"
        >
          {updating ? "⏳ جاري التحديث..." : t("settings.refresh_game")}
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

        {showRules && <RulesModal onClose={() => setShowRules(false)} />}
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
