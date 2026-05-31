import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/hooks/use-admin";

export const Route = createFileRoute("/admin/broadcasts")({
  component: AdminBroadcasts,
  ssr: false,
});

type Notif = {
  id: string;
  recipient_id: string | null;
  title: string;
  body: string;
  kind: string;
  created_at: string;
};

function AdminBroadcasts() {
  const [list, setList] = useState<Notif[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("info");

  // On-screen banner (shows as overlay for all players)
  const [bnTitle, setBnTitle] = useState("");
  const [bnMessage, setBnMessage] = useState("");
  const [bnEmoji, setBnEmoji] = useState("📢");
  const [bnSending, setBnSending] = useState(false);
  const [bnDone, setBnDone] = useState(false);

  const sendBanner = async () => {
    const msg = bnMessage.trim();
    const ttl = bnTitle.trim();
    if (!ttl && !msg) { alert("اكتب عنواناً أو رسالة"); return; }
    if (msg.length > 200) { alert("الرسالة طويلة (الحد 200 حرف)"); return; }
    setBnSending(true);
    const channel = supabase.channel("global:admin");
    await new Promise<void>((resolve) => {
      channel.subscribe((status) => { if (status === "SUBSCRIBED") resolve(); });
      setTimeout(resolve, 2000);
    });
    await channel.send({
      type: "broadcast",
      event: "admin_banner",
      payload: { title: ttl, message: msg, emoji: bnEmoji || "📢" },
    });
    await logAudit("admin_banner", null, { title: ttl, message: msg, emoji: bnEmoji });
    setTimeout(() => { void supabase.removeChannel(channel); }, 1500);
    setBnSending(false);
    setBnDone(true);
    setTimeout(() => setBnDone(false), 2500);
  };
  const [sending, setSending] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(50);
    setList((data ?? []) as Notif[]);
  };
  useEffect(() => { load(); }, []);

  const send = async () => {
    if (!title.trim()) return alert("اكتب عنواناً");
    setSending(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("notifications").insert({
      title: title.trim(),
      body: body.trim(),
      kind,
      recipient_id: null, // broadcast
      created_by: userData.user?.id,
    });
    if (error) { alert("خطأ: " + error.message); setSending(false); return; }
    await logAudit("broadcast", null, { title, kind });
    setTitle(""); setBody("");
    setSending(false);
    load();
  };

  const del = async (id: string) => {
    if (!confirm("حذف هذا الإشعار؟")) return;
    await supabase.from("notifications").delete().eq("id", id);
    load();
  };

  return (
    <div className="p-3 md:p-6">
      <h1 className="text-xl md:text-2xl font-bold mb-1">الإشعارات والرسائل الجماعية</h1>
      <p className="text-slate-400 text-xs md:text-sm mb-4 md:mb-6">أرسل إشعاراً يصل كل اللاعبين فوراً</p>


      <div className="grid md:grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="font-semibold mb-3">إرسال إشعار جديد</h2>
          <div className="space-y-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="العنوان" className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500" />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="نص الرسالة..." className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 resize-none" />
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm">
              <option value="info">📘 معلومة</option>
              <option value="success">✅ نجاح</option>
              <option value="warning">⚠️ تحذير</option>
              <option value="event">🎉 فعالية</option>
              <option value="update">🔄 تحديث</option>
            </select>
            <button onClick={send} disabled={sending} className="w-full px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-semibold text-sm">
              {sending ? "جاري الإرسال..." : "📢 إرسال للجميع"}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="font-semibold mb-3">آخر الإشعارات المرسلة</h2>
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {list.map((n) => (
              <div key={n.id} className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/50 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="font-semibold">{n.title}</div>
                    <div className="text-slate-400 text-xs mt-1">{n.body}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      {n.recipient_id ? "👤 فردي" : "📢 للجميع"} · {new Date(n.created_at).toLocaleString("ar")}
                    </div>
                  </div>
                  <button onClick={() => del(n.id)} className="text-red-400 hover:text-red-300 text-xs">حذف</button>
                </div>
              </div>
            ))}
            {list.length === 0 && <div className="text-slate-500 text-sm">لا توجد إشعارات</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
