import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";

export const Route = createFileRoute("/delete-account")({
  head: () => ({
    meta: [
      { title: "حذف الحساب — ملوك القراصنة (هامور شابك)" },
      { name: "description", content: "تعليمات حذف حسابك وبياناتك بشكل نهائي من لعبة ملوك القراصنة (هامور شابك)." },
      { property: "og:title", content: "حذف الحساب — ملوك القراصنة" },
      { property: "og:description", content: "كيفية طلب حذف حسابك وبياناتك بشكل دائم." },
      { property: "og:url", content: "https://www.molok-alqarasna.com/delete-account" },
    ],
    links: [{ rel: "canonical", href: "https://www.molok-alqarasna.com/delete-account" }],
  }),
  component: DeleteAccountPage,
});

function DeleteAccountPage() {
  return (
    <LegalPage title="حذف الحساب">
      <p>
        يمكنك حذف حسابك وجميع بياناتك (السفن، الجواهر، الإنجازات، الرسائل، الإحصائيات)
        بشكل نهائي ولا يمكن استرجاعها بعد التنفيذ.
      </p>

      <h2>الطريقة من داخل التطبيق</h2>
      <ol>
        <li>سجّل الدخول إلى حسابك.</li>
        <li>افتح <strong>الإعدادات</strong> من القائمة.</li>
        <li>اذهب إلى قسم <strong>حسابك</strong>.</li>
        <li>اضغط زر <strong>«🗑️ حذف الحساب نهائياً»</strong> في «منطقة الخطر».</li>
        <li>سيصلك <strong>كود تحقق (OTP)</strong> من 6 أرقام على بريدك الإلكتروني.</li>
        <li>أدخل الكود ثم اضغط <strong>«تأكيد الحذف النهائي»</strong>.</li>
      </ol>

      <h2>ما الذي يُحذف</h2>
      <ul>
        <li>بيانات حسابك (البريد، الاسم، الصورة).</li>
        <li>كل تقدّمك داخل اللعبة (سفن، أسلحة، عملات، جواهر، إنجازات).</li>
        <li>محادثاتك ورسائلك.</li>
        <li>إحصائيات المعارك والسجلات المرتبطة بك.</li>
      </ul>

      <h2>ما الذي قد نحتفظ به</h2>
      <p>
        نحتفظ بالحد الأدنى من المعلومات اللازمة للالتزامات القانونية والمحاسبية (مثل
        فواتير الشراء) للفترة التي يفرضها القانون (عادةً حتى 7 سنوات)، ثم تُحذف أو
        تُجعل مجهولة الهوية.
      </p>

      <h2>طلب الحذف عبر البريد</h2>
      <p>
        إذا تعذّر عليك الدخول إلى حسابك، أرسل طلب الحذف من نفس البريد المرتبط بحسابك
        إلى: <a href="mailto:support@molok-alqarasna.com">support@molok-alqarasna.com</a>{" "}
        وسنُنفّذ الحذف خلال 30 يوماً كحدّ أقصى.
      </p>

      <p>
        <Link to="/">العودة للصفحة الرئيسية</Link>
      </p>
    </LegalPage>
  );
}
