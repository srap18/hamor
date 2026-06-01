import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/anti-cheat")({
  component: AntiCheatPage,
  ssr: false,
});

type Flag = {
  id: string;
  user_id: string;
  kind: string;
  severity: number;
  details: any;
  resolved: boolean;
  created_at: string;
  display_name?: string;
};

type Link = {
  id: string;
  user_a: string;
  user_b: string;
  link_type: string;
  details: any;
  created_at: string;
};

function AntiCheatPage() {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("cheat_flags").select("*").order("created_at", { ascending: false }).limit(200);
    if (!showResolved) q = q.eq("resolved", false);
    const [{ data: rawFlags }, { data: rawLinks }] = await Promise.all([
      q,
      supabase.from("account_links").select("*").order("created_at", { ascending: false }).limit(100),
    ]);
    const ids = Array.from(new Set((rawFlags ?? []).map((f: any) => f.user_id)));
    const namesMap = new Map<string, string>();
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, display_name").in("id", ids);
      (profs ?? []).forEach((p: any) => namesMap.set(p.id, p.display_name));
    }
    setFlags((rawFlags ?? []).map((f: any) => ({ ...f, display_name: namesMap.get(f.user_id) })));
    setLinks((rawLinks ?? []) as Link[]);
    setLoading(false);
  }, [showResolved]);

  useEffect(() => { void load(); }, [load]);

  const resolveFlag = async (id: string) => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("cheat_flags")
      .update({ resolved: true, resolved_by: u.user?.id ?? null, resolved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error("فشل التحديث: " + error.message);
    else { toast.success("تم"); void load(); }
  };

  const banUser = async (userId: string) => {
    if (!confirm("تأكيد حظر دائم لهذا اللاعب؟")) return;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("bans")
      .insert({ user_id: userId, reason: "manual: confirmed cheat", active: true, banned_by: u.user?.id });
    if (error) toast.error("فشل الحظر: " + error.message);
    else toast.success("تم الحظر");
  };

  return (
    <div className="min-h-screen p-4 md:p-6 bg-background text-foreground" dir="rtl">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">🛡️ مكافحة الغش</h1>
          <Link to="/admin" className="text-sm text-primary hover:underline">← لوحة الأدمن</Link>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            عرض المحلولة
          </label>
          <button onClick={() => void load()} className="text-sm px-3 py-1 rounded-lg border border-border hover:bg-muted">
            تحديث
          </button>
        </div>

        <section>
          <h2 className="text-lg font-semibold mb-2">🚩 حالات الشذوذ ({flags.length})</h2>
          {loading ? (
            <div className="text-sm text-muted-foreground">جارٍ التحميل…</div>
          ) : flags.length === 0 ? (
            <div className="text-sm text-muted-foreground">لا توجد حالات.</div>
          ) : (
            <div className="space-y-2">
              {flags.map((f) => (
                <div key={f.id} className="rounded-xl border border-border p-3 flex flex-col md:flex-row gap-2 md:items-center justify-between">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{f.display_name ?? f.user_id.slice(0, 8)}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-destructive/20 text-destructive">{f.kind}</span>
                      <span className="text-xs text-muted-foreground">شدة {f.severity}</span>
                      {f.resolved && <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-500">محلولة</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{new Date(f.created_at).toLocaleString("ar")}</div>
                    {f.details && Object.keys(f.details).length > 0 && (
                      <pre className="text-[10px] text-muted-foreground bg-muted/30 p-2 rounded overflow-x-auto">
                        {JSON.stringify(f.details, null, 2)}
                      </pre>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {!f.resolved && (
                      <button onClick={() => void resolveFlag(f.id)} className="text-xs px-3 py-1 rounded-lg border border-border hover:bg-muted">
                        خطأ إيجابي
                      </button>
                    )}
                    <button onClick={() => void banUser(f.user_id)} className="text-xs px-3 py-1 rounded-lg bg-destructive text-destructive-foreground hover:opacity-90">
                      حظر
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">🔗 حسابات مرتبطة ({links.length})</h2>
          {links.length === 0 ? (
            <div className="text-sm text-muted-foreground">لا توجد روابط.</div>
          ) : (
            <div className="space-y-2">
              {links.map((l) => (
                <div key={l.id} className="rounded-xl border border-border p-3 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs">{l.user_a.slice(0, 8)}</span>
                    <span>↔</span>
                    <span className="font-mono text-xs">{l.user_b.slice(0, 8)}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-500">{l.link_type}</span>
                    <span className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString("ar")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
