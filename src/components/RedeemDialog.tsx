import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { refreshProfile } from "@/hooks/use-auth";
import { toast } from "sonner";

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
  reward_type: "bundle" | "item" | "ship";
  item_id: string | null;
  reward_coins: number;
  reward_gems: number;
  reward_xp: number;
  quantity: number;
  extra_rewards?: ExtraReward[] | null;
};

const ERR_MSG: Record<string, string> = {
  not_authenticated: "يجب تسجيل الدخول",
  invalid_code: "الكود غير صحيح",
  code_disabled: "هذا الكود معطل",
  code_expired: "انتهت صلاحية الكود",
  code_exhausted: "تم استخدام الكود كاملاً",
  already_redeemed: "لقد استخدمت هذا الكود من قبل",
};

export function RedeemDialog({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RedeemResult | null>(null);

  const submit = async () => {
    // Normalize: uppercase, trim, strip spaces and dashes so "abcd-1234" == "ABCD1234"
    const c = code.toUpperCase().replace(/[\s-]+/g, "").trim();
    if (!c) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("redeem_code", { p_code: c });
    setLoading(false);
    if (error) {
      const msg = (error.message || "").toLowerCase();
      // Find first known error key that appears anywhere in the message
      const matched = Object.keys(ERR_MSG).find((k) => msg.includes(k));
      toast.error(matched ? ERR_MSG[matched] : `تعذر استبدال الكود: ${error.message || ""}`);
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
              {result.reward_type === "item" && (
                <div>📦 {result.item_id} × {result.quantity}</div>
              )}
              {result.reward_type === "ship" && (
                <div>⛵ سفينة جديدة: {result.item_id}</div>
              )}
              {Array.isArray(result.extra_rewards) && result.extra_rewards.length > 0 && (
                <div className="mt-2 pt-2 border-t border-emerald-700/40 space-y-1 text-right">
                  {result.extra_rewards.map((r, i) => (
                    <div key={i}>
                      {r.type === "bundle" ? (
                        <>
                          {(r.coins ?? 0) > 0 && <span>💰 {(r.coins ?? 0).toLocaleString()} ذهب </span>}
                          {(r.gems ?? 0) > 0 && <span>💎 {(r.gems ?? 0).toLocaleString()} جوهرة </span>}
                          {(r.xp ?? 0) > 0 && <span>✨ {(r.xp ?? 0).toLocaleString()} خبرة</span>}
                        </>
                      ) : r.type === "ship" ? (
                        <span>⛵ {r.item_id}{(r.quantity ?? 1) > 1 ? ` × ${r.quantity}` : ""}</span>
                      ) : (
                        <span>📦 {r.item_id} × {r.quantity ?? 1}</span>
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
