import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { sound } from "@/lib/sound";

type Notif = {
  id: string;
  title: string;
  body: string;
  kind: string;
  recipient_id: string | null;
  created_at: string;
};

export function NotificationsBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!user) return;
    const [{ data: ns }, { data: rs }] = await Promise.all([
      supabase.from("notifications").select("*")
        .or(`recipient_id.eq.${user.id},recipient_id.is.null`)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("notification_reads").select("notification_id").eq("user_id", user.id),
    ]);
    setItems((ns || []) as Notif[]);
    setReadIds(new Set((rs || []).map((r: any) => r.notification_id)));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase
      .channel(`notifs:${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, (payload) => {
        const n = payload.new as Notif;
        if (n.kind === "nuke") return; // skip nuke alerts; shown via GlobalBanner
        if (n.recipient_id === null || n.recipient_id === user.id) {
          setItems(s => [n, ...s].slice(0, 30));
          sound.play("click");
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, load]);

  const unread = items.filter(i => !readIds.has(i.id)).length;

  const markAllRead = async () => {
    if (!user) return;
    const toAdd = items.filter(i => !readIds.has(i.id));
    if (!toAdd.length) return;
    const rows = toAdd.map(i => ({ user_id: user.id, notification_id: i.id }));
    await supabase.from("notification_reads").insert(rows);
    setReadIds(new Set([...readIds, ...toAdd.map(i => i.id)]));
  };

  const toggle = () => {
    sound.play("click");
    setOpen(o => {
      const next = !o;
      if (next) setTimeout(markAllRead, 800);
      return next;
    });
  };

  const iconFor = (kind: string) =>
    kind === "nuke" ? "☢️" : kind === "attack" ? "⚔️" : kind === "support" ? "🛠️" : kind === "ship" ? "⛵" : kind === "friend" ? "🤝" : "📢";

  return (
    <>
      <button
        onClick={toggle}
        className="relative w-10 h-10 rounded-xl border-2 border-amber-300 bg-gradient-to-b from-amber-600 to-amber-900 flex items-center justify-center text-lg shadow active:scale-95"
        aria-label="إشعارات"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center border border-amber-100">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[55]" onClick={() => setOpen(false)}>
          <div
            className="absolute top-20 right-2 left-2 max-w-sm mx-auto max-h-[70vh] overflow-y-auto rounded-2xl border-2 border-amber-400/80 bg-stone-950/95 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div className="sticky top-0 bg-amber-900/95 border-b border-amber-400/60 p-3 flex items-center justify-between">
              <div className="text-amber-100 font-extrabold">🔔 الإشعارات</div>
              <button onClick={() => setOpen(false)} className="text-amber-200 px-2">✕</button>
            </div>
            {items.length === 0 ? (
              <div className="p-6 text-center text-amber-300/60 text-sm">لا توجد إشعارات بعد</div>
            ) : (
              <div className="divide-y divide-amber-800/30">
                {items.map(n => {
                  const isRead = readIds.has(n.id);
                  return (
                    <div key={n.id} className={`p-3 flex gap-2 ${isRead ? "opacity-60" : "bg-amber-900/15"}`}>
                      <div className="text-xl">{iconFor(n.kind)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-amber-100">{n.title}</div>
                        {n.body && <div className="text-xs text-amber-200/80 mt-0.5">{n.body}</div>}
                        <div className="text-[10px] text-amber-400/50 mt-1">{new Date(n.created_at).toLocaleString("ar")}</div>
                      </div>
                      {!isRead && <span className="w-2 h-2 mt-2 rounded-full bg-red-500 shrink-0" />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
