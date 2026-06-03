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
  replies_count: number;
  created_at: string;
};
type Reply = {
  id: string;
  topic_id: string;
  user_id: string;
  body: string;
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

function validateReply(body: string): string | null {
  const b = body.trim();
  if (b.length < 2) return "الرد قصير جداً";
  if (b.length > 500) return "الرد طويل جداً";
  if (URL_RE.test(b)) return "ممنوع وضع روابط";
  if (LATIN_RE.test(b)) return "اكتب باللغة العربية فقط";
  const low = b.toLowerCase();
  for (const w of BANNED) if (low.includes(w)) return "الكلام يحتوي على ألفاظ غير لائقة";
  return null;
}

function translateErr(msg: string): string {
  if (msg.includes("NO_LINKS")) return "ممنوع وضع روابط";
  if (msg.includes("ARABIC_ONLY")) return "اكتب باللغة العربية فقط";
  if (msg.includes("PROFANITY")) return "الكلام يحتوي على ألفاظ غير لائقة";
  if (msg.includes("RATE_LIMIT_6H")) return "تقدر تنشر موضوع واحد فقط كل ٦ ساعات";
  if (msg.includes("FORUM_BANNED")) return "أنت محظور من المواضيع";
  if (msg.includes("TOO_SHORT")) return "النص قصير جداً";
  if (msg.includes("TOO_LONG")) return "النص طويل جداً";
  return "تعذّر النشر، حاول لاحقاً";
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

  const [openTopicId, setOpenTopicId] = useState<string | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [replyBody, setReplyBody] = useState("");
  const [replyErr, setReplyErr] = useState<string | null>(null);
  const [replyBusy, setReplyBusy] = useState(false);
  const [repliesLoading, setRepliesLoading] = useState(false);

  const load = useCallback(async () => {
    const { data: tps } = await supabase
      .from("forum_topics")
      .select("id,user_id,title,body,votes,replies_count,created_at")
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

  const loadReplies = useCallback(async (topicId: string) => {
    setRepliesLoading(true);
    const { data } = await supabase
      .from("forum_replies")
      .select("id,topic_id,user_id,body,created_at")
      .eq("topic_id", topicId)
      .order("created_at", { ascending: true });
    const list = (data || []) as Reply[];
    setReplies(list);
    // ensure authors loaded
    const need = Array.from(new Set(list.map(r => r.user_id))).filter(id => !authors.has(id));
    if (need.length) {
      const { data: pf } = await supabase.from("profiles").select("id,display_name,avatar_emoji,avatar_url").in("id", need);
      if (pf) {
        setAuthors(prev => {
          const m = new Map(prev);
          pf.forEach((p: any) => m.set(p.id, p));
          return m;
        });
      }
    }
    setRepliesLoading(false);
  }, [authors]);

  useEffect(() => {
    if (!openTopicId) return;
    loadReplies(openTopicId);
    const ch = supabase
      .channel(`forum-replies-${openTopicId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "forum_replies", filter: `topic_id=eq.${openTopicId}` }, () => loadReplies(openTopicId))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [openTopicId, loadReplies]);

  const submit = useCallback(async () => {
    if (!userId || busy) return;
    const v = validate(title, body);
    if (v) { setErr(v); return; }
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from("forum_topics").insert({ user_id: userId, title: title.trim(), body: body.trim() });
    setBusy(false);
    if (error) {
      setErr(translateErr(error.message || ""));
      return;
    }
    sound.play("click");
    setTitle(""); setBody(""); setShowForm(false);
    load();
  }, [userId, title, body, busy, load]);

  const submitReply = useCallback(async () => {
    if (!userId || replyBusy || !openTopicId) return;
    const v = validateReply(replyBody);
    if (v) { setReplyErr(v); return; }
    setReplyBusy(true);
    setReplyErr(null);
    const { error } = await supabase.from("forum_replies").insert({ topic_id: openTopicId, user_id: userId, body: replyBody.trim() });
    setReplyBusy(false);
    if (error) {
      setReplyErr(translateErr(error.message || ""));
      return;
    }
    sound.play("click");
    setReplyBody("");
    loadReplies(openTopicId);
  }, [userId, replyBody, replyBusy, openTopicId, loadReplies]);

  const toggleVote = useCallback(async (t: Topic) => {
    if (!userId) return;
    const has = myVotes.has(t.id);
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
    if (openTopicId === t.id) setOpenTopicId(null);
    load();
  }, [userId, isAdmin, load, openTopicId]);

  const removeReply = useCallback(async (r: Reply) => {
    if (r.user_id !== userId && !isAdmin) return;
    if (!confirm("حذف الرد؟")) return;
    await supabase.from("forum_replies").delete().eq("id", r.id);
    if (openTopicId) loadReplies(openTopicId);
  }, [userId, isAdmin, openTopicId, loadReplies]);

  const banUser = useCallback(async (uid: string) => {
    if (!isAdmin) return;
    const reason = prompt("سبب الحظر من المنتدى (المواضيع والردود):", "نشر مخالف");
    if (reason === null) return;
    const { error } = await supabase.rpc("forum_admin_ban", { _user_id: uid, _reason: reason || "" });
    if (error) { alert("تعذّر الحظر"); return; }
    alert("تم حظر اللاعب من المواضيع والردود وحذف محتواه.");
    if (openTopicId) loadReplies(openTopicId);
    load();
  }, [isAdmin, load, openTopicId, loadReplies]);

  const sorted = useMemo(() => topics, [topics]);
  const openTopic = useMemo(() => topics.find(t => t.id === openTopicId) || null, [topics, openTopicId]);

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
            ⚠️ ممنوع الروابط والكلام الإنجليزي والسباب. عربي فقط. موضوع واحد كل ٦ ساعات.
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
          const isOpen = openTopicId === t.id;
          return (
            <div key={t.id} className="rounded-xl bg-stone-900/70 border-2 border-amber-800/50 p-2.5">
              <div className="flex gap-2">
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
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
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
                        onClick={() => banUser(t.user_id)}
                        className="text-[10px] text-orange-200 hover:text-orange-100 px-1.5 py-0.5 rounded border border-orange-500/40 bg-orange-900/30"
                        title="حظر اللاعب من المنتدى"
                      >
                        🚫 حظر
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => { setOpenTopicId(isOpen ? null : t.id); setReplyErr(null); setReplyBody(""); }}
                    className="text-right w-full"
                  >
                    <div className="text-sm font-extrabold text-amber-100 break-words leading-snug">{t.title}</div>
                    {t.body && <div className="text-[12px] text-amber-200/80 mt-1 whitespace-pre-wrap break-words leading-snug">{t.body}</div>}
                  </button>
                  <div className="flex items-center gap-2 mt-1.5">
                    <button
                      onClick={() => { setOpenTopicId(isOpen ? null : t.id); setReplyErr(null); setReplyBody(""); }}
                      className="text-[11px] font-bold px-2 py-1 rounded-full bg-sky-700/60 border border-sky-400/50 text-sky-100 active:scale-95"
                    >
                      💬 {t.replies_count || 0} {isOpen ? "إغلاق" : "ردود"}
                    </button>
                  </div>
                </div>
              </div>

              {isOpen && (
                <div className="mt-3 pt-3 border-t border-amber-800/40 space-y-2">
                  {repliesLoading ? (
                    <div className="text-center text-amber-200/60 text-xs py-2">جارٍ تحميل الردود...</div>
                  ) : replies.length === 0 ? (
                    <div className="text-center text-amber-200/50 text-xs py-2">لا توجد ردود بعد. كن أول من يرد!</div>
                  ) : (
                    replies.map(r => {
                      const ra = authors.get(r.user_id);
                      const rMine = r.user_id === userId;
                      return (
                        <div key={r.id} className="rounded-lg bg-stone-950/60 border border-amber-700/30 p-2">
                          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                            <span className="text-xs">{ra?.avatar_emoji || "👤"}</span>
                            <span className="text-[10px] text-amber-300/80 font-bold truncate">{ra?.display_name || "..."}</span>
                            <span className="text-[9px] text-amber-200/40">·</span>
                            <span className="text-[9px] text-amber-200/50">{new Date(r.created_at).toLocaleString("ar")}</span>
                            {(rMine || isAdmin) && (
                              <button
                                onClick={() => removeReply(r)}
                                className="mr-auto text-[9px] text-red-300/80 hover:text-red-200 px-1 py-0.5 rounded border border-red-500/30"
                              >
                                حذف
                              </button>
                            )}
                            {isAdmin && !rMine && (
                              <button
                                onClick={() => banUser(r.user_id)}
                                className="text-[9px] text-orange-200 hover:text-orange-100 px-1 py-0.5 rounded border border-orange-500/40 bg-orange-900/30"
                                title="حظر اللاعب من المنتدى"
                              >
                                🚫
                              </button>
                            )}
                          </div>
                          <div className="text-[12px] text-amber-100 whitespace-pre-wrap break-words leading-snug">{r.body}</div>
                        </div>
                      );
                    })
                  )}

                  <div className="rounded-lg bg-stone-900/80 border border-amber-700/50 p-2 space-y-1.5">
                    <textarea
                      value={replyBody}
                      onChange={e => setReplyBody(e.target.value)}
                      maxLength={500}
                      rows={2}
                      placeholder="اكتب ردك هنا..."
                      className="w-full px-2 py-1.5 rounded bg-stone-950/70 border border-amber-700/40 text-amber-100 text-[12px] placeholder:text-amber-300/40 resize-none"
                    />
                    {replyErr && <div className="text-[11px] text-red-300 font-bold">{replyErr}</div>}
                    <button
                      onClick={submitReply}
                      disabled={replyBusy}
                      className="w-full py-1.5 rounded bg-sky-600 text-white font-extrabold text-xs border-2 border-sky-300 active:scale-95 disabled:opacity-60"
                    >
                      {replyBusy ? "..." : "إرسال الرد"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
