import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/admin/device-appeals")({
  component: DeviceAppealsPage,
  ssr: false,
  head: () => ({ meta: [{ title: "طعون الأجهزة — Admin" }] }),
});

function DeviceAppealsPage() {
  const [data, setData] = useState<any>({ appeals: [], slots: [], profiles: [] });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const load = async () => {
    setLoading(true);
    try {
      const { adminListDeviceAppeals } = await import("@/lib/device-slots.functions");
      const r: any = await adminListDeviceAppeals();
      setData(r);
    } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const resolve = async (id: string, approve: boolean) => {
    const label = approve ? "الموافقة على الطعن وتحرير الأماكن؟" : "رفض الطعن؟";
    if (!confirm(label)) return;
    const { adminResolveDeviceAppeal } = await import("@/lib/device-slots.functions");
    await adminResolveDeviceAppeal({ data: { appealId: id, approve } });
    load();
  };

  const profileById = (uid: string | null) =>
    data.profiles.find((p: any) => p.id === uid);

  const appeals = data.appeals.filter((a: any) => filter === "all" || a.status === "pending");

  return (
    <div className="p-4 text-white" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-amber-300">طعون قفل الأجهزة</h1>
        <div className="flex gap-2 text-xs">
          <button onClick={() => setFilter("pending")}
            className={`px-3 py-1 rounded ${filter === "pending" ? "bg-amber-600" : "bg-stone-800"}`}>
            المعلّقة
          </button>
          <button onClick={() => setFilter("all")}
            className={`px-3 py-1 rounded ${filter === "all" ? "bg-amber-600" : "bg-stone-800"}`}>
            الكل
          </button>
          <button onClick={load} className="px-3 py-1 rounded bg-stone-800">تحديث</button>
        </div>
      </div>

      {loading && <div className="text-stone-400 text-sm">جاري التحميل...</div>}
      {!loading && appeals.length === 0 && (
        <div className="text-stone-400 text-sm text-center py-8">لا توجد طعون.</div>
      )}

      <div className="space-y-3">
        {appeals.map((a: any) => {
          const slotsHere = data.slots.filter((s: any) => s.hardware_hash === a.hardware_hash);
          return (
            <div key={a.id} className="p-3 rounded-lg bg-stone-900 border border-stone-700">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="text-xs text-stone-400 font-mono break-all">
                  🔑 {a.hardware_hash.slice(0, 24)}...
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                  a.status === "pending" ? "bg-amber-700 text-amber-100" :
                  a.status === "approved" ? "bg-emerald-700 text-emerald-100" :
                  "bg-red-700 text-red-100"
                }`}>{a.status}</span>
              </div>
              <div className="text-sm text-amber-200 mb-1">
                📧 {a.email || "(بدون بريد)"}
              </div>
              <div className="text-sm text-white bg-stone-950 p-2 rounded border border-stone-800 mb-2 whitespace-pre-wrap">
                {a.message}
              </div>
              <div className="text-xs text-stone-400 mb-2">
                <b className="text-amber-300">الحسابين المقفولين على هذا الجهاز:</b>
                {slotsHere.length === 0 ? (
                  <div className="mt-1">— (فارغ)</div>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {slotsHere.map((s: any) => {
                      const p = profileById(s.user_id);
                      return (
                        <li key={s.slot_index}>
                          Slot {s.slot_index}: <span className="text-white">{p?.display_name || p?.username || s.user_id.slice(0, 8)}</span>
                          {" — قفل حتى "}{new Date(s.locked_until).toLocaleDateString("ar")}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="text-[10px] text-stone-500 mb-2">
                📅 {new Date(a.created_at).toLocaleString("ar")}
                {a.resolved_at && ` — تم الرد: ${new Date(a.resolved_at).toLocaleString("ar")}`}
              </div>
              {a.status === "pending" && (
                <div className="flex gap-2">
                  <button onClick={() => resolve(a.id, true)}
                    className="flex-1 py-1.5 rounded bg-emerald-700 text-white text-xs font-bold active:scale-95">
                    ✓ موافقة (إعادة تعيين الأماكن)
                  </button>
                  <button onClick={() => resolve(a.id, false)}
                    className="flex-1 py-1.5 rounded bg-red-700 text-white text-xs font-bold active:scale-95">
                    ✗ رفض (7 أيام حظر)
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
