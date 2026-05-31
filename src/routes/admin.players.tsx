import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/hooks/use-admin";
import { toast } from "sonner";


export const Route = createFileRoute("/admin/players")({
  component: AdminPlayers,
  ssr: false,
});

type Player = {
  id: string;
  display_name: string;
  avatar_emoji: string;
  level: number;
  xp: number;
  coins: number;
  gems: number;
  
  online_at: string;
  created_at: string;
};

function AdminPlayers() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Player | null>(null);
  const [banned, setBanned] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("profiles").select("*").order("created_at", { ascending: false }).limit(200);
    if (search.trim()) q = q.ilike("display_name", `%${search.trim()}%`);
    const { data } = await q;
    setPlayers((data ?? []) as Player[]);
    const { data: bans } = await supabase.from("bans").select("user_id").eq("active", true);
    setBanned(new Set((bans ?? []).map((b) => b.user_id)));
    const nowIso = new Date().toISOString();
    const { data: mutes } = await supabase.from("chat_mutes").select("user_id,expires_at").eq("active", true);
    setMuted(new Set((mutes ?? []).filter((m) => !m.expires_at || m.expires_at > nowIso).map((m) => m.user_id)));
    setLoading(false);
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const toggleBan = async (p: Player) => {
    const isBanned = banned.has(p.id);
    if (isBanned) {
      await supabase.from("bans").update({ active: false }).eq("user_id", p.id).eq("active", true);
      await logAudit("unban_user", p.id, { name: p.display_name });
      toast.success(`فُكّ الحظر عن ${p.display_name}`);
    } else {
      const reason = prompt("سبب الحظر:", "مخالفة قواعد اللعبة") ?? "";
      const hoursStr = prompt("مدة الحظر بالساعات (اتركها فارغة للحظر الدائم):", "");
      const hours = hoursStr ? Number(hoursStr) : 0;
      const expires_at = hours > 0 ? new Date(Date.now() + hours * 3600_000).toISOString() : null;
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from("bans").insert({ user_id: p.id, reason, banned_by: userData.user?.id, expires_at });
      await logAudit("ban_user", p.id, { name: p.display_name, reason, hours: hours || "permanent" });
      toast.success(hours > 0 ? `تم حظر ${p.display_name} لمدة ${hours} ساعة` : `تم حظر ${p.display_name} نهائياً`);
    }
    load();
  };


  return (
    <div className="p-3 md:p-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">إدارة اللاعبين</h1>
          <p className="text-slate-400 text-xs md:text-sm mt-1">{players.length} لاعب معروض</p>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث بالاسم..."
          className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 w-full md:w-64"
        />
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">

          <thead className="bg-slate-800/60 text-slate-300">
            <tr>
              <th className="text-right p-3">اللاعب</th>
              <th className="text-right p-3">Lv</th>
              <th className="text-right p-3">XP</th>
              <th className="text-right p-3">🪙</th>
              <th className="text-right p-3">💎</th>
              <th className="text-right p-3">آخر دخول</th>
              <th className="text-right p-3">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="p-6 text-center text-slate-500">جاري التحميل...</td></tr>}
            {!loading && players.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">لا توجد نتائج</td></tr>}
            {players.map((p) => {
              const isBanned = banned.has(p.id);
              return (
                <tr key={p.id} className={`border-t border-slate-800/50 ${isBanned ? "bg-red-900/10" : ""}`}>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{p.avatar_emoji}</span>
                      <div>
                        <div className="font-medium">{p.display_name}</div>
                        <div className="text-xs text-slate-500 font-mono">{p.id.slice(0, 8)}</div>
                      </div>
                      {isBanned && <span className="px-2 py-0.5 rounded text-xs bg-red-600/30 text-red-300 border border-red-500/40">محظور</span>}
                    </div>
                  </td>
                  <td className="p-3">{p.level}</td>
                  <td className="p-3">{p.xp.toLocaleString("en-US")}</td>
                  <td className="p-3">{Number(p.coins).toLocaleString("en-US")}</td>
                  <td className="p-3">{p.gems}</td>
                  <td className="p-3 text-xs text-slate-400">{new Date(p.online_at).toLocaleString("ar")}</td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <button onClick={() => setEditing(p)} className="px-2 py-1 rounded bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 text-xs">تعديل</button>
                      <button
                        onClick={() => toggleBan(p)}
                        className={`px-2 py-1 rounded text-xs ${isBanned ? "bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200" : "bg-red-600/30 hover:bg-red-600/50 text-red-200"}`}
                      >
                        {isBanned ? "فك حظر" : "حظر"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && <EditPlayerModal player={editing} onClose={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function EditPlayerModal({ player, onClose }: { player: Player; onClose: () => void }) {
  const [coins, setCoins] = useState(String(player.coins));
  const [gems, setGems] = useState(String(player.gems));
  
  const [xp, setXp] = useState(String(player.xp));
  const [level, setLevel] = useState(String(player.level));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const updates = {
      coins: Number(coins),
      gems: Number(gems),
      xp: Number(xp),
      level: Number(level),
    };
    const { error } = await supabase.rpc("admin_set_player_currency", {
      _player: player.id, _coins: updates.coins, _gems: updates.gems, _xp: updates.xp, _level: updates.level,
    });
    if (error) {
      toast.error("خطأ: " + error.message);
      setSaving(false);
      return;
    }
    await logAudit("edit_player", player.id, { name: player.display_name, before: { coins: player.coins, gems: player.gems, xp: player.xp, level: player.level }, after: updates });
    toast.success("تم حفظ التعديلات");
    onClose();
  };


  const sendBox = async () => {
    const { data: types } = await supabase.from("lootbox_types").select("id, name").eq("active", true);
    if (!types || types.length === 0) { toast.error("لا توجد صناديق معرّفة"); return; }
    const choice = prompt(`اختر رقم الصندوق:\n${types.map((t, i) => `${i + 1}. ${t.name}`).join("\n")}`, "1");
    if (!choice) return;
    const idx = Number(choice) - 1;
    if (!types[idx]) return;
    await supabase.rpc("admin_grant_lootbox", { _player: player.id, _type_id: types[idx].id });
    await logAudit("gift_lootbox", player.id, { box: types[idx].name });
    toast.success(`تم إرسال صندوق "${types[idx].name}"`);
  };


  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 rounded-2xl border border-slate-700 p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">{player.avatar_emoji}</span>
          <div>
            <h2 className="text-lg font-bold">{player.display_name}</h2>
            <div className="text-xs text-slate-500 font-mono">{player.id}</div>
          </div>
        </div>

        <div className="space-y-3">
          {[
            { label: "🪙 العملات", value: coins, set: setCoins },
            { label: "💎 الجواهر", value: gems, set: setGems },
            
            { label: "⭐ XP", value: xp, set: setXp },
            { label: "📈 المستوى", value: level, set: setLevel },
          ].map((f) => (
            <div key={f.label}>
              <label className="text-xs text-slate-400">{f.label}</label>
              <input type="number" value={f.value} onChange={(e) => f.set(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500" />
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={sendBox} className="px-3 py-2 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 text-sm">🎁 إهداء صندوق</button>
          <button onClick={onClose} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">إلغاء</button>
        </div>
        <button onClick={save} disabled={saving} className="w-full mt-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-semibold">
          {saving ? "جاري الحفظ..." : "💾 حفظ التعديلات"}
        </button>
      </div>
    </div>
  );
}
