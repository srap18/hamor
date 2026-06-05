import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Landmark, MessageCircle, Package, Settings, Skull, Trophy, Users } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { loadDmUnreadMap, markAllDmRead } from "@/lib/dm-unread";

const items = [
  { icon: Skull, label: "تحدي", to: "/battle" as const },
  { icon: Trophy, label: "ترتيب", to: "/arena" as const },
  { icon: Users, label: "أصدقاء", to: "/friends" as const },
  { icon: Package, label: "مخزن", to: "/inventory" as const },
  { icon: Landmark, label: "متجر", to: "/shop" as const },
  { icon: MessageCircle, label: "شات", to: "/chat" as const },
] satisfies Array<{
  icon: typeof Skull;
  label: string;
  to: "/battle" | "/arena" | "/friends" | "/inventory" | "/shop" | "/chat";
}>;

function GoldNavButton({
  label,
  active,
  badge,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex min-w-0 flex-col items-center justify-start gap-1 active:scale-95 transition-transform"
      aria-label={label}
    >
      <div
        className="relative flex size-12 items-center justify-center"
        style={{
          filter: active
            ? "drop-shadow(0 0 14px rgba(246,196,79,0.45))"
            : "drop-shadow(0 3px 8px rgba(0,0,0,0.5))",
        }}
      >
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 50% 50%, rgba(29,16,9,0.95) 0%, rgba(11,7,4,0.98) 58%, rgba(5,3,2,1) 100%)",
            border: "1.6px solid rgba(247,212,122,0.95)",
            boxShadow:
              "inset 0 0 0 1px rgba(101,61,18,0.9), inset 0 0 16px rgba(250,211,122,0.12), 0 0 0 1px rgba(71,42,12,0.85)",
          }}
        />
        <span
          className="absolute inset-[3px] rotate-45"
          style={{
            border: "1px solid rgba(198,148,57,0.9)",
            borderRadius: "10px",
            boxShadow: "inset 0 0 4px rgba(255,220,150,0.12)",
          }}
        />
        <span
          className="absolute inset-[7px] rotate-45"
          style={{
            border: `1px solid ${active ? "rgba(255,232,173,0.95)" : "rgba(161,115,39,0.88)"}`,
            borderRadius: "8px",
          }}
        />
        <span
          className="absolute inset-[4px] rounded-full"
          style={{
            background: active
              ? "radial-gradient(circle at 35% 30%, rgba(130,91,28,0.36) 0%, rgba(38,20,9,0.08) 48%, transparent 76%)"
              : "radial-gradient(circle at 35% 30%, rgba(126,89,32,0.22) 0%, rgba(38,20,9,0.05) 48%, transparent 76%)",
          }}
        />
        <div className="relative z-10 flex items-center justify-center text-[#d7b36a] [&_svg]:size-5 [&_svg]:stroke-[2.2]">
          {children}
        </div>
      </div>

      {typeof badge === "number" && badge > 0 && (
        <span
          className="absolute right-0 top-0 flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-black text-white"
          style={{
            height: 18,
            background: "linear-gradient(180deg, #e53935 0%, #8f1212 100%)",
            border: "2px solid rgba(255,243,200,0.95)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
          }}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      )}

      <span
        className="text-center text-[10px] font-black leading-none"
        style={{
          color: active ? "rgba(255,235,179,0.98)" : "rgba(234,205,126,0.92)",
          textShadow: "0 1px 3px rgba(0,0,0,0.85)",
        }}
      >
        {label}
      </span>
    </button>
  );
}

export function BottomNav({ active }: { active?: string }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const [dmUnread, setDmUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    const loadNotifs = async () => {
      const [{ data: notifications }, { data: boxes }] = await Promise.all([
        supabase
          .from("notifications")
          .select("id")
          .or(`recipient_id.eq.${user.id},recipient_id.is.null`)
          .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
        supabase.from("lootbox_owned").select("id").eq("user_id", user.id).eq("opened", false),
      ]);
      setUnread((notifications?.length ?? 0) + (boxes?.length ?? 0));
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
    <>
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] px-3 pb-2"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        <div
          className="absolute inset-x-0 bottom-0 h-28"
          style={{
            background:
              "linear-gradient(180deg, rgba(5,8,19,0) 0%, rgba(4,7,15,0.72) 42%, rgba(3,5,12,0.98) 100%)",
          }}
        />
        <div className="pointer-events-auto relative flex items-end justify-between gap-1">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.to;
            const badge = item.to === "/chat" ? dmUnread : item.to === "/friends" ? friendsBadge : undefined;
            return (
              <GoldNavButton
                key={item.to}
                label={item.label}
                active={isActive}
                badge={badge}
                onClick={() => nav({ to: item.to, viewTransition: false })}
              >
                <Icon />
              </GoldNavButton>
            );
          })}

          <GoldNavButton label="إعدادات" onClick={() => window.dispatchEvent(new CustomEvent("open-settings-modal"))}>
            <Settings />
          </GoldNavButton>
        </div>
        <div
          className="pointer-events-none absolute bottom-0 right-2 size-11 rotate-45"
          style={{
            background: "linear-gradient(135deg, rgba(235,245,255,0.95) 0%, rgba(183,198,223,0.82) 55%, rgba(115,135,170,0.14) 100%)",
            clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
            filter: "drop-shadow(0 0 12px rgba(224,234,255,0.4))",
            opacity: 0.9,
          }}
        />
      </div>
    </>
  );
}

export const _LinkAlias = Link;
