import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listPlayProducts,
  upsertPlayProduct,
  deletePlayProduct,
  syncOnePlayProduct,
  syncAllPlayProducts,
  testPlayConnection,
} from "@/lib/play-products.functions";

export const Route = createFileRoute("/admin/play-products")({
  component: AdminPlayProductsPage,
  ssr: false,
  head: () => ({ meta: [{ title: "منتجات Google Play — الإدارة" }] }),
});

type Row = {
  id: string;
  sku: string;
  title_ar: string;
  title_en: string;
  description_ar: string;
  description_en: string;
  price_micros: number | string;
  default_currency: string;
  product_type: "inapp" | "subs";
  status: "active" | "inactive";
  sync_status: "pending" | "ok" | "error";
  sync_error: string | null;
  synced_at: string | null;
  rewards: Record<string, unknown>;
};

const EMPTY: Row = {
  id: "",
  sku: "",
  title_ar: "",
  title_en: "",
  description_ar: "",
  description_en: "",
  price_micros: 990000,
  default_currency: "USD",
  product_type: "inapp",
  status: "active",
  sync_status: "pending",
  sync_error: null,
  synced_at: null,
  rewards: {},
};

function statusColor(s: string) {
  if (s === "ok") return "text-green-400";
  if (s === "error") return "text-red-400";
  return "text-amber-400";
}

function AdminPlayProductsPage() {
  const listFn = useServerFn(listPlayProducts);
  const upsertFn = useServerFn(upsertPlayProduct);
  const deleteFn = useServerFn(deletePlayProduct);
  const syncOneFn = useServerFn(syncOnePlayProduct);
  const syncAllFn = useServerFn(syncAllPlayProducts);
  const testFn = useServerFn(testPlayConnection);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | null>(null);
  const [rewardsText, setRewardsText] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [diag, setDiag] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listFn();
      setRows(r.rows as Row[]);
    } catch (e: any) {
      toast.error(e?.message ?? "فشل التحميل");
    } finally {
      setLoading(false);
    }
  }, [listFn]);

  useEffect(() => { refresh(); }, [refresh]);

  const openNew = () => {
    setEditing({ ...EMPTY });
    setRewardsText("{}");
  };
  const openEdit = (r: Row) => {
    setEditing({ ...r });
    setRewardsText(JSON.stringify(r.rewards ?? {}, null, 2));
  };
  const closeEditor = () => setEditing(null);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      let rewards: Record<string, unknown> = {};
      try { rewards = JSON.parse(rewardsText || "{}"); }
      catch { throw new Error("Rewards JSON غير صحيح"); }

      await upsertFn({
        data: {
          id: editing.id || undefined,
          sku: editing.sku.trim(),
          title_ar: editing.title_ar,
          title_en: editing.title_en,
          description_ar: editing.description_ar,
          description_en: editing.description_en,
          price_micros: Number(editing.price_micros),
          default_currency: editing.default_currency,
          product_type: editing.product_type,
          status: editing.status,
          rewards,
        },
      });
      toast.success("تم الحفظ — يتم الآن المزامنة مع Play");
      closeEditor();
      setTimeout(refresh, 1500);
    } catch (e: any) {
      toast.error(e?.message ?? "فشل الحفظ");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Row) => {
    if (!confirm(`حذف المنتج ${r.sku}؟ سيُحذف من Play Console أيضاً.`)) return;
    setBusy(true);
    try {
      await deleteFn({ data: { id: r.id } });
      toast.success("تم الحذف");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "فشل الحذف");
    } finally { setBusy(false); }
  };

  const syncOne = async (r: Row) => {
    setBusy(true);
    try {
      const res = await syncOneFn({ data: { id: r.id } });
      if (res.ok) toast.success("تمت المزامنة");
      else toast.error(`فشل: ${("error" in res && res.error) || "unknown"}`);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "فشل المزامنة");
    } finally { setBusy(false); }
  };

  const syncAll = async () => {
    if (!confirm("مزامنة كل المنتجات مع Play Console الآن؟")) return;
    setBusy(true);
    try {
      const r = await syncAllFn();
      toast.success(`تمت المعالجة: نجح ${r.ok} / فشل ${r.failed} من ${r.total}`);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "فشل");
    } finally { setBusy(false); }
  };

  return (
    <div dir="rtl" className="min-h-screen bg-slate-950 text-slate-100 p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-extrabold text-amber-300">🛒 منتجات Google Play</h1>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={async () => {
              setBusy(true);
              try {
                const res = await testFn();
                setDiag(JSON.stringify(res, null, 2));
                if (res.ok) toast.success(`✓ الاتصال ناجح — ${res.checks?.productsInPlay ?? 0} منتج في Play`);
                else toast.error("فشل الاتصال — اضغط لعرض التفاصيل");
              } catch (e: any) {
                setDiag(String(e?.message ?? e));
                toast.error("فشل الاتصال");
              } finally { setBusy(false); }
            }}
            disabled={busy}
            className="px-3 py-2 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-bold disabled:opacity-50"
          >
            🔌 اختبار الاتصال
          </button>
          <button
            onClick={syncAll}
            disabled={busy}
            className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold disabled:opacity-50"
          >
            🔄 مزامنة الكل
          </button>
          <button
            onClick={openNew}
            className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold"
          >
            + إضافة منتج
          </button>
        </div>
      </div>

      <div className="text-xs text-slate-400 bg-slate-900 border border-slate-800 rounded-lg p-3 leading-relaxed">
        كل تعديل أو إضافة يُرسل تلقائياً إلى Google Play Console عبر Publisher API.
        قد يحتاج المنتج <b>2-4 ساعات</b> ليظهر في تطبيقات المستخدمين بعد الحفظ.
        <br />
        إصدار التطبيق الحالي: <b>versionCode 1003</b> — ارفع نسخة APK/AAB بهذا الرقم في Play Console.
      </div>

      {loading ? (
        <div className="text-center text-slate-400 p-8">جاري التحميل…</div>
      ) : rows.length === 0 ? (
        <div className="text-center text-slate-400 p-8 border border-dashed border-slate-800 rounded-lg">
          لا توجد منتجات بعد. اضغط "إضافة منتج" لتبدأ.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                <th className="p-2 text-right">SKU</th>
                <th className="p-2 text-right">العنوان</th>
                <th className="p-2 text-right">السعر</th>
                <th className="p-2 text-right">النوع</th>
                <th className="p-2 text-right">الحالة</th>
                <th className="p-2 text-right">Play</th>
                <th className="p-2 text-right">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-800">
                  <td className="p-2 font-mono text-xs">{r.sku}</td>
                  <td className="p-2">
                    <div>{r.title_ar}</div>
                    <div className="text-xs text-slate-400">{r.title_en}</div>
                  </td>
                  <td className="p-2 font-mono">
                    {(Number(r.price_micros) / 1_000_000).toFixed(2)} {r.default_currency}
                  </td>
                  <td className="p-2">{r.product_type === "subs" ? "اشتراك" : "شراء"}</td>
                  <td className="p-2">
                    <span className={r.status === "active" ? "text-green-400" : "text-slate-500"}>
                      {r.status === "active" ? "نشط" : "معطّل"}
                    </span>
                  </td>
                  <td className="p-2">
                    <div className={`font-bold ${statusColor(r.sync_status)}`}>
                      {r.sync_status === "ok" ? "✓ متزامن" : r.sync_status === "error" ? "✗ خطأ" : "⏳ قيد الانتظار"}
                    </div>
                    {r.sync_error && (
                      <button
                        onClick={() => setErrorDetail(`SKU: ${r.sku}\n\n${r.sync_error}`)}
                        className="text-xs text-red-300 underline max-w-xs truncate block text-right"
                        title="اضغط لعرض الخطأ كاملاً ونسخه"
                      >
                        📋 {r.sync_error}
                      </button>
                    )}
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    <button
                      onClick={() => syncOne(r)}
                      disabled={busy}
                      className="text-xs px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600 mx-0.5 disabled:opacity-50"
                    >🔄</button>
                    <button
                      onClick={() => openEdit(r)}
                      className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 mx-0.5"
                    >✏️</button>
                    <button
                      onClick={() => remove(r)}
                      disabled={busy}
                      className="text-xs px-2 py-1 rounded bg-red-800 hover:bg-red-700 mx-0.5 disabled:opacity-50"
                    >🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 overflow-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 w-full max-w-lg space-y-3">
            <h2 className="text-lg font-bold text-amber-300">
              {editing.id ? "تعديل منتج" : "منتج جديد"}
            </h2>
            <label className="block text-xs text-slate-300">
              SKU (لا يمكن تغييره بعد النشر في Play)
              <input
                value={editing.sku}
                onChange={(e) => setEditing({ ...editing, sku: e.target.value })}
                disabled={!!editing.id}
                className="mt-1 w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 font-mono disabled:opacity-60"
                placeholder="gold_pack_500"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-slate-300">
                العنوان (عربي)
                <input value={editing.title_ar} onChange={(e) => setEditing({ ...editing, title_ar: e.target.value })}
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded px-2 py-1" />
              </label>
              <label className="block text-xs text-slate-300">
                Title (English)
                <input value={editing.title_en} onChange={(e) => setEditing({ ...editing, title_en: e.target.value })}
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded px-2 py-1" />
              </label>
              <label className="block text-xs text-slate-300 col-span-2">
                الوصف (عربي)
                <textarea value={editing.description_ar} onChange={(e) => setEditing({ ...editing, description_ar: e.target.value })}
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 h-16" />
              </label>
              <label className="block text-xs text-slate-300 col-span-2">
                Description (English)
                <textarea value={editing.description_en} onChange={(e) => setEditing({ ...editing, description_en: e.target.value })}
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 h-16" />
              </label>
              <label className="block text-xs text-slate-300">
                السعر (micros)
                <input type="number" value={String(editing.price_micros)}
                  onChange={(e) => setEditing({ ...editing, price_micros: Number(e.target.value) })}
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 font-mono" />
                <span className="text-slate-500">= ${(Number(editing.price_micros)/1_000_000).toFixed(2)}</span>
              </label>
              <label className="block text-xs text-slate-300">
                العملة
                <input value={editing.default_currency}
                  onChange={(e) => setEditing({ ...editing, default_currency: e.target.value.toUpperCase() })}
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 font-mono uppercase" />
              </label>
              <label className="block text-xs text-slate-300">
                النوع
                <select value={editing.product_type}
                  onChange={(e) => setEditing({ ...editing, product_type: e.target.value as "inapp" | "subs" })}
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded px-2 py-1">
                  <option value="inapp">شراء لمرة (In-App)</option>
                  <option value="subs">اشتراك (Subscription)</option>
                </select>
              </label>
              <label className="block text-xs text-slate-300">
                الحالة
                <select value={editing.status}
                  onChange={(e) => setEditing({ ...editing, status: e.target.value as "active" | "inactive" })}
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded px-2 py-1">
                  <option value="active">نشط</option>
                  <option value="inactive">معطّل</option>
                </select>
              </label>
            </div>
            <label className="block text-xs text-slate-300">
              المكافآت داخل اللعبة (JSON)
              <textarea value={rewardsText} onChange={(e) => setRewardsText(e.target.value)}
                className="mt-1 w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 h-20 font-mono text-xs"
                placeholder='{"gold": 500, "gems": 10}' />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={closeEditor} disabled={busy}
                className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm">إلغاء</button>
              <button onClick={save} disabled={busy}
                className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-bold disabled:opacity-50">
                {busy ? "..." : "حفظ + مزامنة"}
              </button>
            </div>
          </div>
        </div>
      )}

      {(errorDetail || diag) && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 w-full max-w-2xl space-y-3">
            <h2 className="text-lg font-bold text-amber-300">
              {errorDetail ? "تفاصيل الخطأ" : "نتيجة اختبار الاتصال"}
            </h2>
            <textarea
              readOnly
              value={errorDetail ?? diag ?? ""}
              className="w-full h-80 bg-slate-950 border border-slate-800 rounded p-2 font-mono text-xs text-red-200"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(errorDetail ?? diag ?? "");
                  toast.success("تم النسخ");
                }}
                className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-sm font-bold"
              >📋 نسخ</button>
              <button
                onClick={() => { setErrorDetail(null); setDiag(null); }}
                className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm"
              >إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
