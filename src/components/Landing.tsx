import { Link } from "@tanstack/react-router";
import harborBg from "@/assets/harbor-bg.jpg";
import harborVideo from "@/assets/harbor-bg.mp4.asset.json";
import { SeamlessVideo } from "@/components/SeamlessVideo";

export function Landing() {
  return (
    <div className="relative min-h-screen text-amber-100" dir="rtl">
      {/* Live sea background */}
      <div className="fixed inset-0 -z-10 bg-stone-950">
        <SeamlessVideo
          src={harborVideo.url}
          poster={harborBg}
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(rgba(5,10,20,0.65), rgba(5,10,20,0.85))" }}
        />
      </div>

      <header className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <span className="text-2xl">⛵</span>
          <span className="text-xl font-bold text-amber-300">Ocean Catch</span>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link to="/pricing" className="hover:text-amber-300">الأسعار</Link>
          <Link to="/login" className="px-3 py-1.5 rounded-lg bg-amber-500 text-stone-900 font-semibold hover:bg-amber-400">دخول</Link>
        </nav>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-16 text-center">
        <h1 className="text-4xl sm:text-6xl font-bold text-amber-300 mb-4">Ocean Catch</h1>
        <p className="text-lg sm:text-2xl text-amber-100/90 mb-2">محاكي صيد بحري عربي</p>
        <p className="text-base sm:text-lg text-amber-100/70 max-w-2xl mx-auto mb-10">
          سجّل دخولك واركب البحر! ابنِ أسطولك من السفن، وظّف الطاقم، اصطد الأسماك النادرة،
          طوّر سفنك في السوق، وتنافس مع أصدقائك في عالم بحري حي.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 mb-16">
          <Link to="/signup" className="px-6 py-3 rounded-xl bg-amber-500 text-stone-900 font-bold text-lg hover:bg-amber-400">
            ابدأ مجاناً
          </Link>
          <Link to="/login" className="px-6 py-3 rounded-xl border border-amber-400/40 text-amber-200 font-semibold hover:bg-amber-400/10">
            لدي حساب
          </Link>
        </div>

        <section className="grid sm:grid-cols-3 gap-4 text-right mb-16">
          {[
            { icon: "⛵", title: "أسطول السفن", desc: "اشترِ سفناً متنوعة وطوّرها لزيادة الصيد." },
            { icon: "🐟", title: "صيد الأسماك", desc: "اكتشف عشرات الأنواع من الأسماك بقيم مختلفة." },
            { icon: "👥", title: "الطاقم والأصدقاء", desc: "وظّف طاقماً، وتفاعل مع لاعبين آخرين." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-amber-400/20 bg-stone-900/60 p-5">
              <div className="text-3xl mb-2">{f.icon}</div>
              <div className="font-bold text-amber-300 mb-1">{f.title}</div>
              <div className="text-sm text-amber-100/70">{f.desc}</div>
            </div>
          ))}
        </section>

        <section className="rounded-xl border border-amber-400/20 bg-stone-900/60 p-6 text-right">
          <h2 className="text-xl font-bold text-amber-300 mb-2">عمليات الدفع</h2>
          <p className="text-sm text-amber-100/80 leading-relaxed">
            عمليات الشراء داخل اللعبة تتم بأمان عبر مزوّد الدفع Paddle بصفته بائع التسجيل
            (Merchant of Record). جميع المعاملات مشفرة عبر HTTPS.
          </p>
        </section>
      </main>

      <footer className="border-t border-amber-400/10 py-6 mt-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-amber-100/70">
          <Link to="/pricing" className="hover:text-amber-300">الأسعار</Link>
          <span>·</span>
          <Link to="/terms" className="hover:text-amber-300">الشروط والأحكام</Link>
          <span>·</span>
          <Link to="/privacy" className="hover:text-amber-300">سياسة الخصوصية</Link>
          <span>·</span>
          <Link to="/refund" className="hover:text-amber-300">سياسة الاسترداد</Link>
        </div>
        <div className="text-center text-xs text-amber-100/40 mt-3">
          © {new Date().getFullYear()} Ocean Catch — Amira Qailan Dakhil Allah Alsharari
        </div>
      </footer>
    </div>
  );
}
