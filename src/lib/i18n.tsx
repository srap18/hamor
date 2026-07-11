import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";

export type Lang = "ar" | "en";

const STORAGE_KEY = "app-lang";

type Dict = Record<string, { ar: string; en: string }>;

// Central translation dictionary. Add new keys here as we translate more screens.
// Keys are stable identifiers; values are the AR/EN copy.
export const dict: Dict = {
  // Common
  "common.close": { ar: "إغلاق", en: "Close" },
  "common.confirm": { ar: "تأكيد", en: "Confirm" },
  "common.cancel": { ar: "إلغاء", en: "Cancel" },
  "common.save": { ar: "حفظ", en: "Save" },
  "common.sending": { ar: "جاري الإرسال...", en: "Sending..." },
  "common.slow_down": { ar: "تمهّل قليلاً قبل المحاولة مجدداً", en: "Please slow down and try again" },

  // Settings
  "settings.title": { ar: "⚙️ الإعدادات", en: "⚙️ Settings" },
  "settings.account_verification": { ar: "🛡️ توثيق الحساب", en: "🛡️ Account verification" },
  "settings.verified": { ar: "✅ الحساب موثّق", en: "✅ Account verified" },
  "settings.not_verified": { ar: "⚠️ غير موثّق", en: "⚠️ Not verified" },
  "settings.send_verify_link": { ar: "📧 إرسال رابط التوثيق", en: "📧 Send verification link" },
  "settings.not_signed_in": { ar: "لم يتم تسجيل الدخول", en: "Not signed in" },
  "settings.verify_sent": { ar: "تم إرسال رابط التوثيق إلى بريدك ✓", en: "Verification link sent to your email ✓" },
  "settings.send_failed": { ar: "تعذر الإرسال: ", en: "Send failed: " },

  "settings.music": { ar: "🎵 الموسيقى الخلفية", en: "🎵 Background music" },
  "settings.sfx": { ar: "🔊 المؤثرات الصوتية", en: "🔊 Sound effects" },
  "settings.death_banners": { ar: "💀 إظهار لافتات الموت", en: "💀 Show death banners" },
  "settings.pause_bg": { ar: "🎬 إيقاف الخلفية المتحركة", en: "🎬 Pause animated background" },
  "settings.pause_bg_hint": {
    ar: "يوقف الفيديو والحركة في الخلفية (السحب، الطيور، البحر) ويترك صورة ثابتة — مفيد للجوالات الضعيفة أو لما يسخن الجهاز.",
    en: "Stops video and background motion (clouds, birds, sea) and keeps a still image — useful for weaker phones or when the device overheats.",
  },
  "settings.lite_mode": { ar: "🔋 موفر البطارية (يقلل تسخين الجوال)", en: "🔋 Battery saver (reduces device heat)" },
  "settings.lite_hint": {
    ar: "يوقف الخلفيات المتحركة، اللهب، حركات السفن، والفيديو. يخفض حرارة الجهاز ويوفر شحن البطارية بشكل كبير — مناسب للايفون والاندرويد لما يسخن.",
    en: "Stops animated backgrounds, fire, ship motion and video. Significantly reduces device heat and saves battery — useful on iPhone and Android when overheating.",
  },

  "settings.customize_icons": { ar: "🎯 تخصيص مواقع الأيقونات", en: "🎯 Customize icon positions" },
  "settings.change_email": { ar: "✉️ تغيير البريد الإلكتروني", en: "✉️ Change email" },
  "settings.new_email": { ar: "البريد الجديد", en: "New email" },
  "settings.confirm_change": { ar: "تأكيد التغيير", en: "Confirm change" },
  "settings.confirm_change_hint": { ar: "سيُرسَل رابط التأكيد إلى البريد الجديد", en: "A confirmation link will be sent to the new email" },
  "settings.email_change_sent": { ar: "تم إرسال رابط التأكيد إلى البريد الجديد ✓", en: "Confirmation link sent to the new email ✓" },
  "settings.change_failed": { ar: "فشل التغيير: ", en: "Change failed: " },
  "settings.reset_password": { ar: "🔑 استعادة كلمة المرور عبر البريد", en: "🔑 Reset password via email" },
  "settings.reset_sent": { ar: "تم إرسال رابط استعادة كلمة المرور ✓", en: "Password reset link sent ✓" },
  "settings.change_password": { ar: "🔒 تغيير كلمة المرور", en: "🔒 Change password" },
  "settings.new_password": { ar: "كلمة المرور الجديدة (6 أحرف على الأقل)", en: "New password (min 6 chars)" },
  "settings.confirm_password": { ar: "تأكيد كلمة المرور", en: "Confirm password" },
  "settings.password_changed": { ar: "تم تغيير كلمة المرور ✓", en: "Password changed ✓" },
  "settings.password_mismatch": { ar: "كلمتا المرور غير متطابقتين", en: "Passwords do not match" },
  "settings.password_short": { ar: "كلمة المرور قصيرة (6 أحرف على الأقل)", en: "Password too short (min 6 chars)" },
  "settings.save_password": { ar: "حفظ كلمة المرور", en: "Save password" },
  "settings.forgot_hint": { ar: "نسيت كلمة المرور؟ استخدم زر «استعادة كلمة المرور عبر البريد» بالأسفل.", en: "Forgot your password? Use the email reset button below." },
  "settings.sign_out": { ar: "🚪 تسجيل الخروج", en: "🚪 Sign out" },
  "settings.sign_out_confirm_title": { ar: "تسجيل الخروج", en: "Sign out" },
  "settings.sign_out_confirm_msg": { ar: "هل أنت متأكد من تسجيل الخروج؟", en: "Are you sure you want to sign out?" },
  "settings.sign_out_btn": { ar: "خروج", en: "Sign out" },

  "settings.refresh_game": { ar: "🔄 تحديث اللعبة لآخر إصدار", en: "🔄 Update game to latest version" },
  "settings.refresh_hint": { ar: "اضغط هذا الزر إذا ما يظهر عندك آخر تحديث للعبة.", en: "Tap this if you don't see the latest update." },
  "settings.version": { ar: "الإصدار 1.0 — Ocean Catch", en: "Version 1.0 — Ocean Catch" },

  // Language
  "settings.language": { ar: "🌐 اللغة", en: "🌐 Language" },
  "lang.ar": { ar: "العربية", en: "Arabic" },
  "lang.en": { ar: "English", en: "English" },
};

const LangContext = createContext<{
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, fallback?: string) => string;
}>({ lang: "ar", setLang: () => {}, t: (_k, f) => f ?? _k });

function readInitial(): Lang {
  if (typeof window === "undefined") return "ar";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "ar" || v === "en") return v;
  } catch {}
  return "ar";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitial);

  useEffect(() => {
    try {
      document.documentElement.lang = lang;
      document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    } catch {}
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch {}
  }, []);

  const t = useCallback((key: string, fallback?: string) => {
    const entry = dict[key];
    if (!entry) return fallback ?? key;
    return entry[lang] ?? entry.ar ?? fallback ?? key;
  }, [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useT() {
  return useContext(LangContext);
}
