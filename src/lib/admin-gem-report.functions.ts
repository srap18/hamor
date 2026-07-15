/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { STORE_PACKS } from "@/lib/store-catalog";

export type GemReportEvent = {
  at: string;
  delta: number;
  balance_before: number;
  balance_after: number;
  kind:
    | "recharge_paddle"
    | "recharge_stripe"
    | "recharge_polar"
    | "code_redeem"
    | "vip_daily"
    | "elite_vip_daily"
    | "referral"
    | "tribe_daily_gem"
    | "admin_gift"
    | "admin_edit"
    | "spend"
    | "spend_ad_bomb"
    | "spend_lucky_box"
    | "spend_lootbox"
    | "spend_dragon_draw"
    | "spend_dragon_upgrade"
    | "spend_dragon_smelt"
    | "spend_support_gift"
    | "spend_item"
    | "other_gain";
  label_ar: string;
  product_label?: string;
  product_id?: string;
  amount_usd?: number;
  detail?: string;
};

export type GemReportSummary = {
  total_in: number;
  total_out: number;
  net: number;
  recharge_gems: number;
  recharge_usd: number;
  code_gems: number;
  admin_gems: number;
  other_in_gems: number;
  spent_gems: number;
};

const WINDOW_MS = 120_000;
const SPEND_WINDOW_MS = 20_000;

const ITEM_LABELS_AR: Record<string, string> = {
  nuke: "قنبلة ذرية",
  ad_bomb: "قنبلة إعلانية",
  rocket_small: "صاروخ صغير",
  rocket_medium: "صاروخ متوسط",
  rocket_large: "صاروخ كبير",
  shield_1d: "درع يوم",
  shield_2d: "درع يومين",
  shield_3d: "درع 3 أيام",
  shield_7d: "درع أسبوع",
  anti_nuke: "مضاد ذري",
  anti_ad_bomb: "مضاد إعلاني",
  anti_rocket: "مضاد صواريخ",
  sailor: "بحّار",
  luck: "طاقم الحظ",
  guide: "طاقم المرشد",
  thief: "لص",
  police: "شرطي",
  trader: "تاجر",
  golden_fisher: "الصياد الذهبي",
  market_expert: "خبير السوق",
  fixer_1: "مصلّح 1",
  fixer_2: "مصلّح 2",
  fixer_3: "مصلّح 3",
  fixer_4: "مصلّح 4",
  af_gold: "إطار ذهبي",
};

const ITEM_TYPE_LABELS_AR: Record<string, string> = {
  crew: "طاقم",
  weapon: "سلاح",
  consumable: "مستهلك",
  decoration: "زينة",
  frame: "إطار",
  background: "خلفية",
  name_frame: "إطار اسم",
  bubble_frame: "إطار فقاعة",
  profile_frame: "إطار بروفايل",
  shield: "درع",
  anti: "مضاد",
  anti_rocket: "مضاد صواريخ",
  anti_nuke: "مضاد ذري",
  anti_ad_bomb: "مضاد إعلاني",
  disabler: "معطّل",
};

function itemLabel(t: string, id: string): string {
  const n = ITEM_LABELS_AR[id] ?? id;
  const tt = ITEM_TYPE_LABELS_AR[t] ?? t;
  return `شراء ${tt}: ${n}`;
}

const SOURCE_LABELS_AR: Record<string, { label: string; kind: GemReportEvent["kind"] }> = {
  dragon_upgrade: { label: "ترقية معدة تنين", kind: "spend_dragon_upgrade" },
  dragon_smelt: { label: "صهر معدات تنين", kind: "spend_dragon_smelt" },
  admin_gift: { label: "هدية من الإدارة", kind: "admin_gift" },
  admin_action: { label: "تعديل يدوي من الإدارة", kind: "admin_edit" },
  admin_refund: { label: "استرداد من الإدارة", kind: "admin_gift" },
  admin_correction: { label: "تصحيح من الإدارة", kind: "admin_edit" },
  admin_compensation: { label: "تعويض من الإدارة", kind: "admin_gift" },
  security_fix: { label: "تصحيح أمني من الإدارة", kind: "admin_edit" },
  ship_storage_defect_compensation_v2: { label: "تعويض خلل تخزين السفن", kind: "admin_gift" },
  ship_storage_refund_reversal: { label: "عكس تعويض تخزين السفن", kind: "admin_edit" },
};

function packLabelById(id: string | null | undefined): { label: string; gems?: number; usd?: number } {
  if (!id) return { label: "منتج غير معروف" };
  const p = STORE_PACKS.find((x) => x.id === id);
  if (!p) return { label: id };
  return { label: p.label, gems: p.reward.gems, usd: p.priceUSD };
}

export const getPlayerGemReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; limit?: number }) => {
    if (!d?.userId) throw new Error("userId required");
    return { userId: d.userId, limit: Math.max(50, Math.min(1000, d.limit ?? 500)) };
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) {
      const { data: isMod } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "moderator",
      });
      if (!isMod) throw new Error("forbidden");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = data.userId;

    const [audit, paddle, stripe, polar, codes, vipDaily, eliteDaily, referrals, tribeDaily, adminAudit, adBombs, luckyBox, lootboxes, dragonEq, supportSent, invPurchases] = await Promise.all([
      supabaseAdmin
        .from("economy_audit")
        .select("changed_at,gems_delta,gems_before,gems_after,source,reason,meta")
        .eq("user_id", uid)
        .neq("gems_delta", 0)
        .order("changed_at", { ascending: false })
        .limit(data.limit),
      supabaseAdmin
        .from("paddle_purchases")
        .select("pack_id,amount_cents,granted_at,granted,paddle_transaction_id")
        .eq("user_id", uid)
        .eq("granted", true)
        .not("granted_at", "is", null),
      supabaseAdmin
        .from("stripe_purchases")
        .select("pack_id,amount_cents,granted_at,granted,stripe_session_id")
        .eq("user_id", uid)
        .eq("granted", true)
        .not("granted_at", "is", null),
      supabaseAdmin
        .from("polar_purchases")
        .select("pack_id,amount_cents,granted_at,status")
        .eq("user_id", uid)
        .eq("status", "completed" as never)
        .not("granted_at", "is", null),
      supabaseAdmin
        .from("code_redemptions")
        .select("redeemed_at,code_id,redemption_codes(code,reward_gems)")
        .eq("user_id", uid),
      supabaseAdmin
        .from("vip_daily_claims")
        .select("claimed_at,gems,level")
        .eq("user_id", uid)
        .gt("gems", 0),
      supabaseAdmin
        .from("elite_vip_daily_claims")
        .select("claimed_at,gems_awarded,vip_level")
        .eq("user_id", uid)
        .gt("gems_awarded", 0),
      supabaseAdmin
        .from("referral_earnings")
        .select("created_at,gems_awarded,kind,note")
        .eq("inviter_id", uid)
        .gt("gems_awarded", 0),
      supabaseAdmin
        .from("tribe_gem_daily")
        .select("day,donation_gems")
        .eq("user_id", uid),
      supabaseAdmin
        .from("admin_audit")
        .select("created_at,action,details,admin_id")
        .eq("target_user_id", uid)
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin
        .from("ad_bombs")
        .select("created_at,started_at")
        .eq("attacker_id", uid)
        .order("created_at", { ascending: false })
        .limit(500),
      supabaseAdmin
        .from("lucky_box_opens")
        .select("created_at,label,rarity")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(500),
      supabaseAdmin
        .from("lootbox_owned")
        .select("acquired_at,type_id,lootbox_types(name_ar,name,price_gems)")
        .eq("user_id", uid)
        .order("acquired_at", { ascending: false })
        .limit(300),
      supabaseAdmin
        .from("dragon_equipment")
        .select("acquired_at,slot,rarity,name")
        .eq("user_id", uid)
        .order("acquired_at", { ascending: false })
        .limit(500),
      supabaseAdmin
        .from("support_gifts")
        .select("created_at,kind,amount,recipient_id")
        .eq("sender_id", uid)
        .order("created_at", { ascending: false })
        .limit(300),
      supabaseAdmin
        .from("inventory")
        .select("acquired_at,item_type,item_id")
        .eq("user_id", uid)
        .order("acquired_at", { ascending: false })
        .limit(500),
    ]);

    // Enrich admin_audit with admin usernames
    const adminIds = Array.from(new Set((adminAudit.data ?? []).map((r: any) => r.admin_id).filter(Boolean)));
    const adminNames = new Map<string, string>();
    if (adminIds.length > 0) {
      const { data: admins } = await supabaseAdmin
        .from("profiles")
        .select("id,username,display_name")
        .in("id", adminIds);
      for (const a of (admins ?? []) as any[]) {
        adminNames.set(a.id, a.display_name || a.username || String(a.id).slice(0, 8));
      }
    }


    type Src = { at: number; kind: GemReportEvent["kind"]; label_ar: string; product_label?: string; product_id?: string; amount_usd?: number; expect_gems?: number; detail?: string; direction: "in" | "out"; used?: boolean };
    const sources: Src[] = [];

    for (const p of (paddle.data ?? []) as any[]) {
      const info = packLabelById(p.pack_id);
      sources.push({
        at: new Date(p.granted_at).getTime(),
        kind: "recharge_paddle",
        label_ar: "شحن (Paddle)",
        product_label: info.label,
        product_id: p.pack_id,
        amount_usd: (p.amount_cents ?? 0) / 100,
        expect_gems: info.gems,
        detail: p.paddle_transaction_id,
      });
    }
    for (const s of (stripe.data ?? []) as any[]) {
      const info = packLabelById(s.pack_id);
      sources.push({
        at: new Date(s.granted_at).getTime(),
        kind: "recharge_stripe",
        label_ar: "شحن (Stripe)",
        product_label: info.label,
        product_id: s.pack_id,
        amount_usd: (s.amount_cents ?? 0) / 100,
        expect_gems: info.gems,
        detail: s.stripe_session_id,
      });
    }
    for (const p of (polar.data ?? []) as any[]) {
      const info = packLabelById(p.pack_id);
      sources.push({
        at: new Date(p.granted_at).getTime(),
        kind: "recharge_polar",
        label_ar: "شحن (Polar)",
        product_label: info.label,
        product_id: p.pack_id,
        amount_usd: (p.amount_cents ?? 0) / 100,
        expect_gems: info.gems,
      });
    }
    for (const c of (codes.data ?? []) as any[]) {
      const code = c.redemption_codes?.code ?? c.code_id;
      const g = Number(c.redemption_codes?.reward_gems ?? 0);
      if (g <= 0) continue;
      sources.push({
        at: new Date(c.redeemed_at).getTime(),
        kind: "code_redeem",
        label_ar: "استبدال كود",
        product_label: `كود: ${code}`,
        expect_gems: g,
      });
    }
    for (const v of (vipDaily.data ?? []) as any[]) {
      sources.push({
        at: new Date(v.claimed_at).getTime(),
        kind: "vip_daily",
        label_ar: `مكافأة VIP ${v.level} اليومية`,
        expect_gems: Number(v.gems ?? 0),
      });
    }
    for (const v of (eliteDaily.data ?? []) as any[]) {
      sources.push({
        at: new Date(v.claimed_at).getTime(),
        kind: "elite_vip_daily",
        label_ar: `مكافأة Elite VIP ${v.vip_level} اليومية`,
        expect_gems: Number(v.gems_awarded ?? 0),
      });
    }
    for (const r of (referrals.data ?? []) as any[]) {
      sources.push({
        at: new Date(r.created_at).getTime(),
        kind: "referral",
        label_ar: `دعوة صديق (${r.kind ?? ""})`,
        expect_gems: Number(r.gems_awarded ?? 0),
        detail: r.note ?? undefined,
      });
    }
    for (const t of (tribeDaily.data ?? []) as any[]) {
      const g = Number(t.donation_gems ?? 0);
      if (g <= 0) continue;
      sources.push({
        at: new Date(t.day).getTime(),
        kind: "tribe_daily_gem",
        label_ar: "مكافأة نشاط القبيلة (جواهر يومية)",
        expect_gems: g,
      });
    }
    for (const a of (adminAudit.data ?? []) as any[]) {
      const det = a.details ?? {};
      // Try to detect gems in details
      let gems = 0;
      if (typeof det.gems === "number") gems = det.gems;
      else if (det.after?.gems != null && det.before?.gems != null) gems = Number(det.after.gems) - Number(det.before.gems);
      if (gems === 0) continue;
      sources.push({
        at: new Date(a.created_at).getTime(),
        kind: a.action?.includes("gift") ? "admin_gift" : "admin_edit",
        label_ar: a.action?.includes("gift") ? "هدية من الإدارة" : "تعديل يدوي من الإدارة",
        expect_gems: gems,
        detail: `المشرف: ${String(a.admin_id).slice(0, 8)}`,
      });
    }

    // Sort sources by time asc for matching
    sources.sort((a, b) => a.at - b.at);

    const rows: GemReportEvent[] = [];
    const summary: GemReportSummary = {
      total_in: 0,
      total_out: 0,
      net: 0,
      recharge_gems: 0,
      recharge_usd: 0,
      code_gems: 0,
      admin_gems: 0,
      other_in_gems: 0,
      spent_gems: 0,
    };

    for (const a of (audit.data ?? []) as any[]) {
      const delta = Number(a.gems_delta ?? 0);
      const at = new Date(a.changed_at).getTime();
      let match: Src | undefined;

      if (delta > 0) {
        // Find nearest unused source within window whose expected gems matches or is unspecified
        let best: { src: Src; score: number } | undefined;
        for (const s of sources) {
          if (s.used) continue;
          const dt = Math.abs(s.at - at);
          if (dt > WINDOW_MS) continue;
          const gemsOk = s.expect_gems == null || s.expect_gems === delta;
          if (!gemsOk) continue;
          const score = dt + (s.expect_gems === delta ? 0 : 30_000);
          if (!best || score < best.score) best = { src: s, score };
        }
        if (best) {
          best.src.used = true;
          match = best.src;
        }
      }

      let kind: GemReportEvent["kind"] = delta < 0 ? "spend" : "other_gain";
      let label = delta < 0 ? "صرف داخل اللعبة" : "إضافة غير مصنّفة";
      let product_label: string | undefined;
      let product_id: string | undefined;
      let amount_usd: number | undefined;
      let detail: string | undefined;

      if (match) {
        kind = match.kind;
        label = match.label_ar;
        product_label = match.product_label;
        product_id = match.product_id;
        amount_usd = match.amount_usd;
        detail = match.detail;
      } else if (a.source === "admin_gift" || a.source === "admin_action") {
        kind = "admin_gift";
        label = "هدية / تعديل من الإدارة";
        detail = a.reason ?? undefined;
      }

      // Summary
      if (delta > 0) {
        summary.total_in += delta;
        if (kind === "recharge_paddle" || kind === "recharge_stripe" || kind === "recharge_polar") {
          summary.recharge_gems += delta;
          summary.recharge_usd += amount_usd ?? 0;
        } else if (kind === "code_redeem") summary.code_gems += delta;
        else if (kind === "admin_gift" || kind === "admin_edit") summary.admin_gems += delta;
        else summary.other_in_gems += delta;
      } else {
        summary.total_out += -delta;
        summary.spent_gems += -delta;
      }

      rows.push({
        at: a.changed_at,
        delta,
        balance_before: Number(a.gems_before ?? 0),
        balance_after: Number(a.gems_after ?? 0),
        kind,
        label_ar: label,
        product_label,
        product_id,
        amount_usd,
        detail: detail ?? (a.reason || undefined),
      });
    }

    summary.net = summary.total_in - summary.total_out;

    return { events: rows, summary };
  });
