import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logAudit } from "@/hooks/use-admin";

export const Route = createFileRoute("/admin/weekly-xp")({
  component: WeeklyXpAdmin,
  ssr: false,
  head: () => ({ meta: [{ title: "مسابقة XP الأسبوعية — Admin" }] }),
});

type Tier = { rank: number; coins: number; gems: number; xp: number; text: string };
type Config = {
  enabled: boolean;
  title: string;
  description: string;
  prize_tiers: Tier[];
  week_started_at: string;
  last_distributed_at: string | null;
};
type LbRow = {
  user_id: string;
  display_name: string;
  avatar_emoji: string;
  avatar_url: string | null;
  level: number;
  weekly_xp: number;
};

const emptyTier = (rank: number): Tier => ({ rank, coins: 0, gems: 0, xp: 0, text: "" });

type PlayerHit = { id: string; display_name: string; username: string | null; avatar_emoji: string | null };

function WeeklyXpAdmin() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [board, setBoard] = useState<LbRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  // Adjust weekly XP
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlayerHit[]>([]);
  const [selected, setSelected] = useState<PlayerHit | null>(null);
  const [currentXp, setCurrentXp] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [adjusting, setAdjusting] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits([]); return; }
    let cancel = false;
    const t = setTimeout(async () => {
      const { data } = await supabase.from("profiles")
        .select("id,display_name,username,avatar_emoji")
        .or(`display_name.ilike.%${q}%,username.ilike.%${q}%`)
        .limit(8);
      if (!cancel) setHits((data ?? []) as PlayerHit[]);
    }, 250);
    return () => { cancel = true; clearTimeout(t); };
  }, [query]);

  const loadCurrentXp = async (uid: string) => {
    const { data } = await supabase.from("profiles").select("weekly_xp").eq("id", uid).maybeSingle();
    setCurrentXp(Number(((data as { weekly_xp?: number } | null)?.weekly_xp) ?? 0));
  };

  useEffect(() => {
    if (!selected) { setCurrentXp(null); return; }
    loadCurrentXp(selected.id);
    const ch = supabase.channel(`wxp-adm-${selected.id}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${selected.id}` },
        (payload) => {
          const row = payload.new as { weekly_xp?: number } | null;
          if (row && typeof row.weekly_xp === "number") setCurrentXp(row.weekly_xp);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selected]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("weekly_xp_config" as never)
      .select("*")
      .eq("id", true)
      .maybeSingle();
    if (error) toast.error(error.message);
    if (data) {
      const c = data as unknown as Config;
      const tiers = (Array.isArray(c.prize_tiers) ? c.prize_tiers : []).map((t, i) => ({
        rank: t.rank ?? i + 1,
        coins: Number(t.coins) || 0,
        gems: Number(t.gems) || 0,
        xp: Number(t.xp) || 0,
        text: t.text ?? "",
      }));
      setCfg({ ...c, prize_tiers: tiers });
    }
    const { data: lb } = await supabase.rpc("get_weekly_xp_leaderboard" as never, { _limit: 50 } as never);
    setBoard((lb ?? []) as LbRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateTier = (i: number, patch: Partial<Tier>) => {
    if (!cfg) return;
    const tiers = cfg.prize_tiers.slice();
    tiers[i] = { ...tiers[i], ...patch };
    setCfg({ ...cfg, prize_tiers: tiers });
  };

  const addTier = () => {
    if (!cfg) return;
    if (cfg.prize_tiers.length >= 50) { toast.error("الحد الأقصى 50 مرتبة"); return; }
    setCfg({ ...cfg, prize_tiers: [...cfg.prize_tiers, emptyTier(cfg.prize_tiers.length + 1)] });
  };

  const removeTier = (i: number) => {
    if (!cfg) return;
    const tiers = cfg.prize_tiers.filter((_, idx) => idx !== i).map((t, idx) => ({ ...t, rank: idx + 1 }));
    setCfg({ ...cfg, prize_tiers: tiers });
  };

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    const tiers = cfg.prize_tiers.map((t, i) => ({ ...t, rank: i + 1 }));
    const { error } = await supabase
      .from("weekly_xp_config" as never)
      .update({
        enabled: cfg.enabled,
        title: cfg.title,
        description: cfg.description,
        prize_tiers: tiers,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", true);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    await logAudit("weekly_xp_config_update", null, { tiers: tiers.length, enabled: cfg.enabled });
    toast.success("تم الحفظ");
    load();
  };

  const distributeNow = async () => {
    if (!confirm("توزيع الجوائز الآن وتصفير XP الأسبوعي؟ هذا الإجراء لا يمكن التراجع عنه.")) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("distribute_weekly_xp_prizes" as never);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const n = ((data as { distributed?: number } | null)?.distributed) ?? 0;
    await logAudit("weekly_xp_distribute_now", null, { winners: n });
    toast.success(`تم التوزيع لـ ${n} فائزين`);
    load();
  };

  const adjust = async (sign: 1 | -1) => {
    if (!selected) { toast.error("اختر لاعب أولاً"); return; }
    const n = Math.floor(Number(amount));
    if (!Number.isFinite(n) || n <= 0) { toast.error("ادخل رقم موجب"); return; }
    setAdjusting(true);
    const { data, error } = await supabase.rpc("admin_adjust_weekly_xp" as never,
      { _user_id: selected.id, _delta: sign * n } as never);
    setAdjusting(false);
    if (error) { toast.error(error.message); return; }
    setCurrentXp(Number(data ?? 0));
    setAmount("");
    await logAudit(sign > 0 ? "weekly_xp_grant" : "weekly_xp_deduct", selected.id, { amount: n });
    toast.success(sign > 0 ? `تم منح ${n.toLocaleString()} XP` : `تم خصم ${n.toLocaleString()} XP`);
    load();
  };

  if (loading || !cfg) {
    return <div className="p-6 text-slate-400">جاري التحميل...</div>;
  }

  // Next distribution: Friday 21:00 UTC = Saturday 00:00 KSA
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(21, 0, 0, 0);
  const day = now.getUTCDay();
  let daysToFri = (5 - day + 7) % 7;
  if (daysToFri === 0 && now.getUTCHours() >= 21) daysToFri = 7;
  next.setUTCDate(now.getUTCDate() + daysToFri);

  return (
    <div className="p-3 md:p-6 max-w-4xl mx-auto" dir="rtl">
      <div className="mb-4 flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">🏆 مسابقة XP الأسبوعية</h1>
          <p className="text-slate-400 text-xs md:text-sm mt-1">
            يتم التوزيع تلقائياً كل يوم اثنين 00:00 UTC، ثم يُصفّر العدّاد الأسبوعي.
          </p>
        </div>
        <button onClick={distributeNow} disabled={busy}
          className="px-3 py-1.5 rounded-lg bg-red-600/30 hover:bg-red-600/50 text-red-200 border border-red-500/40 text-xs disabled:opacity-50">
          {busy ? "⏳..." : "⚡ توزيع الآن (يدوي)"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 text-sm">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <div className="text-xs text-slate-500">الأسبوع بدأ في</div>
          <div className="font-bold mt-1">{new Date(cfg.week_started_at).toLocaleString("ar")}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <div className="text-xs text-slate-500">آخر توزيع</div>
          <div className="font-bold mt-1">{cfg.last_distributed_at ? new Date(cfg.last_distributed_at).toLocaleString("ar") : "—"}</div>
        </div>
        <div className="rounded-xl border border-amber-700/40 bg-amber-900/10 p-3">
          <div className="text-xs text-amber-400/70">التوزيع التلقائي القادم</div>
          <div className="font-bold mt-1 text-amber-200">{next.toLocaleString("ar")}</div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 mb-4 space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} className="w-4 h-4 accent-emerald-500" />
          <span>تفعيل المسابقة</span>
        </label>
        <div>
          <label className="text-xs text-slate-400">العنوان</label>
          <input value={cfg.title} onChange={(e) => setCfg({ ...cfg, title: e.target.value })}
            className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm" />
        </div>
        <div>
          <label className="text-xs text-slate-400">الوصف</label>
          <textarea value={cfg.description} onChange={(e) => setCfg({ ...cfg, description: e.target.value })} rows={2}
            className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm resize-none" />
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">🎁 قائمة الجوائز ({cfg.prize_tiers.length})</h2>
          <button onClick={addTier} className="px-3 py-1.5 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-500/40 text-xs">
            + إضافة مرتبة
          </button>
        </div>

        {cfg.prize_tiers.length === 0 && (
          <div className="text-center text-slate-500 text-sm py-6">لا توجد جوائز بعد — أضف مرتبة للبداية.</div>
        )}

        <div className="space-y-2">
          {cfg.prize_tiers.map((t, i) => (
            <div key={i} className="rounded-lg bg-slate-950/60 border border-slate-800 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="font-bold text-amber-300">المركز #{i + 1}</div>
                <button onClick={() => removeTier(i)} className="text-xs text-red-400 hover:text-red-300">🗑 حذف</button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <label className="block">
                  <span className="text-slate-400">🪙 عملات</span>
                  <input type="number" min="0" value={t.coins}
                    onChange={(e) => updateTier(i, { coins: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-full mt-1 px-2 py-1.5 rounded bg-slate-800 border border-slate-700" />
                </label>
                <label className="block">
                  <span className="text-slate-400">💎 جواهر</span>
                  <input type="number" min="0" value={t.gems}
                    onChange={(e) => updateTier(i, { gems: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-full mt-1 px-2 py-1.5 rounded bg-slate-800 border border-slate-700" />
                </label>
                <label className="block">
                  <span className="text-slate-400">⭐ XP</span>
                  <input type="number" min="0" value={t.xp}
                    onChange={(e) => updateTier(i, { xp: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-full mt-1 px-2 py-1.5 rounded bg-slate-800 border border-slate-700" />
                </label>
              </div>
              <label className="block mt-2 text-xs">
                <span className="text-slate-400">🎁 جائزة نصّية (اختياري)</span>
                <input value={t.text} onChange={(e) => updateTier(i, { text: e.target.value })}
                  placeholder="مثال: لقب VIP، إطار خاص..."
                  className="w-full mt-1 px-2 py-1.5 rounded bg-slate-800 border border-slate-700" />
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        <button onClick={save} disabled={saving}
          className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-semibold">
          {saving ? "⏳ حفظ..." : "💾 حفظ التغييرات"}
        </button>
      </div>

      <section className="rounded-xl border border-cyan-700/40 bg-cyan-900/10 p-4 space-y-3 mb-4">
        <div>
          <div className="font-semibold">⚖️ تعديل XP الأسبوعي للاعب</div>
          <div className="text-xs text-slate-400">ابحث عن لاعب، ثم امنح أو اخصم نقاط XP الأسبوعية. يُحدَّث فوراً في الترتيب.</div>
        </div>
        <div className="relative">
          <input
            className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-700 text-sm"
            placeholder="🔎 ابحث عن لاعب..."
            value={selected ? `${selected.avatar_emoji ?? "🧑‍✈️"} ${selected.display_name}${selected.username ? ` @${selected.username}` : ""}` : query}
            onChange={(e) => { setSelected(null); setQuery(e.target.value); }}
          />
          {!selected && hits.length > 0 && (
            <div className="absolute z-10 top-full mt-1 w-full rounded-lg bg-slate-900 border border-slate-700 shadow-lg max-h-64 overflow-auto">
              {hits.map((h) => (
                <button key={h.id} type="button"
                  onClick={() => { setSelected(h); setHits([]); setQuery(""); }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-800 text-sm text-start">
                  <span className="text-lg">{h.avatar_emoji ?? "🧑‍✈️"}</span>
                  <span className="flex-1 truncate">{h.display_name}</span>
                  {h.username && <span className="text-xs text-slate-400">@{h.username}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {selected && (
          <div className="flex items-center justify-between text-sm bg-slate-900/60 rounded px-3 py-2 border border-slate-700">
            <span className="text-slate-300">XP الحالي هذا الأسبوع:</span>
            <span className="font-black text-amber-300 tabular-nums">{(currentXp ?? 0).toLocaleString()} ⭐</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input type="number" min={1} placeholder="مقدار XP"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            className="flex-1 px-3 py-2 rounded bg-slate-800 border border-slate-700 text-sm" />
          <button disabled={adjusting} onClick={() => adjust(1)}
            className="px-3 py-2 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold disabled:opacity-50">+ منح</button>
          <button disabled={adjusting} onClick={() => adjust(-1)}
            className="px-3 py-2 rounded bg-amber-700 hover:bg-amber-600 text-white text-xs font-bold disabled:opacity-50">− خصم</button>
        </div>
      </section>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="font-bold mb-3">📊 الترتيب الحالي (أعلى 50)</h2>
        {board.length === 0 ? (
          <div className="text-center text-slate-500 text-sm py-4">لا يوجد لاعبون مسجلين بعد هذا الأسبوع.</div>
        ) : (
          <ol className="space-y-1.5">
            {board.map((r, i) => (
              <li key={r.user_id} className="flex items-center gap-3 p-2 rounded-lg bg-slate-950/40 border border-slate-800 text-sm">
                <div className="w-10 text-center font-bold text-amber-300">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                </div>
                {r.avatar_url
                  ? <img src={r.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                  : <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center">{r.avatar_emoji || "🧑‍✈️"}</div>}
                <div className="flex-1 min-w-0">
                  <div className="truncate">{r.display_name}</div>
                  <div className="text-[10px] text-slate-500">Lv {r.level}</div>
                </div>
                <div className="font-bold text-amber-300">{r.weekly_xp.toLocaleString()} XP</div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
