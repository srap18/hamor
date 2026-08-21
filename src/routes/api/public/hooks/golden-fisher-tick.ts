import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/golden-fisher-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // apikey auth (matches the pg_cron / trigger convention used by the
        // other hooks). Without it, anyone could drive global fishing ticks.
        const expected = process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["SUPABASE_ANON_KEY"];
        const provided = request.headers.get("apikey");
        if (!expected || !provided || provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Global cleanup: remove any expired crew assignments from inventory
        // so ships free up their crew slots automatically even while owners are offline.
        const { error: sweepErr } = await supabaseAdmin.rpc("sweep_expired_crews");
        if (sweepErr) console.error("[golden-fisher-tick] sweep_expired_crews failed", sweepErr);


        // Find all users with active Golden Fisher, whether it was activated
        // globally or is still stored as an assigned crew row from the old flow.
        const nowIso = new Date().toISOString();
        // PostgREST caps un-ranged selects at 1000 rows, which silently skipped
        // users once the active/crew population grew. Page through everything.
        const PAGE = 1000;
        type ProfileRow = {
          id: string;
          golden_fisher_until?: string | null;
          elite_vip_level?: number | null;
          elite_vip_expires_at?: string | null;
        };
        const activeProfiles: ProfileRow[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabaseAdmin
            .from("profiles")
            .select("id,golden_fisher_until,elite_vip_level,elite_vip_expires_at")
            .or(`golden_fisher_until.gt.${nowIso},elite_vip_level.gte.6`)
            .order("id", { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) {
            console.error("[golden-fisher-tick] select failed", error);
            return new Response(JSON.stringify({ ok: false, error: error.message }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
          activeProfiles.push(...((data ?? []) as ProfileRow[]));
          if (!data || data.length < PAGE) break;
        }

        const activeInventory: Array<{ user_id: string; meta: unknown }> = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error: inventoryError } = await supabaseAdmin
            .from("inventory")
            .select("user_id, meta")
            .eq("item_type", "crew")
            .eq("item_id", "golden_fisher")
            .order("user_id", { ascending: true })
            .range(from, from + PAGE - 1);
          if (inventoryError) {
            console.error("[golden-fisher-tick] inventory select failed", inventoryError);
            return new Response(JSON.stringify({ ok: false, error: inventoryError.message }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
          activeInventory.push(...((data ?? []) as Array<{ user_id: string; meta: unknown }>));
          if (!data || data.length < PAGE) break;
        }

        let totalCycles = 0;
        let totalShips = 0;
        const userIds = new Set<string>((activeProfiles ?? [])
          .filter((u: { golden_fisher_until?: string | null; elite_vip_level?: number | null; elite_vip_expires_at?: string | null }) => {
            const regularActive = !!u.golden_fisher_until && new Date(u.golden_fisher_until).getTime() > Date.now();
            const eliteActive = Number(u.elite_vip_level ?? 0) >= 6
              && (!u.elite_vip_expires_at || new Date(u.elite_vip_expires_at).getTime() > Date.now());
            return regularActive || eliteActive;
          })
          .map((u: { id: string }) => u.id));
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
