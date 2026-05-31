import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";

export const Route = createFileRoute("/refund")({
  head: () => ({
    meta: [
      { title: "سياسة الاسترداد — هامور شابك" },
      { name: "description", content: "ضمان استرداد المال خلال 14 يومًا لمشتريات هامور شابك دون أي شروط." },
      { property: "og:title", content: "سياسة الاسترداد — هامور شابك" },
      { property: "og:description", content: "ضمان استرداد المال خلال 14 يومًا لمشتريات هامور شابك دون أي شروط." },
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
        تتم معالجة المدفوعات والاستردادات عبر شريكنا <strong>Paddle</strong> (تاجر التسجيل / Merchant of Record). لطلب الاسترداد:
      </p>
      <ul>
        <li>
          ادخل إلى{" "}
          <a href="https://paddle.net" target="_blank" rel="noopener noreferrer">paddle.net</a> وأدخل بريدك
          الإلكتروني المستخدم في الشراء.
        </li>
        <li>أو تواصل مع دعم اللعبة من داخل التطبيق وسنحوّل طلبك إلى Paddle.</li>
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
