import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/hooks/golden-fisher-tick")({
  server: {
    handlers: {
      POST: async () => {
        // Find all users with active Golden Fisher
        const { data: active, error } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .gt("golden_fisher_until", new Date().toISOString());

        if (error) {
          console.error("[golden-fisher-tick] select failed", error);
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        let totalCycles = 0;
        let totalShips = 0;
        const users = active ?? [];

        await Promise.all(
          users.map(async (u: { id: string }) => {
            const { data, error: rpcErr } = await supabaseAdmin.rpc("golden_fisher_tick", {
              _user: u.id,
            });
            if (rpcErr) {
              console.error("[golden-fisher-tick] rpc failed", u.id, rpcErr);
              return;
            }
            const res = (data as { cycles?: number; ships?: number }) ?? {};
            totalCycles += res.cycles ?? 0;
            totalShips += res.ships ?? 0;
          }),
        );

        return Response.json({
          ok: true,
          users: users.length,
          cycles: totalCycles,
          ships: totalShips,
        });
      },
    },
  },
});
