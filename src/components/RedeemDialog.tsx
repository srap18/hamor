import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { rateLimit } from "@/lib/rate-limit";

import { refreshProfile } from "@/hooks/use-auth";
import { toast } from "sonner";
import { CREWS } from "@/lib/crews";
import { WEAPONS } from "@/lib/weapons";
import { BACKGROUNDS } from "@/lib/backgrounds";
import { ALL_FRAMES } from "@/lib/frames";
import { getShipByCode } from "@/lib/ships";

type ExtraReward = {
  type: "bundle" | "item" | "ship";
  item_id?: string | null;
  quantity?: number;
  coins?: number;
  gems?: number;
  xp?: number;
};

type RedeemResult = {
  ok: boolean;
  reward_type: "bundle" | "item" | "ship" | "lootbox" | "vip" | "elite_vip" | "bundle_multi";
  item_id: string | null;
  item_type?: string | null;
  reward_coins: number;
  reward_gems: number;
  reward_xp: number;
  reward_vip_level?: number;
  reward_vip_days?: number;
  reward_elite_vip_level?: number;
  reward_elite_vip_days?: number;
  quantity: number;
  extra_rewards?: ExtraReward[] | null;
  meta?: Record<string, unknown> | null;
};


const ERR_MSG: Record<string, string> = {
  not_authenticated: "يجب تسجيل الدخول",
  invalid_code: "الكود غير صحيح",
  code_disabled: "هذا الكود معطل",
  code_expired: "انتهت صلاحية الكود",
  code_exhausted: "تم استخدام الكود كاملاً",
  already_redeemed: "لقد استخدمت هذا الكود من قبل",
  already_redeemed_on_this_device: "تم استخدام هذا الكود من حساب آخر على نفس الجهاز — لا يمكن تفعيله مرتين",
  "fleet and storage full": "الأسطول والمخزن ممتلئان",
  "storage full": "المخزن ممتلئ",
  "fleet full": "الأسطول ممتلئ",
};

// Arabic name + image lookup for item codes
type ItemMeta = { name: string; image?: string; emoji?: string };
const ITEM_META: Record<string, ItemMeta> = {};
CREWS.forEach((c) => { ITEM_META[c.id] = { name: c.name, image: c.image, emoji: c.emoji }; });
WEAPONS.forEach((w) => { ITEM_META[w.id] = { name: w.name, image: w.image, emoji: w.emoji }; });
BACKGROUNDS.forEach((b) => { ITEM_META[b.id] = { name: b.name, image: b.image, emoji: "🌅" }; });
ALL_FRAMES.forEach((f) => { ITEM_META[f.id] = { name: f.name, image: f.imageUrl, emoji: f.preview }; });

function getItemMeta(code: string | null | undefined, type?: string): ItemMeta {
  if (!code) return { name: "", emoji: "📦" };
  if (ITEM_META[code]) return ITEM_META[code];
  if (type === "ship") {
    try {
      const s = getShipByCode(code);
      return { name: s.name ?? code, image: s.image, emoji: "⛵" };
    } catch { /* ignore */ }
  }
  return { name: code, emoji: type === "ship" ? "⛵" : "📦" };
}

function ItemLine({ code, type, qty }: { code: string | null | undefined; type: string; qty: number }) {
  const meta = getItemMeta(code, type);
  return (
    <div className="flex items-center justify-end gap-2 py-0.5">
      <span className="font-bold">{meta.name}</span>
      {qty > 1 && <span className="text-amber-300">× {qty}</span>}
      {meta.image ? (
        <img src={meta.image} alt={`صورة عنصر ${meta.name}`} className="w-8 h-8 object-contain rounded" />
      ) : (
        <span className="text-xl">{meta.emoji ?? "📦"}</span>
      )}
    </div>
  );
}

export function RedeemDialog({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RedeemResult | null>(null);

  const submit = async () => {
    const c = code.toUpperCase().replace(/[\s-]+/g, "").trim();
    if (!c) return;
    if (loading) return;
    if (!(await rateLimit("redeem", 1500))) { toast.warning("تمهّل قليلاً قبل المحاولة مجدداً"); return; }
    setLoading(true);

    // Ensure we have a valid session — expired JWT is the most common cause
    // of a mysterious "generic error" on this dialog.
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        setLoading(false);
        toast.error("يجب تسجيل الدخول");
        return;
      }
    } catch { /* noop */ }

    const { data, error } = await supabase.rpc("redeem_code", { p_code: c });

    setLoading(false);
    if (error) {
      console.error("[redeem_code] error:", error);
      const parts = [
        error.message,
        (error as { details?: string }).details,
        (error as { hint?: string }).hint,
        (error as { code?: string }).code,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matched = Object.keys(ERR_MSG).find((k) => parts.includes(k));
      if (matched) {
        toast.error(ERR_MSG[matched]);
      } else {
        // Avoid appending the raw error text — it can trip the toast
        // sanitizer (JWT / supabase / file paths) and become a useless
        // "generic error" for the user.
        toast.error("تعذّر استبدال الكود — تحقق من الكود وحاول مرة ثانية");
      }
      return;
    }
    const r = data as unknown as RedeemResult;
    setResult(r);
    toast.success("🎉 تم استبدال الكود بنجاح");
    refreshProfile();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border-2 border-emerald-400/60 bg-gradient-to-b from-emerald-950 to-stone-950 shadow-2xl p-5 text-white"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-extrabold">🎟️ استبدال كود</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-sm">✕</button>
        </div>

        {result ? (
          <div className="space-y-3 text-center">
            <div className="text-5xl">🎁</div>
            <div className="text-emerald-200 font-bold">حصلت على:</div>
            <div className="rounded-lg bg-black/30 p-3 text-sm space-y-1">
              {result.reward_type === "bundle" && (
                <>
                  {result.reward_coins > 0 && <div>💰 {result.reward_coins.toLocaleString()} عملة</div>}
                  {result.reward_gems > 0 && <div>💎 {result.reward_gems.toLocaleString()} جوهرة</div>}
                  {result.reward_xp > 0 && <div>✨ {result.reward_xp.toLocaleString()} خبرة</div>}
                </>
              )}
              {(result.reward_type === "item" || result.reward_type === "ship" || result.reward_type === "lootbox") && (
                <ItemLine code={result.item_id} type={result.reward_type} qty={result.quantity || 1} />
              )}
              {result.reward_type === "vip" && result.item_id && (
                <div>👑 VIP مستوى {result.item_id} — {result.meta?.permanent ? "دائم" : `${result.quantity || 1} يوم`}</div>
              )}
              {result.reward_type === "elite_vip" && result.item_id && (
                <div>💎 Elite VIP مستوى {result.item_id} — {result.meta?.permanent ? "دائم" : `${result.quantity || 1} يوم`}</div>
              )}
              {(result.reward_vip_level ?? 0) > 0 && (
                <div>👑 +{result.reward_vip_level} مستوى VIP{(result.reward_vip_days ?? 0) > 0 ? ` — ${result.reward_vip_days} يوم` : " — دائم"}</div>
              )}
              {(result.reward_elite_vip_level ?? 0) > 0 && (
                <div>💎 +{result.reward_elite_vip_level} مستوى Elite VIP{(result.reward_elite_vip_days ?? 0) > 0 ? ` — ${result.reward_elite_vip_days} يوم` : " — دائم"}</div>
              )}
              {Array.isArray(result.extra_rewards) && result.extra_rewards.length > 0 && (

                <div className="mt-2 pt-2 border-t border-emerald-700/40 space-y-1 text-right">
                  {result.extra_rewards.map((r, i) => (
                    <div key={i}>
                      {r.type === "bundle" ? (
                        <div className="space-x-2 space-x-reverse">
                          {(r.coins ?? 0) > 0 && <span>💰 {(r.coins ?? 0).toLocaleString()} ذهب </span>}
                          {(r.gems ?? 0) > 0 && <span>💎 {(r.gems ?? 0).toLocaleString()} جوهرة </span>}
                          {(r.xp ?? 0) > 0 && <span>✨ {(r.xp ?? 0).toLocaleString()} خبرة</span>}
                        </div>
                      ) : (
                        <ItemLine code={r.item_id} type={r.type} qty={r.quantity ?? 1} />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-bold"
            >تم</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-emerald-200/80">
              أدخل كود الاستعمال الذي حصلت عليه من المشرف للحصول على المكافأة.
            </p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD-1234"
              autoFocus
              className="w-full bg-black/40 border-2 border-emerald-700 rounded-lg px-3 py-2.5 text-center text-lg font-mono tracking-[0.2em] text-amber-200 placeholder-emerald-700/60"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            />
            <button
              disabled={loading || !code.trim()}
              onClick={submit}
              className="w-full py-2.5 rounded-lg bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-400 hover:to-emerald-600 font-bold disabled:opacity-50"
            >
              {loading ? "جاري التحقق..." : "🎁 استبدال"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
