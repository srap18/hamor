import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BackButton } from "@/components/BackButton";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { confirmDialog } from "@/components/ConfirmDialog";
import { TRADE_GROUPS, tradeItemLabel, type TradeItemType } from "@/lib/trade-catalog";

// Fairness limits — mirrored server-side in public.trade_create
const MAX_PER_ITEM = 10;
const MAX_SIDE_TOTAL = 20;
const MAX_WANT_RATIO = 3;


export const Route = createFileRoute("/trade")({
  head: () => ({
    meta: [
      { title: "المقايضة — ملوك القراصنة" },
      { name: "description", content: "بادل الطواقم والأسلحة والدروع والمضادات مع اللاعبين بأمان كامل." },
      { property: "og:title", content: "المقايضة — ملوك القراصنة" },
      { property: "og:description", content: "بادل الطواقم والأسلحة والدروع والمضادات مع اللاعبين بأمان كامل." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TradePage,
});

interface OfferItem { item_type: string; item_id: string; quantity: number }
interface Offer {
  id: string;
  creator_id: string;
  creator_name: string | null;
  creator_avatar: string | null;
  created_at: string;
  expires_at: string;
  note: string | null;
  mine: boolean;
  give: OfferItem[];
  want: OfferItem[];
}
interface InvRow { item_type: string; item_id: string; quantity: number; meta: unknown }
type Basket = Record<string, { type: TradeItemType; id: string; qty: number }>;

const HOURS = [6, 12, 24, 48];

function ItemChip({ it }: { it: OfferItem }) {
  const meta = tradeItemLabel(it.item_type, it.item_id);
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary/50 border border-border text-[11px] font-bold">
      {meta.image ? <img src={meta.image} alt={meta.name} className="w-4 h-4 object-contain" loading="lazy" /> : <span>{meta.emoji}</span>}
      {meta.name} ×{it.quantity}
    </span>
  );
}

function remaining(expires: string) {
  const ms = new Date(expires).getTime() - Date.now();
  if (ms <= 0) return "منتهي";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}س ${m}د` : `${m}د`;
}

function basketTotal(b: Basket) {
  return Object.values(b).reduce((s, v) => s + v.qty, 0);
}

function BasketPicker({
  title, basket, setBasket, owned, maxTotal,
}: {
  title: string;
  basket: Basket;
  setBasket: (b: Basket) => void;
  owned?: Record<string, number>;
  maxTotal?: number;
}) {
  const [group, setGroup] = useState<TradeItemType>("crew");
  const items = TRADE_GROUPS.find((g) => g.type === group)?.items ?? [];
  const total = basketTotal(basket);
  const cap = Math.min(MAX_SIDE_TOTAL, maxTotal ?? MAX_SIDE_TOTAL);
  const bump = (type: TradeItemType, id: string, delta: number) => {
    const key = `${type}:${id}`;
    const cur = basket[key]?.qty ?? 0;
    let next = cur + delta;
    if (owned) next = Math.min(next, owned[key] ?? 0);
    next = Math.max(0, Math.min(MAX_PER_ITEM, next));
    if (delta > 0 && total - cur + next > cap) {
      toast.error(`الحد الأقصى ${cap} قطعة في هذه الجهة`);
      return;
    }
    const copy = { ...basket };
    if (next <= 0) delete copy[key];
    else copy[key] = { type, id, qty: next };
    setBasket(copy);
  };
  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-2">
      <div className="text-xs font-bold mb-2 flex items-center justify-between">
        <span>{title}</span>
        <span className="text-[10px] text-muted-foreground">{total}/{cap}</span>
      </div>

      <div className="flex gap-1 mb-2 flex-wrap">
        {TRADE_GROUPS.map((g) => (
          <button key={g.type} onClick={() => setGroup(g.type)}
            className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${group === g.type ? "bg-amber-500 text-amber-950 border-amber-300" : "bg-secondary/40 border-border text-muted-foreground"}`}>
            {g.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto">
        {items.map((it) => {
          const key = `${it.type}:${it.id}`;
          const n = basket[key]?.qty ?? 0;
          const have = owned ? owned[key] ?? 0 : null;
          const disabled = have !== null && have <= 0;
          return (
            <div key={key} className={`rounded-lg border p-1.5 flex items-center gap-1.5 ${disabled ? "opacity-40" : ""} ${n > 0 ? "border-amber-400 bg-amber-500/10" : "border-border bg-background/30"}`}>
              {it.image ? <img src={it.image} alt={it.name} className="w-6 h-6 object-contain" loading="lazy" /> : <span className="text-base">{it.emoji}</span>}
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold truncate">{it.name}</div>
                {have !== null && <div className="text-[9px] text-muted-foreground">عندك {have}</div>}
              </div>
              <div className="flex items-center gap-1">
                <button disabled={disabled} onClick={() => bump(it.type, it.id, -1)} className="w-5 h-5 rounded bg-secondary/70 text-xs font-bold active:scale-90">−</button>
                <span className="text-[11px] font-bold w-4 text-center">{n}</span>
                <button disabled={disabled} onClick={() => bump(it.type, it.id, +1)} className="w-5 h-5 rounded bg-secondary/70 text-xs font-bold active:scale-90">+</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TradePage() {
  const [status, setStatus] = useState<{ eligible: boolean; trade_allowed: boolean; market_level: number } | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [owned, setOwned] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [give, setGive] = useState<Basket>({});
  const [want, setWant] = useState<Basket>({});
  const [hours, setHours] = useState(24);
  const [note, setNote] = useState("");
  const [, setTick] = useState(0);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [pulse, setPulse] = useState(false);
  const knownIds = useRef<Set<string> | null>(null);

  const load = useCallback(async (silent = false) => {
    try {
      const [st, ls, { data: u }] = await Promise.all([
        (supabase as never as { rpc: (n: string) => Promise<{ data: unknown }> }).rpc("trade_my_status"),
        (supabase as never as { rpc: (n: string) => Promise<{ data: unknown }> }).rpc("trade_list"),
        supabase.auth.getUser(),
      ]);
      setStatus(st.data as never);
      setOffers((ls.data as Offer[]) ?? []);
      if (u.user) {
        const { data: inv } = await supabase
          .from("inventory")
          .select("item_type,item_id,quantity,meta")
          .eq("user_id", u.user.id);
        const map: Record<string, number> = {};
        for (const r of ((inv ?? []) as InvRow[])) {
          if ((r.meta as { assigned_ship_id?: string } | null)?.assigned_ship_id) continue;
          const type = r.item_type.startsWith("anti") ? "anti" : r.item_type;
          map[`${type}:${r.item_id}`] = (map[`${type}:${r.item_id}`] ?? 0) + (r.quantity ?? 0);
        }
        setOwned(map);
      }
    } catch (e) {
      console.error("[trade] load failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const toPayload = (b: Basket) =>
    Object.values(b).map((v) => ({ item_type: v.type, item_id: v.id, quantity: v.qty }));

  const blockedReason = useMemo(() => {
    if (!status) return null;
    if (!status.trade_allowed) return "🚫 المقايضة معطّلة على حسابك من قبل الإدارة.";
    if ((status.market_level ?? 1) < 28) return "🔒 يجب ترقية سوق السفن إلى المستوى 28 لفتح نظام المقايضة.";
    return null;
  }, [status]);

  const rpc = async (name: string, args: Record<string, unknown>) =>
    (supabase as never as { rpc: (n: string, a: unknown) => Promise<{ data: unknown; error: { message: string } | null }> }).rpc(name, args);

  const listItems = (arr: { item_type: string; item_id: string; quantity: number }[]) =>
    arr.map((i) => `• ${tradeItemLabel(i.item_type, i.item_id).name} ×${i.quantity}`).join("\n");

  const createOffer = async () => {
    if (busy) return;
    const g = toPayload(give); const w = toPayload(want);
    if (!g.length) { toast.error("اختر العناصر التي ستقدمها"); return; }
    if (!w.length) { toast.error("اختر العناصر التي تريدها"); return; }
    const gt = basketTotal(give); const wt = basketTotal(want);
    const maxWant = Math.max(3, gt * MAX_WANT_RATIO);
    if (wt > maxWant) {
      toast.error(`طلب غير معقول: الحد الأقصى ${maxWant} قطعة مقابل ما تقدّمه`);
      return;
    }
    const ok = await confirmDialog({
      title: "تأكيد نشر المقايضة",
      message: `ستقدّم:\n${listItems(g)}\n\nوتطلب:\n${listItems(w)}\n\nسيتم حجز عناصرك فوراً حتى القبول أو الإلغاء.`,
      confirmText: "نشر العرض",
    });
    if (!ok) return;
    setBusy("create");
    const { error } = await rpc("trade_create", { _give: g, _want: w, _hours: hours, _note: note || null });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("✅ تم نشر عرض المقايضة وحجز عناصرك");
    setGive({}); setWant({}); setNote(""); setCreating(false);
    load();
  };

  const cancelOffer = async (id: string) => {
    if (busy) return;
    const ok = await confirmDialog({
      title: "إلغاء العرض",
      message: "سيتم إلغاء العرض وإرجاع عناصرك المحجوزة إلى المخزن.",
      confirmText: "إلغاء العرض",
      cancelText: "تراجع",
      danger: true,
    });
    if (!ok) return;
    setBusy(id);
    const { error } = await rpc("trade_cancel", { _offer_id: id });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("↩️ تم إلغاء العرض وإرجاع عناصرك");
    load();
  };

  const acceptOffer = async (o: Offer) => {
    if (busy) return;
    const ok = await confirmDialog({
      title: "تأكيد المقايضة",
      message: `ستدفع من مخزنك:\n${listItems(o.want)}\n\nوستحصل على:\n${listItems(o.give)}\n\nالعملية نهائية ولا يمكن التراجع عنها.`,
      confirmText: "نعم، قايض",
    });
    if (!ok) return;
    setBusy(o.id);
    const { error } = await rpc("trade_accept", { _offer_id: o.id });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("🤝 تمت المقايضة بنجاح");
    load();
  };


  return (
    <div className="min-h-screen" dir="rtl" style={{ background: "radial-gradient(ellipse at top, oklch(0.30 0.10 250) 0%, oklch(0.12 0.06 245) 100%)" }}>
      <header className="sticky top-0 z-20 glass-hud border-b border-accent/30 px-3 pb-3 flex items-center gap-3" style={{ paddingTop: "max(1.75rem, calc(env(safe-area-inset-top) + 1.25rem))" }}>
        <BackButton className="w-10 h-10 rounded-xl glass-hud flex items-center justify-center text-lg active:scale-95">←</BackButton>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-glow">🤝 المقايضة</h1>
          <p className="text-[10px] text-muted-foreground">بادل الطواقم والأسلحة والدروع والمضادات</p>
        </div>
      </header>

      <div className="p-3 pb-8 space-y-3">
        {loading && <div className="text-center text-muted-foreground py-12">جاري التحميل…</div>}

        {!loading && blockedReason && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs font-bold text-amber-200">{blockedReason}</div>
        )}

        {!loading && !blockedReason && (
          <>
            {!creating ? (
              <button onClick={() => setCreating(true)}
                className="w-full py-3 rounded-xl bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 font-bold active:scale-95">
                ➕ إنشاء عرض مقايضة
              </button>
            ) : (
              <div className="rounded-2xl border border-accent/30 glass-hud p-3 space-y-3">
                <BasketPicker title="أقدّم (سيتم حجزه فوراً)" basket={give} setBasket={setGive} owned={owned} />
                <BasketPicker title="أطلب مقابله" basket={want} setBasket={setWant} maxTotal={Math.max(3, basketTotal(give) * MAX_WANT_RATIO)} />
                <div className="text-[10px] text-muted-foreground">⚖️ الحد: 10 قطع لكل عنصر، و20 قطعة لكل جهة، ولا يمكن طلب أكثر من 3 أضعاف ما تقدّمه.</div>
                <div className="flex gap-1 flex-wrap items-center">
                  <span className="text-[11px] text-muted-foreground">مدة العرض:</span>
                  {HOURS.map((h) => (
                    <button key={h} onClick={() => setHours(h)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${hours === h ? "bg-amber-500 text-amber-950 border-amber-300" : "bg-secondary/40 border-border text-muted-foreground"}`}>
                      {h} ساعة
                    </button>
                  ))}
                </div>
                <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 120))} placeholder="ملاحظة (اختياري)"
                  className="w-full px-3 py-2 rounded-lg bg-background/40 border border-border text-xs" />
                <div className="flex gap-2">
                  <button disabled={busy === "create"} onClick={createOffer}
                    className="flex-1 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold active:scale-95 disabled:opacity-50">
                    {busy === "create" ? "..." : "نشر العرض"}
                  </button>
                  <button onClick={() => setCreating(false)} className="px-4 py-2 rounded-xl bg-secondary/60 text-xs font-bold active:scale-95">إلغاء</button>
                </div>
              </div>
            )}
          </>
        )}

        {!loading && (
          <div className="space-y-2">
            <div className="text-xs font-bold text-muted-foreground">العروض النشطة ({offers.length})</div>
            {offers.length === 0 && <div className="text-center text-muted-foreground text-xs py-8">لا توجد عروض حالياً</div>}
            {offers.map((o) => (
              <div key={o.id} className={`rounded-2xl border p-3 space-y-2 ${o.mine ? "border-amber-400/50 bg-amber-500/5" : "border-border bg-secondary/20"}`}>
                <div className="flex items-center gap-2">
                  {o.creator_avatar
                    ? <img src={o.creator_avatar} alt={o.creator_name ?? "لاعب"} className="w-7 h-7 rounded-full object-cover" loading="lazy" />
                    : <div className="w-7 h-7 rounded-full bg-secondary/60 grid place-items-center text-xs">🏴‍☠️</div>}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold truncate">{o.creator_name ?? "لاعب"}{o.mine ? " (أنت)" : ""}</div>
                    <div className="text-[10px] text-muted-foreground">ينتهي بعد {remaining(o.expires_at)}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="text-[10px] text-emerald-300 font-bold">يقدّم:</span>
                  {o.give.map((it, i) => <ItemChip key={`g${i}`} it={it} />)}
                </div>
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="text-[10px] text-sky-300 font-bold">يطلب:</span>
                  {o.want.map((it, i) => <ItemChip key={`w${i}`} it={it} />)}
                </div>
                {o.note && <div className="text-[10px] text-muted-foreground">📝 {o.note}</div>}
                {o.mine ? (
                  <button disabled={busy === o.id} onClick={() => cancelOffer(o.id)}
                    className="w-full py-2 rounded-xl bg-rose-700/70 text-white text-xs font-bold active:scale-95 disabled:opacity-50">
                    {busy === o.id ? "..." : "إلغاء العرض واسترجاع العناصر"}
                  </button>
                ) : (
                  <button disabled={busy === o.id || !!blockedReason} onClick={() => acceptOffer(o)}
                    className="w-full py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold active:scale-95 disabled:opacity-50">
                    {busy === o.id ? "..." : "قبول المقايضة"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
