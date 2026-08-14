import { sound } from "@/lib/sound";

type Section = { title: string; icon: string; tone: "mute" | "ban" | "info"; items: string[] };

const SECTIONS: Section[] = [
  {
    title: "مخالفات تؤدي إلى الكتم (منع الكتابة في الشات)",
    icon: "🔇",
    tone: "mute",
    items: [
      "السب أو الشتم أو الألفاظ النابية بأي صيغة (مباشرة أو مموّهة بالرموز والحروف).",
      "الإساءة الشخصية، التنمّر، السخرية من الشكل أو اللهجة أو المستوى داخل اللعبة.",
      "الإساءة للأديان أو المذاهب أو الأعراق أو الجنسيات أو القبائل أو الدول.",
      "الكلام المخل بالحياء أو الإيحاءات الجنسية أو مشاركة محتوى غير لائق (صور/صوت/روابط).",
      "التحرش بأي لاعب أو ملاحقته برسائل خاصة بعد رفضه.",
      "التهديد أو الوعيد أو تمنّي الأذى للآخرين.",
      "الإزعاج المتكرر: تكرار نفس الرسالة، إغراق الشات، الكتابة بأحرف كبيرة/رموز بشكل مزعج.",
      "الإعلان أو الترويج لألعاب أو مجموعات أو حسابات أو مواقع خارجية.",
      "بيع أو شراء أو تبادل الحسابات والعملات خارج اللعبة.",
      "انتحال شخصية مشرف أو إدارة أو لاعب آخر.",
      "نشر معلومات شخصية لأي لاعب (رقم، بريد، صور، موقع) بدون إذنه.",
      "شتم أو استفزاز أو تحقير المشرفين والإدارة، أو التشكيك بقراراتهم بأسلوب مسيء.",
      "التلفّظ على اللعبة أو النظام أو سياساتها بأسلوب مسيء أو تحريضي.",
    ],
  },
  {
    title: "مخالفات تؤدي إلى الحظر (إيقاف الحساب)",
    icon: "⛔",
    tone: "ban",
    items: [
      "تكرار مخالفات الكتم بعد التحذير أو بعد انتهاء مدة الكتم.",
      "الحسابات الوهمية أو المتعددة لاستغلال المكافآت أو الفعاليات أو الدعوات.",
      "استخدام برامج غش أو تعديل التطبيق أو أدوات أتمتة (بوتات) أو تعديل وقت الجهاز.",
      "استغلال ثغرة أو خلل في اللعبة بدل الإبلاغ عنها للدعم.",
      "الاحتيال أو النصب في المقايضة أو الشحن أو الوعود المالية بين اللاعبين.",
      "الشحن الاحتيالي أو استرجاع المدفوعات (Chargeback) بعد استلام المنتجات.",
      "بيع/شراء/مشاركة الحسابات أو تسريب حساب لاعب آخر أو محاولة اختراقه.",
      "تجاوز الكتم أو الحظر عبر حساب آخر أو جهاز آخر.",
      "التهديد الجاد، الابتزاز، أو نشر محتوى مخل أو مخالف للقانون.",
      "الإساءة الجسيمة أو المستمرة للمشرفين أو الإدارة أو التحريض ضد اللعبة.",
    ],
  },
  {
    title: "كيف تُطبَّق العقوبة",
    icon: "⚖️",
    tone: "info",
    items: [
      "التدرّج المعتاد: تحذير ← كتم مؤقت ← كتم طويل ← حظر مؤقت ← حظر نهائي.",
      "المخالفات الجسيمة (غش، احتيال، محتوى مخل، تهديد) تُعاقب بالحظر مباشرة بدون تحذير.",
      "العقوبة قد تشمل الحساب والجهاز والاتصال معًا لمنع الالتفاف عليها.",
      "قرارات الإدارة تعتمد على السجلات والأدلة داخل النظام، ولا تُلغى بالمجاملة.",
      "لا تُسترجع المشتريات أو العملات أو المستوى عند الحظر بسبب مخالفة.",
    ],
  },
  {
    title: "الاعتراض على العقوبة",
    icon: "🛟",
    tone: "info",
    items: [
      "افتح تذكرة عبر «الدعم الفني» واذكر اسم حسابك ووقت الحادثة.",
      "الاعتراض بأسلوب محترم يُدرس، والإساءة داخل التذكرة تُغلقها فورًا.",
      "إذا ثبت وجود خطأ من النظام تُرفع العقوبة ويُعاد الحساب كما كان.",
    ],
  },
];

const TONE: Record<Section["tone"], string> = {
  mute: "from-amber-500/15 to-transparent border-amber-400/40 text-amber-100",
  ban: "from-rose-600/15 to-transparent border-rose-400/40 text-rose-100",
  info: "from-sky-500/15 to-transparent border-sky-400/40 text-sky-100",
};

export function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3"
      onClick={onClose}
      dir="rtl"
    >
      <div
        className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-2xl border border-amber-400/40 bg-stone-950/95 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center mb-3">
          <div className="text-2xl">📜</div>
          <h2 className="text-base font-extrabold text-amber-200">بنود الحظر والكتم</h2>
          <p className="text-[11px] text-amber-100/70 leading-snug mt-1">
            الالتزام بهذه البنود شرط لاستخدام اللعبة والشات. الجهل بالبنود ليس عذرًا.
          </p>
        </div>

        <div className="space-y-3">
          {SECTIONS.map((sec) => (
            <div
              key={sec.title}
              className={`rounded-xl border bg-gradient-to-b p-3 ${TONE[sec.tone]}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg leading-none">{sec.icon}</span>
                <h3 className="text-[13px] font-bold">{sec.title}</h3>
              </div>
              <ul className="space-y-1.5">
                {sec.items.map((it) => (
                  <li key={it} className="flex gap-1.5 text-[11px] leading-relaxed opacity-95">
                    <span className="opacity-60">•</span>
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-3 text-[11px] leading-relaxed text-stone-300">
          احترم الجميع، والعب بشرف ⚓ — الشات مساحة مشتركة للكل، وأي إساءة تفسدها على بقية اللاعبين.
        </div>

        <button
          className="mt-4 w-full py-2.5 rounded-lg bg-gradient-to-b from-amber-500 to-amber-700 text-white text-sm font-bold active:scale-95"
          onClick={() => { sound.play("click"); onClose(); }}
        >
          فهمت وأوافق
        </button>
      </div>
    </div>
  );
}
