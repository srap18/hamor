import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/hooks/use-admin";
import { toast } from "sonner";
import { FISH_LIST } from "@/lib/fish";


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
  rubies: number;
  
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

  const notify = async (userId: string, title: string, body: string) => {
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("notifications").insert({
      recipient_id: userId, title, body, kind: "warning", created_by: userData.user?.id,
    });
  };

  const toggleBan = async (p: Player) => {
    const isBanned = banned.has(p.id);
    if (isBanned) {
      await supabase.from("bans").update({ active: false }).eq("user_id", p.id).eq("active", true);
      await logAudit("unban_user", p.id, { name: p.display_name });
      await notify(p.id, "✅ تم رفع الحظر", "يمكنك الآن استخدام اللعبة بشكل طبيعي.");
      toast.success(`فُكّ الحظر عن ${p.display_name}`);
    } else {
      const reason = prompt("سبب الحظر:", "مخالفة قواعد اللعبة") ?? "";
      const daysStr = prompt("مدة الحظر — كم يوم؟ (اتركه فارغ للدائم):", "");
      const hoursStr = prompt("مدة الحظر — كم ساعة إضافية؟", "0");
      const days = daysStr ? Math.max(0, Number(daysStr) | 0) : 0;
      const hours = hoursStr ? Math.max(0, Number(hoursStr) | 0) : 0;
      const totalH = days * 24 + hours;
      const expires_at = totalH > 0 ? new Date(Date.now() + totalH * 3600_000).toISOString() : null;
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from("bans").insert({ user_id: p.id, reason, banned_by: userData.user?.id, expires_at });
      await logAudit("ban_user", p.id, { name: p.display_name, reason, days, hours, permanent: totalH === 0 });
      const dur = totalH > 0 ? `لمدة ${days ? `${days}ي ` : ""}${hours ? `${hours}س` : ""}`.trim() : "نهائياً";
      await notify(p.id, "🚫 تم حظرك", `تم حظرك ${dur}. السبب: ${reason || "غير محدد"}`);
      toast.success(`تم حظر ${p.display_name} ${dur}`);
    }
    load();
  };

  const toggleMute = async (p: Player) => {
    const isMuted = muted.has(p.id);
    if (isMuted) {
      await supabase.from("chat_mutes").update({ active: false }).eq("user_id", p.id).eq("active", true);
      await logAudit("unmute_user", p.id, { name: p.display_name });
      await notify(p.id, "✅ تم رفع الكتم", "يمكنك الآن الكتابة في الدردشة.");
      toast.success(`أُلغي كتم ${p.display_name}`);
    } else {
      const reason = prompt("سبب الكتم:", "إساءة في الدردشة") ?? "";
      const daysStr = prompt("مدة الكتم — كم يوم؟ (اتركه فارغ للدائم):", "1");
      const hoursStr = prompt("مدة الكتم — كم ساعة إضافية؟", "0");
      const days = daysStr ? Math.max(0, Number(daysStr) | 0) : 0;
      const hours = hoursStr ? Math.max(0, Number(hoursStr) | 0) : 0;
      const totalH = days * 24 + hours;
      const expires_at = totalH > 0 ? new Date(Date.now() + totalH * 3600_000).toISOString() : null;
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from("chat_mutes").insert({ user_id: p.id, reason, muted_by: userData.user?.id, expires_at });
      await logAudit("mute_user", p.id, { name: p.display_name, reason, days, hours, permanent: totalH === 0 });
      const dur = totalH > 0 ? `لمدة ${days ? `${days}ي ` : ""}${hours ? `${hours}س` : ""}`.trim() : "نهائياً";
      await notify(p.id, "🔇 تم كتمك في الدردشة", `لا يمكنك الكتابة ${dur}. السبب: ${reason || "غير محدد"}`);
      toast.success(`تم كتم ${p.display_name} ${dur}`);
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
              const isMuted = muted.has(p.id);
              return (
                <tr key={p.id} className={`border-t border-slate-800/50 ${isBanned ? "bg-red-900/10" : ""}`}>
                  <td className="p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg">{p.avatar_emoji}</span>
                      <div>
                        <div className="font-medium">{p.display_name}</div>
                        <div className="text-xs text-slate-500 font-mono">{p.id.slice(0, 8)}</div>
                      </div>
                      {isBanned && <span className="px-2 py-0.5 rounded text-xs bg-red-600/30 text-red-300 border border-red-500/40">محظور</span>}
                      {isMuted && <span className="px-2 py-0.5 rounded text-xs bg-amber-600/30 text-amber-300 border border-amber-500/40">مكتوم</span>}
                    </div>
                  </td>
                  <td className="p-3">{p.level}</td>
                  <td className="p-3">{p.xp.toLocaleString("en-US")}</td>
                  <td className="p-3">{Number(p.coins).toLocaleString("en-US")}</td>
                  <td className="p-3">{p.gems}</td>
                  <td className="p-3 text-xs text-slate-400">{new Date(p.online_at).toLocaleString("ar")}</td>
                  <td className="p-3">
                    <div className="flex gap-1 flex-wrap">
                      <button onClick={() => setEditing(p)} className="px-2 py-1 rounded bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 text-xs">تعديل</button>
                      <button
                        onClick={() => toggleMute(p)}
                        className={`px-2 py-1 rounded text-xs ${isMuted ? "bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200" : "bg-amber-600/30 hover:bg-amber-600/50 text-amber-200"}`}
                      >
                        {isMuted ? "فك كتم" : "كتم"}
                      </button>
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

type HistoryEntry = { kind: "ban" | "mute"; reason: string; expires_at: string | null; created_at: string; active: boolean };
type FishAdminRow = { fish_id: string; quantity: number; total_caught: number };

function EditPlayerModal({ player, onClose }: { player: Player; onClose: () => void }) {
  const [coins, setCoins] = useState(String(player.coins));
  const [gems, setGems] = useState(String(player.gems));
  const [rubies, setRubies] = useState(String(player.rubies ?? 0));

  const [xp, setXp] = useState(String(player.xp));
  const [level, setLevel] = useState(String(player.level));
  const [displayName, setDisplayName] = useState(player.display_name);
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [fishRows, setFishRows] = useState<FishAdminRow[]>([]);
  const fishMap = new Map(fishRows.map((r) => [r.fish_id, r]));

  useEffect(() => {
    (async () => {
      const [{ data: bans }, { data: mutes }, { data: prof }, { data: fish }] = await Promise.all([
        supabase.from("bans").select("reason,expires_at,active,created_at:banned_at").eq("user_id", player.id).order("banned_at", { ascending: false }).limit(20),
        supabase.from("chat_mutes").select("reason,expires_at,active,created_at").eq("user_id", player.id).order("created_at", { ascending: false }).limit(20),
        supabase.from("profiles").select("avatar_url").eq("id", player.id).maybeSingle(),
        (supabase as any).rpc("admin_get_player_fish", { _player: player.id }),
      ]);
      const all: HistoryEntry[] = [
        ...((bans ?? []) as any[]).map((b) => ({ ...b, kind: "ban" as const })),
        ...((mutes ?? []) as any[]).map((m) => ({ ...m, kind: "mute" as const })),
      ].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      setHistory(all);
      setAvatarUrl((prof as any)?.avatar_url ?? null);
      setFishRows(((fish ?? []) as FishAdminRow[]).map((r) => ({ fish_id: r.fish_id, quantity: r.quantity ?? 0, total_caught: r.total_caught ?? 0 })));
    })();
  }, [player.id]);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const { adminUpdateUser } = await import("@/lib/admin-users.functions");
      const payload: { userId: string; email?: string; display_name?: string; avatar_url?: string | null } = { userId: player.id };
      if (displayName.trim() !== player.display_name) payload.display_name = displayName.trim();
      if (email.trim()) payload.email = email.trim();
      await adminUpdateUser({ data: payload });
      toast.success("تم حفظ بيانات الحساب");
      setEmail("");
    } catch (e: any) {
      toast.error("خطأ: " + (e?.message ?? "غير معروف"));
    }
    setSavingProfile(false);
  };

  const onUploadAvatar = async (file: File) => {
    if (file.size > 3 * 1024 * 1024) { toast.error("الصورة كبيرة (الحد 3 ميجا)"); return; }
    try {
      toast("جاري فحص الصورة...");
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => { const s = String(r.result || ""); const i = s.indexOf(","); resolve(i >= 0 ? s.slice(i + 1) : s); };
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const { moderateImage } = await import("@/lib/moderation.functions");
      const verdict = await moderateImage({ data: { imageBase64: b64, mimeType: file.type || "image/jpeg" } });
      if (!verdict.safe) { toast.error("⚠️ الصورة مرفوضة: محتوى غير لائق"); return; }
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
      const path = `${player.id}/avatar.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, cacheControl: "0" });
      if (error) { toast.error("فشل الرفع"); return; }
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = `${pub.publicUrl}?t=${Date.now()}`;
      const { adminUpdateUser } = await import("@/lib/admin-users.functions");
      await adminUpdateUser({ data: { userId: player.id, avatar_url: url } });
      setAvatarUrl(url);
      toast.success("تم تحديث الصورة");
    } catch (e: any) {
      toast.error("خطأ: " + (e?.message ?? "غير معروف"));
    }
  };

  const deleteAccount = async () => {
    if (!confirm(`⚠️ حذف حساب ${player.display_name} نهائياً؟ هذا الإجراء لا يمكن التراجع عنه.`)) return;
    const banEmail = confirm("هل تريد أيضاً منع نفس البريد من إنشاء حساب جديد؟");
    const reason = prompt("سبب الحذف (اختياري):", "") ?? "";
    try {
      const { adminDeleteUser } = await import("@/lib/admin-users.functions");
      await adminDeleteUser({ data: { userId: player.id, banEmail, reason } });
      toast.success("تم حذف الحساب");
      onClose();
    } catch (e: any) {
      toast.error("خطأ: " + (e?.message ?? "غير معروف"));
    }
  };

  const blockLogin = async () => {
    const hoursStr = prompt("منع تسجيل الدخول لكم ساعة؟ (اتركه فارغاً للمنع الدائم)", "");
    const hours = hoursStr ? Number(hoursStr) : 87600;
    if (!confirm(`منع ${player.display_name} من تسجيل الدخول ${hoursStr ? `${hours} ساعة` : "نهائياً"}؟`)) return;
    try {
      const { adminBlockLogin } = await import("@/lib/admin-users.functions");
      await adminBlockLogin({ data: { userId: player.id, hours } });
      toast.success("تم منع تسجيل الدخول");
    } catch (e: any) {
      toast.error("خطأ: " + (e?.message ?? "غير معروف"));
    }
  };

  const unblockLogin = async () => {
    try {
      const { adminBlockLogin } = await import("@/lib/admin-users.functions");
      await adminBlockLogin({ data: { userId: player.id, unblock: true } });
      toast.success("تم رفع منع الدخول");
    } catch (e: any) {
      toast.error("خطأ: " + (e?.message ?? "غير معروف"));
    }
  };

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

  const grantVip = async () => {
    const levelStr = prompt("مستوى VIP (1-10):", "1");
    if (!levelStr) return;
    const level = Math.max(1, Math.min(10, Number(levelStr) | 0));
    const daysStr = prompt("المدة بالأيام (0 = دائم):", "30");
    if (daysStr === null) return;
    const days = Math.max(0, Number(daysStr) | 0);
    const { error } = await supabase.rpc("grant_vip" as never, {
      _user_id: player.id, _level: level, _days: days,
    } as never);
    if (error) { toast.error("خطأ: " + error.message); return; }
    await logAudit("grant_vip", player.id, { name: player.display_name, level, days });
    toast.success(`👑 تم منح VIP ${level} لـ ${player.display_name} ${days === 0 ? "دائم" : `(${days} يوم)`}`);
  };


  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-slate-900 rounded-2xl border border-slate-700 p-6 max-w-md w-full my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="w-12 h-12 rounded-full object-cover border border-slate-700" />
          ) : (
            <span className="text-3xl">{player.avatar_emoji}</span>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold truncate">{player.display_name}</h2>
            <div className="text-xs text-slate-500 font-mono truncate">{player.id}</div>
          </div>
        </div>

        {/* Account fields */}
        <div className="space-y-3 mb-4 pb-4 border-b border-slate-800">
          <div className="text-sm font-semibold text-slate-300">👤 بيانات الحساب</div>
          <div>
            <label className="text-xs text-slate-400">الاسم</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="text-xs text-slate-400">الإيميل (اتركه فارغاً لعدم التغيير)</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="new@email.com" className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="text-xs text-slate-400">الصورة الرمزية</label>
            <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadAvatar(f); e.currentTarget.value = ""; }}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs file:mr-2 file:rounded file:border-0 file:bg-indigo-600 file:px-2 file:py-1 file:text-white" />
          </div>
          <button onClick={saveProfile} disabled={savingProfile} className="w-full px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-semibold">
            {savingProfile ? "جاري الحفظ..." : "💾 حفظ بيانات الحساب"}
          </button>
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
          <button onClick={grantVip} className="px-3 py-2 rounded-lg bg-amber-600/40 hover:bg-amber-600/60 text-amber-100 text-sm font-bold">👑 منح VIP</button>
        </div>
        <button onClick={save} disabled={saving} className="w-full mt-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-semibold">
          {saving ? "جاري الحفظ..." : "💾 حفظ العملات والمستوى"}
        </button>
        <button onClick={onClose} className="w-full mt-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">إغلاق</button>

        {/* Anti-cheat: gold tracking */}
        <div className="mt-4 pt-4 border-t border-amber-900/50 space-y-2">
          <div className="text-sm font-semibold text-amber-300">🛡️ تتبع الذهب (مكافحة الغش)</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={async () => {
                const { data, error } = await (supabase as any).rpc("audit_player_currency", { _uid: player.id });
                if (error) { toast.error("خطأ: " + error.message); return; }
                const r = (data?.[0]) ?? {};
                const cd = Number(r.coins_diff ?? 0);
                const gd = Number(r.gems_diff ?? 0);
                alert(
                  `🪙 الذهب الحالي: ${Number(r.current_coins ?? 0).toLocaleString()}\n` +
                  `   المتتبَّع: ${Number(r.ledger_coins ?? 0).toLocaleString()}\n` +
                  `   فرق غير متتبَّع: ${cd.toLocaleString()}\n\n` +
                  `💎 الجواهر الحالية: ${Number(r.current_gems ?? 0).toLocaleString()}\n` +
                  `   المتتبَّع: ${Number(r.ledger_gems ?? 0).toLocaleString()}\n` +
                  `   فرق غير متتبَّع: ${gd.toLocaleString()}`
                );
              }}
              className="px-3 py-2 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 text-sm"
            >🔍 فحص الذهب</button>
            <button
              onClick={async () => {
                if (!confirm(`حذف كل الذهب والجواهر غير المتتبَّعة لـ ${player.display_name}؟`)) return;
                const { data, error } = await (supabase as any).rpc("reset_player_to_ledger", { _uid: player.id });
                if (error) { toast.error("خطأ: " + error.message); return; }
                const d: any = data ?? {};
                toast.success(`🧹 حُذف ${Number(d.removed_coins ?? 0).toLocaleString()} ذهب و ${Number(d.removed_gems ?? 0).toLocaleString()} جوهرة غير متتبَّعة`);
                onClose();
              }}
              className="px-3 py-2 rounded-lg bg-rose-600/40 hover:bg-rose-600/60 text-rose-100 text-sm font-bold"
            >🧹 حذف غير المتتبَّع</button>
          </div>
        </div>

        {/* Danger zone */}
        <div className="mt-4 pt-4 border-t border-red-900/50 space-y-2">
          <div className="text-sm font-semibold text-red-300">⚠️ منطقة الخطر</div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={blockLogin} className="px-3 py-2 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 text-sm">🚷 منع الدخول</button>
            <button onClick={unblockLogin} className="px-3 py-2 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 text-sm">✅ رفع المنع</button>
          </div>
          <button onClick={deleteAccount} className="w-full px-3 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-semibold">🗑️ حذف الحساب نهائياً</button>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-800">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">📜 سجل العقوبات ({history.length})</h3>
          {history.length === 0 ? (
            <div className="text-xs text-slate-500">لا يوجد سجل عقوبات</div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {history.map((h, i) => (
                <div key={i} className="flex items-start gap-2 text-xs p-2 rounded bg-slate-800/50">
                  <span className={`px-1.5 py-0.5 rounded shrink-0 ${h.kind === "ban" ? "bg-red-600/30 text-red-200" : "bg-amber-600/30 text-amber-200"}`}>
                    {h.kind === "ban" ? "🚫" : "🔇"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-300 truncate">{h.reason || "—"}</div>
                    <div className="text-slate-500 text-[10px]">
                      {new Date(h.created_at).toLocaleString("ar")}
                      {h.expires_at && ` • ينتهي: ${new Date(h.expires_at).toLocaleString("ar")}`}
                      {!h.expires_at && h.active && " • دائم"}
                      {!h.active && " • مُلغى"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
