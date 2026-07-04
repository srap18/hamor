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
  const [enemyIds, setEnemyIds] = useState<Set<string>>(new Set());
  const [busyEnemy, setBusyEnemy] = useState<string | null>(null);

  const loadEnemies = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from("user_enemies").select("enemy_id").eq("user_id", user.id);
    setEnemyIds(new Set((data || []).map((r: any) => r.enemy_id)));
  }, [user]);

  useEffect(() => { loadEnemies(); }, [loadEnemies]);

  const toggleEnemy = async (enemyId: string) => {
    if (!user || busyEnemy) return;
    setBusyEnemy(enemyId);
    try {
      if (enemyIds.has(enemyId)) {
        await supabase.from("user_enemies").delete().eq("user_id", user.id).eq("enemy_id", enemyId);
        setEnemyIds(s => { const n = new Set(s); n.delete(enemyId); return n; });
      } else {
        const { error } = await supabase.from("user_enemies").insert({ user_id: user.id, enemy_id: enemyId, reason: "من الإشعارات" });
        if (!error) setEnemyIds(s => new Set(s).add(enemyId));
      }
    } finally {
      setBusyEnemy(null);
    }
  };


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
    // Fetch personal and broadcast notifications SEPARATELY so high-volume
    // global broadcasts (lucky-box winners, etc.) don't push personal
    // attack/support rows out of the visible window.
    const [{ data: personal }, { data: broadcast }, { data: rs }] = await Promise.all([
      supabase.from("notifications").select("*")
        .eq("recipient_id", user.id)
        .order("created_at", { ascending: false })
        .limit(80),
      supabase.from("notifications").select("*")
        .is("recipient_id", null)
        .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
        .order("created_at", { ascending: false })
        .limit(20),
      supabase.from("notification_reads").select("notification_id").eq("user_id", user.id),
    ]);
    const merged = [...((personal || []) as Notif[]), ...((broadcast || []) as Notif[])]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 100);
    setItems(merged);
    setReadIds(new Set((rs || []).map((r: any) => r.notification_id)));
    loadActors(merged);
  }, [user, loadActors]);

  useEffect(() => {
    if (!user) return;
    load();
    const onInsert = (payload: any) => {
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
    };
    // Split into two server-filtered subscriptions so Realtime only forwards
    // rows meant for this user (personal or broadcast) instead of every
    // notification insert in the game. Same behavior, tiny fraction of WAL.
    const ch = supabase
      .channel(`notifs:${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${user.id}` }, onInsert)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=is.null` }, onInsert)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") load();
      });
    const poll = setInterval(() => { if (!document.hidden) load(); }, 60000);
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
          <div className="fixed inset-0 z-[60] bg-black/30" onClick={() => setOpen(false)}>
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

                // === Grouped view for attacks: one row per attacker ===
                if (tab === "attack") {
                  type Group = { attackerId: string | null; count: number; unread: number; last: Notif; sample: Notif[] };
                  const map = new Map<string, Group>();
                  for (const n of filtered) {
                    const key = n.created_by || `_anon_${n.id}`;
                    const g = map.get(key);
                    if (g) {
                      g.count += 1;
                      if (!readIds.has(n.id)) g.unread += 1;
                      if (n.created_at > g.last.created_at) g.last = n;
                      if (g.sample.length < 3) g.sample.push(n);
                    } else {
                      map.set(key, { attackerId: n.created_by, count: 1, unread: readIds.has(n.id) ? 0 : 1, last: n, sample: [n] });
                    }
                  }
                  const groups = Array.from(map.values()).sort((a, b) => b.last.created_at.localeCompare(a.last.created_at));
                  return (
                    <div className="divide-y divide-amber-800/30">
                      <div className="px-3 py-1.5 text-[10px] text-amber-300/60 bg-stone-900/40">
                        📊 {groups.length} مهاجم • {filtered.length} هجوم
                      </div>
                      {groups.map(g => {
                        const actor = g.attackerId ? actors[g.attackerId] : null;
                        const name = actor?.display_name || "لاعب مجهول";
                        const when = new Date(g.last.created_at);
                        const mins = Math.max(1, Math.round((Date.now() - when.getTime()) / 60000));
                        const ago = mins < 60 ? `قبل ${mins} د` : mins < 1440 ? `قبل ${Math.round(mins/60)} س` : when.toLocaleDateString("ar");
                        return (
                          <div key={g.attackerId || g.last.id} className={`p-3 flex gap-2 ${g.unread > 0 ? "bg-red-900/20" : "opacity-70"}`}>
                            {actor ? (
                              <Link to="/p/$id" params={{ id: actor.id }} onClick={() => setOpen(false)} className="shrink-0 relative">
                                {actor.avatar_url ? (
                                  <img src={actor.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover border-2 border-red-500/70" />
                                ) : (
                                  <div className="w-12 h-12 rounded-full bg-red-900/60 border-2 border-red-500/70 flex items-center justify-center text-2xl">
                                    {actor.avatar_emoji || "🏴‍☠️"}
                                  </div>
                                )}
                                {g.count > 1 && (
                                  <span className="absolute -bottom-1 -right-1 min-w-[20px] h-[20px] px-1 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center border border-stone-950">
                                    ×{g.count}
                                  </span>
                                )}
                              </Link>
                            ) : (
                              <div className="text-2xl w-12 h-12 flex items-center justify-center shrink-0">⚔️</div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-extrabold text-amber-100 flex items-center gap-1.5">
                                <span>⚔️</span>
                                <span className="truncate">{name}</span>
                                {g.unread > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-600 text-white font-black">{g.unread} جديد</span>}
                              </div>
                              <div className="text-[11px] text-red-200/90 mt-0.5">
                                {g.count === 1 ? "هاجمك مرة واحدة" : `هاجمك ${g.count} مرات`} • {ago}
                              </div>
                              <div className="text-[10px] text-amber-200/60 mt-0.5 truncate">
                                آخر: {g.last.title}
                              </div>
                              {actor && (
                                <div className="mt-1.5 flex gap-1.5 flex-wrap">
                                  <Link
                                    to="/p/$id"
                                    params={{ id: actor.id }}
                                    onClick={() => setOpen(false)}
                                    className="px-2 py-0.5 rounded-md bg-red-600 text-white text-[10px] font-bold"
                                  >
                                    ⚔️ رد الهجوم
                                  </Link>
                                  <Link
                                    to="/p/$id"
                                    params={{ id: actor.id }}
                                    onClick={() => setOpen(false)}
                                    className="px-2 py-0.5 rounded-md bg-sky-600/90 text-white text-[10px] font-bold"
                                  >
                                    👤 الملف
                                  </Link>
                                  <button
                                    onClick={() => toggleEnemy(actor.id)}
                                    disabled={busyEnemy === actor.id}
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${enemyIds.has(actor.id) ? "bg-red-900/80 text-red-100 border-red-400" : "bg-stone-800 text-amber-200 border-amber-700/60"} disabled:opacity-50`}
                                  >
                                    {enemyIds.has(actor.id) ? "🚩 عدو مثبّت ✕" : "🚩 ثبّت كعدو"}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
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
                              {actor && enemyIds.has(actor.id) && <span className="text-[9px] px-1 rounded bg-red-900/80 text-red-100 border border-red-400">🚩 عدو</span>}
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
