import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Anchor, Coins, Compass, Crown, ScrollText, Swords, Skull, Users } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { loadDmUnreadMap, markAllDmRead } from "@/lib/dm-unread";

const items = [
  { icon: Swords, label: "تحدي", to: "/battle" as const },
  { icon: Crown, label: "ترتيب", to: "/arena" as const },
  { icon: Users, label: "أصدقاء", to: "/friends" as const },
  { icon: Anchor, label: "مخزن", to: "/inventory" as const },
  { icon: Coins, label: "متجر", to: "/shop" as const },
  { icon: ScrollText, label: "شات", to: "/chat" as const },
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
        className="relative flex size-[52px] items-center justify-center"
        style={{
          filter: active
            ? "drop-shadow(0 0 18px rgba(255,196,79,0.7)) drop-shadow(0 4px 8px rgba(0,0,0,0.6))"
            : "drop-shadow(0 4px 10px rgba(0,0,0,0.65))",
        }}
      >
        {/* outer rope ring (twisted gold rope) */}
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, #5a3410 0deg, #c8923a 12deg, #fbe39a 22deg, #c8923a 32deg, #5a3410 44deg, #c8923a 56deg, #fbe39a 66deg, #c8923a 76deg, #5a3410 88deg, #c8923a 100deg, #fbe39a 110deg, #c8923a 120deg, #5a3410 132deg, #c8923a 144deg, #fbe39a 154deg, #c8923a 164deg, #5a3410 176deg, #c8923a 188deg, #fbe39a 198deg, #c8923a 208deg, #5a3410 220deg, #c8923a 232deg, #fbe39a 242deg, #c8923a 252deg, #5a3410 264deg, #c8923a 276deg, #fbe39a 286deg, #c8923a 296deg, #5a3410 308deg, #c8923a 320deg, #fbe39a 330deg, #c8923a 340deg, #5a3410 352deg, #5a3410 360deg)",
            padding: 3,
            boxShadow:
              "0 0 0 1px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(255,230,160,0.35)",
          }}
        >
          <span
            className="block size-full rounded-full"
            style={{
              background:
                "radial-gradient(circle at 50% 38%, #3a2210 0%, #1a0e06 55%, #07040 100%)",
            }}
          />
        </span>

        {/* inner brass medallion */}
        <span
          className="absolute inset-[6px] rounded-full"
          style={{
            background: active
              ? "radial-gradient(circle at 36% 28%, #fff3c2 0%, #f4c668 22%, #b07a1f 60%, #5a3a10 100%)"
              : "radial-gradient(circle at 36% 28%, #efd28a 0%, #c89344 28%, #7a4e16 70%, #3a2308 100%)",
            boxShadow:
              "inset 0 1px 2px rgba(255,240,190,0.7), inset 0 -3px 6px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(70,40,10,0.9)",
          }}
        />

        {/* subtle inner shine */}
        <span
          className="absolute inset-[8px] rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at 40% 22%, rgba(255,255,235,0.55) 0%, rgba(255,255,235,0) 45%)",
          }}
        />

        {/* rivets (4 corners) */}
        {[
          { top: 1, left: "50%", x: "-50%", y: "0" },
          { bottom: 1, left: "50%", x: "-50%", y: "0" },
          { left: 1, top: "50%", x: "0", y: "-50%" },
          { right: 1, top: "50%", x: "0", y: "-50%" },
        ].map((p, i) => (
          <span
            key={i}
            className="absolute size-[5px] rounded-full"
            style={{
              ...p,
              transform: `translate(${p.x}, ${p.y})`,
              background:
                "radial-gradient(circle at 35% 30%, #fde9a8 0%, #b7811d 60%, #3d2509 100%)",
              boxShadow: "0 0 2px rgba(0,0,0,0.8), inset 0 0 1px rgba(255,240,180,0.7)",
            }}
          />
        ))}

        <div
          className="relative z-10 flex items-center justify-center [&_svg]:size-[22px] [&_svg]:stroke-[2.3]"
          style={{
            color: active ? "#2a1605" : "#3a2208",
            filter: active
              ? "drop-shadow(0 1px 0 rgba(255,245,200,0.8))"
              : "drop-shadow(0 1px 0 rgba(255,230,160,0.5))",
          }}
        >
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
            <Compass />
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
