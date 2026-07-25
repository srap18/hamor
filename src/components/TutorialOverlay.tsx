import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile, refreshProfile } from "@/hooks/use-auth";

type Step = {
  title: string;
  body: string;
  icon: string;
};

const STEPS: Step[] = [
  {
    icon: "👋",
    title: "أهلاً بك في ملوك القراصنة!",
    body: "هذا شرح سريع لأهم ما تحتاج معرفته للبدء. تقدر تتخطاه في أي وقت.",
  },
  {
    icon: "🎣",
    title: "ابدأ الصيد",
    body: "سفينتك الأولى تصيد السمك تلقائياً. اضغط على السفينة لجمع الصيد بمجرد امتلاء المخزن.",
  },
  {
    icon: "🐟",
    title: "اختيار نوع السمك",
    body: "اضغط على السفينة ثم على «تغيير نوع الصيد» لاختيار السمكة التي تريد اصطيادها من الأنواع المتاحة لمستوى السفينة.",
  },
  {
    icon: "💰",
    title: "بيع السمك",
    body: "افتح «سوق السمك» من المبنى الظاهر على الخلفية أو من الشريط السفلي، ثم بع صيدك مقابل الذهب.",
  },
  {
    icon: "🚢",
    title: "شراء سفينة جديدة",
    body: "افتح «سوق السفن» لشراء قوارب وسفن إضافية. كل سفينة أعلى تصيد أنواع أفضل وتربح أكثر.",
  },
  {
    icon: "⚓",
    title: "إدارة الأسطول",
    body: "اضغط على أي سفينة في البحر لإدارتها: ترقية، تغيير الصيد، البيع، أو نقلها. تقدر تحرك المخازن والمباني بلمسة مطولة.",
  },
  {
    icon: "🏆",
    title: "هدفك",
    body: "طوّر أسطولك، وارفع مستوى السوق، وانضم لقبيلة، وشارك في المعارك والفعاليات لتصبح من ملوك القراصنة!",
  },
];

export function TutorialOverlay() {
  const { profile, loading } = useProfile();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const shouldShow =
    !loading &&
    !!profile &&
    (profile as any).tutorial_completed === false &&
    !dismissed;

  useEffect(() => {
    if (shouldShow) setStep(0);
  }, [shouldShow]);

  if (!shouldShow) return null;

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    setDismissed(true);
    try {
      await (supabase as any).rpc("complete_tutorial");
    } catch {}
    try { await refreshProfile(); } catch {}
    setBusy(false);
  };

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-4 animate-fade-in"
      dir="rtl"
      style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)" }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-stone-950/95 border-2 border-amber-500/70 shadow-2xl p-5 text-white animate-scale-in">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] text-amber-200/80">
            الخطوة {step + 1} من {STEPS.length}
          </div>
          <button
            onClick={finish}
            disabled={busy}
            className="text-[11px] text-amber-100/70 hover:text-amber-200 underline"
          >
            تخطي الشرح
          </button>
        </div>

        <div className="flex flex-col items-center text-center gap-2 py-2">
          <div className="text-5xl">{current.icon}</div>
          <div className="text-lg font-extrabold text-amber-300">{current.title}</div>
          <div className="text-sm text-amber-100/90 leading-relaxed">{current.body}</div>
        </div>

        <div className="flex items-center gap-1 justify-center my-3">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-6 bg-amber-400" : "w-1.5 bg-amber-100/25"
              }`}
            />
          ))}
        </div>

        <div className="flex gap-2 mt-3">
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="flex-1 py-2 rounded-lg bg-stone-800 border border-amber-700/40 text-amber-100 text-sm font-bold active:scale-95"
            >
              السابق
            </button>
          )}
          <button
            onClick={() => (isLast ? finish() : setStep((s) => s + 1))}
            disabled={busy}
            className="flex-1 py-2 rounded-lg bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 text-sm font-extrabold active:scale-95 disabled:opacity-60"
          >
            {isLast ? "ابدأ اللعب 🚀" : "التالي ←"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TutorialOverlay;
