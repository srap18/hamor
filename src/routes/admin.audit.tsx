import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/audit")({
  component: AdminAudit,
  ssr: false,
});

type Entry = {
  id: string;
  admin_id: string;
  action: string;
  target_user_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

function AdminAudit() {
  const [list, setList] = useState<Entry[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("admin_audit").select("*").order("created_at", { ascending: false }).limit(200);
      setList((data ?? []) as Entry[]);
    })();
  }, []);

  return (
    <div className="p-3 md:p-6">
      <h1 className="text-xl md:text-2xl font-bold mb-1">سجل عمليات الأدمن</h1>
      <p className="text-slate-400 text-xs md:text-sm mb-4 md:mb-6">آخر 200 عملية</p>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">

          <thead className="bg-slate-800/60">
            <tr>
              <th className="text-right p-3">الوقت</th>
              <th className="text-right p-3">العملية</th>
              <th className="text-right p-3">الهدف</th>
              <th className="text-right p-3">التفاصيل</th>
            </tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id} className="border-t border-slate-800/50">
                <td className="p-3 text-xs text-slate-400 whitespace-nowrap">{new Date(e.created_at).toLocaleString("ar")}</td>
                <td className="p-3"><span className="px-2 py-0.5 rounded text-xs bg-indigo-600/30 text-indigo-200">{e.action}</span></td>
                <td className="p-3 font-mono text-xs text-slate-400">{e.target_user_id?.slice(0, 8) ?? "—"}</td>
                <td className="p-3 text-xs text-slate-300"><pre className="whitespace-pre-wrap font-mono">{JSON.stringify(e.details, null, 0)}</pre></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-slate-500">لا توجد عمليات بعد</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
