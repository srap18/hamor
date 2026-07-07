/**
 * Public webhook: called by a Postgres trigger whenever a row in
 * `play_products` is inserted or updated. Syncs that single row to
 * Google Play Console.
 *
 * Auth: requires the project's Supabase anon key in the `apikey` header
 * (set by the trigger). `/api/public/*` bypasses platform auth, so we
 * verify the header ourselves.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bodySchema = z.object({
  product_id: z.string().uuid().optional(),
  sku: z.string().min(1).max(128).optional(),
}).refine((d) => d.product_id || d.sku, { message: "product_id or sku required" });

export const Route = createFileRoute("/api/public/hooks/play-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // apikey auth (matches pg_cron / trigger convention)
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
        const provided = request.headers.get("apikey");
        if (!expected || !provided || provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        let parsed;
        try {
          parsed = bodySchema.parse(await request.json());
        } catch (e: any) {
          return new Response(`invalid body: ${e?.message ?? "parse error"}`, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { syncPlayProduct } = await import("@/lib/play-sync.server");

        const query = supabaseAdmin
          .from("play_products")
          .select("id, sku, title_ar, title_en, description_ar, description_en, price_micros, default_currency, product_type, status")
          .limit(1);

        const { data, error } = parsed.product_id
          ? await query.eq("id", parsed.product_id).maybeSingle()
          : await query.eq("sku", parsed.sku!).maybeSingle();

        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        if (!data) return Response.json({ ok: false, error: "row not found" }, { status: 404 });

        const result = await syncPlayProduct({
          sku: data.sku,
          title_ar: data.title_ar,
          title_en: data.title_en,
          description_ar: data.description_ar ?? "",
          description_en: data.description_en ?? "",
          price_micros: data.price_micros,
          default_currency: data.default_currency,
          product_type: data.product_type as "inapp" | "subs",
          status: data.status as "active" | "inactive",
        });

        await supabaseAdmin
          .from("play_products")
          .update({
            sync_status: result.ok ? "ok" : "error",
            sync_error: result.ok ? null : result.error,
            synced_at: new Date().toISOString(),
          })
          .eq("id", data.id);

        return Response.json(result, { status: result.ok ? 200 : 502 });
      },
    },
  },
});
