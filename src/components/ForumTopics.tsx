import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sound } from "@/lib/sound";
import { useIsAdmin } from "@/hooks/use-admin";

type Topic = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  votes: number;
  created_at: string;
};
type Author = { id: string; display_name: string; avatar_emoji: string; avatar_url: string | null };

const URL_RE = /(https?:\/\/|www\.|\.com|\.net|\.org|\.io|\.co|\.me|t\.me|wa\.me|bit\.ly|tinyurl)/i;
const LATIN_RE = /[A-Za-z]/;
const BANNED = [
  "كلب","كلاب","حمار","حمير","خنزير","خنازير","زفت","تفو",
  "قحب","قحبة","شرموط","شرموطة","عاهر","عاهرة","منيوك","منيوكة",
  "كس","كسك","كسمك","كسختك","كسامك","طيز","طيزك","زب","زبر","زبري",
  "نيك","نياك","منيك","انيك","نياكة","نياكه",
  "لعن","لعنة","يلعن","ملعون","ابن الكلب","ابن كلب","ابن العاهرة",
  "fuck","shit","bitch","asshole","dick","pussy","whore","slut","cunt",
];

function validate(title: string, body: string): string | null {
  const t = title.trim();
  if (t.length < 4) return "العنوان قصير جداً (٤ حروف على الأقل)";
  if (t.length > 120) return "العنوان طويل جداً";
  if (body.length > 1000) return "الوصف طويل جداً";
  const combined = `${t} ${body}`;
  if (URL_RE.test(combined)) return "ممنوع وضع روابط";
  if (LATIN_RE.test(combined)) return "اكتب باللغة العربية فقط";
  const low = combined.toLowerCase();
  for (const w of BANNED) if (low.includes(w)) return "الكلام يحتوي على ألفاظ غير لائقة";
  return null;
}

export function ForumTopics({ userId }: { userId: string }) {
  const { isAdmin } = useIsAdmin();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [authors, setAuthors] = useState<Map<string, Author>>(new Map());
  const [myVotes, setMyVotes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: tps } = await supabase
      .from("forum_topics")
      .select("id,user_id,title,body,votes,created_at")
      .order("votes", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);
    const list = (tps || []) as Topic[];
    setTopics(list);
    const ids = Array.from(new Set(list.map(t => t.user_id)));
    if (ids.length) {
      const { data: pf } = await supabase.from("profiles").select("id,display_name,avatar_emoji,avatar_url").in("id", ids);
      const m = new Map<string, Author>();
      (pf || []).forEach((p: any) => m.set(p.id, p));
      setAuthors(m);
    }
    if (userId) {
      const { data: vs } = await supabase.from("forum_topic_votes").select("topic_id").eq("user_id", userId);
      setMyVotes(new Set((vs || []).map((v: any) => v.topic_id)));
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel("forum-topics-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "forum_topics" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "forum_topic_votes" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const submit = useCallback(async () => {
    if (!userId || busy) return;
    const v = validate(title, body);
    if (v) { setErr(v); return; }
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from("forum_topics").insert({ user_id: userId, title: title.trim(), body: body.trim() });
    setBusy(false);
    if (error) {
      const m = error.message || "";
      if (m.includes("NO_LINKS")) setErr("ممنوع وضع روابط");
      else if (m.includes("ARABIC_ONLY")) setErr("اكتب باللغة العربية فقط");
      else if (m.includes("PROFANITY")) setErr("الكلام يحتوي على ألفاظ غير لائقة");
      else setErr("تعذّر النشر، حاول لاحقاً");
      return;
    }
    sound.play("click");
    setTitle(""); setBody(""); setShowForm(false);
    load();
  }, [userId, title, body, busy, load]);

  const toggleVote = useCallback(async (t: Topic) => {
    if (!userId) return;
    const has = myVotes.has(t.id);
    // optimistic
    setMyVotes(prev => { const n = new Set(prev); has ? n.delete(t.id) : n.add(t.id); return n; });
    setTopics(prev => prev.map(x => x.id === t.id ? { ...x, votes: Math.max(0, x.votes + (has ? -1 : 1)) } : x));
    if (has) {
      await supabase.from("forum_topic_votes").delete().eq("topic_id", t.id).eq("user_id", userId);
    } else {
      sound.play("click");
      await supabase.from("forum_topic_votes").insert({ topic_id: t.id, user_id: userId });
    }
  }, [userId, myVotes]);

  const removeTopic = useCallback(async (t: Topic) => {
    if (t.user_id !== userId && !isAdmin) return;
    if (!confirm("حذف الموضوع؟")) return;
    await supabase.from("forum_topics").delete().eq("id", t.id);
    load();
  }, [userId, isAdmin, load]);

  const banUser = useCallback(async (t: Topic) => {
    if (!isAdmin) return;
    const reason = prompt("سبب الحظر من المواضيع (اختياري):", "نشر مخالف");
    if (reason === null) return;
    const { error } = await supabase.rpc("forum_admin_ban", { _user_id: t.user_id, _reason: reason || "" });
    if (error) { alert("تعذّر الحظر"); return; }
    alert("تم حظر اللاعب من المواضيع وحذف مواضيعه.");
    load();
  }, [isAdmin, load]);

  const sorted = useMemo(() => topics, [topics]);

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">📝</span>
        <div className="text-sm font-extrabold text-amber-200 tracking-wide">المواضيع والاقتراحات</div>
        <div className="flex-1 h-px bg-gradient-to-l from-transparent via-amber-500/40 to-transparent" />
        <button
          onClick={() => { setShowForm(s => !s); setErr(null); }}
          className="text-[11px] font-black px-3 py-1 rounded-full bg-amber-500 text-amber-950 border-2 border-amber-200 active:scale-95"
        >
          {showForm ? "إلغاء" : "+ موضوع جديد"}
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl bg-stone-900/80 border-2 border-amber-700/60 p-3 space-y-2">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={120}
            placeholder="عنوان الموضوع (بالعربية فقط)"
            className="w-full px-3 py-2 rounded-lg bg-stone-950/70 border border-amber-700/60 text-amber-100 text-sm placeholder:text-amber-300/40"
          />
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="وصف الموضوع أو الاقتراح / المشكلة"
            className="w-full px-3 py-2 rounded-lg bg-stone-950/70 border border-amber-700/60 text-amber-100 text-sm placeholder:text-amber-300/40 resize-none"
          />
          <div className="text-[10px] text-amber-300/70">
            ⚠️ ممنوع الروابط والكلام الإنجليزي والسباب. عربي فقط.
          </div>
          {err && <div className="text-[12px] text-red-300 font-bold">{err}</div>}
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={busy}
              className="flex-1 py-2 rounded-lg bg-emerald-600 text-white font-extrabold text-sm border-2 border-emerald-300 active:scale-95 disabled:opacity-60"
            >
              {busy ? "..." : "نشر"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-amber-200/60 text-sm py-6">جارٍ التحميل...</div>
      ) : sorted.length === 0 ? (
        <div className="text-center text-amber-200/60 text-sm py-8">
          لا توجد مواضيع بعد. كن أول من ينشر اقتراحاً!
        </div>
      ) : (
        sorted.map((t, idx) => {
          const a = authors.get(t.user_id);
          const voted = myVotes.has(t.id);
          const isMine = t.user_id === userId;
          const rank = idx + 1;
          const rankColor = rank === 1 ? "bg-yellow-400 text-yellow-950 border-yellow-200"
            : rank === 2 ? "bg-stone-300 text-stone-900 border-stone-100"
            : rank === 3 ? "bg-amber-700 text-amber-50 border-amber-400"
            : "bg-stone-800 text-amber-200 border-amber-700/60";
          return (
            <div key={t.id} className="rounded-xl bg-stone-900/70 border-2 border-amber-800/50 p-2.5 flex gap-2">
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div className={`w-7 h-7 rounded-full text-[10px] font-black flex items-center justify-center border-2 ${rankColor}`}>
                  #{rank}
                </div>
                <button
                  onClick={() => toggleVote(t)}
                  className={`w-12 rounded-lg border-2 px-1 py-1 flex flex-col items-center active:scale-95 transition ${
                    voted
                      ? "bg-emerald-600 border-emerald-200 text-white shadow-[0_0_10px_rgba(16,185,129,0.6)]"
                      : "bg-stone-800 border-amber-700/60 text-amber-200"
                  }`}
                >
                  <span className="text-base leading-none">▲</span>
                  <span className="text-[11px] font-black leading-tight">{t.votes}</span>
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-sm">{a?.avatar_emoji || "👤"}</span>
                  <span className="text-[10px] text-amber-300/80 font-bold truncate">{a?.display_name || "..."}</span>
                  <span className="text-[9px] text-amber-200/40">·</span>
                  <span className="text-[9px] text-amber-200/50">{new Date(t.created_at).toLocaleDateString("ar")}</span>
                  {(isMine || isAdmin) && (
                    <button
                      onClick={() => removeTopic(t)}
                      className="mr-auto text-[10px] text-red-300/80 hover:text-red-200 px-1.5 py-0.5 rounded border border-red-500/30"
                    >
                      حذف
                    </button>
                  )}
                  {isAdmin && !isMine && (
                    <button
                      onClick={() => banUser(t)}
                      className={`text-[10px] text-orange-200 hover:text-orange-100 px-1.5 py-0.5 rounded border border-orange-500/40 bg-orange-900/30 ${isMine ? "" : "ml-1"}`}
                      title="حظر اللاعب من المواضيع"
                    >
                      🚫 حظر
                    </button>
                  )}
                </div>
                <div className="text-sm font-extrabold text-amber-100 break-words leading-snug">{t.title}</div>
                {t.body && <div className="text-[12px] text-amber-200/80 mt-1 whitespace-pre-wrap break-words leading-snug">{t.body}</div>}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
