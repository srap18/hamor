import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { sound } from "@/lib/sound";
import { claimQuest, buyLootbox, openLootbox } from "@/lib/economy";

type Tab = "missions" | "achievements" | "boxes" | "notifs" | "events";

type Quest = { id: string; title: string; description: string; icon: string; goal_count: number; goal_type: string; reward_coins: number; reward_xp: number; reward_gems: number };
type QProgress = { quest_id: string; progress: number; claimed: boolean };
type Ach = { id: string; title: string; description: string; icon: string; goal_count: number; reward_coins: number; reward_xp: number };
type UAch = { achievement_id: string; progress: number; claimed: boolean; unlocked_at: string | null };
type Box = { id: string; type_id: string; opened: boolean; reward: { coins?: number; gems?: number; xp?: number } | null; lootbox_types: { name: string; icon: string; rarity: string } | null };
type BoxType = { id: string; name: string; icon: string; rarity: string; cost_coins: number; cost_gems: number; min_coins: number; max_coins: number; min_gems: number; max_gems: number; min_xp: number; max_xp: number };
type Notif = { id: string; title: string; body: string; kind: string; created_at: string; recipient_id: string | null };
type Evt = { id: string; title: string; description: string; banner: string; starts_at: string; ends_at: string; xp_multiplier: number; coin_multiplier: number };

function dayKey() { return new Date().toISOString().slice(0, 10); }

export function MissionsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("missions");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-stone-900 border border-amber-700/40 rounded-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-3 border-b border-amber-700/30">
          <h2 className="text-amber-200 font-bold text-lg">🗺 المهام والمكافآت</h2>
          <button onClick={onClose} className="text-amber-200/70 hover:text-amber-100 text-xl">✕</button>
        </div>
        <div className="flex gap-1 px-2 pt-2 overflow-x-auto border-b border-amber-700/20">
          {([
            { id: "missions", label: "🎯 يومية" },
            { id: "achievements", label: "🏆 إنجازات" },
            { id: "boxes", label: "🎁 صناديق" },
            { id: "events", label: "🎉 فعاليات" },
            { id: "notifs", label: "📢 إشعارات" },
          ] as { id: Tab; label: string }[]).map((t) => (
            <button
              key={t.id}
              onClick={() => { sound.play("click"); setTab(t.id); }}
              className={`px-3 py-2 text-xs whitespace-nowrap border-b-2 transition ${tab === t.id ? "border-amber-400 text-amber-200" : "border-transparent text-amber-200/50"}`}
            >{t.label}</button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-3 text-amber-100">
          {tab === "missions" && <MissionsTab />}
          {tab === "achievements" && <AchievementsTab />}
          {tab === "boxes" && <BoxesTab />}
          {tab === "events" && <EventsTab />}
          {tab === "notifs" && <NotifsTab />}
        </div>
      </div>
    </div>
  );
}

function MissionsTab() {
  const { user } = useAuth();
  const [quests, setQuests] = useState<Quest[]>([]);
  const [prog, setProg] = useState<Record<string, QProgress>>({});

  const load = async () => {
    if (!user) return;
    const { data: qs } = await supabase.from("daily_quests").select("*").eq("active", true);
    const { data: pgs } = await supabase.from("quest_progress").select("quest_id, progress, claimed").eq("user_id", user.id).eq("day_key", dayKey());
    setQuests((qs ?? []) as Quest[]);
    const map: Record<string, QProgress> = {};
    (pgs ?? []).forEach((p) => { map[p.quest_id] = p as QProgress; });
    setProg(map);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

  const claim = async (q: Quest) => {
    if (!user) return;
    const p = prog[q.id];
    if (!p || p.progress < q.goal_count || p.claimed) return;
    sound.play("coin");
    const { error } = await claimQuest(q.id, dayKey());
    if (error) { alert(error.message || "تعذر استلام المكافأة"); return; }
    load();
  };

  return (
    <div className="space-y-2">
      {quests.length === 0 && <div className="text-amber-200/50 text-center py-6 text-sm">لا توجد مهام نشطة</div>}
      {quests.map((q) => {
        const p = prog[q.id] ?? { progress: 0, claimed: false };
        const done = p.progress >= q.goal_count;
        return (
          <div key={q.id} className="rounded-lg bg-stone-800/60 border border-amber-700/20 p-3">
            <div className="flex items-start gap-2">
              <span className="text-2xl">{q.icon}</span>
              <div className="flex-1">
                <div className="font-semibold text-sm">{q.title}</div>
                <div className="text-xs text-amber-200/60">{q.description}</div>
                <div className="mt-2 h-1.5 bg-stone-700 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500" style={{ width: `${Math.min(100, (p.progress / q.goal_count) * 100)}%` }} />
                </div>
                <div className="flex items-center justify-between mt-2 text-xs">
                  <span className="text-amber-200/70">{p.progress}/{q.goal_count}</span>
                  <span className="text-amber-300">🪙{q.reward_coins} ⭐{q.reward_xp} {q.reward_gems > 0 && `💎${q.reward_gems}`}</span>
                </div>
              </div>
              {done && !p.claimed && (
                <button onClick={() => claim(q)} className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold">استلام</button>
              )}
              {p.claimed && <span className="text-emerald-400 text-xs">✓ مُستلَم</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AchievementsTab() {
  const { user } = useAuth();
  const [list, setList] = useState<Ach[]>([]);
  const [prog, setProg] = useState<Record<string, UAch>>({});
  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: achs } = await supabase.from("achievements").select("*").eq("active", true).order("sort_order");
      const { data: ups } = await supabase.from("user_achievements").select("*").eq("user_id", user.id);
      setList((achs ?? []) as Ach[]);
      const m: Record<string, UAch> = {};
      (ups ?? []).forEach((u) => { m[u.achievement_id] = u as UAch; });
      setProg(m);
    })();
  }, [user]);
  return (
    <div className="space-y-2">
      {list.length === 0 && <div className="text-amber-200/50 text-center py-6 text-sm">لا توجد إنجازات بعد</div>}
      {list.map((a) => {
        const p = prog[a.id];
        const pct = p ? Math.min(100, (p.progress / a.goal_count) * 100) : 0;
        const unlocked = p?.unlocked_at;
        return (
          <div key={a.id} className={`rounded-lg p-3 border ${unlocked ? "bg-amber-900/30 border-amber-600/40" : "bg-stone-800/60 border-amber-700/20"}`}>
            <div className="flex items-start gap-2">
              <span className={`text-2xl ${unlocked ? "" : "grayscale opacity-60"}`}>{a.icon}</span>
              <div className="flex-1">
                <div className="font-semibold text-sm flex items-center gap-2">{a.title} {unlocked && <span className="text-amber-400">★</span>}</div>
                <div className="text-xs text-amber-200/60">{a.description}</div>
                <div className="mt-1.5 h-1 bg-stone-700 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
                </div>
                <div className="text-xs text-amber-200/70 mt-1">{p?.progress ?? 0}/{a.goal_count} · 🪙{a.reward_coins} ⭐{a.reward_xp}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BoxesTab() {
  const { user } = useAuth();
  const [owned, setOwned] = useState<Box[]>([]);
  const [types, setTypes] = useState<BoxType[]>([]);
  const [opening, setOpening] = useState<string | null>(null);
  const [reward, setReward] = useState<{ coins: number; gems: number; xp: number } | null>(null);

  const load = async () => {
    if (!user) return;
    const { data: o } = await supabase.from("lootbox_owned").select("*, lootbox_types(name, icon, rarity)").eq("user_id", user.id).order("acquired_at", { ascending: false });
    const { data: t } = await supabase.from("lootbox_types").select("*").eq("active", true).order("cost_coins");
    setOwned((o ?? []) as unknown as Box[]);
    setTypes((t ?? []) as BoxType[]);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

  const buyBox = async (t: BoxType) => {
    if (!user) return;
    sound.play("coin");
    const { error } = await buyLootbox(t.id);
    if (error) { alert(error.message || "تعذر الشراء"); return; }
    load();
  };

  const openBox = async (b: Box) => {
    if (!user || b.opened) return;
    setOpening(b.id);
    const { data, error } = await openLootbox(b.id);
    if (error) { setOpening(null); alert(error.message || "تعذر فتح الصندوق"); return; }
    const rw = (data ?? { coins: 0, gems: 0, xp: 0 }) as { coins: number; gems: number; xp: number };
    sound.play("coin");
    setReward(rw);
    setTimeout(() => { setReward(null); setOpening(null); load(); }, 2200);
  };

  return (
    <div className="space-y-3">
      {reward && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70" onClick={() => setReward(null)}>
          <div className="bg-gradient-to-b from-amber-700 to-amber-900 border border-amber-300 rounded-2xl p-6 text-center animate-pulse">
            <div className="text-6xl mb-3">🎉</div>
            <div className="text-amber-100 font-bold text-lg mb-2">مبروك!</div>
            <div className="text-amber-50">🪙 {reward.coins} · 💎 {reward.gems} · ⭐ {reward.xp}</div>
          </div>
        </div>
      )}
      <div>
        <h3 className="text-sm font-bold text-amber-300 mb-2">📦 صناديقي ({owned.filter((b) => !b.opened).length} غير مفتوحة)</h3>
        {owned.length === 0 && <div className="text-amber-200/50 text-xs">لا توجد صناديق — اشترِ واحداً!</div>}
        <div className="grid grid-cols-3 gap-2">
          {owned.slice(0, 12).map((b) => (
            <button key={b.id} onClick={() => openBox(b)} disabled={b.opened || opening === b.id} className={`rounded-lg p-2 text-center border transition ${b.opened ? "opacity-40 bg-stone-800/40 border-stone-700" : "bg-stone-800/60 border-amber-600/40 hover:scale-105"}`}>
              <div className="text-3xl">{b.lootbox_types?.icon ?? "📦"}</div>
              <div className="text-xs mt-1">{b.opened ? "مفتوح" : "افتح"}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="border-t border-amber-700/20 pt-3">
        <h3 className="text-sm font-bold text-amber-300 mb-2">🛒 متجر الصناديق</h3>
        <div className="space-y-2">
          {types.map((t) => (
            <div key={t.id} className="flex items-center gap-3 p-2 rounded-lg bg-stone-800/60 border border-amber-700/20">
              <span className="text-2xl">{t.icon}</span>
              <div className="flex-1">
                <div className="text-sm font-semibold">{t.name}</div>
                <div className="text-xs text-amber-200/60">🪙 {t.min_coins}-{t.max_coins} · ⭐ {t.min_xp}-{t.max_xp}</div>
              </div>
              <button onClick={() => buyBox(t)} className="px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 text-xs font-semibold">
                🪙 {t.cost_coins}{t.cost_gems > 0 && ` 💎${t.cost_gems}`}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NotifsTab() {
  const { user } = useAuth();
  const [list, setList] = useState<Notif[]>([]);
  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data } = await supabase.from("notifications").select("*").or(`recipient_id.eq.${user.id},recipient_id.is.null`).order("created_at", { ascending: false }).limit(50);
      setList((data ?? []) as Notif[]);
    })();
  }, [user]);
  const kindIcon: Record<string, string> = { info: "📘", success: "✅", warning: "⚠️", event: "🎉", update: "🔄" };
  return (
    <div className="space-y-2">
      {list.length === 0 && <div className="text-amber-200/50 text-center py-6 text-sm">لا توجد إشعارات</div>}
      {list.map((n) => (
        <div key={n.id} className="rounded-lg bg-stone-800/60 border border-amber-700/20 p-3">
          <div className="flex items-start gap-2">
            <span className="text-xl">{kindIcon[n.kind] ?? "📘"}</span>
            <div className="flex-1">
              <div className="font-semibold text-sm">{n.title}</div>
              {n.body && <div className="text-xs text-amber-200/70 mt-1 whitespace-pre-line">{n.body}</div>}
              <div className="text-xs text-amber-200/40 mt-1">{new Date(n.created_at).toLocaleString("ar")}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EventsTab() {
  const [list, setList] = useState<Evt[]>([]);
  useEffect(() => {
    (async () => {
      const now = new Date().toISOString();
      const { data } = await supabase.from("events").select("*").eq("active", true).lte("starts_at", now).gte("ends_at", now).order("ends_at");
      setList((data ?? []) as Evt[]);
    })();
  }, []);
  return (
    <div className="space-y-2">
      {list.length === 0 && <div className="text-amber-200/50 text-center py-6 text-sm">لا توجد فعاليات حالياً</div>}
      {list.map((e) => {
        const remaining = Math.max(0, new Date(e.ends_at).getTime() - Date.now());
        const days = Math.floor(remaining / 86400000);
        const hrs = Math.floor((remaining % 86400000) / 3600000);
        return (
          <div key={e.id} className="rounded-lg bg-gradient-to-br from-purple-900/40 to-amber-900/40 border border-amber-500/40 p-3">
            <div className="text-3xl">{e.banner}</div>
            <div className="font-bold mt-1">{e.title}</div>
            <div className="text-xs text-amber-100/80 mt-1">{e.description}</div>
            <div className="flex items-center justify-between mt-2 text-xs">
              <span>⭐×{e.xp_multiplier} · 🪙×{e.coin_multiplier}</span>
              <span className="text-amber-300">⏱ {days}ي {hrs}س متبقية</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
