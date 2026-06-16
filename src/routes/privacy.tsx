import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "سياسة الخصوصية — ملوك القراصنة (هامور شابك)" },
      { name: "description", content: "كيف نجمع ونحمي بياناتك الشخصية في لعبة ملوك القراصنة (هامور شابك)." },
      { property: "og:title", content: "سياسة الخصوصية — ملوك القراصنة" },
      { property: "og:description", content: "حماية بيانات اللاعبين في ملوك القراصنة (هامور شابك)." },
      { property: "og:url", content: "https://www.molok-alqarasna.com/privacy" },
    ],
    links: [{ rel: "canonical", href: "https://www.molok-alqarasna.com/privacy" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "سياسة الخصوصية — ملوك القراصنة",
          headline: "سياسة الخصوصية",
          url: "https://www.molok-alqarasna.com/privacy",
          inLanguage: "ar",
          description: "كيف نجمع ونستخدم ونحمي بياناتك الشخصية في لعبة ملوك القراصنة (هامور شابك).",
          publisher: { "@type": "Organization", name: "ملوك القراصنة", url: "https://www.molok-alqarasna.com/" },
        }),
      },
    ],
  }),
  component: PrivacyPage,
});


function PrivacyPage() {
  return (
    <LegalPage title="سياسة الخصوصية">
      <p>
        تشرح هذه السياسة كيف تقوم <strong>Amira Qailan Dakhil Allah Alsharari</strong> ("نحن") بجمع واستخدام
        وحماية بياناتك الشخصية عند استخدامك لخدمة <strong>هامور شابك</strong>. نحن مسؤول التحكم بالبيانات
        (Data Controller) عن المعلومات التي نجمعها منك.
      </p>

      <h2>1. البيانات التي نجمعها</h2>
      <ul>
        <li><strong>بيانات الحساب</strong>: البريد الإلكتروني، كلمة المرور (مشفّرة)، الاسم/اللقب داخل اللعبة.</li>
        <li><strong>بيانات اللعب</strong>: الإحصائيات، التقدّم، السفن، الجواهر، سجل المعارك والمحادثات.</li>
        <li><strong>بيانات تقنية</strong>: عنوان IP، نوع الجهاز والمتصفح، معرّفات الجلسة، بيانات الاستخدام.</li>
        <li><strong>بيانات الدعم</strong>: الرسائل التي ترسلها لنا عبر الدعم.</li>
        <li><strong>بيانات الدفع</strong>: تُعالَج مباشرة لدى مزوّد الدفع ولا نخزّن بيانات بطاقتك لدينا.</li>
      </ul>

      <h2>2. أغراض الاستخدام والأساس القانوني</h2>
      <ul>
        <li>إنشاء الحساب وتقديم الخدمة (تنفيذ العقد).</li>
        <li>منع الاحتيال وحماية الحسابات (المصلحة المشروعة).</li>
        <li>تحسين اللعبة وتحليل الأداء (المصلحة المشروعة).</li>
        <li>دعم العملاء والرد على الاستفسارات (تنفيذ العقد).</li>
        <li>إرسال إشعارات ضرورية (التزام تعاقدي) أو تسويقية (الموافقة، يمكن سحبها).</li>
      </ul>

      <h2>3. مشاركة البيانات</h2>
      <ul>
        <li><strong>مزوّدو الخدمة (Subprocessors)</strong>: استضافة سحابية، قواعد بيانات، تحليلات، وأدوات
          دعم العملاء — جميعهم ملتزمون بالسرية وحماية البيانات.
        </li>
        <li><strong>المستشارون المهنيون</strong>: محامون ومحاسبون عند الضرورة.</li>
        <li><strong>السلطات المختصّة</strong>: عند طلب قانوني صريح.</li>
      </ul>

      <h2>4. الاحتفاظ بالبيانات</h2>
      <p>
        نحتفظ ببيانات الحساب طوال فترة نشاطه. بعد حذف الحساب نحتفظ بحدّ أدنى من المعلومات للالتزامات
        القانونية والمحاسبية (عادةً حتى 7 سنوات للفواتير)، ثم تُحذف أو تُجعَل مجهولة الهوية.
      </p>

      <h2>5. حقوقك</h2>
      <ul>
        <li>الوصول إلى بياناتك وتصحيحها.</li>
        <li>طلب حذف بياناتك (مع مراعاة الالتزامات القانونية).</li>
        <li>الاعتراض على معالجة معينة أو سحب موافقتك.</li>
        <li>طلب نسخة قابلة للنقل من بياناتك.</li>
        <li>تقديم شكوى إلى الجهة المختصة بحماية البيانات في بلدك.</li>
      </ul>
      <p>لممارسة هذه الحقوق، تواصل معنا عبر الدعم داخل اللعبة.</p>

      <h2>6. الأمان</h2>
      <p>
        نطبّق إجراءات تقنية وتنظيمية مناسبة (تشفير كلمات المرور، تشفير الاتصال HTTPS، التحكم في الصلاحيات،
        نسخ احتياطية) لحماية بياناتك من الوصول غير المصرّح به.
      </p>

      <h2>7. ملفات تعريف الارتباط (Cookies)</h2>
      <p>
        نستخدم كوكيز ضرورية لإبقائك مسجل الدخول وحفظ تفضيلاتك. لا نستخدم كوكيز إعلانية تابعة لأطراف ثالثة.
      </p>

      <h2>8. الأطفال</h2>
      <p>
        الخدمة غير موجهة للأطفال دون السن القانوني في بلدهم دون إذن وليّ الأمر. إذا علمنا بجمع بيانات قاصر
        دون إذن، سنقوم بحذفها.
      </p>

      <h2>9. تحديثات السياسة</h2>
      <p>
        قد نُحدّث هذه السياسة من وقت لآخر. التحديثات الجوهرية سنبلّغ عنها داخل اللعبة.
      </p>

      <h2>10. تواصل معنا</h2>
      <p>
        لأي استفسار بخصوص الخصوصية، تواصل معنا عبر دعم اللعبة، أو عبر{" "}
        <a href="https://paddle.net" target="_blank" rel="noopener noreferrer">paddle.net</a> للاستفسارات
        المتعلقة بالفواتير.
      </p>

      <hr style={{ margin: "2rem 0", opacity: 0.3 }} />

      <section dir="ltr" lang="en" style={{ textAlign: "left" }}>
        <h2>Privacy Policy for Molok Al-Qarasna</h2>
        <p><em>Last updated: June 2026</em></p>
        <p>
          Welcome to Molok Al-Qarasna ("we," "our," or "us"). We are committed to protecting your personal
          privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you
          play our game.
        </p>

        <h3>1. Information We Collect</h3>
        <ul>
          <li><strong>Account Information:</strong> When you create an account, we may store your username,
            email address, and game progress data.</li>
          <li><strong>Device Data:</strong> We may collect standard information such as your device type,
            operating system, and unique device identifiers to optimize game performance.</li>
        </ul>

        <h3>2. How We Use Your Information</h3>
        <p>
          We use the collected data strictly to maintain your game account, save your in-game progress,
          process secure payments, and provide customer support.
        </p>

        <h3>3. Third-Party Services</h3>
        <p>
          Our app links to secure payment providers and Google Play Services. We do not sell or share your
          personal data with unauthorized third parties.
        </p>

        <h3>4. Contact Us</h3>
        <p>
          If you have any questions about this Privacy Policy, please contact us through the in-game support,
          or visit{" "}
          <a href="https://www.molok-alqarasna.com" target="_blank" rel="noopener noreferrer">
            www.molok-alqarasna.com
          </a>.
        </p>
      </section>
    </LegalPage>
  );
}
