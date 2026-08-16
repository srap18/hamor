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

const ZODIAC_AR: Record<string, string> = {
  aries: "الحمل", taurus: "الثور", gemini: "الجوزاء", leo: "الأسد", virgo: "العذراء",
  pisces: "الحوت", scorpio: "العقرب", phoenix: "العنقاء", imperial: "الإمبراطوري",
  cosmic_vip: "الكوني VIP", lux_diamond: "الألماس الفاخر", lux_emerald: "الزمرد الفاخر",
  lux_imperial: "الإمبراطوري الفاخر", lux_obsidian: "الأوبسيديان الفاخر",
  lux_royal: "الملكي الفاخر", lux_sakura: "الساكورا الفاخر", lux_celestial: "السماوي الفاخر",
};

const BG_AR: Record<string, string> = {
  cove: "الخليج", crystal_kingdom: "مملكة الكريستال", eiffel: "إيفل", eiffel_night: "إيفل ليلاً",
  madagascar: "قرية مدغشقر", onepiece: "ون بيس", worldcup: "كأس العالم",
};

const ITEM_LABELS_AR: Record<string, string> = {
  nuke: "قنبلة ذرية",
  ad_bomb: "قنبلة إعلانية",
  kraken_bomb: "قنبلة الكراكن",
  rocket_small: "صاروخ صغير",
  rocket_medium: "صاروخ متوسط",
  rocket_large: "صاروخ كبير",
  shield_1h: "درع ساعة",
  shield_4h: "درع 4 ساعات",
  shield_1d: "درع يوم",
  shield_2d: "درع يومين",
  shield_3d: "درع 3 أيام",
  shield_7d: "درع أسبوع",
  shield_30d: "درع 30 يوم",
  anti_nuke: "مضاد ذري",
  anti_ad_bomb: "مضاد إعلاني",
  anti_rocket: "مضاد صواريخ",
  anti_kraken: "مضاد الكراكن",
  disabler_nuke: "معطّل ذري",
  disabler_ad_bomb: "معطّل إعلاني",
  disabler_rocket: "معطّل صواريخ",
  disabler_kraken: "معطّل الكراكن",
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

/** Arabic name of any inventory item id (no raw codes). */
function itemNameAr(t: string, id: string): string {
  if (ITEM_LABELS_AR[id]) return ITEM_LABELS_AR[id]!;
  const m = /^(af|nf|bf|pf)_(.+)$/.exec(id);
  if (m) {
    const kindAr = m[1] === "af" ? "إطار صورة" : m[1] === "nf" ? "إطار اسم" : m[1] === "bf" ? "إطار فقاعة" : "إطار بروفايل";
    return `${kindAr}: ${ZODIAC_AR[m[2]!] ?? m[2]!}`;
  }
  if (t === "background") return `خلفية: ${BG_AR[id] ?? id}`;
  return `${ITEM_TYPE_LABELS_AR[t] ?? t}: ${id}`;
}

function itemLabel(t: string, id: string, qty?: number): string {
  const n = itemNameAr(t, id);
  const q = qty && qty > 1 ? ` ×${qty}` : "";
  return `شراء ${n}${q}`;
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
  ship_storage_upgrade: { label: "ترقية تخزين السفينة", kind: "spend_item" },
  vip_gem_cashback_backfill: { label: "تعويض كاش باك VIP (جواهر)", kind: "other_gain" },
  royal_whale_full_catch: { label: "جواهر الحوت الملكي (صيد كامل)", kind: "other_gain" },
};

/**
 * Precise map for the auto-captured DB source (`fn:<name>` / `rpc:<name>`).
 * Every gem movement now records the exact database operation that caused it,
 * so the report never needs to guess.
 */
const FN_SOURCE_LABELS: Record<string, { label: string; kind: GemReportEvent["kind"] }> = {
  // ==== شحن حقيقي ====
  grant_paddle_purchase: { label: "شحن مدفوع (Paddle)", kind: "recharge_paddle" },
  grant_stripe_purchase: { label: "شحن مدفوع (Stripe)", kind: "recharge_stripe" },
  grant_polar_purchase: { label: "شحن مدفوع (Polar)", kind: "recharge_polar" },
  revoke_paddle_purchase: { label: "سحب شحن (استرجاع Paddle)", kind: "admin_edit" },
  daughter_apply_purchase_bonus: { label: "كاش باك الابنة على الشحن", kind: "other_gain" },
  award_vip_cashback: { label: "كاش باك ترقية VIP", kind: "other_gain" },

  // ==== أكواد ====
  redeem_code: { label: "استبدال كود", kind: "code_redeem" },
  admin_redeem_code_for: { label: "استبدال كود بواسطة الإدارة", kind: "code_redeem" },
  admin_redeem_code_for_legacy_20260717: { label: "استبدال كود (إداري - قديم)", kind: "code_redeem" },
  admin_revoke_redemption: { label: "إلغاء كود من الإدارة", kind: "admin_edit" },

  // ==== إدارة ====
  admin_set_player_currency: { label: "تعديل رصيد يدوي من الإدارة", kind: "admin_edit" },
  admin_set_player_full: { label: "تعديل بيانات اللاعب من الإدارة", kind: "admin_edit" },
  admin_mass_gift: { label: "هدية جماعية من الإدارة", kind: "admin_gift" },
  admin_grant_referral_gift: { label: "هدية دعوات من الإدارة", kind: "admin_gift" },
  admin_revert_economy_window: { label: "تراجع اقتصادي من الإدارة", kind: "admin_edit" },
  admin_wipe_exploit: { label: "سحب أرباح استغلال (الإدارة)", kind: "admin_edit" },
  reset_player_to_ledger: { label: "إعادة ضبط الرصيد للسجل", kind: "admin_edit" },
  refund_ban_user: { label: "استرداد عند الحظر", kind: "admin_edit" },
  qa_award: { label: "منحة اختبار/دعم", kind: "admin_gift" },
  gift_gold: { label: "إهداء ذهب لاعب آخر", kind: "spend" },

  // ==== مكافآت اللعب ====
  claim_vip_daily: { label: "مكافأة VIP اليومية", kind: "vip_daily" },
  claim_elite_vip_daily_gems: { label: "مكافأة Elite VIP اليومية", kind: "elite_vip_daily" },
  claim_daily_login: { label: "مكافأة الدخول اليومي", kind: "other_gain" },
  claim_daily_login_pirate: { label: "مكافأة الدخول اليومي (القراصنة)", kind: "other_gain" },
  claim_quest: { label: "مكافأة مهمة يومية", kind: "other_gain" },
  claim_daily_quest: { label: "مكافأة مهمة يومية", kind: "other_gain" },
  claim_achievement: { label: "مكافأة إنجاز", kind: "other_gain" },
  claim_phone_verification_reward: { label: "مكافأة توثيق الجوال", kind: "other_gain" },
  collect_fishing_reward: { label: "ناتج رحلة صيد (جواهر الحوت الأرجواني)", kind: "other_gain" },
  finalize_competition: { label: "جائزة فعالية صيد", kind: "other_gain" },
  distribute_tribe_fish_event_prizes: { label: "جائزة فعالية القبائل", kind: "other_gain" },
  distribute_weekly_xp_prizes: { label: "جائزة الخبرة الأسبوعية", kind: "other_gain" },
  close_season: { label: "جائزة نهاية الموسم", kind: "other_gain" },
  attack_grant_tribe_gems: { label: "جواهر نشاط القبيلة (هجوم)", kind: "tribe_daily_gem" },
  tribe_donation_grant_gems: { label: "جواهر تبرعات القبيلة", kind: "tribe_daily_gem" },
  grant_referral_bonus: { label: "مكافأة دعوة صديق", kind: "referral" },
  award_pending_referral_if_qualified: { label: "مكافأة دعوة صديق (بعد التأهل)", kind: "referral" },
  arena_attack_request: { label: "ساحة التنين (رسوم/جائزة)", kind: "other_gain" },
  refresh_boss_attacks: { label: "شراء محاولات زعيم إضافية", kind: "spend" },
  open_lucky_box: { label: "فتح صندوق الحظ", kind: "spend_lucky_box" },
  open_lootbox: { label: "فتح صندوق", kind: "spend_lootbox" },

  // ==== مصاريف ====
  buy_with_gems: { label: "شراء بالجواهر (متجر)", kind: "spend_item" },
  buy_with_coins: { label: "شراء بالكوينز (خصم جواهر احتياطي)", kind: "spend_item" },
  buy_catalog_item: { label: "شراء عنصر من الكتالوج", kind: "spend_item" },
  buy_anti_to_inventory: { label: "شراء مضاد", kind: "spend_item" },
  buy_disabler_to_inventory: { label: "شراء معطّل", kind: "spend_item" },
  buy_shield_to_inventory: { label: "شراء درع", kind: "spend_item" },
  buy_protection: { label: "شراء حماية", kind: "spend_item" },
  buy_lootbox: { label: "شراء صندوق", kind: "spend_lootbox" },
  buy_background: { label: "شراء خلفية", kind: "spend_item" },
  buy_background_gems: { label: "شراء خلفية بالجواهر", kind: "spend_item" },
  buy_dragon_equipment: { label: "سحب/شراء معدة تنين", kind: "spend_dragon_draw" },
  upgrade_dragon_item: { label: "ترقية معدة تنين", kind: "spend_dragon_upgrade" },
  smelt_dragon_items: { label: "صهر معدات تنين", kind: "spend_dragon_smelt" },
  buy_market_freeze: { label: "تجميد أسعار السوق", kind: "spend_item" },
  buy_trader_unlock: { label: "فتح التاجر", kind: "spend_item" },
  buy_phoenix_pack_1: { label: "شراء باقة العنقاء 1", kind: "spend_item" },
  buy_phoenix_pack_3: { label: "شراء باقة العنقاء 3", kind: "spend_item" },
  buy_ship_by_code: { label: "شراء سفينة", kind: "spend_item" },
  sell_ship: { label: "بيع سفينة", kind: "other_gain" },
  upgrade_ship_storage: { label: "ترقية تخزين السفينة", kind: "spend_item" },
  repair_ship_instant: { label: "إصلاح فوري للسفينة", kind: "spend_item" },
  repair_burned_bg: { label: "إصلاح الخلفية المحروقة", kind: "spend_item" },
  repair_target_burned_bg: { label: "إصلاح خلفية لاعب آخر", kind: "spend_item" },
  remove_ad_bombs: { label: "إزالة القنابل الإعلانية", kind: "spend_item" },
  skip_shield_type_cooldown: { label: "تخطي انتظار الدرع", kind: "spend_item" },
  rent_market_capacity: { label: "استئجار سعة سوق السمك", kind: "spend_item" },
  market_start_upgrade: { label: "بدء ترقية السوق", kind: "spend_item" },
  market_finish_upgrade_with_gems: { label: "إنهاء ترقية السوق بالجواهر", kind: "spend_item" },
  fish_market_start_upgrade: { label: "بدء ترقية سوق السمك", kind: "spend_item" },
  fish_market_finish_upgrade_with_gems: { label: "إنهاء ترقية سوق السمك بالجواهر", kind: "spend_item" },
  upgrade_daughter_with_gems: { label: "ترقية الابنة بالجواهر", kind: "spend_item" },
  rename_tribe: { label: "تغيير اسم القبيلة", kind: "spend_item" },
  trade_create: { label: "رسوم إنشاء مقايضة", kind: "spend_item" },
  trade_accept: { label: "رسوم قبول مقايضة", kind: "spend_item" },
  sell_fish: { label: "بيع سمك", kind: "other_gain" },
  sell_fish_by_qty: { label: "بيع سمك", kind: "other_gain" },
  add_xp: { label: "مكافأة خبرة/مستوى", kind: "other_gain" },
  award_vip_cashback_gems: { label: "كاش باك VIP (جواهر)", kind: "other_gain" },
  
  buy_kraken: { label: "شراء قنبلة الكراكن", kind: "spend_item" },
  market_start_upgrade_ship: { label: "بدء ترقية سوق السفن", kind: "spend_item" },
};

/** Arabic word map to humanize any unmapped database operation. */
const WORDS_AR: Record<string, string> = {
  buy: "شراء", sell: "بيع", upgrade: "ترقية", start: "بدء", finish: "إنهاء", claim: "استلام",
  grant: "منح", revoke: "سحب", refund: "استرداد", gift: "هدية", open: "فتح", repair: "إصلاح",
  rent: "استئجار", remove: "إزالة", skip: "تخطي", rename: "تغيير اسم", reset: "إعادة ضبط",
  redeem: "استبدال", trade: "مقايضة", market: "السوق", fish: "السمك", ship: "السفينة",
  ships: "السفن", storage: "التخزين", gems: "بالجواهر", coins: "بالكوينز", with: "",
  code: "كود", daily: "اليومية", login: "الدخول", quest: "مهمة", achievement: "إنجاز",
  vip: "VIP", elite: "Elite", dragon: "التنين", equipment: "المعدات", smelt: "صهر",
  lootbox: "صندوق", lucky: "الحظ", box: "صندوق", tribe: "القبيلة", referral: "الدعوات",
  season: "الموسم", weekly: "الأسبوعية", prizes: "الجوائز", distribute: "توزيع",
  freeze: "تجميد", capacity: "السعة", shield: "الدرع", cooldown: "الانتظار",
  admin: "الإدارة", player: "اللاعب", set: "تعديل", full: "الكامل", currency: "الرصيد",
  bonus: "مكافأة", cashback: "كاش باك", boss: "الزعيم", attacks: "المحاولات",
  arena: "الساحة", instant: "فوري", background: "الخلفية", burned: "المحروقة",
  bg: "الخلفية", protection: "الحماية", anti: "مضاد", disabler: "معطّل", inventory: "المخزون",
  to: "", by: "", for: "", of: "", the: "", and: "", pack: "باقة", phoenix: "العنقاء",
  award: "منح", pending: "المعلّقة", qualified: "المؤهلة", reward: "مكافأة", fisher: "الصياد",
  golden: "الذهبي", whale: "الحوت", royal: "الملكي", catch: "صيد", competition: "الفعالية",
  finalize: "إنهاء", close: "إغلاق", event: "الفعالية", donation: "التبرع", qa: "اختبار",
};

function humanizeFn(fn: string): string {
  const parts = fn.split(/[_:]+/).filter(Boolean);
  const words = parts.map((p) => WORDS_AR[p] ?? WORDS_AR[p.toLowerCase()] ?? "").filter(Boolean);
  return words.length > 0 ? words.join(" ") : "عملية داخل اللعبة";
}

function resolveFnSource(src: string): { label: string; kind: GemReportEvent["kind"]; fn: string } | null {
  const m = /^(fn|rpc):(.+)$/.exec(src);
  if (!m) return null;
  const fn = m[2]!;
  const hit = FN_SOURCE_LABELS[fn];
  if (hit) return { ...hit, fn };
  // Unknown: build a readable Arabic phrase — never show the raw code.
  const isAdmin = fn.startsWith("admin_");
  const human = humanizeFn(fn);
  return {
    label: isAdmin ? `عملية إدارية: ${human}` : human,
    kind: isAdmin ? "admin_edit" : "other_gain",
    fn,
  };
}



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
        .select("acquired_at,item_type,item_id,quantity")
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


    type Src = { at: number; kind: GemReportEvent["kind"]; label_ar: string; product_label?: string; product_id?: string; amount_usd?: number; expect_gems?: number; detail?: string; direction?: "in" | "out"; used?: boolean };
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
      let gems = 0;
      if (typeof det.gems === "number") gems = det.gems;
      else if (det.after?.gems != null && det.before?.gems != null) gems = Number(det.after.gems) - Number(det.before.gems);
      if (gems === 0) continue;
      const isGift = a.action?.includes("gift");
      const adminName = adminNames.get(a.admin_id) ?? String(a.admin_id).slice(0, 8);
      sources.push({
        at: new Date(a.created_at).getTime(),
        kind: isGift ? "admin_gift" : "admin_edit",
        label_ar: isGift ? `هدية من الإدارة: ${adminName}` : `تعديل يدوي من الإدارة: ${adminName}`,
        expect_gems: gems,
        direction: gems > 0 ? "in" : "out",
        detail: a.reason || undefined,
      });
    }

    // === Spend sources (delta < 0) ===
    for (const b of (adBombs.data ?? []) as any[]) {
      sources.push({
        at: new Date(b.created_at ?? b.started_at).getTime(),
        kind: "spend_ad_bomb",
        label_ar: "إطلاق قنبلة إعلانية",
        direction: "out",
      });
    }
    for (const l of (luckyBox.data ?? []) as any[]) {
      sources.push({
        at: new Date(l.created_at).getTime(),
        kind: "spend_lucky_box",
        label_ar: "فتح صندوق الحظ",
        detail: l.label ? `الجائزة: ${l.label}` : undefined,
        direction: "out",
      });
    }
    for (const lb of (lootboxes.data ?? []) as any[]) {
      const nm = lb.lootbox_types?.name_ar ?? lb.lootbox_types?.name ?? "صندوق";
      const g = Number(lb.lootbox_types?.price_gems ?? 0);
      sources.push({
        at: new Date(lb.acquired_at).getTime(),
        kind: "spend_lootbox",
        label_ar: `شراء صندوق: ${nm}`,
        expect_gems: g > 0 ? g : undefined,
        direction: "out",
      });
    }
    for (const d of (dragonEq.data ?? []) as any[]) {
      sources.push({
        at: new Date(d.acquired_at).getTime(),
        kind: "spend_dragon_draw",
        label_ar: `سحب معدة تنين (${d.slot ?? ""} - ${d.rarity ?? ""})`,
        direction: "out",
      });
    }
    for (const s of (supportSent.data ?? []) as any[]) {
      const g = Number(s.amount ?? 0);
      sources.push({
        at: new Date(s.created_at).getTime(),
        kind: "spend_support_gift",
        label_ar: `دعم طاقم: ${ITEM_LABELS_AR[s.kind] ?? s.kind}`,
        expect_gems: g > 0 ? g : undefined,
        direction: "out",
      });
    }
    for (const it of (invPurchases.data ?? []) as any[]) {
      sources.push({
        at: new Date(it.acquired_at).getTime(),
        kind: "spend_item",
        label_ar: itemLabel(it.item_type, it.item_id),
        direction: "out",
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
      const wantDir: "in" | "out" = delta > 0 ? "in" : "out";
      const win = delta > 0 ? WINDOW_MS : SPEND_WINDOW_MS;
      const wantAbs = Math.abs(delta);

      let match: Src | undefined;
      let best: { src: Src; score: number } | undefined;
      for (const s of sources) {
        if (s.used) continue;
        if (s.direction && s.direction !== wantDir) continue;
        const dt = Math.abs(s.at - at);
        if (dt > win) continue;
        const gemsOk = s.expect_gems == null || s.expect_gems === wantAbs;
        if (!gemsOk) continue;
        const score = dt + (s.expect_gems === wantAbs ? 0 : 30_000);
        if (!best || score < best.score) best = { src: s, score };
      }
      if (best) {
        best.src.used = true;
        match = best.src;
      }

      let kind: GemReportEvent["kind"] = delta < 0 ? "spend" : "other_gain";
      let label = delta < 0 ? "صرف داخل اللعبة (سجل قديم بدون تتبع)" : "إضافة قديمة بدون تتبع";
      let product_label: string | undefined;
      let product_id: string | undefined;
      let amount_usd: number | undefined;
      let detail: string | undefined;
      let exact = false;

      // 1) Exact source recorded by the database (highest trust)
      const srcKey = (a.source as string | null) ?? null;
      const fnSrc = srcKey ? resolveFnSource(srcKey) : null;
      if (srcKey && SOURCE_LABELS_AR[srcKey]) {
        const s = SOURCE_LABELS_AR[srcKey];
        kind = s.kind;
        label = s.label;
        detail = a.reason || undefined;
        exact = true;
      } else if (fnSrc) {
        kind = fnSrc.kind;
        label = fnSrc.label;
        detail = a.reason || `العملية: ${fnSrc.fn}`;
        exact = true;
      } else if (srcKey) {
        kind = delta < 0 ? "spend" : "other_gain";
        label = `مصدر مسجّل: ${srcKey}`;
        detail = a.reason || undefined;
        exact = true;
      }

      // 2) Correlated event (older rows recorded before exact tracking)
      if (!exact && match) {
        kind = match.kind;
        label = `${match.label_ar} (مطابقة زمنية)`;
        product_label = match.product_label;
        product_id = match.product_id;
        amount_usd = match.amount_usd;
        detail = match.detail;
      } else if (exact && match) {
        // keep exact label but enrich with product/price info
        product_label = product_label ?? match.product_label;
        product_id = product_id ?? match.product_id;
        amount_usd = amount_usd ?? match.amount_usd;
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
