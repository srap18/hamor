/**
 * Internal admin sync endpoint. Protected by ADMIN_SYNC_TOKEN header.
 *
 * Actions:
 *   - action=sync_all      → run the full syncAllPlayProducts flow
 *   - action=test          → run the testPlayConnection diagnostic
 *   - action=list          → return current play_products rows summary
 *
 * All work is performed inline (not through the authenticated server-fn
 * chain) so the Lovable agent can trigger it during setup.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/admin/run-play-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.ADMIN_SYNC_TOKEN;
        const provided = request.headers.get("x-admin-sync-token");
        if (!expected || !provided || provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }
        let body: { action?: string } = {};
        try { body = await request.json(); } catch { /* empty body ok */ }
        const action = body.action ?? "sync_all";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        if (action === "list") {
          const { data, error } = await supabaseAdmin
            .from("play_products")
            .select("sku, product_type, status, sync_status, sync_error, subscription_exists, base_plan_id, base_plan_state, synced_at")
            .order("product_type").order("sku");
          if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
          return Response.json({ ok: true, rows: data });
        }

        if (action === "sync_all") {
          const { batchSyncPlayProducts, upsertSubscription } = await import("@/lib/play-sync.server");
          const { data: rows, error } = await supabaseAdmin
            .from("play_products")
            // deno-lint-ignore no-explicit-any
            .select("id, sku, title_ar, title_en, description_ar, description_en, price_micros, default_currency, product_type, status, base_plan_id" as any);
          if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

          // deno-lint-ignore no-explicit-any
          const asRow = (r: any) => ({
            sku: r.sku,
            title_ar: r.title_ar,
            title_en: r.title_en,
            description_ar: r.description_ar ?? "",
            description_en: r.description_en ?? "",
            price_micros: r.price_micros,
            default_currency: r.default_currency,
            product_type: r.product_type as "inapp" | "subs",
            status: r.status as "active" | "inactive",
            base_plan_id: r.base_plan_id ?? null,
          });
          // deno-lint-ignore no-explicit-any
          const inAppProducts = (rows ?? []).filter((r: any) => r.product_type === "inapp").map(asRow);
          // deno-lint-ignore no-explicit-any
          const subs = (rows ?? []).filter((r: any) => r.product_type === "subs").map(asRow);

          const batchSync = await batchSyncPlayProducts(inAppProducts);
          const batchResults = batchSync.results;

          // deno-lint-ignore no-explicit-any
          const subResults = new Map<string, { ok: boolean; error?: string; detail?: any }>();
          for (const s of subs) {
            const detail = await upsertSubscription(s);
            subResults.set(s.sku, { ok: detail.ok, error: detail.error, detail });
            await new Promise((r) => setTimeout(r, 400));
          }

          let ok = 0, failed = 0;
          const errors: { sku: string; error: string }[] = [];
          const perSku: { sku: string; ok: boolean; error?: string; type: string }[] = [];
          // deno-lint-ignore no-explicit-any
          for (const r of (rows ?? []) as any[]) {
            let result: { ok: boolean; error?: string; detail?: any };
            // deno-lint-ignore no-explicit-any
            const updatePatch: any = {
              synced_at: new Date().toISOString(),
              last_sync_source: "run_play_sync_route",
            };
            if (r.product_type === "subs") {
              const sr = subResults.get(r.sku) ?? { ok: false, error: "no result" };
              result = sr;
              updatePatch.subscription_exists = sr.detail?.subscriptionExisted ?? null;
              updatePatch.base_plan_state = sr.detail?.basePlanState ?? null;
              if (sr.detail?.basePlanId) updatePatch.base_plan_id = sr.detail.basePlanId;
            } else {
              const br = batchResults.get(r.sku) ?? { ok: false as const, error: "no result" };
              // deno-lint-ignore no-explicit-any
              result = { ok: br.ok, error: (br as any).error };
            }
            updatePatch.sync_status = result.ok ? "ok" : "error";
            updatePatch.sync_error = result.ok ? null : (result.error ?? null);
            await supabaseAdmin.from("play_products").update(updatePatch).eq("id", r.id);
            perSku.push({ sku: r.sku, ok: result.ok, error: result.ok ? undefined : (result.error ?? "unknown"), type: r.product_type });
            if (result.ok) ok++;
            else {
              failed++;
              if (errors.length < 20) errors.push({ sku: r.sku, error: (result.error ?? "unknown").slice(0, 600) });
            }
          }
          return Response.json({
            ok: true, ranAction: "sync_all", ok_count: ok, failed_count: failed,
            total: (rows ?? []).length, inAppCount: inAppProducts.length, subsCount: subs.length,
            quotaBlocked: batchSync.quotaBlocked, errors, perSku,
          });
        }

        if (action === "test") {
          // Re-run the connection/comparison logic (mirrors testPlayConnection).
          // deno-lint-ignore no-explicit-any
          const checks: Record<string, any> = {};
          checks.package = process.env.GOOGLE_PLAY_PACKAGE_NAME || null;
          checks.hasServiceAccount = !!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
          if (!checks.package || !checks.hasServiceAccount) {
            return Response.json({ ok: false, error: "missing env", checks });
          }
          const { SignJWT, importPKCS8 } = await import("jose");
          const { parseServiceAccount, normalizePem } = await import("@/lib/play-service-account.server");
          const sa = parseServiceAccount(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON!);
          const now = Math.floor(Date.now() / 1000);
          const key = await importPKCS8(normalizePem(sa.private_key), "RS256");
          const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/androidpublisher" })
            .setProtectedHeader({ alg: "RS256", typ: "JWT" })
            .setIssuer(sa.client_email)
            .setAudience(sa.token_uri || "https://oauth2.googleapis.com/token")
            .setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
          const tokRes = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }).toString(),
          });
          if (!tokRes.ok) {
            return Response.json({ ok: false, error: `OAuth ${tokRes.status}: ${(await tokRes.text()).slice(0, 400)}` });
          }
          // deno-lint-ignore no-explicit-any
          const { access_token } = (await tokRes.json()) as any;

          const { toPlayId, fromPlayId } = await import("@/lib/iap-play-ids");
          const { data: skuRows } = await supabaseAdmin
            .from("play_products").select("sku").eq("product_type", "inapp");
          // deno-lint-ignore no-explicit-any
          const skus = (skuRows ?? []).map((r: any) => r.sku).filter(Boolean) as string[];
          const playSkusToQuery = skus.map((s) => toPlayId(s));
          const playSkus: string[] = [];
          for (let index = 0; index < playSkusToQuery.length; index += 100) {
            const batch = playSkusToQuery.slice(index, index + 100);
            const params = new URLSearchParams();
            for (const sku of batch) params.append("productIds", sku);
            const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(checks.package)}/oneTimeProducts:batchGet?${params.toString()}`;
            const r = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
            if (!r.ok) return Response.json({ ok: false, error: `batchGet ${r.status}: ${(await r.text()).slice(0, 400)}` });
            // deno-lint-ignore no-explicit-any
            const page = JSON.parse((await r.text()) || "{}") as { oneTimeProducts?: { productId?: string }[] };
            for (const p of page.oneTimeProducts ?? []) if (p.productId) playSkus.push(p.productId);
          }
          const { data: subRows } = await supabaseAdmin
            .from("play_products").select("sku").eq("product_type", "subs");
          // deno-lint-ignore no-explicit-any
          const subSkus = (subRows ?? []).map((r: any) => r.sku).filter(Boolean) as string[];
          const subsFoundInPlay: string[] = []; const subsMissingInPlay: string[] = [];
          const subsDetail: { sku: string; basePlans?: { basePlanId: string; state: string }[] }[] = [];
          for (const sku of subSkus) {
            const playSku = toPlayId(sku);
            const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(checks.package)}/subscriptions/${encodeURIComponent(playSku)}`;
            const r = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
            if (r.status === 404) { subsMissingInPlay.push(sku); continue; }
            if (r.ok) {
              subsFoundInPlay.push(sku);
              // deno-lint-ignore no-explicit-any
              const body = await r.json() as any;
              subsDetail.push({
                sku,
                // deno-lint-ignore no-explicit-any
                basePlans: (body.basePlans ?? []).map((b: any) => ({ basePlanId: b.basePlanId, state: b.state })),
              });
            } else subsMissingInPlay.push(sku);
            await new Promise((res) => setTimeout(res, 120));
          }
          const playSetInternal = new Set(playSkus.map((s) => fromPlayId(s)));
          const found = skus.filter((sku) => playSetInternal.has(sku));
          const missing = skus.filter((sku) => !playSetInternal.has(sku));
          return Response.json({
            ok: true, ranAction: "test",
            inapp: { local: skus.length, inPlay: playSkus.length, found: found.length, missing },
            subscriptions: { local: subSkus.length, foundInPlay: subsFoundInPlay, missingInPlay: subsMissingInPlay, detail: subsDetail },
          });
        }

        return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
      },
    },
  },
});
