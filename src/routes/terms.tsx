import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "الشروط والأحكام — ملوك القراصنة (هامور شابك)" },
      { name: "description", content: "الشروط والأحكام لاستخدام لعبة ملوك القراصنة (هامور شابك) — حقوق وواجبات اللاعبين." },
      { property: "og:title", content: "الشروط والأحكام — ملوك القراصنة" },
      { property: "og:description", content: "شروط استخدام لعبة ملوك القراصنة (هامور شابك)." },
      { property: "og:url", content: "https://www.molok-alqarasna.com/terms" },
    ],
    links: [{ rel: "canonical", href: "https://www.molok-alqarasna.com/terms" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "الشروط والأحكام — ملوك القراصنة",
          headline: "الشروط والأحكام",
          url: "https://www.molok-alqarasna.com/terms",
          inLanguage: "ar",
          description: "الشروط والأحكام التي تحكم استخدام لعبة ملوك القراصنة (هامور شابك).",
          publisher: { "@type": "Organization", name: "ملوك القراصنة", url: "https://www.molok-alqarasna.com/" },
        }),
      },
    ],
  }),
  component: TermsPage,
});


function TermsPage() {
  return (
    <LegalPage title="الشروط والأحكام">
      <p>
        مرحبًا بك في لعبة <strong>هامور شابك</strong> (يشار إليها بـ"الخدمة"). الخدمة مقدّمة من قبل
        <strong> Amira Qailan Dakhil Allah Alsharari</strong> ("نحن" أو "البائع"). باستخدامك للخدمة فأنت توافق
        على هذه الشروط والأحكام.
      </p>

      <h2>1. القبول والأهلية</h2>
      <p>
        باستخدامك المستمر للخدمة فأنت تقرّ بأنك قرأت هذه الشروط ووافقت عليها، وأنك بلغت السن القانوني في بلدك،
        أو أن لديك إذن وليّ أمرك.
      </p>

      <h2>2. وصف الخدمة</h2>
      <p>
        هامور شابك لعبة صيد ومنافسة عبر الإنترنت تتيح للاعبين شراء عناصر افتراضية مثل الجواهر، العملات،
        الياقوت، الدروع، واشتراك VIP.
      </p>

      <h2>3. الاستخدام الممنوع</h2>
      <ul>
        <li>أي استخدام غير قانوني أو احتيالي.</li>
        <li>الإزعاج، السبام، أو انتهاك حقوق الملكية الفكرية.</li>
        <li>محاولة اختراق الخدمة، تشغيل برمجيات خبيثة، فحص أمني، أو استخراج بيانات (scraping) دون إذن.</li>
        <li>استخدام برامج غش أو بوتات أو حسابات وهمية.</li>
      </ul>

      <h2>4. الملكية الفكرية</h2>
      <p>
        جميع حقوق الملكية الفكرية في الخدمة (البرمجيات، الرسوم، الشعارات، التصاميم) مملوكة لنا أو لمرخّصينا.
        لا يُمنح المستخدم سوى ترخيص محدود وغير حصري وغير قابل للنقل لاستخدام الخدمة شخصيًا.
      </p>

      <h2>5. مستوى الخدمة</h2>
      <p>
        نسعى لتقديم خدمة موثوقة، لكننا لا نضمن أن تكون الخدمة متاحة دون انقطاع أو خالية من الأخطاء.
      </p>

      <h2>6. الدفع والاشتراكات</h2>
      <p>
        تتم معالجة جميع عمليات الدفع عبر شريكنا <strong>Paddle</strong>. للاطلاع على شروط الدفع وضريبة القيمة
        المضافة والفوترة، يُرجى مراجعة{" "}
        <a href="https://www.paddle.com/legal/checkout-buyer-terms" target="_blank" rel="noopener noreferrer">
          شروط Paddle للمشتري
        </a>
        . تجدّد اشتراكات VIP تلقائيًا شهريًا حتى يتم إلغاؤها. عند إلغاء اشتراك VIP يتم إيقاف مزاياه فورًا
        (الجواهر الممنوحة مع الاشتراك تبقى للاعب).
      </p>

      <h2>7. تاجر التسجيل (Merchant of Record)</h2>
      <p>
        تتم عملية الشراء عبر بائعنا الإلكتروني <strong>Paddle.com</strong>. <strong>Paddle.com</strong> هو
        تاجر التسجيل (Merchant of Record) لجميع الطلبات، ويقدّم خدمة العملاء فيما يخص الفواتير، ويتولّى
        طلبات الاسترداد.
      </p>

      <h2>8. تعليق الحساب أو إنهاؤه</h2>
      <p>
        يحق لنا تعليق أو إنهاء وصولك للخدمة في حال: الإخلال الجوهري بهذه الشروط، عدم الدفع، الاشتباه في
        احتيال أو مخاطر أمنية، أو الانتهاكات المتكررة لسياساتنا. لن تكون مستحقًا لأي استرداد للعناصر
        الافتراضية في حال الإنهاء بسبب انتهاكك.
      </p>

      <h2>9. العناصر الافتراضية</h2>
      <p>
        جميع العناصر داخل اللعبة (جواهر، عملات، دروع، VIP، وغيرها) ليست لها قيمة نقدية حقيقية ولا يمكن
        تحويلها أو بيعها أو استبدالها بنقد خارج اللعبة.
      </p>

      <h2>10. إخلاء المسؤولية وحدودها</h2>
      <p>
        تُقدَّم الخدمة "كما هي" دون أي ضمانات. لا نتحمل المسؤولية عن أي أضرار غير مباشرة أو تبعية أو فقدان
        أرباح، باستثناء ما يحظر القانون استبعاده.
      </p>

      <h2>11. القانون الحاكم</h2>
      <p>
        تخضع هذه الشروط لقوانين المملكة العربية السعودية، وأي نزاع يُحال إلى المحاكم المختصة فيها.
      </p>

      <h2>12. سياسة الاستخدام المقبول (Acceptable Use)</h2>
      <p>
        التزاماً بسياسات شريكنا للدفع <strong>Paddle</strong>
        (<a href="https://www.paddle.com/legal/terms" target="_blank" rel="noopener noreferrer">شروط Paddle</a>{" "}
        و<a href="https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle" target="_blank" rel="noopener noreferrer">قائمة المنتجات الممنوعة</a>)،
        فإننا لا نبيع ولا نسمح باستخدام الخدمة في أيٍّ مما يلي:
      </p>
      <ul>
        <li>القمار، الرهانات، اليانصيب، أو أي ألعاب ذات جوائز نقدية حقيقية.</li>
        <li>تداول العملات الرقمية، NFTs، أو أي أصول مالية أو استثمارية.</li>
        <li>بيع أو تحويل العناصر داخل اللعبة أو الحسابات مقابل نقد حقيقي خارج المنصة (RMT).</li>
        <li>المحتوى الإباحي أو الموجّه للبالغين، التبغ، الكحول، الأسلحة، أو المواد الخاضعة للرقابة.</li>
        <li>المحتوى الذي يحرّض على الكراهية، العنف، أو يستهدف القاصرين.</li>
        <li>المنتجات المقلّدة، المسروقة، أو التي تنتهك حقوق الملكية الفكرية.</li>
        <li>الخدمات المالية، الطبية، أو القانونية الخاضعة للترخيص.</li>
        <li>أي نشاط غير قانوني في بلد البائع أو المشتري.</li>
      </ul>
      <p>
        الخدمة هي <strong>لعبة ترفيهية فقط</strong>؛ جميع المشتريات عبارة عن <strong>عناصر افتراضية</strong>{" "}
        (جواهر، عملات لعبة، دروع، اشتراك VIP) تُستخدم داخل اللعبة فقط، ولا تمثّل استثماراً ولا قيمة نقدية
        قابلة للسحب.
      </p>

      <h2>13. تواصل معنا</h2>
      <p>
        البائع: <strong>Amira Qailan Dakhil Allah Alsharari</strong> — المملكة العربية السعودية.<br />
        للاستفسارات: دعم اللعبة داخل التطبيق، أو{" "}
        <a href="https://paddle.net" target="_blank" rel="noopener noreferrer">paddle.net</a> للفواتير والاسترداد.
      </p>

      <hr style={{ margin: "2rem 0", opacity: 0.3 }} />

      <section dir="ltr" lang="en" style={{ textAlign: "left" }}>
        <h2>Terms &amp; Conditions (English Summary)</h2>
        <p>
          <strong>Molok Al-Qarasna / Hamour Shabek</strong> is an online entertainment game operated by
          <strong> Amira Qailan Dakhil Allah Alsharari</strong> (the "Seller"). By using the Service you
          agree to these Terms.
        </p>
        <h3>Product</h3>
        <p>
          We sell <strong>virtual in-game items only</strong> (gems, coins, shields, cosmetics, VIP
          subscription). Items have no real-world monetary value and cannot be exchanged for cash, traded
          for fiat, or withdrawn.
        </p>
        <h3>Merchant of Record</h3>
        <p>
          Our order process is conducted by our online reseller <strong>Paddle.com</strong>. Paddle.com is
          the Merchant of Record for all our orders. Paddle provides all customer service inquiries and
          handles returns. See{" "}
          <a href="https://www.paddle.com/legal/checkout-buyer-terms" target="_blank" rel="noopener noreferrer">
            Paddle Buyer Terms
          </a>.
        </p>
        <h3>Acceptable Use — What We Do NOT Sell</h3>
        <p>
          In compliance with{" "}
          <a href="https://www.paddle.com/legal/terms" target="_blank" rel="noopener noreferrer">Paddle's Terms</a>{" "}
          and{" "}
          <a href="https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle" target="_blank" rel="noopener noreferrer">
            Restricted Products list
          </a>, we do not sell or facilitate:
        </p>
        <ul>
          <li>Gambling, betting, lotteries, or real-money gaming with cash prizes.</li>
          <li>Cryptocurrency, NFTs, tokens, securities, or investment products.</li>
          <li>Real-money trading (RMT) of in-game items or accounts.</li>
          <li>Adult / pornographic content, tobacco, alcohol, weapons, controlled substances.</li>
          <li>Hate speech, violence, or content targeting minors.</li>
          <li>Counterfeit, stolen, or IP-infringing goods.</li>
          <li>Regulated financial, medical, or legal services.</li>
          <li>Any activity unlawful in the seller's or buyer's jurisdiction.</li>
        </ul>
        <h3>Refunds</h3>
        <p>
          14-day money-back guarantee with no conditions. Refunds are processed by Paddle. Request via{" "}
          <a href="https://paddle.net" target="_blank" rel="noopener noreferrer">paddle.net</a>.
        </p>
        <h3>Subscriptions</h3>
        <p>
          VIP subscriptions auto-renew monthly until cancelled. Cancel anytime from in-game settings or via
          paddle.net.
        </p>
        <h3>Account Suspension</h3>
        <p>
          We may suspend accounts for: cheating/botting, fraud, chargebacks, RMT, harassment, or breach of
          these Terms.
        </p>
        <h3>Contact</h3>
        <p>
          Seller: Amira Qailan Dakhil Allah Alsharari, Saudi Arabia. Support: in-game support, or{" "}
          <a href="https://paddle.net" target="_blank" rel="noopener noreferrer">paddle.net</a> for billing.
        </p>
      </section>
    </LegalPage>
  );
}
