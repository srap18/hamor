import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/audit")({
  component: AdminAudit,
  ssr: false,
});

type Entry = {
  id: string;
  admin_id: string;
  action: string;
  target_user_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

type Profile = { id: string; display_name: string | null; avatar_emoji: string | null };

const ACTION_AR: Record<string, string> = {
  admin_adjust_tribe_points: "🏴 تعديل نقاط قبيلة",
  admin_banner: "📢 لافتة إعلانية",
  admin_block_login: "🚫 حظر دخول اللاعب",
  admin_delete_user: "🧨 حذف حساب لاعب نهائيًا",
  admin_edit_bio: "✏️ تعديل النبذة الشخصية",
  admin_edit_user: "✏️ تعديل بيانات لاعب",
  admin_full_unban: "✅ رفع كامل الحظر",
  admin_give_code: "🎟️ إعطاء كود لشخص محدد",
  admin_give_code_to_all: "🎁 إعطاء كود لجميع اللاعبين",
  admin_hard_ban: "🔨 حظر قوي (جهاز + IP + إيميل)",
  admin_max_dragon: "🐉 ترقية التنين للحد الأقصى",
  admin_permanent_ban: "⛔ حظر دائم",
  admin_redeem_code_for: "🎟️ استبدال كود لشخص",
  admin_set_dragon: "🐉 تعديل التنين",
  admin_set_inventory_quantity: "📦 تعديل كمية عنصر في المخزون",
  admin_set_market_levels: "🏪 تعديل مستويات الأسواق",
  admin_set_player_fish: "🐟 تعديل سمك اللاعب",
  admin_set_player_full: "🛠️ تعديل شامل للاعب",
  admin_set_username: "🪪 تغيير اسم المستخدم",
  admin_unblock_login: "✅ فك حظر الدخول",
  admin_unhard_ban: "✅ إلغاء الحظر القوي",
  admin_wipe_profile: "🧨 مسح حساب لاعب بالكامل",
  ban_user: "🔨 حظر لاعب",
  broadcast: "📣 بث إذاعي عام",
  delete_message_from_report: "🗑️ حذف رسالة من بلاغ",
  delete_user_messages: "🗑️ حذف جميع رسائل لاعب",
  disable_reporter: "🚷 تعطيل مبلّغ متكرر",
  edit_player: "✏️ تعديل لاعب",
  grant_chat_audio_upload: "🎙️ السماح برفع صوتيات في الشات",
  grant_code_to_online: "🎁 إعطاء كود لكل المتصلين",
  lucky_box_settings_update: "🎁 تعديل إعدادات صندوق الحظ",
  mute_from_report: "🔇 كتم لاعب من بلاغ",
  mute_user: "🔇 كتم لاعب",
  reclaim_exploited_gems: "♻️ استرداد جواهر ناتجة عن استغلال",
  revoke_chat_audio_upload: "🔇 سحب صلاحية رفع الصوتيات",
  unban_user: "🔓 فك حظر لاعب",
  unmute_user: "🔊 فك كتم لاعب",
  weekly_xp_distribute_now: "🏆 توزيع جوائز XP الأسبوعية",
};

function arAction(a: string): string {
  return ACTION_AR[a] ?? a;
}

function AdminAudit() {
  const [list, setList] = useState<Entry[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [filterAdmin, setFilterAdmin] = useState<string>("");
  const [filterAction, setFilterAction] = useState<string>("");
  const [openDetails, setOpenDetails] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("admin_audit")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      const rows = (data ?? []) as Entry[];
      setList(rows);
      const ids = Array.from(
        new Set(rows.flatMap((r) => [r.admin_id, r.target_user_id]).filter(Boolean) as string[]),
      );
      if (ids.length > 0) {
        const { data: ps } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_emoji")
          .in("id", ids);
        const map: Record<string, Profile> = {};
        (ps ?? []).forEach((p) => { map[p.id] = p as Profile; });
        setProfiles(map);
      }
    })();
  }, []);

  const adminOptions = useMemo(() => {
    const ids = Array.from(new Set(list.map((e) => e.admin_id)));
    return ids.map((id) => ({ id, name: profiles[id]?.display_name || id.slice(0, 8) }));
  }, [list, profiles]);

  const actionOptions = useMemo(
    () => Array.from(new Set(list.map((e) => e.action))).sort(),
    [list],
  );

  const filtered = useMemo(
    () =>
      list.filter(
        (e) =>
          (!filterAdmin || e.admin_id === filterAdmin) &&
          (!filterAction || e.action === filterAction),
      ),
    [list, filterAdmin, filterAction],
  );

  const nameOf = (id: string | null) => {
    if (!id) return "—";
    const p = profiles[id];
    if (!p) return id.slice(0, 8);
    return `${p.avatar_emoji ?? "🧑‍✈️"} ${p.display_name ?? id.slice(0, 8)}`;
  };

  return (
    <div dir="rtl" className="p-3 md:p-6">
      <h1 className="text-xl md:text-2xl font-bold mb-1">سجل عمليات الأدمن</h1>
      <p className="text-slate-400 text-xs md:text-sm mb-4">آخر 500 عملية — مراقبة كاملة لكل ما يفعله المشرفون</p>

      <div className="flex flex-wrap gap-2 mb-3">
        <select
          value={filterAdmin}
          onChange={(e) => setFilterAdmin(e.target.value)}
          className="bg-slate-900 border border-slate-700 text-slate-100 text-xs rounded-md px-2 py-1.5"
        >
          <option value="">👤 كل المشرفين</option>
          {adminOptions.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="bg-slate-900 border border-slate-700 text-slate-100 text-xs rounded-md px-2 py-1.5"
        >
          <option value="">⚙️ كل العمليات</option>
          {actionOptions.map((a) => (
            <option key={a} value={a}>{arAction(a)}</option>
          ))}
        </select>
        {(filterAdmin || filterAction) && (
          <button
            onClick={() => { setFilterAdmin(""); setFilterAction(""); }}
            className="text-xs px-2 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200"
          >مسح الفلاتر</button>
        )}
        <span className="text-xs text-slate-400 self-center">عرض {filtered.length}</span>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-slate-800/60">
            <tr>
              <th className="text-right p-3">الوقت</th>
              <th className="text-right p-3">المشرف</th>
              <th className="text-right p-3">العملية</th>
              <th className="text-right p-3">الهدف</th>
              <th className="text-right p-3">التفاصيل</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className="border-t border-slate-800/50 align-top">
                <td className="p-3 text-xs text-slate-400 whitespace-nowrap">
                  {new Date(e.created_at).toLocaleString("ar")}
                </td>
                <td className="p-3 text-xs">
                  <div className="font-bold text-amber-200">{nameOf(e.admin_id)}</div>
                  <div className="font-mono text-[10px] text-slate-500">{e.admin_id.slice(0, 8)}</div>
                </td>
                <td className="p-3">
                  <span className="px-2 py-0.5 rounded text-xs bg-indigo-600/30 text-indigo-200 whitespace-nowrap">
                    {arAction(e.action)}
                  </span>
                </td>
                <td className="p-3 text-xs">
                  {e.target_user_id ? (
                    <>
                      <div className="text-slate-200">{nameOf(e.target_user_id)}</div>
                      <div className="font-mono text-[10px] text-slate-500">{e.target_user_id.slice(0, 8)}</div>
                    </>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
                <td className="p-3 text-xs text-slate-300">
                  <button
                    onClick={() => setOpenDetails(openDetails === e.id ? null : e.id)}
                    className="text-[11px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                  >
                    {openDetails === e.id ? "إخفاء" : "عرض"}
                  </button>
                  {openDetails === e.id && (
                    <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] bg-slate-950 border border-slate-800 rounded p-2 max-w-md overflow-x-auto">
                      {JSON.stringify(e.details, null, 2)}
                    </pre>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-slate-500">لا توجد عمليات</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
