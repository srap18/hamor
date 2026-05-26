import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen text-amber-50" dir="rtl" style={{
      background: "radial-gradient(ellipse at top, #0c4a6e 0%, #082f49 55%, #020617 100%)",
    }}>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <Link to="/" className="text-amber-300 text-sm">← الرئيسية</Link>
          <div className="text-xs text-amber-100/60">
            <Link to="/terms" className="hover:text-amber-300">الشروط</Link> ·{" "}
            <Link to="/privacy" className="hover:text-amber-300">الخصوصية</Link> ·{" "}
            <Link to="/refund" className="hover:text-amber-300">الاسترداد</Link> ·{" "}
            <Link to="/pricing" className="hover:text-amber-300">الأسعار</Link>
          </div>
        </div>
        <h1 className="text-2xl font-extrabold text-amber-300 mb-6">{title}</h1>
        <div className="prose prose-invert max-w-none text-amber-50/90 text-sm leading-7 space-y-4 [&_h2]:text-amber-200 [&_h2]:font-bold [&_h2]:text-lg [&_h2]:mt-6 [&_a]:text-amber-300 [&_ul]:list-disc [&_ul]:pr-5 [&_ul]:space-y-1">
          {children}
        </div>
        <div className="mt-8 text-xs text-amber-100/50">آخر تحديث: 26 مايو 2026</div>
      </div>
    </div>
  );
}
