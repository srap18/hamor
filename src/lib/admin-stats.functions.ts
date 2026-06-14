import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AdminOverviewStats = {
  players: number;
  online: number;
  banned: number;
  muted: number;
  ships: number;
  totalCoins: number;
  totalGems: number;
  totalXp: number;
  txCount: number;
};

export const getAdminOverviewStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminOverviewStats> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Authorize: admin or moderator only
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .in("role", ["admin", "moderator"]);
    if (!roles || roles.length === 0) throw new Error("forbidden");

    const onlineCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    const [
      playersRes,
      onlineRes,
      bannedRes,
      mutedRes,
      shipsRes,
      txRes,
    ] = await Promise.all([
      supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
      supabaseAdmin
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .gte("online_at", onlineCutoff),
      supabaseAdmin
        .from("bans")
        .select("*", { count: "exact", head: true })
        .eq("active", true),
      supabaseAdmin
        .from("chat_mutes")
        .select("*", { count: "exact", head: true })
        .eq("active", true)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`),
      supabaseAdmin.from("ships_owned").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("transactions").select("*", { count: "exact", head: true }),
    ]);

    // Aggregate totals via SQL to avoid loading all rows
    const { data: aggRow } = await supabaseAdmin.rpc("admin_profile_totals" as never);
    let totalCoins = 0, totalGems = 0, totalXp = 0;
    const row = Array.isArray(aggRow) ? aggRow[0] : aggRow;
    if (row && typeof row === "object") {
      totalCoins = Number((row as any).total_coins ?? 0);
      totalGems = Number((row as any).total_gems ?? 0);
      totalXp = Number((row as any).total_xp ?? 0);
    } else {
      // Fallback: paginate
      const { data: agg } = await supabaseAdmin.from("profiles").select("coins, gems, xp");
      for (const p of agg ?? []) {
        totalCoins += Number((p as any).coins || 0);
        totalGems += Number((p as any).gems || 0);
        totalXp += Number((p as any).xp || 0);
      }
    }

    return {
      players: playersRes.count ?? 0,
      online: onlineRes.count ?? 0,
      banned: bannedRes.count ?? 0,
      muted: mutedRes.count ?? 0,
      ships: shipsRes.count ?? 0,
      totalCoins,
      totalGems,
      totalXp,
      txCount: txRes.count ?? 0,
    };
  });
