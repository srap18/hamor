import { Link, useNavigate } from "@tanstack/react-router";
import { memo, useEffect, useMemo, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { loadDmUnreadMap, markAllDmRead } from "@/lib/dm-unread";

import iconBattle from "@/assets/nav-icon-battle.png";
import iconArena from "@/assets/nav-icon-arena.png";
import iconFriends from "@/assets/nav-icon-friends.png";
import iconInventory from "@/assets/nav-icon-inventory.png";
import iconShop from "@/assets/nav-icon-shop.png";
import iconChat from "@/assets/nav-icon-chat.png";
import iconSettings from "@/assets/nav-icon-settings.png";

const items = [
  { src: iconBattle, label: "تحدي", to: "/battle" as const },
  { src: iconArena, label: "ترتيب", to: "/arena" as const },
  { src: iconFriends, label: "أصدقاء", to: "/friends" as const },
  { src: iconInventory, label: "مخزن", to: "/inventory" as const },
  { src: iconShop, label: "متجر", to: "/shop" as const },
  { src: iconChat, label: "شات", to: "/chat" as const },
] satisfies Array<{
  src: string;
  label: string;
  to: "/battle" | "/arena" | "/friends" | "/inventory" | "/shop" | "/chat";
}>;

const NavIconButton = memo(function NavIconButton({
  label,
  src,
  active,
  badge,
  onClick,
}: {
  label: string;
  src: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex min-w-0 flex-1 flex-col items-center justify-start gap-1 active:scale-95 transition-transform"
      aria-label={label}
    >
      <div
        className="relative flex size-[44px] xs:size-[48px] sm:size-[52px] items-center justify-center"
        style={{
          filter: active
            ? "drop-shadow(0 0 14px rgba(255,200,90,0.7)) drop-shadow(0 4px 6px rgba(0,0,0,0.6))"
            : "drop-shadow(0 4px 8px rgba(0,0,0,0.6))",
        }}
      >
        <img
          src={src}
          alt={`أيقونة ${label}`}
          loading="lazy"
          width={112}
          height={112}
          className="size-full object-contain"
          style={{ transform: active ? "scale(1.06)" : "scale(1)", transition: "transform 200ms" }}
        />
      </div>


      {typeof badge === "number" && badge > 0 && (
        <span
          className="absolute right-0 top-0 z-10 flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-black text-white"
          style={{
            height: 18,
            background: "linear-gradient(180deg, #e53935 0%, #8f1212 100%)",
            border: "2px solid rgba(255,243,200,0.95)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
          }}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      )}

      <span
        className="text-center text-[10px] font-black leading-none mt-0.5"
        style={{
          fontFamily: "'Pirata One', 'Cinzel', serif",
          letterSpacing: "0.5px",
          color: active ? "#ffe9a8" : "#e8c878",
          textShadow:
            "0 1px 0 #1a0e04, 0 0 6px rgba(0,0,0,0.9), 0 0 10px rgba(255,180,80,0.25)",
        }}
      >
        {label}
      </span>
    </button>
  );
});

export function BottomNav({ active }: { active?: string }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const [dmUnread, setDmUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    const loadNotifs = async () => {
      const [{ data: notifications }, { data: reads }, { data: boxes }] = await Promise.all([
        supabase
          .from("notifications")
          .select("id")
          .or(`recipient_id.eq.${user.id},recipient_id.is.null`)
          .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
        supabase.from("notification_reads").select("notification_id").eq("user_id", user.id),
        supabase.from("lootbox_owned").select("id").eq("user_id", user.id).eq("opened", false),
      ]);
      const readIds = new Set((reads || []).map((r: any) => r.notification_id));
      const unreadNotifications = (notifications || []).filter((n: any) => !readIds.has(n.id)).length;
      setUnread(unreadNotifications + (boxes?.length ?? 0));
    };

    const loadDm = async () => {
      if (active === "/chat") {
        setDmUnread(0);
        return;
      }
      const { total } = await loadDmUnreadMap(user.id);
      setDmUnread(total);
    };

    loadNotifs();
    loadDm();

    const ch = supabase
      .channel(`bottom-nav:${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, loadNotifs)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${user.id}` }, loadDm)
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, active]);

  useEffect(() => {
    if (!user || active !== "/chat") return;
    markAllDmRead(user.id);
    setDmUnread(0);
  }, [user, active]);

  const friendsBadge = useMemo(() => (unread > 0 ? unread : undefined), [unread]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[80]"
      style={{
        paddingBottom: "max(0.4rem, env(safe-area-inset-bottom))",
        paddingLeft: "max(0.5rem, env(safe-area-inset-left))",
        paddingRight: "max(0.5rem, env(safe-area-inset-right))",
      }}
    >
      <div
        className="absolute inset-x-0 bottom-0 h-32 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(5,8,19,0) 0%, rgba(4,7,15,0.7) 45%, rgba(3,5,12,0.95) 100%)",
        }}
      />
      <div className="pointer-events-auto relative flex items-end justify-between gap-0 pb-1">

        {items.map((item) => {
          const isActive = active === item.to;
          const badge = item.to === "/chat" ? dmUnread : item.to === "/friends" ? friendsBadge : undefined;
          return (
            <NavIconButton
              key={item.to}
              label={item.label}
              src={item.src}
              active={isActive}
              badge={badge}
              onClick={() => nav({ to: item.to, viewTransition: false })}
            />
          );
        })}

        <NavIconButton
          label="إعدادات"
          src={iconSettings}
          onClick={() => window.dispatchEvent(new CustomEvent("open-settings-modal"))}
        />
      </div>
    </div>
  );
}

export const _LinkAlias = Link;
