import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PROFILE_PUBLIC_COLUMNS } from "@/lib/profile-columns";
import { logAudit } from "@/hooks/use-admin";
import { toast } from "sonner";
import { FISH_LIST } from "@/lib/fish";
import { CREWS } from "@/lib/crews";
import { WEAPONS } from "@/lib/weapons";
import { BACKGROUNDS } from "@/lib/backgrounds";
import { ALL_FRAMES } from "@/lib/frames";
import { getShipByCode } from "@/lib/ships";

const ITEM_NAME_AR: Record<string, string> = {};
CREWS.forEach((c) => { ITEM_NAME_AR[c.id] = c.name; });
WEAPONS.forEach((w) => { ITEM_NAME_AR[w.id] = w.name; });
BACKGROUNDS.forEach((b) => { ITEM_NAME_AR[b.id] = b.name; });
ALL_FRAMES.forEach((f) => { ITEM_NAME_AR[f.id] = f.name; });
FISH_LIST.forEach((f: any) => { if (f?.id && f?.name) ITEM_NAME_AR[f.id] = f.name; });

const TYPE_LABEL_AR: Record<string, string> = {
  crew: "طاقم",
  weapon: "سلاح",
  consumable: "مستهلك",
  decoration: "زينة",
  frame: "إطار",
  background: "خلفية",
  name_frame: "إطار اسم",
  bubble_frame: "إطار فقاعة",
  profile_frame: "إطار ملف",
  shield: "درع",
  ship: "سفينة",
  fish: "سمكة",
};

function getItemNameAr(itemType: string, itemId: string): string {
  if (ITEM_NAME_AR[itemId]) return ITEM_NAME_AR[itemId];
  if (itemType === "ship") {
    try { return getShipByCode(itemId).name ?? itemId; } catch { /* ignore */ }
  }
  return itemId;
}



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
    const s = search.trim();
    let emailIds: string[] = [];
    if (s) {
      const { data: emailMatches } = await (supabase as any).rpc("admin_search_player_ids_by_email", { _q: s });
      emailIds = ((emailMatches ?? []) as { id: string }[]).map((r) => r.id);
    }
    let q = supabase.from("profiles").select(PROFILE_PUBLIC_COLUMNS).order("created_at", { ascending: false }).limit(200);
    if (s) {
      const esc = s.replace(/[,()]/g, "");
      const filters = [`display_name.ilike.%${esc}%`, `username.ilike.%${esc.toLowerCase()}%`];
      if (emailIds.length > 0) filters.push(`id.in.(${emailIds.join(",")})`);
      q = q.or(filters.join(","));
    }
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


  const giveCodeToAll = async () => {
    const code = prompt("🎟️ أدخل الكود لإعطائه لجميع اللاعبين (يصل حتى لو غير متصلين):", "")?.trim();
    if (!code) return;
    if (!confirm(`تفعيل الكود "${code}" لكل اللاعبين (${players.length} لاعب على الأقل)؟ سيتم الإرسال على جميع الحسابات المسجّلة.`)) return;
    const t = toast.loading("جاري إرسال الكود لجميع اللاعبين...");
    const { data, error } = await (supabase as any).rpc("admin_redeem_code_for_all", { p_code: code });
    toast.dismiss(t);
    if (error) {
      const raw = String(error.message || error);
      const map: Record<string, string> = {
        invalid_code: "كود غير صالح",
        code_expired: "الكود منتهي",
        code_disabled: "الكود معطّل",
        admin_only: "صلاحية الأدمن مطلوبة",
      };
      const key = (raw.match(/(invalid_code|code_expired|code_disabled|admin_only|not_authenticated)/) || [, raw])[1];
      toast.error("❌ " + (map[key] ?? raw));
      return;
    }
    const d: { ok_count?: number; skipped?: number; total?: number } = data ?? {};
    await logAudit("admin_give_code_to_all", null, { code, ok: d.ok_count, skipped: d.skipped });
    toast.success(`🎁 تم تفعيل "${code}" لـ ${d.ok_count ?? 0} لاعب (تم تخطي ${d.skipped ?? 0} مفعّل مسبقاً)`);
  };

  return (
    <div className="p-3 md:p-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">إدارة اللاعبين</h1>
          <p className="text-slate-400 text-xs md:text-sm mt-1">{players.length} لاعب معروض</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <button onClick={giveCodeToAll} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold whitespace-nowrap shrink-0">
            🎁 إعطاء كود للجميع
          </button>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو اليوزر أو الإيميل..."
            className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 flex-1 md:w-64"
          />
        </div>
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
type InvRow = { id: string; item_type: string; item_id: string; quantity: number; meta: any; acquired_at: string };

function EditPlayerModal({ player, onClose }: { player: Player; onClose: () => void }) {
  const [coins, setCoins] = useState(String(player.coins));
  const [gems, setGems] = useState(String(player.gems));
  const [rubies, setRubies] = useState(String(player.rubies ?? 0));

  const [xp, setXp] = useState(String(player.xp));
  const [level, setLevel] = useState(String(player.level));
  const [shipMarketLevel, setShipMarketLevel] = useState("1");
  const [fishMarketLevel, setFishMarketLevel] = useState("1");
  const [savingMarkets, setSavingMarkets] = useState(false);
  const [dragonStage, setDragonStage] = useState("1");
  const [dragonDp, setDragonDp] = useState("0");
  const [dragonPearls, setDragonPearls] = useState("0");
  const [dragonPearlLevel, setDragonPearlLevel] = useState("0");
  const [savingDragon, setSavingDragon] = useState(false);
  const [displayName, setDisplayName] = useState(player.display_name);
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [usernameVal, setUsernameVal] = useState("");
  const [bio, setBio] = useState("");
  const [mediaBanned, setMediaBanned] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);
  const [savingBio, setSavingBio] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [fishRows, setFishRows] = useState<FishAdminRow[]>([]);
  const fishMap = new Map(fishRows.map((r) => [r.fish_id, r]));
  const [invRows, setInvRows] = useState<InvRow[]>([]);
  const [invFilter, setInvFilter] = useState<string>("all");
  const [invQtyEdits, setInvQtyEdits] = useState<Record<string, string>>({});
  const [linkedLoading, setLinkedLoading] = useState(false);
  const [linkedData, setLinkedData] = useState<{
    self: { user_id: string; email: string | null; devices: { device_id: string; created_at: string; updated_at: string }[]; ips: { ip: string; first_seen: string; last_seen: string; hits: number }[] };
    linked: Array<{ user_id: string; display_name: string | null; username: string | null; avatar_url: string | null; email: string | null; level: number | null; coins: number | null; created_at: string | null; shared_devices: string[]; shared_ips: string[]; link_via: ("device" | "ip")[] }>;
  } | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteBanEmail, setDeleteBanEmail] = useState(true);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  const loadLinked = useCallback(async () => {
    setLinkedLoading(true);
    try {
      const { adminGetLinkedAccounts } = await import("@/lib/admin-linked-accounts.functions");
      const res = await adminGetLinkedAccounts({ data: { userId: player.id } });
      setLinkedData(res as never);
    } catch (e: any) {
      toast.error("فشل تحميل الحسابات المرتبطة: " + (e?.message ?? ""));
    }
    setLinkedLoading(false);
  }, [player.id]);

  useEffect(() => { loadLinked(); }, [loadLinked]);

  const reloadInventory = useCallback(async () => {
    const { data, error } = await (supabase as any).rpc("admin_get_player_inventory", { _player: player.id });
    if (error) { toast.error("فشل تحميل المخزن: " + error.message); return; }
    setInvRows(((data ?? []) as InvRow[]));
    setInvQtyEdits({});
  }, [player.id]);

  useEffect(() => { reloadInventory(); }, [reloadInventory]);

  const saveInvRow = async (rowId: string) => {
    const raw = invQtyEdits[rowId];
    if (raw === undefined) return;
    const q = Math.max(0, Number(raw) || 0);
    const { error } = await (supabase as any).rpc("admin_set_inventory_quantity", { _row_id: rowId, _quantity: q });
    if (error) { toast.error("خطأ: " + error.message); return; }
    toast.success(q === 0 ? "تم حذف العنصر" : "تم تحديث الكمية");
    await reloadInventory();
  };

  const deleteInvRow = async (rowId: string, label: string) => {
    if (!confirm(`حذف "${label}" من المخزن؟`)) return;
    const { error } = await (supabase as any).rpc("admin_set_inventory_quantity", { _row_id: rowId, _quantity: 0 });
    if (error) { toast.error("خطأ: " + error.message); return; }
    toast.success("تم الحذف");
    await reloadInventory();
  };

  const grantItem = async () => {
    const types = ["crew","weapon","consumable","decoration","frame","background","name_frame","bubble_frame","profile_frame","shield"];
    const itype = prompt(`نوع العنصر:\n${types.join(", ")}`, "consumable")?.trim();
    if (!itype || !types.includes(itype)) return;
    const iid = prompt("معرّف العنصر (item_id):", "")?.trim();
    if (!iid) return;
    const qtyStr = prompt("الكمية:", "1");
    if (qtyStr === null) return;
    const q = Math.max(1, Number(qtyStr) || 1);
    const { error } = await (supabase as any).rpc("admin_grant_inventory_item", {
      _player: player.id, _item_type: itype, _item_id: iid, _quantity: q,
    });
    if (error) { toast.error("خطأ: " + error.message); return; }
    await logAudit("admin_grant_inventory_item", player.id, { item_type: itype, item_id: iid, quantity: q });
    toast.success("تم إضافة العنصر");
    await reloadInventory();
  };

  useEffect(() => {
    (async () => {
      const [{ data: bans }, { data: mutes }, { data: prof }, { data: fish }, { data: um }, { data: ufm }] = await Promise.all([
        supabase.from("bans").select("reason,expires_at,active,created_at:banned_at").eq("user_id", player.id).order("banned_at", { ascending: false }).limit(20),
        supabase.from("chat_mutes").select("reason,expires_at,active,created_at").eq("user_id", player.id).order("created_at", { ascending: false }).limit(20),
        supabase.from("profiles").select("avatar_url,username,bio,media_banned,coins,gems,rubies,xp,level,display_name").eq("id", player.id).maybeSingle(),
        (supabase as any).rpc("admin_get_player_fish", { _player: player.id }),
        (supabase as any).from("user_market").select("level").eq("user_id", player.id).maybeSingle(),
        (supabase as any).from("user_fish_market").select("level").eq("user_id", player.id).maybeSingle(),
      ]);
      setShipMarketLevel(String((um as any)?.level ?? 1));
      setFishMarketLevel(String((ufm as any)?.level ?? 1));
      const all: HistoryEntry[] = [
        ...((bans ?? []) as any[]).map((b) => ({ ...b, kind: "ban" as const })),
        ...((mutes ?? []) as any[]).map((m) => ({ ...m, kind: "mute" as const })),
      ].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      setHistory(all);
      const p: any = prof ?? {};
      setAvatarUrl(p.avatar_url ?? null);
      setUsernameVal((p.username ?? "") as string);
      setBio((p.bio ?? "") as string);
      setMediaBanned(Boolean(p.media_banned));
      // تحديث الحقول الحيّة من قاعدة البيانات (قائمة الأب قد تكون قديمة)
      if (p.coins != null) setCoins(String(p.coins));
      if (p.gems != null) setGems(String(p.gems));
      if (p.rubies != null) setRubies(String(p.rubies));
      if (p.xp != null) setXp(String(p.xp));
      if (p.level != null) setLevel(String(p.level));
      if (p.display_name) setDisplayName(String(p.display_name));
      setFishRows(((fish ?? []) as FishAdminRow[]).map((r) => ({ fish_id: r.fish_id, quantity: r.quantity ?? 0, total_caught: r.total_caught ?? 0 })));
    })();
  }, [player.id]);

  const saveUsername = async () => {
    const v = usernameVal.trim().toLowerCase();
    if (!/^[a-z0-9_]{1,20}$/.test(v)) { toast.error("اليوزر: 1-20 حرف، a-z 0-9 _"); return; }
    setSavingUsername(true);
    const { error } = await (supabase as any).rpc("admin_set_username", { _target: player.id, _new: v });
    setSavingUsername(false);
    if (error) {
      const m = String(error.message || "");
      if (m.includes("USERNAME_TAKEN")) toast.error("اليوزر محجوز");
      else if (m.includes("INVALID_USERNAME")) toast.error("صيغة اليوزر غير صحيحة");
      else toast.error("خطأ: " + m);
      return;
    }
    await logAudit("admin_set_username", player.id, { username: v });
    toast.success("تم تعيين اليوزر");
  };

  const saveBio = async () => {
    setSavingBio(true);
    const { error } = await (supabase as any).rpc("admin_set_profile_fields", { _target: player.id, _bio: bio.slice(0, 200) });
    setSavingBio(false);
    if (error) { toast.error("خطأ: " + error.message); return; }
    await logAudit("admin_edit_bio", player.id, {});
    toast.success("تم حفظ الوصف");
  };

  const toggleMediaBan = async () => {
    const next = !mediaBanned;
    if (next && !confirm(`منع ${player.display_name} من رفع أي صور أو مقاطع في الألبوم؟`)) return;
    const { error } = await (supabase as any).rpc("admin_set_media_ban", { _target: player.id, _banned: next });
    if (error) { toast.error("خطأ: " + error.message); return; }
    setMediaBanned(next);
    await logAudit(next ? "media_ban" : "media_unban", player.id, {});
    toast.success(next ? "تم منع الرفع" : "تم رفع المنع");
  };

  const wipeProfile = async () => {
    if (!confirm(`⚠️ مسح الوصف والصورة وكل الألبوم لـ ${player.display_name}؟`)) return;
    const { data, error } = await (supabase as any).rpc("admin_wipe_profile", { _target: player.id });
    if (error) { toast.error("خطأ: " + error.message); return; }
    const d: any = data ?? {};
    setBio(""); setAvatarUrl(null);
    await logAudit("admin_wipe_profile", player.id, { deleted_media: d.deleted_media });
    toast.success(`🧹 مُسح الملف الشخصي (${d.deleted_media ?? 0} عنصر من الألبوم)`);
  };

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

  const deleteAccount = () => {
    setDeleteReason("");
    setDeleteBanEmail(true);
    setShowDeleteModal(true);
  };

  const confirmDeleteAccount = async () => {
    setDeleting(true);
    try {
      const { adminDeleteUser } = await import("@/lib/admin-users.functions");
      await adminDeleteUser({ data: { userId: player.id, banEmail: deleteBanEmail, banDevices: true, reason: deleteReason } });
      toast.success("تم حذف الحساب نهائياً");
      setShowDeleteModal(false);
      onClose();
    } catch (e: any) {
      toast.error("خطأ: " + (e?.message ?? "غير معروف"));
    }
  };

  const reconcilePayments = async () => {
    if (!confirm(`فحص ومنح أي مشتريات Paddle مدفوعة ولم تُسلَّم لـ ${player.display_name}؟`)) return;
    try {
      const { adminReconcilePaddleForUser } = await import("@/lib/admin-payments.functions");
      const r = await adminReconcilePaddleForUser({ data: { userId: player.id, environment: "live" } });
      if (r?.grantedCount && r.grantedCount > 0) {
        toast.success(`✅ تم منح ${r.grantedCount} عملية شراء معلقة`);
      } else {
        toast.message(r?.reason ? `لا شيء للمنح (${r.reason})` : "لا توجد مشتريات معلقة");
      }
    } catch (e: any) {
      toast.error("خطأ: " + (e?.message ?? "غير معروف"));
    }
  };




  const blockLogin = async () => {
    const hoursStr = prompt("منع تسجيل الدخول لكم ساعة؟ (اتركه فارغاً للمنع الدائم)", "");
    const hours = hoursStr ? Number(hoursStr) : 87600;
    const reason = prompt("سبب منع الدخول:", "منع تسجيل الدخول") ?? "";
    if (!confirm(`منع ${player.display_name} من تسجيل الدخول ${hoursStr ? `${hours} ساعة` : "نهائياً"}؟\n(يؤثر على هذا الحساب فقط — لا يحظر الجهاز ولا الحسابات المرتبطة)`)) return;
    try {
      const { adminBlockLogin } = await import("@/lib/admin-users.functions");
      await adminBlockLogin({ data: { userId: player.id, hours, reason } });
      toast.success("تم منع تسجيل الدخول وأُضيف للعقوبات");
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

  const permanentBan = async () => {
    const reason = prompt("سبب الحظر النهائي:", "غش أو استغلال قلتش") ?? "";
    if (!confirm(`حظر ${player.display_name} نهائياً؟\n(هذا الحساب فقط — لا يمنع إنشاء حساب ثاني)`)) return;
    try {
      const { adminPermanentBan } = await import("@/lib/admin-users.functions");
      await adminPermanentBan({ data: { userId: player.id, reason } });
      toast.success("تم تطبيق الحظر النهائي");
      onClose();
    } catch (e: any) {
      toast.error("خطأ: " + (e?.message ?? "غير معروف"));
    }
  };

  const hardBan = async () => {
    const reason = prompt("سبب الحظر القوي الشامل:", "غش / تخريب") ?? "";
    if (!confirm(`حظر قوي شامل لـ ${player.display_name}؟\n\nسيتم حظر:\n• الحساب نهائياً\n• البريد (لا يقدر يسجل من جديد)\n• كل أجهزته (لا يقدر يفتح حساب من نفس الجهاز)\n• كل عناوين IP الخاصة به (تغيير الشبكة لن يفيد)\n\n(لا يؤثر على الحسابات المرتبطة الأخرى — فقط هذا اللاعب)`)) return;
    try {
      const { adminHardBan } = await import("@/lib/admin-users.functions");
      const r = await adminHardBan({ data: { userId: player.id, reason } });
      toast.success(`تم الحظر القوي ✓ — ${r.devices} جهاز / ${r.ips} IP / بريد ${r.email ? "✓" : "—"}`);
      onClose();
    } catch (e: any) {
      toast.error("خطأ: " + (e?.message ?? "غير معروف"));
    }
  };

  const save = async () => {
    setSaving(true);
    const updates = {
      coins: Number(coins),
      gems: Number(gems),
      rubies: Number(rubies),
      xp: Number(xp),
      level: Number(level),
    };
    const { error } = await (supabase as any).rpc("admin_set_player_full", {
      _player: player.id, _coins: updates.coins, _gems: updates.gems, _rubies: updates.rubies, _xp: updates.xp, _level: updates.level,
    });
    if (error) {
      toast.error("خطأ: " + error.message);
      setSaving(false);
      return;
    }
    await logAudit("edit_player", player.id, { name: player.display_name, before: { coins: player.coins, gems: player.gems, rubies: player.rubies, xp: player.xp, level: player.level }, after: updates });
    toast.success("تم حفظ التعديلات");
    onClose();
  };

  const setFishValue = (fishId: string, key: "quantity" | "total_caught", value: string) => {
    const n = Math.max(0, Number(value) || 0);
    setFishRows((rows) => {
      const cur = rows.find((r) => r.fish_id === fishId) ?? { fish_id: fishId, quantity: 0, total_caught: 0 };
      const next = { ...cur, [key]: n } as FishAdminRow;
      return [...rows.filter((r) => r.fish_id !== fishId), next];
    });
  };

  const saveFishRow = async (fishId: string) => {
    const row = fishMap.get(fishId) ?? { fish_id: fishId, quantity: 0, total_caught: 0 };
    const { error } = await (supabase as any).rpc("admin_set_player_fish", {
      _player: player.id,
      _fish_id: fishId,
      _quantity: row.quantity,
      _total_caught: Math.max(row.total_caught, row.quantity),
    });
    if (error) { toast.error("خطأ: " + error.message); return; }
    toast.success("تم حفظ السمك");
  };

  const saveMarkets = async () => {
    const s = Math.max(1, Math.min(31, Number(shipMarketLevel) | 0));
    const f = Math.max(1, Math.min(30, Number(fishMarketLevel) | 0));
    setSavingMarkets(true);
    const { error } = await (supabase as any).rpc("admin_set_market_levels", {
      _player: player.id, _ship_level: s, _fish_level: f,
    });
    setSavingMarkets(false);
    if (error) { toast.error("خطأ: " + error.message); return; }
    await logAudit("admin_set_market_levels", player.id, { ship_level: s, fish_level: f });
    toast.success(`تم: سوق السفن L${s} • سوق السمك L${f}`);
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


  const giveCode = async () => {
    const code = prompt(`🎟️ أدخل الكود الذي تريد تفعيله لـ ${player.display_name}:\n(يصل اللاعب حتى لو كان غير متصل)`, "")?.trim();
    if (!code) return;
    const { error } = await (supabase as any).rpc("admin_redeem_code_for", {
      p_code: code,
      p_target_user: player.id,
    });
    if (error) {
      const raw = String(error.message || error);
      const map: Record<string, string> = {
        already_redeemed: "تم تفعيل هذا الكود مسبقاً لهذا اللاعب",
        code_exhausted: "نفذ الحد الأقصى للاستخدامات",
        code_expired: "الكود منتهي الصلاحية",
        code_disabled: "الكود معطّل",
        invalid_code: "كود غير صالح",
        admin_only: "صلاحية الأدمن مطلوبة",
        invalid_target: "اللاعب غير موجود",
      };
      const key = (raw.match(/(already_redeemed|code_exhausted|code_expired|code_disabled|invalid_code|admin_only|invalid_target|not_authenticated)/) || [, raw])[1];
      toast.error("❌ " + (map[key] ?? raw));
      return;
    }
    await logAudit("admin_give_code", player.id, { code, name: player.display_name });
    toast.success(`🎁 تم تفعيل الكود "${code}" لـ ${player.display_name}`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 overflow-y-auto overscroll-contain" onClick={onClose}>
      <div className="min-h-full flex items-start justify-center p-3 md:p-6">
        <div className="bg-slate-900 rounded-2xl border border-slate-700 max-w-3xl w-full my-4 md:my-8 flex flex-col max-h-[92vh] shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-3 p-4 md:p-5 border-b border-slate-800 sticky top-0 bg-slate-900 rounded-t-2xl z-10">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-12 h-12 rounded-full object-cover border border-slate-700" />
            ) : (
              <span className="text-3xl">{player.avatar_emoji}</span>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold truncate">{player.display_name}</h2>
              <div className="text-xs text-slate-500 font-mono truncate">{player.id}</div>
            </div>
            <button onClick={onClose} aria-label="إغلاق" className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm shrink-0">✕</button>
          </div>
          <div className="p-4 md:p-6 overflow-y-auto overscroll-contain">

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

        {/* Linked accounts (same device / same IP) */}
        <div className="space-y-3 mb-4 pb-4 border-b border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-300">🔗 الحسابات المرتبطة (نفس الجهاز / IP)</div>
            <button onClick={loadLinked} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs">🔄 تحديث</button>
          </div>
          {linkedData?.self?.email && (
            <div className="text-[11px] text-slate-400 font-mono break-all" dir="ltr">
              📧 {linkedData.self.email}
            </div>
          )}
          <div className="text-[11px] text-slate-500">
            عدد الأجهزة: {linkedData?.self.devices.length ?? 0} • عدد عناوين الـ IP: {linkedData?.self.ips.length ?? 0}
          </div>
          {linkedLoading ? (
            <div className="text-xs text-slate-500 py-3 text-center">جاري التحميل...</div>
          ) : !linkedData || linkedData.linked.length === 0 ? (
            <div className="text-xs text-slate-500 py-3 text-center bg-slate-800/40 rounded-lg">
              ✅ لا توجد حسابات أخرى مرتبطة بهذا اللاعب
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              <div className="text-[11px] text-amber-300">⚠️ تم العثور على {linkedData.linked.length} حساب آخر يشارك نفس الجهاز أو IP</div>
              {linkedData.linked.map((acc) => (
                <div key={acc.user_id} className="rounded-lg bg-slate-800/70 border border-slate-700 p-2 flex items-center gap-2">
                  {acc.avatar_url ? (
                    <img src={acc.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border border-slate-600 shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-sm shrink-0">👤</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-slate-100 truncate">
                      {acc.display_name || "بدون اسم"}
                      {acc.username && <span className="text-slate-400 font-normal"> · @{acc.username}</span>}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate" dir="ltr">
                      {acc.email ?? "—"} · L{acc.level ?? 0} · 🪙{(acc.coins ?? 0).toLocaleString()}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {acc.shared_devices.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-600/30 text-rose-200 text-[10px]">
                          📱 نفس الجهاز ({acc.shared_devices.length})
                        </span>
                      )}
                      {acc.shared_ips.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-600/30 text-amber-200 text-[10px]">
                          🌐 نفس IP ({acc.shared_ips.length})
                        </span>
                      )}
                    </div>
                  </div>
                  <a
                    href={`/p/${acc.user_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2 py-1 rounded bg-indigo-600/40 hover:bg-indigo-600/60 text-indigo-100 text-[11px] font-bold shrink-0"
                  >
                    فتح
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Profile (username + bio + media ban + wipe) */}
        <div className="space-y-3 mb-4 pb-4 border-b border-slate-800">
          <div className="text-sm font-semibold text-slate-300">🪪 الملف الشخصي</div>
          <div>
            <label className="text-xs text-slate-400">اليوزر @ (الأدمن فقط يقدر أقل من 5 حروف وبدون قيد 14 يوم)</label>
            <div className="flex gap-2 mt-1">
              <input dir="ltr" value={usernameVal}
                onChange={(e) => setUsernameVal(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20))}
                placeholder="user_or_2-20"
                className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm font-mono focus:outline-none focus:border-indigo-500" />
              <button onClick={saveUsername} disabled={savingUsername}
                className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-xs font-bold">
                {savingUsername ? "..." : "تعيين"}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400">الوصف الشخصي</label>
            <textarea value={bio} onChange={(e) => setBio(e.target.value.slice(0, 200))} rows={2}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 resize-none" />
            <div className="flex justify-between items-center mt-1">
              <span className="text-[10px] text-slate-500">{bio.length}/200</span>
              <button onClick={saveBio} disabled={savingBio}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-bold">
                {savingBio ? "..." : "💾 حفظ الوصف"}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={toggleMediaBan}
              className={`px-3 py-2 rounded-lg text-xs font-bold ${mediaBanned ? "bg-emerald-600/40 hover:bg-emerald-600/60 text-emerald-100" : "bg-orange-600/40 hover:bg-orange-600/60 text-orange-100"}`}>
              {mediaBanned ? "✅ السماح بالرفع" : "🚫 منع رفع الصور/المقاطع"}
            </button>
            <button onClick={wipeProfile}
              className="px-3 py-2 rounded-lg bg-rose-600/50 hover:bg-rose-600/70 text-rose-100 text-xs font-bold">
              🧹 مسح الوصف + الصورة + الألبوم
            </button>
          </div>
        </div>


        <div className="space-y-3">
          {[
            { label: "🪙 العملات", value: coins, set: setCoins },
            { label: "💎 الجواهر", value: gems, set: setGems },
            { label: "♦️ الياقوت", value: rubies, set: setRubies },
            { label: "⭐ XP", value: xp, set: setXp },
            { label: "📈 المستوى", value: level, set: setLevel },
          ].map((f) => (
            <div key={f.label}>
              <label className="text-xs text-slate-400">{f.label}</label>
              <input type="number" value={f.value} onChange={(e) => f.set(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500" />
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-800">
          <div className="text-sm font-semibold text-slate-300 mb-2">🏪 مستويات الأسواق</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-400">🚢 سوق السفن (1-30)</label>
              <input type="number" min={1} max={31} value={shipMarketLevel} onChange={(e) => setShipMarketLevel(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-slate-400">🐟 سوق السمك (1-30)</label>
              <input type="number" min={1} max={30} value={fishMarketLevel} onChange={(e) => setFishMarketLevel(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
          <button onClick={saveMarkets} disabled={savingMarkets} className="w-full mt-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-semibold">
            {savingMarkets ? "جاري الحفظ..." : "💾 حفظ مستويات الأسواق"}
          </button>
        </div>



        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={sendBox} className="px-3 py-2 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 text-sm">🎁 إهداء صندوق</button>
          <button onClick={grantVip} className="px-3 py-2 rounded-lg bg-amber-600/40 hover:bg-amber-600/60 text-amber-100 text-sm font-bold">👑 منح VIP</button>
        </div>
        <button onClick={save} disabled={saving} className="w-full mt-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-semibold">
          {saving ? "جاري الحفظ..." : "💾 حفظ العملات والمستوى"}
        </button>

        <div className="mt-4 pt-4 border-t border-slate-800">
          <div className="text-sm font-semibold text-slate-300 mb-2">🐟 السمك المكتشف والمخزون</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
            {FISH_LIST.map((f) => {
              const row = fishMap.get(f.id) ?? { fish_id: f.id, quantity: 0, total_caught: 0 };
              return (
                <div key={f.id} className="rounded-lg bg-slate-800/70 border border-slate-700 p-2">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-bold text-slate-200 truncate">{f.emoji} {f.name}</span>
                    <button onClick={() => saveFishRow(f.id)} className="px-2 py-1 rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 text-[11px]">حفظ</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[10px] text-slate-400">المخزون
                      <input type="number" min={0} value={row.quantity} onChange={(e) => setFishValue(f.id, "quantity", e.target.value)} className="w-full mt-1 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs" />
                    </label>
                    <label className="text-[10px] text-slate-400">المكتشف/المصطاد
                      <input type="number" min={0} value={row.total_caught} onChange={(e) => setFishValue(f.id, "total_caught", e.target.value)} className="w-full mt-1 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs" />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <button onClick={onClose} className="w-full mt-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">إغلاق</button>

        {/* Inventory / مخزن اللاعب */}
        <div className="mt-4 pt-4 border-t border-slate-800">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <div className="text-sm font-semibold text-slate-300">📦 مخزن اللاعب ({invRows.length})</div>
            <div className="flex gap-2">
              <button onClick={reloadInventory} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs">🔄 تحديث</button>
              <button onClick={grantItem} className="px-2 py-1 rounded bg-emerald-600/40 hover:bg-emerald-600/60 text-emerald-100 text-xs font-bold">➕ إضافة عنصر</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1 mb-2">
            {(() => {
              const types = Array.from(new Set(invRows.map(r => r.item_type)));
              return ["all", ...types].map(t => (
                <button key={t} onClick={() => setInvFilter(t)}
                  className={`px-2 py-0.5 rounded text-[11px] ${invFilter === t ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
                  {t === "all" ? `الكل (${invRows.length})` : `${TYPE_LABEL_AR[t] ?? t} (${invRows.filter(r => r.item_type === t).length})`}
                </button>
              ));
            })()}
          </div>
          {invRows.length === 0 ? (
            <div className="text-xs text-slate-500 py-3 text-center">المخزن فارغ</div>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
              {invRows.filter(r => invFilter === "all" || r.item_type === invFilter).map((r) => {
                const editVal = invQtyEdits[r.id] ?? String(r.quantity);
                const assigned = r.meta?.assigned_ship_id ? ` • مرتبط بسفينة` : "";
                return (
                  <div key={r.id} className="rounded-lg bg-slate-800/60 border border-slate-700 p-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-slate-100 truncate">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 ml-1">{TYPE_LABEL_AR[r.item_type] ?? r.item_type}</span>
                        {getItemNameAr(r.item_type, r.item_id)}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono truncate" dir="ltr">
                        {r.item_id} • {new Date(r.acquired_at).toLocaleDateString("ar")}{assigned}
                      </div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={editVal}
                      onChange={(e) => setInvQtyEdits((s) => ({ ...s, [r.id]: e.target.value }))}
                      className="w-16 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs text-center"
                    />
                    <button onClick={() => saveInvRow(r.id)}
                      className="px-2 py-1 rounded bg-blue-600/40 hover:bg-blue-600/60 text-blue-100 text-[11px] font-bold">حفظ</button>
                    <button onClick={() => deleteInvRow(r.id, getItemNameAr(r.item_type, r.item_id))}
                      className="px-2 py-1 rounded bg-rose-600/40 hover:bg-rose-600/60 text-rose-100 text-[11px] font-bold">🗑️</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>


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
          <button onClick={permanentBan} className="w-full px-3 py-2 rounded-lg bg-red-600/40 hover:bg-red-600/60 text-red-100 text-sm font-bold">⛔ حظر نهائي (هذا الحساب فقط)</button>
          <button onClick={hardBan} className="w-full px-3 py-2 rounded-lg bg-red-800 hover:bg-red-700 text-white text-sm font-extrabold">🛡️ حظر قوي شامل — يمنع حساب ثاني وتغيير الاتصال</button>
          <button onClick={reconcilePayments} className="w-full px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold">💰 استرجاع مشتريات Paddle المعلقة</button>
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

        {/* Give Code */}
        <div className="mt-4 pt-4 border-t border-emerald-900/50 space-y-2">
          <div className="text-sm font-semibold text-emerald-300">🎟️ إعطاء كود لهذا اللاعب</div>
          <p className="text-[11px] text-slate-400">يفعّل الكود فوراً لحساب اللاعب حتى لو كان غير متصل.</p>
          <button onClick={giveCode} className="w-full px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold">
            🎁 تفعيل كود لـ {player.display_name}
          </button>
        </div>

          </div>
        </div>
      </div>
      {showDeleteModal && (
        <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4" onClick={() => !deleting && setShowDeleteModal(false)}>
          <div className="bg-slate-900 border border-red-700 rounded-2xl p-5 max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-bold text-red-300">⚠️ حذف الحساب نهائياً</div>
            <div className="text-sm text-slate-300">
              سيتم محو حساب <span className="font-bold text-white">{player.display_name}</span> بالكامل من اللعبة (المتصدّرين، الأصدقاء، الرسائل، المخزن، السفن، كل شيء). لا يمكن التراجع.
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" checked={deleteBanEmail} onChange={(e) => setDeleteBanEmail(e.target.checked)} />
              منع نفس البريد من إنشاء حساب جديد
            </label>
            <div>
              <label className="text-xs text-slate-400 block mb-1">سبب الحذف (اختياري)</label>
              <input
                type="text"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm"
                placeholder="مثال: مخالفة قواعد اللعبة"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="flex-1 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold disabled:opacity-50"
              >إلغاء</button>
              <button
                onClick={confirmDeleteAccount}
                disabled={deleting}
                className="flex-1 px-3 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-bold disabled:opacity-50"
              >{deleting ? "...جاري الحذف" : "🗑️ احذف نهائياً"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

