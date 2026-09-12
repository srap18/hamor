/**
 * Safety net for the strict "no refunds" policy.
 *
 * Paddle's adjustment webhook can be missing from the notification
 * settings, retried into a failure, or simply never delivered. When that
 * happens a player gets their money back AND keeps everything they bought.
 * This hook re-reads recent refunds/chargebacks straight from Paddle and
 * applies `refund_ban_user` for any transaction that is still marked as
 * granted. Fully idempotent — already-refunded rows are skipped.
 *
 * Auth: same `apikey` convention as the other pg_cron-driven hooks.
 */
import { createFileRoute } from "@tanstack/react-router";
import { gatewayFetch, type PaddleEnv } from "@/lib/paddle.server";

type Adjustment = {
  action?: string;
  status?: string;
  transaction_id?: string;
  reason?: string;
};

export const Route = createFileRoute("/api/public/hooks/paddle-refund-sweep")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected =
          process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["SUPABASE_ANON_KEY"];
        const provided = request.headers.get("apikey");
        if (!expected || !provided || provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const env: PaddleEnv = "live";
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let res: Response;
        try {
          res = await gatewayFetch(env, "/adjustments?per_page=50");
        } catch (e) {
          console.error("[refund-sweep] paddle fetch failed", e);
          return Response.json({ ok: false, error: "paddle_unreachable" }, { status: 502 });
        }
        if (!res.ok) {
          return Response.json({ ok: false, error: `paddle_${res.status}` }, { status: 502 });
        }
        const body = (await res.json()) as { data?: Adjustment[] };
        const rows = body?.data ?? [];

        const applied: string[] = [];
        const failed: { txn: string; error: string }[] = [];

        for (const adj of rows) {
          const action = adj.action ?? "";
          if (action !== "refund" && action !== "chargeback") continue;
          const status = adj.status ?? "";
          if (status && status !== "approved" && status !== "completed") continue;
          const txnId = adj.transaction_id;
          if (!txnId) continue;

          const { data: row } = await supabaseAdmin
            .from("paddle_purchases")
            .select("status, granted")
            .eq("paddle_transaction_id", txnId)
            .maybeSingle();
          if (!row) continue;
          if (row.status === "refunded" || row.granted === false) continue;

          const { error } = await supabaseAdmin.rpc("refund_ban_user", {
            _txn_id: txnId,
            _reason: `${action}${adj.reason ? ": " + adj.reason : ""} (sweep)`,
          });
          if (error) {
            console.error("[refund-sweep] refund_ban_user failed", txnId, error);
            failed.push({ txn: txnId, error: error.message });
          } else {
            applied.push(txnId);
          }
        }

        return Response.json({ ok: true, scanned: rows.length, applied, failed });
      },
    },
  },
});
