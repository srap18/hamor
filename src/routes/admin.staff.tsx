import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { confirmDialog } from "@/components/ConfirmDialog";
import { ADMIN_NAV_PATHS } from "./admin";

export const Route = createFileRoute("/admin/staff")({
  component: StaffPage,
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/" });
    const { data: sup } = await supabase.rpc("is_super_admin", { _uid: data.user.id });
    if (!sup) throw redirect({ to: "/admin" });
  },
});

type StaffRow = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  roles: string[] | null;
  allowed_paths: string[] | null;
  is_super: boolean;
};

function StaffPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<"admin" | "moderator">("moderator");
  const [addPaths, setAddPaths] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_list_staff");
    if (error) toast.error(error.message);
    setRows((data as StaffRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const doAdd = async () => {
    if (!addEmail.trim()) return toast.error("أدخل الإيميل");
    const { error } = await supabase.rpc("admin_grant_staff", {
      _email: addEmail.trim(),
      _role: addRole,
      _paths: addPaths.length ? addPaths : null,
    });
    if (error) return toast.error(error.message);
    toast.success("تمت الإضافة");
    setAddEmail(""); setAddPaths([]);
    void load();
  };

  const savePaths = async (uid: string, paths: string[] | null) => {
    const { error } = await supabase.rpc("admin_set_staff_paths", { _uid: uid, _paths: paths });
    if (error) return toast.error(error.message);
    toast.success("تم حفظ الصلاحيات");
    void load();
  };

  const changeRole = async (uid: string, role: "admin" | "moderator") => {
    const { error } = await supabase.rpc("admin_set_staff_role", { _uid: uid, _role: role });
    if (error) return toast.error(error.message);
    toast.success("تم تغيير الدور");
    void load();
  };

  const revoke = async (uid: string, email: string | null) => {
    const ok = await confirmDialog({
      title: "إزالة مشرف",
      message: `هل تريد إزالة صلاحيات المشرف ${email ?? uid} كاملة؟`,
      confirmText: "إزالة", danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.rpc("admin_revoke_staff", { _uid: uid });
    if (error) return toast.error(error.message);
    toast.success("تمت الإزالة");
    void load();
  };

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-6 text-slate-100">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">👑 إدارة المشرفين</h1>
        <span className="text-xs text-slate-400">(المالك: {user?.email})</span>
      </div>

      {/* Add form */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="font-bold">إضافة / تعديل مشرف عبر الإيميل</div>
        <div className="flex flex-wrap gap-2">
          <input
            value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
            placeholder="email@example.com"
            className="flex-1 min-w-[220px] px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm"
            dir="ltr"
          />
          <select
            value={addRole}
            onChange={(e) => setAddRole(e.target.value as "admin" | "moderator")}
            className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm"
          >
            <option value="moderator">مشرف محدود (moderator)</option>
            <option value="admin">مشرف كامل (admin)</option>
          </select>
          <button
            onClick={doAdd}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-bold"
          >إضافة</button>
        </div>
        <div>
          <div className="text-xs text-slate-400 mb-1">
            الصفحات المسموحة (اتركها فارغة = كل الصفحات):
          </div>
          <PathsPicker value={addPaths} onChange={setAddPaths} />
        </div>
      </div>

      {/* Staff list */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl">
        <div className="p-3 border-b border-slate-800 font-bold">القائمة الحالية</div>
        {loading ? (
          <div className="p-6 text-center text-slate-400">جاري التحميل...</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-slate-400">لا يوجد مشرفون</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {rows.map((r) => {
              const isOpen = expanded === r.user_id;
              return (
                <div key={r.user_id} className="p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-bold flex items-center gap-2">
                        {r.is_super && <span className="text-amber-400">👑</span>}
                        {r.display_name || r.email || r.user_id.slice(0, 8)}
                      </div>
                      <div className="text-xs text-slate-400" dir="ltr">{r.email}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        الدور: {(r.roles ?? []).join(", ") || "-"} ·
                        {" "}
                        {r.is_super
                          ? "سلطة كاملة (لا يمكن تعديله)"
                          : r.allowed_paths?.length
                            ? `${r.allowed_paths.length} صفحة مسموحة`
                            : "كل الصفحات"}
                      </div>
                    </div>
                    {!r.is_super && (
                      <div className="flex gap-1.5">
                        <select
                          value={(r.roles ?? []).includes("admin") ? "admin" : "moderator"}
                          onChange={(e) => changeRole(r.user_id, e.target.value as "admin" | "moderator")}
                          className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-xs"
                        >
                          <option value="moderator">moderator</option>
                          <option value="admin">admin</option>
                        </select>
                        <button
                          onClick={() => setExpanded(isOpen ? null : r.user_id)}
                          className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs"
                        >{isOpen ? "إغلاق" : "تعديل الصلاحيات"}</button>
                        <button
                          onClick={() => revoke(r.user_id, r.email)}
                          className="px-3 py-1 rounded bg-red-900/50 hover:bg-red-900/70 text-red-200 text-xs"
                        >إزالة</button>
                      </div>
                    )}
                  </div>
                  {isOpen && !r.is_super && (
                    <div className="mt-3 pt-3 border-t border-slate-800">
                      <RowPathsEditor
                        initial={r.allowed_paths ?? []}
                        onSave={(paths) => savePaths(r.user_id, paths.length ? paths : null)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PathsPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (p: string) => {
    onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);
  };
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
      {ADMIN_NAV_PATHS.filter((n) => n.to !== "/admin/staff").map((n) => {
        const on = value.includes(n.to);
        return (
          <button
            key={n.to}
            type="button"
            onClick={() => toggle(n.to)}
            className={`text-xs px-2 py-1.5 rounded-lg border text-right ${
              on
                ? "bg-indigo-600/30 border-indigo-500 text-indigo-100"
                : "bg-slate-800 border-slate-700 text-slate-300"
            }`}
          >
            <span className="ml-1">{n.icon}</span>{n.label}
          </button>
        );
      })}
    </div>
  );
}

function RowPathsEditor({ initial, onSave }: { initial: string[]; onSave: (v: string[]) => void }) {
  const [val, setVal] = useState<string[]>(initial);
  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-400">اختر الصفحات المسموحة (بدون اختيار = كل الصفحات):</div>
      <PathsPicker value={val} onChange={setVal} />
      <div className="flex gap-2">
        <button
          onClick={() => onSave(val)}
          className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-bold"
        >حفظ</button>
        <button
          onClick={() => { setVal([]); onSave([]); }}
          className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs"
        >منح كل الصفحات</button>
      </div>
    </div>
  );
}
