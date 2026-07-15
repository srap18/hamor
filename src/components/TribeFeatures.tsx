import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

type Tab = "ach" | "etribes" | "eplayers" | "log";

type Achievement = { id: string; code: string; title: string; description: string | null; emoji: string; earned_at: string };
type EnemyTribe = { id: string; enemy_tribe_id: string; note: string | null; created_at: string; tribe: { id: string; name: string; emblem: string | null; level: number } | null };
type EnemyPlayer = { id: string; enemy_user_id: string; reason: string | null; created_at: string; profile: { id: string; display_name: string | null; avatar_emoji: string | null; avatar_url: string | null; level: number | null } | null };
type LogRow = {
  id: string; created_at: string; direction: "in" | "out";
  attacker_id: string; defender_id: string;
  damage_dealt: number | null; attacker_won: boolean | null; loot_coins: number | null;
  attacker_name: string | null; attacker_avatar_url: string | null; attacker_avatar_emoji: string | null;
  attacker_tribe_id: string | null; attacker_tribe_name: string | null; attacker_tribe_emblem: string | null;
  defender_name: string | null; defender_avatar_url: string | null; defender_avatar_emoji: string | null;
  defender_tribe_id: string | null; defender_tribe_name: string | null; defender_tribe_emblem: string | null;
};

export function TribeFeatures({ tribeId, canManage }: { tribeId: string; canManage: boolean }) {
  const [tab, setTab] = useState<Tab>("ach");
  const [ach, setAch] = useState<Achievement[]>([]);
  const [eTribes, setETribes] = useState<EnemyTribe[]>([]);
  const [ePlayers, setEPlayers] = useState<EnemyPlayer[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // search inputs
  const [tribeQ, setTribeQ] = useState("");
  const [tribeResults, setTribeResults] = useState<Array<{ id: string; name: string; emblem: string | null; level: number }>>([]);
  const [playerQ, setPlayerQ] = useState("");
  const [playerResults, setPlayerResults] = useState<Array<{ id: string; display_name: string | null; username: string | null; avatar_emoji: string | null; avatar_url: string | null; level: number | null }>>([]);

  const load = useCallback(async () => {
    const [{ data: a }, { data: et }, { data: ep }] = await Promise.all([
      (supabase as any).from("tribe_achievements").select("*").eq("tribe_id", tribeId).order("earned_at", { ascending: false }),
      (supabase as any).from("tribe_enemies").select("id,enemy_tribe_id,note,created_at").eq("tribe_id", tribeId).order("created_at", { ascending: false }),
      (supabase as any).from("tribe_enemy_players").select("id,enemy_user_id,reason,created_at").eq("tribe_id", tribeId).order("created_at", { ascending: false }),
    ]);
    setAch((a || []) as Achievement[]);
    // hydrate enemy tribes
    const tIds = ((et || []) as any[]).map(r => r.enemy_tribe_id);
    const { data: tribes } = tIds.length
      ? await supabase.from("tribes").select("id,name,emblem,level").in("id", tIds)
      : { data: [] };
    const tMap = new Map((tribes || []).map((t: any) => [t.id, t]));
    setETribes(((et || []) as any[]).map(r => ({ ...r, tribe: tMap.get(r.enemy_tribe_id) || null })));
    // hydrate enemy players
    const pIds = ((ep || []) as any[]).map(r => r.enemy_user_id);
    const { data: profs } = pIds.length
      ? await supabase.from("profiles").select("id,display_name,avatar_emoji,avatar_url,level").in("id", pIds)
      : { data: [] };
    const pMap = new Map((profs || []).map((p: any) => [p.id, p]));
    setEPlayers(((ep || []) as any[]).map(r => ({ ...r, profile: pMap.get(r.enemy_user_id) || null })));
  }, [tribeId]);

  useEffect(() => { load(); }, [load]);

  const loadLog = useCallback(async () => {
    setLogLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc("get_tribe_attack_log", { _tribe_id: tribeId, _limit: 100 });
      if (error) throw error;
      setLog((data || []) as LogRow[]);
    } catch (e: any) {
      setErr(e?.message || "خطأ في تحميل السجل");
    }
    setLogLoading(false);
  }, [tribeId]);

  useEffect(() => { if (tab === "log") loadLog(); }, [tab, loadLog]);


  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e: any) { setErr(e?.message || "خطأ"); }
    setBusy(false);
  };

  const searchTribes = async (q: string) => {
    setTribeQ(q);
    if (!q.trim()) { setTribeResults([]); return; }
    const { data } = await supabase.from("tribes").select("id,name,emblem,level").ilike("name", `%${q.trim()}%`).neq("id", tribeId).limit(8);
    setTribeResults((data || []) as any);
  };

  const searchPlayers = async (q: string) => {
    setPlayerQ(q);
    if (!q.trim()) { setPlayerResults([]); return; }
    const { data } = await supabase.from("profiles")
      .select("id,display_name,username,avatar_emoji,avatar_url,level")
      .or(`display_name.ilike.%${q.trim()}%,username.ilike.%${q.trim()}%`)
      .limit(8);
    setPlayerResults((data || []) as any);
  };

  const addEnemyTribe = (t: { id: string }) => wrap(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("غير مسجل");
    const { error } = await (supabase as any).from("tribe_enemies").insert({ tribe_id: tribeId, enemy_tribe_id: t.id, added_by: user.id });
    if (error) throw error;
    setTribeQ(""); setTribeResults([]);
    await load();
  });

  const removeEnemyTribe = (id: string) => wrap(async () => {
    const { error } = await (supabase as any).from("tribe_enemies").delete().eq("id", id);
    if (error) throw error;
    await load();
  });

  const addEnemyPlayer = (p: { id: string }) => wrap(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("غير مسجل");
    const { error } = await (supabase as any).from("tribe_enemy_players").insert({ tribe_id: tribeId, enemy_user_id: p.id, added_by: user.id });
    if (error) throw error;
    setPlayerQ(""); setPlayerResults([]);
    await load();
  });

  const removeEnemyPlayer = (id: string) => wrap(async () => {
    const { error } = await (supabase as any).from("tribe_enemy_players").delete().eq("id", id);
    if (error) throw error;
    await load();
  });

  return (
    <div className="rounded-xl border border-amber-700/40 bg-stone-900/60 overflow-hidden">
      <div className="flex border-b border-amber-700/40">
        {([
          { k: "ach" as const, l: "🏆 إنجازات", n: ach.length },
          { k: "etribes" as const, l: "🚩 قبائل عدوة", n: eTribes.length },
          { k: "eplayers" as const, l: "🎯 أعداء", n: ePlayers.length },
        ]).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`flex-1 py-2 text-[11px] font-bold ${tab === t.k ? "bg-amber-700/40 text-amber-100" : "text-amber-300/70"}`}>
            {t.l} {t.n > 0 && <span className="ms-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[9px]">{t.n}</span>}
          </button>
        ))}
      </div>

      <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
        {err && <div className="text-[11px] text-red-300 bg-red-900/40 p-2 rounded">{err}</div>}

        {tab === "ach" && (
          ach.length === 0 ? (
            <div className="text-center text-amber-300/60 text-xs py-4">لا توجد إنجازات بعد. ارفع مستوى القبيلة أو حقق أهدافها 🏆</div>
          ) : (
            <div className="space-y-1.5">
              {ach.map(a => (
                <div key={a.id} className="flex items-center gap-2 p-2 rounded-lg bg-gradient-to-r from-amber-900/30 to-stone-900 border border-amber-700/30">
                  <div className="text-2xl">{a.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-amber-100 truncate">{a.title}</div>
                    {a.description && <div className="text-[10px] text-amber-200/70 truncate">{a.description}</div>}
                    <div className="text-[9px] text-amber-400/50">{new Date(a.earned_at).toLocaleDateString("ar")}</div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {tab === "etribes" && (
          <>
            {canManage && (
              <div className="space-y-1">
                <input value={tribeQ} onChange={e => searchTribes(e.target.value)}
                  placeholder="ابحث عن قبيلة لإضافتها عدو..."
                  className="w-full px-2 py-1.5 rounded bg-stone-800 border border-red-700/40 text-amber-100 text-xs" />
                {tribeResults.length > 0 && (
                  <div className="rounded bg-stone-950 border border-amber-700/30 divide-y divide-amber-700/20">
                    {tribeResults.map(t => (
                      <button key={t.id} disabled={busy} onClick={() => addEnemyTribe(t)}
                        className="w-full flex items-center gap-2 p-2 text-right hover:bg-stone-900">
                        <span className="text-lg">{t.emblem || "🏴‍☠️"}</span>
                        <span className="flex-1 text-sm text-amber-100 truncate">{t.name}</span>
                        <span className="text-[10px] text-amber-300/70">⭐ {t.level}</span>
                        <span className="text-[10px] text-red-300 font-bold">+ عدو</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {eTribes.length === 0 ? (
              <div className="text-center text-amber-300/60 text-xs py-4">لا توجد قبائل عدوة محددة</div>
            ) : (
              <div className="space-y-1.5">
                {eTribes.map(e => (
                  <div key={e.id} className="flex items-center gap-2 p-2 rounded-lg bg-red-900/20 border border-red-700/30">
                    <div className="text-xl">{e.tribe?.emblem || "🏴‍☠️"}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-red-100 truncate">{e.tribe?.name || "قبيلة محذوفة"}</div>
                      <div className="text-[10px] text-red-200/70">⭐ {e.tribe?.level ?? "?"}</div>
                    </div>
                    {canManage && (
                      <button disabled={busy} onClick={() => removeEnemyTribe(e.id)}
                        className="px-2 py-1 rounded bg-stone-800 text-amber-200 text-[10px] font-bold">✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "eplayers" && (
          <>
            {canManage && (
              <div className="space-y-1">
                <input value={playerQ} onChange={e => searchPlayers(e.target.value)}
                  placeholder="ابحث عن لاعب لإضافته عدو..."
                  className="w-full px-2 py-1.5 rounded bg-stone-800 border border-red-700/40 text-amber-100 text-xs" />
                {playerResults.length > 0 && (
                  <div className="rounded bg-stone-950 border border-amber-700/30 divide-y divide-amber-700/20">
                    {playerResults.map(p => (
                      <button key={p.id} disabled={busy} onClick={() => addEnemyPlayer(p)}
                        className="w-full flex items-center gap-2 p-2 text-right hover:bg-stone-900">
                        {p.avatar_url
                          ? <img src={p.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                          : <span className="w-7 h-7 rounded-full bg-stone-800 flex items-center justify-center text-base">{p.avatar_emoji || "🏴‍☠️"}</span>}
                        <span className="flex-1 text-sm text-amber-100 truncate">{p.display_name || p.username || "لاعب"}</span>
                        <span className="text-[10px] text-amber-300/70">⭐ {p.level ?? 1}</span>
                        <span className="text-[10px] text-red-300 font-bold">+ عدو</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {ePlayers.length === 0 ? (
              <div className="text-center text-amber-300/60 text-xs py-4">لا توجد أعداء شخصيون محددون</div>
            ) : (
              <div className="space-y-1.5">
                {ePlayers.map(e => (
                  <div key={e.id} className="flex items-center gap-2 p-2 rounded-lg bg-red-900/20 border border-red-700/30">
                    {e.profile?.avatar_url
                      ? <img src={e.profile.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border border-red-500/50" />
                      : <span className="w-9 h-9 rounded-full bg-stone-800 border border-red-500/50 flex items-center justify-center text-lg">{e.profile?.avatar_emoji || "🏴‍☠️"}</span>}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-red-100 truncate">{e.profile?.display_name || "لاعب"}</div>
                      <div className="text-[10px] text-red-200/70">⭐ {e.profile?.level ?? 1}</div>
                    </div>
                    {e.profile && (
                      <Link to="/p/$id" params={{ id: e.profile.id }}
                        className="px-2 py-1 rounded bg-sky-600 text-white text-[10px] font-bold">👤 زيارة</Link>
                    )}
                    {canManage && (
                      <button disabled={busy} onClick={() => removeEnemyPlayer(e.id)}
                        className="px-2 py-1 rounded bg-stone-800 text-amber-200 text-[10px] font-bold">✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
