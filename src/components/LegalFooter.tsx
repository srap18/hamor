import { Link } from "@tanstack/react-router";

export function LegalFooter() {
  return (
    <div className="mt-4 text-center text-[11px] text-amber-100/60 flex flex-wrap justify-center gap-x-3 gap-y-1" dir="rtl">
      <Link to="/pricing" className="hover:text-amber-300">الأسعار</Link>
      <span>·</span>
      <Link to="/terms" className="hover:text-amber-300">الشروط</Link>
      <span>·</span>
      <Link to="/privacy" className="hover:text-amber-300">الخصوصية</Link>
      <span>·</span>
      <Link to="/refund" className="hover:text-amber-300">سياسة الاسترداد</Link>
    </div>
  );
}
