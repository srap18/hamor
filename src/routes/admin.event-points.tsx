import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logAudit } from "@/hooks/use-admin";
import { confirmDialog } from "@/components/ConfirmDialog";

export const Route = createFileRoute("/admin/event-points")({
  component: AdminEventPoints,
  ssr: false,
  head: () => ({ meta: [{ title: "تعديل نقاط الفعاليات — Admin" }] }),
});

type Kind = "competition" | "tribe_event" | "arena" | "weekly_xp" | "tribe_points";
type PlayerHit = { id: string; display_name: string; username: string | null; avatar_emoji: string | null };
type EventRow = { id: string; title: string; active: boolean; metric: string; starts_at: string; ends_at: string };
type TribeRow = { id: string; name: string; emblem: string };
type LogRow = {
  id: string; event_kind: string; event_id: string; user_id: string | null;
  tribe_id: string | null; delta: number; reason: string | null; created_at: string;
};

const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: "competition", label: "🏆 المسابقات", hint: "نقاط لاعب داخل مسابقة محددة" },
  { id: "tribe_event", label: "🎣 فعاليات القبائل", hint: "نقاط لاعب أو قبيلة داخل فعالية قبائل" },
  { id: "arena", label: "🏟️ الأرينا", hint: "نقاط الأسبوع الحالي للاعب" },
  { id: "weekly_xp", label: "⭐ XP الأسبوعية", hint: "نقاط XP الأسبوعية للاعب" },
  { id: "tribe_points", label: "🏴‍☠️ نقاط القبيلة", hint: "نقاط القبيلة العامة" },
];

function AdminEventPoints() {
  const [kind, setKind] = useState<Kind>("competition");

  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventId, setEventId] = useState<string>("");

  const [tribes, setTribes] = useState<TribeRow[]>([]);
  const [tribeId, setTribeId] = useState<string>("");
  const [target, setTarget] = useState<"player" | "tribe">("player");

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlayerHit[]>([]);
  const [selected, setSelected] = useState<PlayerHit | null>(null);
  const [parts, setParts] = useState<PlayerHit[]>([]);
  const [partsLoading, setPartsLoading] = useState(false);

  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [current, setCurrent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<LogRow[]>([]);


  const isEventKind = kind === "competition" || kind === "tribe_event";
  const usesTribe = kind === "tribe_points" || (kind === "tribe_event" && target === "tribe");

  // load event lists
  useEffect(() => {
    setEventId(""); setCurrent(null); setAmount("");
    if (kind === "competition") {
      supabase.from("competitions").select("id,title,active,metric,starts_at,ends_at")
        .order("starts_at", { ascending: false }).limit(50)
        .then(({ data }) => setEvents((data ?? []) as EventRow[]));
    } else if (kind === "tribe_event") {
      supabase.from("tribe_fish_events").select("id,title,active,metric,starts_at,ends_at")
        .order("starts_at", { ascending: false }).limit(50)
        .then(({ data }) => setEvents((data ?? []) as EventRow[]));
    } else {
      setEvents([]);
    }
    if (kind === "tribe_points" || kind === "tribe_event") {
      supabase.from("tribes").select("id,name,emblem").order("points", { ascending: false }).limit(300)
        .then(({ data }) => setTribes((data ?? []) as TribeRow[]));
    }
    if (kind !== "tribe_event") setTarget("player");
  }, [kind]);

  // player search
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

  const weekStartISO = () => {
    const d = new Date();
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  };

  const loadCurrent = useCallback(async () => {
    setCurrent(null);
    if (isEventKind) {
      if (!eventId) return;
      if (usesTribe ? !tribeId : !selected) return;
      const { data, error } = await supabase.rpc("event_score_total" as never, {
        _kind: kind, _event_id: eventId,
        _user: usesTribe ? null : selected!.id,
        _tribe: usesTribe ? tribeId : null,
      } as never);
      if (!error) setCurrent(Number(data ?? 0));
      return;
    }
    if (kind === "arena" && selected) {
      const { data } = await supabase.from("arena_scores").select("score")
        .eq("user_id", selected.id).eq("week_start", weekStartISO()).maybeSingle();
      setCurrent(Number((data as { score?: number } | null)?.score ?? 0));
      return;
    }
    if (kind === "weekly_xp" && selected) {
      const { data } = await supabase.from("profiles").select("weekly_xp").eq("id", selected.id).maybeSingle();
      setCurrent(Number((data as { weekly_xp?: number } | null)?.weekly_xp ?? 0));
      return;
    }
    if (kind === "tribe_points" && tribeId) {
      const { data } = await supabase.from("tribes").select("points").eq("id", tribeId).maybeSingle();
      setCurrent(Number((data as { points?: number } | null)?.points ?? 0));
    }
  }, [kind, eventId, selected, tribeId, isEventKind, usesTribe]);

  useEffect(() => { loadCurrent(); }, [loadCurrent]);

  const loadLogs = useCallback(async () => {
    if (!isEventKind || !eventId) { setLogs([]); return; }
    const { data } = await supabase.from("event_score_adjustments")
      .select("id,event_kind,event_id,user_id,tribe_id,delta,reason,created_at")
      .eq("event_id", eventId).order("created_at", { ascending: false }).limit(30);
    setLogs((data ?? []) as LogRow[]);
  }, [eventId, isEventKind]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const targetOk = usesTribe ? !!tribeId : !!selected;

  const apply = async (sign: 1 | -1) => {
    if (isEventKind && !eventId) { toast.error("اختر الفعالية أولاً"); return; }
    if (!targetOk) { toast.error(usesTribe ? "اختر قبيلة" : "اختر لاعب"); return; }
    const n = Math.floor(Number(amount));
    if (!Number.isFinite(n) || n <= 0) { toast.error("ادخل رقم موجب"); return; }
    const delta = sign * n;
    setBusy(true);
    let err: string | null = null;
    if (isEventKind) {
      const { error } = await supabase.rpc("admin_adjust_event_points" as never, {
        _kind: kind, _event_id: eventId, _delta: delta,
        _user_id: usesTribe ? null : selected!.id,
        _tribe_id: usesTribe ? tribeId : null,
        _reason: reason || null,
      } as never);
      err = error?.message ?? null;
    } else if (kind === "arena") {
      const { error } = await supabase.rpc("admin_adjust_arena_score" as never,
        { _user_id: selected!.id, _delta: delta } as never);
      err = error?.message ?? null;
    } else if (kind === "weekly_xp") {
      const { error } = await supabase.rpc("admin_adjust_weekly_xp" as never,
        { _user_id: selected!.id, _delta: delta } as never);
      err = error?.message ?? null;
    } else {
      const { error } = await supabase.rpc("admin_adjust_tribe_points" as never,
        { _tribe_id: tribeId, _delta: delta } as never);
      err = error?.message ?? null;
    }
    setBusy(false);
    if (err) { toast.error(err); return; }
    await logAudit("event_points_adjust", usesTribe ? null : selected!.id,
      { kind, event_id: eventId || null, tribe_id: usesTribe ? tribeId : null, delta, reason });
    setAmount("");
    toast.success(sign > 0 ? `تم منح ${n.toLocaleString()} نقطة` : `تم خصم ${n.toLocaleString()} نقطة`);
    await loadCurrent(); await loadLogs();
  };

  const zero = async () => {
    if (!targetOk) { toast.error(usesTribe ? "اختر قبيلة" : "اختر لاعب"); return; }
    const ok = await confirmDialog({
      title: "تصفير النقاط",
      message: "سيتم جعل نقاط هذا الهدف صفر في هذه الفعالية. متأكد؟",
      confirmText: "صفّر", danger: true,
    });
    if (!ok) return;
    setBusy(true);
    let err: string | null = null;
    if (isEventKind) {
      if (!eventId) { setBusy(false); toast.error("اختر الفعالية أولاً"); return; }
      const { error } = await supabase.rpc("admin_zero_event_points" as never, {
        _kind: kind, _event_id: eventId,
        _user_id: usesTribe ? null : selected!.id,
        _tribe_id: usesTribe ? tribeId : null,
        _reason: reason || "zero",
      } as never);
      err = error?.message ?? null;
    } else {
      const cur = current ?? 0;
      if (cur === 0) { setBusy(false); toast.success("النقاط صفر أصلاً"); return; }
      if (kind === "arena") {
        const { error } = await supabase.rpc("admin_adjust_arena_score" as never,
          { _user_id: selected!.id, _delta: -cur } as never);
        err = error?.message ?? null;
      } else if (kind === "weekly_xp") {
        const { error } = await supabase.rpc("admin_adjust_weekly_xp" as never,
          { _user_id: selected!.id, _delta: -cur } as never);
        err = error?.message ?? null;
      } else {
        const { error } = await supabase.rpc("admin_adjust_tribe_points" as never,
          { _tribe_id: tribeId, _delta: -cur } as never);
        err = error?.message ?? null;
      }
    }
    setBusy(false);
    if (err) { toast.error(err); return; }
    await logAudit("event_points_zero", usesTribe ? null : selected?.id ?? null,
      { kind, event_id: eventId || null, tribe_id: usesTribe ? tribeId : null });
    toast.success("تم التصفير");
    await loadCurrent(); await loadLogs();
  };

  return (
    <div className="p-3 md:p-6 max-w-3xl space-y-5" dir="rtl">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-amber-300">⚖️ تعديل نقاط الفعاليات</h1>
        <p className="text-slate-400 text-xs md:text-sm mt-1">امنح أو اخصم أو صفّر نقاط أي لاعب أو قبيلة في أي فعالية.</p>
      </div>

      {/* kind */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {KINDS.map((k) => (
            <button key={k.id} onClick={() => { setKind(k.id); setSelected(null); setQuery(""); setTribeId(""); }}
              className={`px-3 py-2 rounded-lg text-sm font-bold border transition ${
                kind === k.id ? "bg-amber-600/30 border-amber-500 text-amber-100" : "bg-slate-800 border-slate-700 text-slate-300"}`}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="text-xs text-slate-500">{KINDS.find((k) => k.id === kind)?.hint}</div>
      </section>

      {/* event picker */}
      {isEventKind && (
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-2">
          <label className="text-xs text-slate-400">الفعالية</label>
          <select value={eventId} onChange={(e) => setEventId(e.target.value)}
            className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-700 text-sm">
            <option value="">— اختر فعالية —</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.active ? "🟢 " : "⚪ "}{e.title} — {e.metric}
              </option>
            ))}
          </select>
          {kind === "tribe_event" && (
            <div className="flex gap-2 pt-1">
              <button onClick={() => setTarget("player")}
                className={`px-3 py-1.5 rounded text-xs font-bold border ${target === "player" ? "bg-cyan-700/40 border-cyan-500 text-cyan-100" : "bg-slate-800 border-slate-700 text-slate-300"}`}>👤 لاعب</button>
              <button onClick={() => setTarget("tribe")}
                className={`px-3 py-1.5 rounded text-xs font-bold border ${target === "tribe" ? "bg-cyan-700/40 border-cyan-500 text-cyan-100" : "bg-slate-800 border-slate-700 text-slate-300"}`}>🏴‍☠️ قبيلة</button>
            </div>
          )}
        </section>
      )}

      {/* target */}
      <section className="rounded-xl border border-cyan-700/40 bg-cyan-900/10 p-4 space-y-3">
        {usesTribe ? (
          <div>
            <label className="text-xs text-slate-400">القبيلة</label>
            <select value={tribeId} onChange={(e) => setTribeId(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded bg-slate-800 border border-slate-700 text-sm">
              <option value="">— اختر قبيلة —</option>
              {tribes.map((t) => <option key={t.id} value={t.id}>{t.emblem} {t.name}</option>)}
            </select>
          </div>
        ) : (
          <div className="relative">
            <label className="text-xs text-slate-400">اللاعب</label>
            <input
              className="w-full mt-1 px-3 py-2 rounded bg-slate-800 border border-slate-700 text-sm"
              placeholder="🔎 ابحث باسم العرض أو اليوزر..."
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
        )}

        <div className="flex items-center justify-between text-sm bg-slate-900/60 rounded px-3 py-2 border border-slate-700">
          <span className="text-slate-300">النقاط الحالية:</span>
          <span className="font-black text-amber-300 tabular-nums">
            {current === null ? "—" : current.toLocaleString()}
          </span>
        </div>

        <input className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-700 text-sm"
          placeholder="السبب (اختياري)" value={reason} onChange={(e) => setReason(e.target.value)} />

        <div className="flex items-center gap-2">
          <input type="number" min={1} placeholder="مقدار النقاط"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            className="flex-1 px-3 py-2 rounded bg-slate-800 border border-slate-700 text-sm" />
          <button disabled={busy} onClick={() => apply(1)}
            className="px-3 py-2 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold disabled:opacity-50">+ منح</button>
          <button disabled={busy} onClick={() => apply(-1)}
            className="px-3 py-2 rounded bg-amber-700 hover:bg-amber-600 text-white text-xs font-bold disabled:opacity-50">− خصم</button>
          <button disabled={busy} onClick={zero}
            className="px-3 py-2 rounded bg-red-700 hover:bg-red-600 text-white text-xs font-bold disabled:opacity-50">🗑️ تصفير</button>
        </div>
      </section>

      {/* history */}
      {isEventKind && eventId && (
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-2">
          <div className="font-semibold text-sm">📋 آخر التعديلات على هذه الفعالية</div>
          {logs.length === 0 && <div className="text-slate-500 text-sm">لا توجد تعديلات.</div>}
          {logs.map((l) => (
            <div key={l.id} className="flex items-center justify-between text-xs bg-slate-900/70 border border-slate-800 rounded px-3 py-2">
              <span className="text-slate-400 truncate">
                {l.user_id ? `👤 ${l.user_id.slice(0, 8)}` : `🏴‍☠️ ${(l.tribe_id ?? "").slice(0, 8)}`}
                {l.reason ? ` — ${l.reason}` : ""}
              </span>
              <span className={`font-bold tabular-nums ${l.delta >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                {l.delta >= 0 ? "+" : ""}{Number(l.delta).toLocaleString()}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
