import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BackButton } from "@/components/BackButton";
import { SEASON_FRAMES, SeasonFrameRing, frameForDamage } from "@/lib/season-frames";

export const Route = createFileRoute("/season")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "🏆 SEASON RANKING — ملوك القراصنة" },
      { name: "description", content: "ترتيب الموسم الحالي في ملوك القراصنة — تنافس على المركز الأول واحصد الجوائز والإطارات الأسطورية." },
      { property: "og:title", content: "🏆 SEASON RANKING — ملوك القراصنة" },
      { property: "og:description", content: "ترتيب الموسم الحالي وجوائز نهاية الموسم." },
      { property: "og:type", content: "article" },
    ],
  }),
  component: SeasonPage,
});

type Season = { id: number; code: string; name: string; starts_at: string; ends_at: string; status: string };
type Row = { user_id: string; damage_total: number; first_reached_at: string };
type Profile = { id: string; display_name: string | null; avatar_emoji: string | null; avatar_url: string | null; level: number | null };
type ResultRow = { season_id: number; user_id: string; final_rank: number; final_damage: number; frame_tier: number; reward_gems: number };

function fmt(n: number) { return Number(n || 0).toLocaleString("ar-EG"); }
function shortDate(iso: string) { try { return new Date(iso).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" }); } catch { return ""; } }
function countdown(target: string) {
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return "انتهى";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${d}ي ${h}س ${m}د`;
}

function SeasonPage() {
  const navigate = useNavigate();
  const openPlayer = (id: string) => { if (id) navigate({ to: "/players/$playerId", params: { playerId: id } }); };
  const [tab, setTab] = useState<"live" | "history">("live");
  const [season, setSeason] = useState<Season | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [profs, setProfs] = useState<Record<string, Profile>>({});
  const [me, setMe] = useState<string | null>(null);
  const [myResults, setMyResults] = useState<(ResultRow & { season?: Season })[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      setMe(u.user?.id ?? null);

      // Ensure a current season exists
      const { data: cur } = await supabase.rpc("current_season");
      const s = Array.isArray(cur) ? (cur[0] as Season) : (cur as unknown as Season);
      setSeason(s || null);

      if (s?.id) {
        const { data: r } = await supabase.from("season_damage")
          .select("user_id, damage_total, first_reached_at")
          .eq("season_id", s.id)
          .order("damage_total", { ascending: false })
          .order("first_reached_at", { ascending: true })
          .limit(100);
        const list = (r || []) as Row[];
        setRows(list);
        if (list.length) {
          const ids = list.map((x) => x.user_id);
          if (u.user?.id && !ids.includes(u.user.id)) ids.push(u.user.id);
          const { data: p } = await supabase.from("profiles")
            .select("id, display_name, avatar_emoji, avatar_url, level")
            .in("id", ids);
          const map: Record<string, Profile> = {};
          (p || []).forEach((x) => { map[(x as Profile).id] = x as Profile; });
          setProfs(map);
        }
      }

      if (u.user?.id) {
        const { data: res } = await supabase.from("season_results")
          .select("season_id, user_id, final_rank, final_damage, frame_tier, reward_gems")
          .eq("user_id", u.user.id)
          .order("season_id", { ascending: false });
        const results = (res || []) as ResultRow[];
        if (results.length) {
          const sids = results.map((x) => x.season_id);
          const { data: sList } = await supabase.from("seasons").select("*").in("id", sids);
          const smap: Record<number, Season> = {};
          (sList || []).forEach((x) => { smap[(x as Season).id] = x as Season; });
          setMyResults(results.map((x) => ({ ...x, season: smap[x.season_id] })));
        }
      }
    })();
  }, []);

  const myRow = useMemo(() => (me ? rows.find((r) => r.user_id === me) : null), [me, rows]);
  const myRank = useMemo(() => (me ? rows.findIndex((r) => r.user_id === me) + 1 : 0), [me, rows]);
  const [first, second, third, ...rest] = rows;

  return (
    <div className="fixed inset-0 overflow-y-auto text-foreground" dir="rtl"
      style={{ background: "radial-gradient(ellipse at top, oklch(0.18 0.15 300) 0%, oklch(0.05 0.06 260) 100%)" }}>
      <header className="sticky top-0 z-20 glass-hud border-b border-amber-500/40 px-3 pb-3 flex items-center gap-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <BackButton className="w-10 h-10 rounded-xl glass-hud flex items-center justify-center text-lg active:scale-95">←</BackButton>
        <div className="flex-1">
          <h1 className="text-lg font-black text-glow flex items-center gap-2 text-amber-200">🏆 SEASON RANKING</h1>
          <p className="text-[10px] text-muted-foreground">{season?.name || ""} — {season?.ends_at ? `ينتهي خلال ${countdown(season.ends_at)}` : ""}</p>
        </div>
      </header>

      {/* Tabs */}
      <div className="px-3 pt-3">
        <div className="flex gap-2 mb-3">
          <button onClick={() => setTab("live")} className={`flex-1 py-2 rounded-xl text-sm font-black ${tab==="live"?"bg-amber-500 text-black":"bg-white/10 text-amber-200"}`}>الموسم الحالي</button>
          <button onClick={() => setTab("history")} className={`flex-1 py-2 rounded-xl text-sm font-black ${tab==="history"?"bg-amber-500 text-black":"bg-white/10 text-amber-200"}`}>سجل إنجازاتي</button>
        </div>
      </div>

      <main className="p-3 pb-16 space-y-4">
        {tab === "live" ? (
          <>
            {/* Season banner */}
            {season && (
              <section className="relative rounded-2xl overflow-hidden p-4 text-center"
                style={{ background: "linear-gradient(135deg, rgba(255,200,0,0.15), rgba(180,0,255,0.12))", border: "1px solid rgba(255,200,0,0.35)" }}>
                <div className="text-[10px] tracking-widest text-amber-300/80 font-black">SEASON CHAMPIONSHIP</div>
                <div className="text-3xl font-black text-amber-100 mt-1 drop-shadow-[0_0_10px_rgba(255,200,0,0.6)]">{season.name}</div>
                <div className="text-[11px] text-amber-200/80 mt-1">
                  {shortDate(season.starts_at)} — {shortDate(season.ends_at)} · ينتهي خلال {countdown(season.ends_at)}
                </div>
              </section>
            )}

            {/* Podium */}
            {rows.length >= 3 && (
              <section className="grid grid-cols-3 items-end gap-2">
                <PodiumCard row={second} p={profs[second.user_id]} rank={2} isMe={me===second.user_id} onOpen={openPlayer} />
                <PodiumCard row={first} p={profs[first.user_id]} rank={1} isMe={me===first.user_id} tall onOpen={openPlayer} />
                <PodiumCard row={third} p={profs[third.user_id]} rank={3} isMe={me===third.user_id} onOpen={openPlayer} />
              </section>
            )}

            {/* Me summary */}
            {me && (
              <section className="rounded-2xl p-3 bg-white/5 border border-amber-400/30 flex items-center gap-3">
                <SeasonFrameRing frame={frameForDamage(myRow?.damage_total || 0)} size={56}>
                  {profs[me]?.avatar_url ? (
                    <img src={profs[me]!.avatar_url!} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xl bg-slate-700">{profs[me]?.avatar_emoji || "🏴‍☠️"}</div>
                  )}
                </SeasonFrameRing>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-amber-200/80">ترتيبك</div>
                  <div className="text-lg font-black text-amber-100">{myRank ? `#${myRank}` : "بدون ترتيب"}</div>
                </div>
                <div className="text-left">
                  <div className="text-[10px] text-amber-200/70">ضرر الموسم</div>
                  <div className="text-base font-black text-amber-200">{fmt(Number(myRow?.damage_total || 0))}</div>
                </div>
              </section>
            )}

            {/* Rest */}
            <section className="space-y-2">
              {rest.map((r, i) => {
                const rank = i + 4;
                const p = profs[r.user_id];
                const frame = frameForDamage(r.damage_total);
                return (
                  <button type="button" onClick={() => openPlayer(r.user_id)} key={r.user_id} className={`w-full flex items-center gap-3 rounded-xl p-2 text-right active:scale-[0.99] ${me===r.user_id?"bg-amber-500/15 border border-amber-400/40":"bg-white/5 border border-white/10"}`}>
                    <div className="w-8 text-center font-black text-amber-300">#{rank}</div>
                    <SeasonFrameRing frame={frame} size={48} showCrown={false}>
                      {p?.avatar_url ? (
                        <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-lg bg-slate-700">{p?.avatar_emoji || "🏴‍☠️"}</div>
                      )}
                    </SeasonFrameRing>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-amber-100 truncate">{p?.display_name || "قرصان"}{me===r.user_id ? " (أنت)" : ""}</div>
                      <div className="text-[10px] text-amber-200/70">{frame ? frame.name : "بدون إطار"} · مستوى {p?.level ?? "—"}</div>
                    </div>
                    <div className="text-left">
                      <div className="text-[9px] text-amber-200/70">ضرر</div>
                      <div className="text-sm font-black text-amber-200 tabular-nums">{fmt(r.damage_total)}</div>
                    </div>
                  </button>
                );
              })}
              {rows.length === 0 && (
                <div className="text-center text-amber-200/70 text-sm py-8">لم يبدأ أحد بعد — كن أول من يتصدر الموسم! ⚔️</div>
              )}
            </section>

            {/* Frame tiers reference */}
            <section className="rounded-2xl bg-white/5 border border-white/10 p-3">
              <div className="text-sm font-black text-amber-200 mb-2">🖼️ إطارات الموسم</div>
              <div className="grid grid-cols-2 gap-2">
                {SEASON_FRAMES.map((f) => (
                  <div key={f.tier} className="flex items-center gap-2 p-2 rounded-lg bg-black/30">
                    <SeasonFrameRing frame={f} size={44} showCrown={false}>
                      <div className="w-full h-full flex items-center justify-center text-lg bg-slate-800">{f.crown || "🏴‍☠️"}</div>
                    </SeasonFrameRing>
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold text-amber-100 truncate">{f.name}</div>
                      <div className="text-[9px] text-amber-200/70">{fmt(f.threshold)} ضرر</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Rewards */}
            <section className="rounded-2xl bg-gradient-to-br from-amber-500/10 to-purple-500/10 border border-amber-400/30 p-3">
              <div className="text-sm font-black text-amber-200 mb-2">🎁 جوائز نهاية الموسم</div>
              <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="p-2 rounded-lg bg-amber-500/20"><div className="text-lg">🥇</div><div className="font-black text-amber-100">100,000 💎</div></div>
                <div className="p-2 rounded-lg bg-slate-400/20"><div className="text-lg">🥈</div><div className="font-black text-amber-100">50,000 💎</div></div>
                <div className="p-2 rounded-lg bg-orange-500/20"><div className="text-lg">🥉</div><div className="font-black text-amber-100">25,000 💎</div></div>
              </div>
            </section>
          </>
        ) : (
          <section className="space-y-2">
            {myResults.length === 0 ? (
              <div className="text-center text-amber-200/70 text-sm py-8">لا توجد إنجازات موسمية بعد.</div>
            ) : (
              myResults.map((r) => {
                const f = SEASON_FRAMES.find((x) => x.tier === r.frame_tier) || null;
                return (
                  <div key={`${r.season_id}-${r.user_id}`} className="rounded-2xl p-3 bg-white/5 border border-amber-400/30 flex items-center gap-3">
                    <SeasonFrameRing frame={f} size={64}>
                      <div className="w-full h-full flex items-center justify-center text-2xl bg-slate-800">{f?.crown || "🏆"}</div>
                    </SeasonFrameRing>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-black text-amber-100">{r.season?.name || `SEASON ${r.season_id}`}</div>
                      <div className="text-[11px] text-amber-200/80">الترتيب النهائي: #{r.final_rank}</div>
                      <div className="text-[11px] text-amber-200/80">⚔️ الضرر: {fmt(r.final_damage)}</div>
                      <div className="text-[11px] text-amber-200/80">🖼️ الإطار: {f?.name || "بدون"}</div>
                      {r.reward_gems > 0 && <div className="text-[11px] text-amber-300">🎁 مكافأة: {fmt(r.reward_gems)} جوهرة</div>}
                      {r.season && <div className="text-[10px] text-amber-200/60">📅 {shortDate(r.season.starts_at)} — {shortDate(r.season.ends_at)}</div>}
                    </div>
                  </div>
                );
              })
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function PodiumCard({ row, p, rank, isMe, tall, onOpen }: { row: Row; p?: Profile; rank: 1|2|3; isMe?: boolean; tall?: boolean; onOpen?: (id: string) => void }) {
  const frame = frameForDamage(row.damage_total);
  const styles = {
    1: { bg: "from-amber-400 via-yellow-300 to-amber-500", border: "border-amber-200", glow: "shadow-[0_0_30px_rgba(255,200,0,0.9)]", label: "SEASON CHAMPION" },
    2: { bg: "from-slate-300 via-slate-100 to-slate-400", border: "border-slate-200", glow: "shadow-[0_0_20px_rgba(220,220,220,0.7)]", label: "SILVER" },
    3: { bg: "from-orange-400 via-amber-400 to-orange-600", border: "border-orange-200", glow: "shadow-[0_0_20px_rgba(255,140,40,0.7)]", label: "BRONZE" },
  }[rank];
  const size = tall ? 92 : 76;
  return (
    <button type="button" onClick={() => onOpen?.(row.user_id)} className={`relative flex flex-col items-center ${tall ? "pt-0" : "pt-6"} active:scale-95`}>
      {rank === 1 && <div className="absolute -top-2 text-3xl z-30" style={{ filter: "drop-shadow(0 0 10px gold)" }}>👑</div>}
      <SeasonFrameRing frame={frame} size={size} intense={rank===1}>
        {p?.avatar_url ? (
          <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-3xl bg-slate-800">{p?.avatar_emoji || "🏴‍☠️"}</div>
        )}
      </SeasonFrameRing>
      <div className={`mt-2 w-full rounded-xl border-2 ${styles.border} ${styles.glow} bg-gradient-to-b ${styles.bg} p-2 text-center`}>
        <div className="text-[9px] font-black text-black/80 tracking-widest">{styles.label}</div>
        <div className="text-[11px] font-black text-black truncate">{p?.display_name || "قرصان"}{isMe?" (أنت)":""}</div>
        <div className="text-[10px] font-black text-black/80 tabular-nums">{fmt(row.damage_total)}</div>
        <div className="text-[9px] text-black/70">{frame?.name || ""}</div>
      </div>
    </button>
  );
}
