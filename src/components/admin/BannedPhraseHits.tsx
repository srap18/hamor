import { Fragment, useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Hit = {
  id: string;
  user_id: string;
  user_name: string;
  user_emoji: string;
  peer_id: string | null;
  peer_name: string | null;
  channel: string | null;
  body: string;
  phrase: string;
  muted: boolean;
  created_at: string;
};

type CtxMsg = {
  id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  channel: string;
  created_at: string;
};

const channelLabel = (c: string | null) =>
  c === "dm" ? "💬 خاص" : c === "tribe" ? "🏰 قبيلة" : "🌍 عام";

export function BannedPhraseHits() {
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [ctx, setCtx] = useState<Record<string, CtxMsg[]>>({});
  const [ctxLoading, setCtxLoading] = useState(false);
  const [ctxErr, setCtxErr] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("admin_banned_phrase_hits" as never, { _limit: 100 } as never);
    setHits((data ?? []) as Hit[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (h: Hit) => {
    if (openId === h.id) { setOpenId(null); return; }
    setOpenId(h.id);
    if (ctx[h.id]) return;
    setCtxLoading(true);
    const { data, error } = await supabase.rpc("admin_banned_phrase_context" as never, { _hit_id: h.id } as never);
    if (error) setCtxErr((p) => ({ ...p, [h.id]: error.message }));
    else setCtx((p) => ({ ...p, [h.id]: (data ?? []) as CtxMsg[] }));
    setCtxLoading(false);
  };

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold">🚨 كتابة عبارة ممنوعة «ملوك الاعماق» ({hits.length})</h2>
        <button onClick={load} className="px-3 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700">🔄</button>
      </div>
      <p className="text-xs text-slate-500 mb-2">
        أي شخص يكتب العبارة (حتى لو مزخرفة أو مقطّعة) في العام أو القبيلة أو الخاص يُكتم أسبوع تلقائياً. اضغط على السطر لعرض آخر 10 رسائل في نفس المحادثة.
      </p>
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-slate-800/60 text-slate-300">
            <tr>
              <th className="text-right p-3">اللاعب</th>
              <th className="text-right p-3">القناة</th>
              <th className="text-right p-3">الطرف الآخر</th>
              <th className="text-right p-3">الرسالة</th>
              <th className="text-right p-3">الكتم</th>
              <th className="text-right p-3">التاريخ</th>
              <th className="text-right p-3">المحادثة</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="p-6 text-center text-slate-500">جاري التحميل...</td></tr>}
            {!loading && hits.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">لا توجد حالات</td></tr>}
            {hits.map((h) => (
              <Fragment key={h.id}>
                <tr
                  onClick={() => toggle(h)}
                  className="border-t border-slate-800/50 cursor-pointer hover:bg-slate-800/40"
                >
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{h.user_emoji}</span>
                      <div>
                        <div className="font-medium">{h.user_name}</div>
                        <div className="text-xs text-slate-500 font-mono">{h.user_id.slice(0, 8)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-xs">{channelLabel(h.channel)}</td>
                  <td className="p-3 text-xs text-slate-300">{h.peer_name ?? "—"}</td>
                  <td className="p-3 text-slate-200 max-w-xs truncate" title={h.body}>{h.body}</td>
                  <td className="p-3 text-xs">
                    {h.muted
                      ? <span className="px-2 py-1 rounded bg-amber-600/30 text-amber-200 border border-amber-500/40">🔇 أسبوع</span>
                      : <span className="px-2 py-1 rounded bg-slate-700/40 text-slate-300">مكتوم مسبقاً / مستثنى</span>}
                  </td>
                  <td className="p-3 text-xs text-slate-400">{new Date(h.created_at).toLocaleString("ar")}</td>
                  <td className="p-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggle(h); }}
                      className="px-2 py-1 rounded bg-indigo-600/40 hover:bg-indigo-600/60 text-indigo-100 text-xs whitespace-nowrap"
                    >
                      {openId === h.id ? "إخفاء" : "عرض آخر 10 رسائل"}
                    </button>
                  </td>
                </tr>
                {openId === h.id && (
                  <tr className="border-t border-slate-800/50 bg-slate-950/60">
                    <td colSpan={6} className="p-3">
                      <div className="text-xs text-slate-400 mb-2">آخر 10 رسائل في نفس المحادثة:</div>
                      {ctxErr[h.id] ? (
                        <div className="text-xs text-red-400">تعذر جلب الرسائل: {ctxErr[h.id]}</div>
                      ) : ctxLoading && !ctx[h.id] ? (
                        <div className="text-xs text-slate-500">جاري التحميل...</div>
                      ) : (ctx[h.id] ?? []).length === 0 ? (
                        <div className="text-xs text-slate-500">لا توجد رسائل</div>
                      ) : (
                        <div className="space-y-1.5">
                          {(ctx[h.id] ?? []).map((m) => (
                            <div
                              key={m.id}
                              className={`rounded-lg px-3 py-2 text-xs border ${
                                m.sender_id === h.user_id
                                  ? "bg-red-900/20 border-red-700/40"
                                  : "bg-slate-800/60 border-slate-700"
                              }`}
                            >
                              <div className="text-[10px] text-slate-400 mb-0.5">
                                {m.sender_name} · {new Date(m.created_at).toLocaleString("ar")}
                              </div>
                              <div className="whitespace-pre-wrap break-words text-slate-100">{m.body || "—"}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
