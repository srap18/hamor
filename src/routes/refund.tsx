import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";

export const Route = createFileRoute("/refund")({
  head: () => ({
    meta: [
      { title: "سياسة الاسترداد — ملوك القراصنة (هامور شابك)" },
      { name: "description", content: "ضمان استرداد المال خلال 14 يوماً لمشتريات لعبة ملوك القراصنة (هامور شابك) — بدون شروط." },
      { property: "og:title", content: "سياسة الاسترداد — ملوك القراصنة" },
      { property: "og:description", content: "استرداد خلال 14 يوماً في ملوك القراصنة (هامور شابك)." },
      { property: "og:url", content: "https://www.molok-alqarasna.com/refund" },
    ],
    links: [{ rel: "canonical", href: "https://www.molok-alqarasna.com/refund" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "سياسة الاسترداد — ملوك القراصنة",
          headline: "سياسة الاسترداد",
          url: "https://www.molok-alqarasna.com/refund",
          inLanguage: "ar",
          description: "ضمان استرداد كامل خلال 14 يوماً لمشتريات لعبة ملوك القراصنة (هامور شابك)، يُعالَج عبر Paddle.",
          publisher: { "@type": "Organization", name: "ملوك القراصنة", url: "https://www.molok-alqarasna.com/" },
        }),
      },
    ],
  }),
  component: RefundPage,
});


function RefundPage() {
  return (
    <LegalPage title="سياسة الاسترداد">
      <p>
        نحن في <strong>هامور شابك</strong> (المُشغَّلة من قبل <strong>Amira Qailan Dakhil Allah Alsharari</strong>)
        نقدّم <strong>ضمان استرداد كامل خلال 14 يومًا</strong> من تاريخ الشراء لأي سبب كان،
        <strong> بدون أي شروط أو استثناءات أو قيود</strong>.
      </p>

      <h2>1. مدة الاسترداد</h2>
      <p>
        يحقّ لك طلب استرداد كامل خلال <strong>14 يومًا على الأقل</strong> من تاريخ الشراء.
        لا توجد أي شروط، استثناءات، أو قيود على هذا الضمان — ينطبق على كل المنتجات والباقات والاشتراكات.
      </p>

      <h2>2. كيفية طلب الاسترداد</h2>
      <p>
        تختلف طريقة طلب الاسترداد بحسب المنصّة التي اشتريت منها:
      </p>
      <ul>
        <li>
          <strong>الشراء عبر الويب (Paddle)</strong>: ادخل إلى{" "}
          <a href="https://paddle.net" target="_blank" rel="noopener noreferrer">paddle.net</a> وأدخل بريدك
          الإلكتروني المستخدم في الشراء، أو تواصل مع دعم اللعبة وسنحوّل طلبك إلى Paddle (تاجر التسجيل / Merchant of Record).
        </li>
        <li>
          <strong>الشراء داخل تطبيق Android (Google Play)</strong>: تتم الاستردادات عبر متجر Google Play من
          خلال <a href="https://play.google.com/store/account/orderhistory" target="_blank" rel="noopener noreferrer">سجل
          الطلبات</a>، أو تواصل مع دعم Google Play. تخضع المشتريات لسياسة استرداد Google Play.
        </li>
        <li>
          <strong>الشراء داخل تطبيق iPhone / iPad (Apple)</strong>: تتم الاستردادات عبر Apple من{" "}
          <a href="https://reportaproblem.apple.com" target="_blank" rel="noopener noreferrer">reportaproblem.apple.com</a>.
          تخضع المشتريات لسياسة استرداد Apple.
        </li>
      </ul>
      <p>
        تتم معالجة الاسترداد عادة خلال 5 إلى 10 أيام عمل وتُعاد المبالغ إلى وسيلة الدفع الأصلية.
      </p>

      <h2>3. اشتراكات VIP</h2>
      <p>
        يمكنك إلغاء اشتراك VIP في أي وقت، وطلب استرداد كامل خلال الـ14 يومًا من تاريخ السحب
        بدون أي شروط.
      </p>

      <h2>4. تواصل معنا</h2>
      <p>
        لأي استفسار بخصوص الاسترداد، تواصل عبر{" "}
        <a href="https://paddle.net" target="_blank" rel="noopener noreferrer">paddle.net</a> أو دعم اللعبة.
      </p>
    </LegalPage>
  );
}
