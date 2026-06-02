import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { MissionsModal } from "@/components/MissionsModal";
import { MyShipsModal } from "@/components/MyShipsModal";
import { sound } from "@/lib/sound";
import { serverNow, serverNowMs, serverTodayKey, syncServerTime } from "@/lib/server-time";

const items: Array<{ icon: string; label: string; to: "/" | "/shop" | "/friends" | "/chat" | "/fish-market" }> = [
  { icon: "🏠", label: "البحر", to: "/" },
  { icon: "🏛️", label: "المتجر", to: "/shop" },
  { icon: "👥", label: "الأصدقاء", to: "/friends" },
  { icon: "💬", label: "الشات", to: "/chat" },
  { icon: "🐟", label: "السوق", to: "/fish-market" },
];

const dmSeenKey = (uid: string) => `dm-last-seen:${uid}`;

export function BottomNav({ active }: { active?: string }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const [missionsOpen, setMissionsOpen] = useState(false);
  const [myShipsOpen, setMyShipsOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [dmUnread, setDmUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    const loadMissions = async () => {
      await syncServerTime(true);
      const today = serverTodayKey();
      const [{ data: notifs }, { data: progress }, { data: quests }, { data: boxes }] = await Promise.all([
        supabase.from("notifications").select("id").or(`recipient_id.eq.${user.id},recipient_id.is.null`).gte("created_at", new Date(serverNowMs() - 7 * 86400000).toISOString()),
        supabase.from("quest_progress").select("quest_id, progress, claimed").eq("user_id", user.id).eq("day_key", today),
        supabase.from("daily_quests").select("id, goal_count").eq("active", true),
        supabase.from("lootbox_owned").select("id").eq("user_id", user.id).eq("opened", false),
      ]);
      let count = (notifs?.length ?? 0) + (boxes?.length ?? 0);
      const progressMap = new Map((progress ?? []).map((p) => [p.quest_id, p]));
      (quests ?? []).forEach((q) => {
        const p = progressMap.get(q.id);
        if (p && p.progress >= q.goal_count && !p.claimed) count++;
      });
      setUnread(count);
    };
    const loadDm = async () => {
      if (active === "/chat") { setDmUnread(0); return; }
      const lastSeen = localStorage.getItem(dmSeenKey(user.id)) || new Date(serverNowMs() - 30 * 86400000).toISOString();
      const { count } = await supabase.from("messages")
        .select("id", { count: "exact", head: true })
        .eq("channel", "dm")
        .eq("recipient_id", user.id)
        .neq("sender_id", user.id)
        .gt("created_at", lastSeen);
      setDmUnread(count ?? 0);
    };
    loadMissions();
    loadDm();
    const ch = supabase
      .channel("nav-notifs")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, loadMissions)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${user.id}` }, loadDm)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, active]);

  // When user lands on /chat, mark DMs as seen
  useEffect(() => {
    if (!user || active !== "/chat") return;
    localStorage.setItem(dmSeenKey(user.id), serverNow().toISOString());
    setDmUnread(0);
  }, [user, active]);


  return (
    <>
      <div className="absolute bottom-0 left-0 right-0 z-30 px-2 pt-2 pb-2 border-t-4 border-amber-400/80 bg-gradient-to-b from-[#2a1606] via-[#1a0d04] to-black shadow-[0_-6px_20px_rgba(0,0,0,0.7)]">
        {/* Decorative rope/gold line */}
        <div className="absolute -top-1 left-0 right-0 h-1 bg-gradient-to-r from-amber-700 via-amber-300 to-amber-700 opacity-80" />
        <div className="flex items-center justify-around">
          {items.map((it) => {
            const isActive = active === it.to;
            return (
              <button
                key={it.to}
                onClick={() => nav({ to: it.to, viewTransition: false })}
                className={`relative flex flex-col items-center gap-0.5 px-1.5 active:scale-95 transition-transform ${isActive ? "-translate-y-1" : ""}`}
              >

                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg border-2 ${
                    isActive
                      ? "bg-gradient-to-b from-amber-300 via-amber-500 to-amber-800 border-amber-100 shadow-[0_0_14px_rgba(252,191,73,0.7),inset_0_1px_0_rgba(255,255,255,0.4)]"
                      : "bg-gradient-to-b from-[#5a2e0e] to-[#1a0d04] border-amber-700/70 shadow-[inset_0_1px_0_rgba(252,191,73,0.2)]"
                  }`}
                >
                  <span className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">{it.icon}</span>
                </div>
                {it.to === "/chat" && dmUnread > 0 && (
                  <span className="absolute -top-1 -right-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center border-2 border-amber-200 shadow animate-pulse">
                    {dmUnread > 9 ? "9+" : dmUnread}
                  </span>
                )}
                <span className={`text-[9px] font-black ${isActive ? "text-amber-200 drop-shadow" : "text-amber-400/70"}`}>{it.label}</span>
              </button>
            );
          })}

          <button
            onClick={() => { sound.play("click"); setMyShipsOpen(true); }}
            className="flex flex-col items-center gap-0.5 px-1.5 active:scale-95 relative"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg border-2 bg-gradient-to-b from-[#5a2e0e] to-[#1a0d04] border-amber-700/70 shadow-[inset_0_1px_0_rgba(252,191,73,0.2)]">
              <span className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">⚓</span>
            </div>
            <span className="text-[9px] font-black text-amber-400/70">سفينتي</span>
          </button>
          <button
            onClick={() => { sound.play("click"); setMissionsOpen(true); }}
            className="flex flex-col items-center gap-0.5 px-1.5 active:scale-95 relative"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg border-2 bg-gradient-to-b from-[#5a2e0e] to-[#1a0d04] border-amber-700/70 shadow-[inset_0_1px_0_rgba(252,191,73,0.2)]">
              <span className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">🗺</span>
            </div>
            {unread > 0 && (
              <span className="absolute -top-1 -right-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center border-2 border-amber-200 shadow">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
            <span className="text-[9px] font-black text-amber-400/70">المهام</span>
          </button>
        </div>
      </div>
      <MissionsModal open={missionsOpen} onClose={() => setMissionsOpen(false)} />
      <MyShipsModal open={myShipsOpen} onClose={() => setMyShipsOpen(false)} />
    </>
  );
}

// keep Link import used for tree-shaking detection in case future refactor needs it
export const _LinkAlias = Link;

