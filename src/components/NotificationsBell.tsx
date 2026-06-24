import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { sound } from "@/lib/sound";
import { getProfilesPublic, type PublicProfile } from "@/lib/profiles-public";


type Notif = {
  id: string;
  title: string;
  body: string;
  kind: string;
  recipient_id: string | null;
  created_by: string | null;
  created_at: string;
};

type TabKey = "all" | "attack" | "support" | "ship" | "friend" | "info";
const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "all", label: "الكل", icon: "📋" },
  { key: "attack", label: "هجمات", icon: "⚔️" },
  { key: "support", label: "دعم", icon: "🛠️" },
  { key: "ship", label: "سفن", icon: "⛵" },
  { key: "friend", label: "أصدقاء", icon: "🤝" },
  { key: "info", label: "إعلانات", icon: "📢" },
];

export function NotificationsBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<TabKey>("all");
  const [actors, setActors] = useState<Record<string, PublicProfile>>({});

  const loadActors = useCallback(async (notifs: Notif[]) => {
    const ids = Array.from(new Set(notifs.map(n => n.created_by).filter((x): x is string => !!x)));
    const missing = ids.filter(id => !actors[id]);
    if (!missing.length) return;
    const profs = await getProfilesPublic(missing);
    setActors(prev => {
      const next = { ...prev };
      for (const p of profs) next[p.id] = p;
      return next;
    });
  }, [actors]);

  const load = useCallback(async () => {
    if (!user) return;
    const [{ data: ns }, { data: rs }] = await Promise.all([
      supabase.from("notifications").select("*")
        .or(`recipient_id.eq.${user.id},recipient_id.is.null`)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("notification_reads").select("notification_id").eq("user_id", user.id),
    ]);
    const list = (ns || []) as Notif[];
    setItems(list);
    setReadIds(new Set((rs || []).map((r: any) => r.notification_id)));
    loadActors(list);
  }, [user, loadActors]);

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase
      .channel(`notifs:${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, (payload) => {
        const n = payload.new as Notif;
        if (n.kind === "nuke") return;
        if (n.recipient_id === null || n.recipient_id === user.id) {
          setItems(s => {
            if (s.some(x => x.id === n.id)) return s;
            return [n, ...s].slice(0, 30);
          });
          if (n.created_by) loadActors([n]);
          sound.play("click");
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") load();
      });
    const poll = setInterval(load, 30000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [user, load, loadActors]);

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

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)}>
            <div
              className="absolute top-20 right-2 left-2 max-w-sm mx-auto max-h-[70vh] overflow-y-auto rounded-2xl border-2 border-amber-400/80 bg-stone-950/95 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              dir="rtl"
            >
              <div className="sticky top-0 bg-amber-900/95 border-b border-amber-400/60 p-3 flex items-center justify-between">
                <div className="text-amber-100 font-extrabold">🔔 الإشعارات</div>
                <button onClick={() => setOpen(false)} className="text-amber-200 px-2">✕</button>
              </div>
              <div className="sticky top-[52px] z-10 bg-stone-950/95 border-b border-amber-800/40 px-2 py-2 flex gap-1 overflow-x-auto">
                {TABS.map(t => {
                  const count = t.key === "all"
                    ? items.filter(i => !readIds.has(i.id)).length
                    : items.filter(i => !readIds.has(i.id) && (i.kind === t.key || (t.key === "info" && !["attack","support","ship","friend","nuke"].includes(i.kind)))).length;
                  const active = tab === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-bold border transition ${active ? "bg-amber-500 text-stone-900 border-amber-300" : "bg-stone-900/60 text-amber-200 border-amber-800/60"}`}
                    >
                      <span className="me-1">{t.icon}</span>{t.label}
                      {count > 0 && <span className={`ms-1 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-black ${active ? "bg-stone-900 text-amber-200" : "bg-red-600 text-white"}`}>{count}</span>}
                    </button>
                  );
                })}
              </div>
              {(() => {
                const filtered = tab === "all"
                  ? items
                  : items.filter(i => i.kind === tab || (tab === "info" && !["attack","support","ship","friend","nuke"].includes(i.kind)));
                if (filtered.length === 0) {
                  return <div className="p-6 text-center text-amber-300/60 text-sm">لا توجد إشعارات في هذا التبويب</div>;
                }
                return (
                  <div className="divide-y divide-amber-800/30">
                    {filtered.map(n => {
                      const isRead = readIds.has(n.id);
                      const actor = n.created_by ? actors[n.created_by] : null;
                      return (
                        <div key={n.id} className={`p-3 flex gap-2 ${isRead ? "opacity-60" : "bg-amber-900/15"}`}>
                          {actor ? (
                            <Link
                              to="/p/$id"
                              params={{ id: actor.id }}
                              onClick={() => setOpen(false)}
                              className="shrink-0"
                            >
                              {actor.avatar_url ? (
                                <img src={actor.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover border-2 border-amber-500/70" />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-amber-900/60 border-2 border-amber-500/70 flex items-center justify-center text-xl">
                                  {actor.avatar_emoji || "🏴‍☠️"}
                                </div>
                              )}
                            </Link>
                          ) : (
                            <div className="text-xl w-10 h-10 flex items-center justify-center shrink-0">{iconFor(n.kind)}</div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold text-amber-100 flex items-center gap-1">
                              <span>{iconFor(n.kind)}</span>
                              <span className="truncate">{n.title}</span>
                            </div>
                            {n.body && <div className="text-xs text-amber-200/80 mt-0.5">{n.body}</div>}
                            {actor && (
                              <div className="mt-1.5 flex gap-1.5">
                                <Link
                                  to="/p/$id"
                                  params={{ id: actor.id }}
                                  onClick={() => setOpen(false)}
                                  className="px-2 py-0.5 rounded-md bg-sky-600/90 text-white text-[10px] font-bold"
                                >
                                  👤 زيارة {actor.display_name || "اللاعب"}
                                </Link>
                                <Link
                                  to="/p/$id"
                                  params={{ id: actor.id }}
                                  onClick={() => setOpen(false)}
                                  className="px-2 py-0.5 rounded-md bg-emerald-600/90 text-white text-[10px] font-bold"
                                >
                                  ➕ صديق
                                </Link>
                              </div>
                            )}
                            <div className="text-[10px] text-amber-400/50 mt-1">{new Date(n.created_at).toLocaleString("ar")}</div>
                          </div>
                          {!isRead && <span className="w-2 h-2 mt-2 rounded-full bg-red-500 shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
