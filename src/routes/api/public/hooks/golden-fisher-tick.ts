import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/hooks/golden-fisher-tick")({
  server: {
    handlers: {
      POST: async () => {
        // Global cleanup: remove any expired crew assignments from inventory
        // so ships free up their crew slots automatically even while owners are offline.
        const { error: sweepErr } = await supabaseAdmin.rpc("sweep_expired_crews");
        if (sweepErr) console.error("[golden-fisher-tick] sweep_expired_crews failed", sweepErr);

        // Find all users with active Golden Fisher, whether it was activated
        // globally or is still stored as an assigned crew row from the old flow.
        const nowIso = new Date().toISOString();
        const { data: activeProfiles, error } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .gt("golden_fisher_until", nowIso);

        if (error) {
          console.error("[golden-fisher-tick] select failed", error);
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { data: activeInventory, error: inventoryError } = await supabaseAdmin
          .from("inventory")
          .select("user_id, meta")
          .eq("item_type", "crew")
          .eq("item_id", "golden_fisher");

        if (inventoryError) {
          console.error("[golden-fisher-tick] inventory select failed", inventoryError);
          return new Response(JSON.stringify({ ok: false, error: inventoryError.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        let totalCycles = 0;
        let totalShips = 0;
        const userIds = new Set<string>((activeProfiles ?? []).map((u: { id: string }) => u.id));
        for (const row of activeInventory ?? []) {
          const expiresAt = (row.meta as { expires_at?: string } | null)?.expires_at;
          if (expiresAt && new Date(expiresAt).getTime() > Date.now()) userIds.add(row.user_id as string);
        }
        const users = Array.from(userIds).map((id) => ({ id }));

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
