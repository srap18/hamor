/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Admin server functions for the Google Play products catalog.
 * All functions require an authenticated admin caller.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function requireAdmin(context: any) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("forbidden");
}

const productInput = z.object({
  id: z.string().uuid().optional(),
  sku: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._]*$/, "sku: must start with a lowercase letter/number and contain only lowercase letters, numbers, dots, or underscores"),
  title_ar: z.string().min(1).max(55),
  title_en: z.string().min(1).max(55),
  description_ar: z.string().max(200).default(""),
  description_en: z.string().max(200).default(""),
  price_micros: z.number().int().nonnegative(),
  default_currency: z.string().length(3).default("USD"),
  product_type: z.enum(["inapp", "subs"]).default("inapp"),
  status: z.enum(["active", "inactive"]).default("active"),
  rewards: z.record(z.any()).default({}),
});

export const upsertPlayProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => productInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const row = {
      sku: data.sku,
      title_ar: data.title_ar,
      title_en: data.title_en,
      description_ar: data.description_ar,
      description_en: data.description_en,
      price_micros: data.price_micros,
      default_currency: data.default_currency.toUpperCase(),
      product_type: data.product_type,
      status: data.status,
      rewards: data.rewards,
    };

    if (data.id) {
      const { error } = await supabaseAdmin.from("play_products").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: inserted, error } = await supabaseAdmin
      .from("play_products").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: inserted!.id };
  });

export const deletePlayProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { deleteInAppProduct } = await import("@/lib/play-sync.server");

    const { data: row, error: readErr } = await supabaseAdmin
      .from("play_products").select("sku").eq("id", data.id).maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) return { ok: true, alreadyGone: true };

    const playRes = await deleteInAppProduct(row.sku);
    // Delete from DB regardless of Play result; admin can retry if needed.
    const { error } = await supabaseAdmin.from("play_products").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, playDelete: playRes };
  });

export const listPlayProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("play_products").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

export const syncAllPlayProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { batchSyncPlayProducts } = await import("@/lib/play-sync.server");

    const { data: rows, error } = await supabaseAdmin
      .from("play_products")
      .select("id, sku, title_ar, title_en, description_ar, description_en, price_micros, default_currency, product_type, status");
    if (error) throw new Error(error.message);

    const products = (rows ?? []).map((r) => ({
      sku: r.sku,
      title_ar: r.title_ar,
      title_en: r.title_en,
      description_ar: r.description_ar ?? "",
      description_en: r.description_en ?? "",
      price_micros: r.price_micros as any,
      default_currency: r.default_currency,
      product_type: r.product_type as "inapp" | "subs",
      status: r.status as "active" | "inactive",
    }));
    const inAppProducts = products.filter((product) => product.product_type === "inapp");
    const batchResults = await batchSyncPlayProducts(inAppProducts);
    let ok = 0, failed = 0;
    const errors: { sku: string; error: string }[] = [];
    for (const r of rows ?? []) {
      const result = r.product_type === "subs"
        ? { ok: false as const, error: "subscriptions sync not implemented yet" }
        : batchResults.get(r.sku) ?? { ok: false as const, error: "لم تُرجع Google نتيجة لهذا المنتج" };
      await supabaseAdmin.from("play_products").update({
        sync_status: result.ok ? "ok" : "error",
        sync_error: result.ok ? null : result.error,
        synced_at: new Date().toISOString(),
      }).eq("id", r.id);
      if (result.ok) ok++;
      else {
        failed++;
        if (errors.length < 3) errors.push({ sku: r.sku, error: (result as any).error });
      }
    }
    return {
      ok,
      failed,
      total: (rows ?? []).length,
      errors,
      mode: "batch" as const,
      apiRequestsMaximum: Math.ceil(inAppProducts.length / 5) * 2,
    };
  });

export const syncOnePlayProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncPlayProduct } = await import("@/lib/play-sync.server");

    const { data: r, error } = await supabaseAdmin
      .from("play_products")
      .select("id, sku, title_ar, title_en, description_ar, description_en, price_micros, default_currency, product_type, status")
      .eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!r) throw new Error("not found");

    const result = await syncPlayProduct({
      sku: r.sku,
      title_ar: r.title_ar,
      title_en: r.title_en,
      description_ar: r.description_ar ?? "",
      description_en: r.description_en ?? "",
      price_micros: r.price_micros as any,
      default_currency: r.default_currency,
      product_type: r.product_type as any,
      status: r.status as any,
    });
    await supabaseAdmin.from("play_products").update({
      sync_status: result.ok ? "ok" : "error",
      sync_error: result.ok ? null : result.error,
      synced_at: new Date().toISOString(),
    }).eq("id", r.id);
    return result;
  });

/**
 * Diagnostic — verify Google Play Publisher API credentials are configured
 * and reachable. Attempts a token exchange + the official one-time product list.
 * Returns granular info so the admin can copy/paste failures.
 */
export const testPlayConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const checks: Record<string, any> = {};
    checks.package = process.env.GOOGLE_PLAY_PACKAGE_NAME || null;
    checks.hasServiceAccount = !!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
    if (!checks.package || !checks.hasServiceAccount) {
      return {
        ok: false,
        error: `Missing env: ${!checks.package ? "GOOGLE_PLAY_PACKAGE_NAME " : ""}${!checks.hasServiceAccount ? "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON" : ""}`.trim(),
        checks,
      };
    }
    try {
      const { SignJWT, importPKCS8 } = await import("jose");
      const { parseServiceAccount, normalizePem } = await import("./play-service-account.server");
      const sa = parseServiceAccount(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON!);
      checks.clientEmail = sa.client_email;
      const now = Math.floor(Date.now() / 1000);
      const pem = normalizePem(sa.private_key);
      const key = await importPKCS8(pem, "RS256");
      const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/androidpublisher" })
        .setProtectedHeader({ alg: "RS256", typ: "JWT" })
        .setIssuer(sa.client_email)
        .setAudience(sa.token_uri || "https://oauth2.googleapis.com/token")
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(key);
      const tokRes = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: jwt,
        }).toString(),
      });
      if (!tokRes.ok) {
        return { ok: false, error: `OAuth ${tokRes.status}: ${(await tokRes.text()).slice(0, 800)}`, checks };
      }
      const { access_token } = (await tokRes.json()) as any;
      checks.tokenObtained = true;
      // Compare the local catalog with Google's Monetization API in batches.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: skuRows } = await supabaseAdmin
        .from("play_products")
        .select("sku")
        .eq("product_type", "inapp");
      const skus = (skuRows ?? []).map((r: any) => r.sku).filter(Boolean);
      const playSkus: string[] = [];
      for (let index = 0; index < skus.length; index += 100) {
        const batch = skus.slice(index, index + 100);
        const params = new URLSearchParams();
        for (const sku of batch) params.append("productIds", sku);
        const url =
          `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
          `${encodeURIComponent(checks.package)}/oneTimeProducts:batchGet?${params.toString()}`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
        const responseText = await r.text();
        if (!r.ok) {
          return {
            ok: false,
            error: `GET ${url}\nHTTP ${r.status}\n${responseText}`,
            checks,
          };
        }
        const page = JSON.parse(responseText || "{}") as {
          oneTimeProducts?: { productId?: string }[];
        };
        for (const product of page.oneTimeProducts ?? []) {
          if (product.productId) playSkus.push(product.productId);
        }
      }

      const playSet = new Set(playSkus);
      const found = skus.filter((sku: string) => playSet.has(sku));
      const missing = skus.filter((sku: string) => !playSet.has(sku));
      const unmanaged = playSkus.filter((sku) => !skus.includes(sku));
      checks.localSkus = skus.length;
      checks.productsInPlay = playSkus.length;
      checks.foundSkus = found;
      checks.missingSkus = missing;
      checks.unmanagedPlaySkus = unmanaged;
      checks.createEndpoint =
        `PATCH https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
        `${encodeURIComponent(checks.package)}/onetimeproducts/{productId}`;
      if (skus.length === 0) {
        checks.note = "لا توجد منتجات شراء لمرة واحدة في قاعدة البيانات للمقارنة.";
      }
      checks.hint = missing.length
        ? `${missing.length} منتج غير موجود في Google Play — اضغط "مزامنة الكل" لإنشائها عبر المسار الصحيح.`
        : undefined;
      return { ok: true, checks };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e), checks };
    }
  });


