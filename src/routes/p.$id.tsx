import { createFileRoute, useNavigate, useParams, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { getProfilePublic } from "@/lib/profiles-public";

export const Route = createFileRoute("/p/$id")({
  ssr: false,
  head: () => ({ meta: [{ title: "ملف اللاعب — Ocean Catch" }] }),
  component: PlayerRedirect,
});

function PlayerRedirect() {
  const { id } = useParams({ from: "/p/$id" });
  const nav = useNavigate();
  useEffect(() => {
    (async () => {
      const p = await getProfilePublic(id);
      if (p?.username) {
        nav({ to: "/u/$username", params: { username: p.username }, replace: true });
      } else {
        // Fallback: if the player has no username, send the viewer to their ocean
        nav({ to: "/players/$playerId", params: { playerId: id }, replace: true });
      }
    })();
  }, [id, nav]);
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-stone-950 text-amber-200 gap-3" dir="rtl">
      <div>جاري فتح الملف الشخصي…</div>
      <Link to="/" className="text-xs underline text-muted-foreground">إلغاء</Link>
    </div>
  );
}
