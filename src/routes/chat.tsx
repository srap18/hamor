import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { officerSetTribe, setMyTribe } from "@/lib/economy";
import { AuthGuard } from "@/components/AuthGuard";
import { BottomNav } from "@/components/BottomNav";
import { useAuth, useProfile } from "@/hooks/use-auth";
import { QuickReplies } from "@/components/QuickReplies";
import { frameById } from "@/lib/frames";
import { EliteVipBadge, eliteVipNameClass } from "@/components/EliteVipBadge";
import { ReportMessageButton } from "@/components/ReportMessageButton";


import { ForumTopics } from "@/components/ForumTopics";
import { CoinIcon } from "@/components/CurrencyIcon";
import { sound } from "@/lib/sound";
import { useIsAdmin } from "@/hooks/use-admin";
import { useIsChatMod } from "@/hooks/use-chat-mod";
import { confirmDialog } from "@/components/ConfirmDialog";
import { getTribeBanner } from "@/lib/tribe-banners";
import { TribeFeatures } from "@/components/TribeFeatures";
import { loadDmUnreadMap, markDmRead, type DmEntry } from "@/lib/dm-unread";
import { containsLink, LINK_BLOCK_MESSAGE } from "@/lib/link-guard";
import { useServerFn } from "@tanstack/react-start";
import { moderateChatText } from "@/lib/chat-moderation.functions";

export const Route = createFileRoute("/chat")({
  head: () => ({ meta: [{ title: "الشات — ملوك القراصنة" }] }),
  component: () => <AuthGuard><ChatPage /></AuthGuard>,
});

type Channel = "public" | "tribe" | "dm" | "topics";
type Msg = { id: string; channel: string; sender_id: string; recipient_id: string | null; tribe_id: string | null; body: string; created_at: string; audio_url?: string | null; audio_duration_ms?: number | null; reply_to_id?: string | null; reply_to_body?: string | null; reply_to_name?: string | null };
type Prof = { id: string; display_name: string; avatar_emoji: string; level?: number; coins?: number; avatar_url?: string | null; avatar_frame?: string | null; name_frame?: string | null; bubble_frame?: string | null; profile_frame?: string | null; vip_level?: number | null; vip_expires_at?: string | null; elite_vip_level?: number | null };
type DmThreadStatus = "pending" | "accepted" | "rejected";
type DmThread = { other: Prof; status: DmThreadStatus; requester_id: string; responded_at: string | null; last_request_at: string };

function getActiveEliteVip(p?: Prof | null): number {
  // elite_vip_expires_at is no longer exposed to clients (privacy).
  // The server-side sweep_expired_elite_vip job sets elite_vip_level back to 0
  // when a subscription expires, so the level itself is authoritative.
  return Math.max(0, Number(p?.elite_vip_level ?? 0));
}

function VipBadge(_: { level?: number | null; expiresAt?: string | null }) {
  return null;
}


function Avatar({ p, size = 56 }: { p?: Prof | null; size?: number }) {
  const style = { width: size, height: size };
  const frame = frameById(p?.avatar_frame);
  const ringCls = frame?.kind === "avatar" ? frame.ring || "" : "";
  return (
    <div style={style} className="relative shrink-0 flex items-center justify-center">
      {p?.avatar_url ? (
        <img src={p.avatar_url} alt={p.display_name || ""} loading="lazy" decoding="async" className={`w-[68%] h-[68%] rounded-full object-cover bg-sky-700 ring-2 ring-amber-300/50 shadow-[0_0_10px_rgba(252,191,73,0.5)] ${ringCls}`} />
      ) : (
        <div className={`w-[68%] h-[68%] rounded-full bg-sky-700 flex items-center justify-center text-xl ring-2 ring-amber-300/50 shadow-[0_0_10px_rgba(252,191,73,0.5)] ${ringCls}`}>{p?.avatar_emoji || "👤"}</div>
      )}
      {frame?.imageUrl && <img src={frame.imageUrl} alt="" loading="lazy" decoding="async" className={`absolute inset-0 w-full h-full object-contain pointer-events-none ${frame.animClass ?? ""}`} style={{ filter: "drop-shadow(0 0 8px rgba(252,191,73,0.7)) saturate(1.35) contrast(1.1)" }} />}

    </div>
  );
}

function NameBadge({ p, mine }: { p?: Prof | null; mine?: boolean }) {
  const frame = frameById(p?.name_frame);
  const cls = frame?.kind === "name" ? frame.nameClass || "" : "";
  const lvl = typeof p?.level === "number" ? p.level : null;
  const eliteLvl = getActiveEliteVip(p);
  const eliteCls = eliteVipNameClass(eliteLvl);
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold ${eliteCls || cls || (mine ? "text-amber-100" : "text-amber-300")} ${frame?.animClass ?? ""}`}>
      <VipBadge level={p?.vip_level} expiresAt={p?.vip_expires_at} />
      {eliteLvl > 0 && <EliteVipBadge level={eliteLvl} size="xs" />}
      <span>{p?.display_name || "..."}</span>
      {lvl !== null && (
        <span className="text-[9px] px-1 rounded bg-black/40 text-amber-200 border border-amber-300/40">Lv {lvl}</span>
      )}
    </span>
  );
}


function ChatPage() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { isAdmin } = useIsAdmin();
  
  const [tab, setTab] = useState<Channel>("public");
  const [soloTribe, setSoloTribe] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [msgsKey, setMsgsKey] = useState("");
  const [profMap, setProfMap] = useState<Map<string, Prof>>(new Map());
  // NOTE: composer text lives inside <ChatComposer/> to avoid re-rendering the
  // entire chat (and re-diffing hundreds of messages) on every keystroke.
  const restoreDraftRef = useRef<(body: string) => void>(() => {});

  const [dmFriends, setDmFriends] = useState<Prof[]>([]);
  const [dmWith, setDmWith] = useState<string | null>(null);
  const [dmMap, setDmMap] = useState<Map<string, DmEntry>>(new Map());
  const [dmThreads, setDmThreads] = useState<DmThread[]>([]);
  const [dmTotal, setDmTotal] = useState(0);
  const [showManage, setShowManage] = useState(false);
  
  const [warTarget, setWarTarget] = useState<Prof | null>(null);
  const [actionTarget, setActionTarget] = useState<Prof | null>(null);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set()); // people I blocked
  const [blockedBy, setBlockedBy] = useState<Set<string>>(new Set()); // people who blocked me
  const [myMute, setMyMute] = useState<{ reason: string; expires_at: string | null } | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: string; body: string; name: string } | null>(null);
  const [pinned, setPinned] = useState<{ body: string; pinned_at: string } | null>(null);
  const [pinEditOpen, setPinEditOpen] = useState(false);
  const [pinDraft, setPinDraft] = useState("");
  const [marketLevel, setMarketLevel] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const SHIP_MARKET_MIN = 6;
  const canChat = isAdmin || (marketLevel !== null && marketLevel >= SHIP_MARKET_MIN);

  // Pause background music while on the chat screen, resume on leave
  useEffect(() => {
    sound.pauseForChat();
    return () => { sound.resumeForChat(); };
  }, []);

  // Deep-link: ?tab=tribe or ?manage=1 auto-opens the tribe tab / management modal
  // ?dm=<peerId> auto-opens the private DM with that peer
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const wantTab = params.get("tab");
    const wantManage = params.get("manage") === "1";
    const wantDm = params.get("dm");
    const wantSolo = params.get("solo") === "1";
    if (wantDm) {
      setTab("dm");
      setDmWith(wantDm);
    } else if (wantTab === "tribe" || wantManage || wantSolo) {
      setTab("tribe");
    }
    if (wantSolo) setSoloTribe(true);
    if (wantManage && profile?.tribe_id) setShowManage(true);
  }, [profile?.tribe_id]);




  useEffect(() => {
    if (!user) { setMyMute(null); return; }
    const nowIso = new Date().toISOString();
    supabase.from("chat_mutes").select("reason,expires_at").eq("user_id", user.id).eq("active", true)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        if (!data) { setMyMute(null); return; }
        if (data.expires_at && data.expires_at <= nowIso) { setMyMute(null); return; }
        setMyMute(data as any);
      });
  }, [user]);

  // Load my ship-market level — required to write in chat
  useEffect(() => {
    if (!user) { setMarketLevel(null); return; }
    try {
      const cached = window.localStorage.getItem(`chat:market-level:${user.id}`);
      if (cached) setMarketLevel(Math.max(1, Number(cached) || 1));
    } catch {}
    supabase.from("user_market").select("level").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => {
        const next = ((data as any)?.level as number | undefined) ?? 1;
        setMarketLevel(next);
        try { window.localStorage.setItem(`chat:market-level:${user.id}`, String(next)); } catch {}
      });
  }, [user]);

  // Pinned admin message — live
  useEffect(() => {
    const load = async () => {
      const { data } = await (supabase as any).from("chat_pinned").select("body,pinned_at").eq("id", true).maybeSingle();
      if (data && data.body) setPinned({ body: data.body, pinned_at: data.pinned_at });
      else setPinned(null);
    };
    load();
    const ch = supabase.channel("chat_pinned_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_pinned" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);


  const reloadBlocks = useCallback(async () => {
    if (!user) return;
    const [a, b] = await Promise.all([
      supabase.from("user_blocks").select("blocked_id").eq("blocker_id", user.id),
      supabase.from("user_blocks").select("blocker_id").eq("blocked_id", user.id),
    ]);
    setBlockedIds(new Set(((a.data as any[]) || []).map(r => r.blocked_id)));
    setBlockedBy(new Set(((b.data as any[]) || []).map(r => r.blocker_id)));
  }, [user]);

  useEffect(() => { reloadBlocks(); }, [reloadBlocks]);

  const reloadThreads = useCallback(async () => {
    if (!user) { setDmFriends([]); setDmThreads([]); return; }
    // Load all DM threads I'm part of (RLS enforces user_low/high match auth.uid())
    const { data: t } = await (supabase as any).from("dm_threads").select("*")
      .or(`user_low.eq.${user.id},user_high.eq.${user.id}`);
    const list = ((t || []) as any[]);
    const otherIds = Array.from(new Set(list.map(r => r.user_low === user.id ? r.user_high : r.user_low)));
    // Union with accepted friends so friends without a thread yet still appear (backwards-compat)
    const { data: f } = await supabase.from("friends").select("requester_id,addressee_id").eq("status", "accepted")
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);
    const friendIds = ((f || []) as any[]).map(x => x.requester_id === user.id ? x.addressee_id : x.requester_id);
    const allIds = Array.from(new Set([...otherIds, ...friendIds]));
    let profs: Prof[] = [];
    if (allIds.length) {
      const { data: ps } = await supabase.from("profiles").select("id,display_name,avatar_emoji,avatar_url,level,coins,avatar_frame,name_frame,bubble_frame,profile_frame,elite_vip_level").in("id", allIds);
      profs = (ps || []) as Prof[];
    }
    const pmap = new Map(profs.map(p => [p.id, p]));
    const threads: DmThread[] = list.map(r => {
      const otherId = r.user_low === user.id ? r.user_high : r.user_low;
      const other = pmap.get(otherId) || ({ id: otherId, display_name: "مستخدم", avatar_emoji: "👤" } as Prof);
      return { other, status: r.status as DmThreadStatus, requester_id: r.requester_id, responded_at: r.responded_at, last_request_at: r.last_request_at };
    });
    setDmThreads(threads);
    setDmFriends(profs);
  }, [user]);

  useEffect(() => { reloadThreads(); }, [reloadThreads]);

  // Live-refresh threads when new dm_threads rows appear/change
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel(`dm-threads:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "dm_threads" }, () => reloadThreads())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, reloadThreads]);

  const acceptDmRequest = useCallback(async (otherId: string) => {
    const { error } = await (supabase as any).rpc("dm_accept_request", { _other: otherId });
    if (error) { showNotice("تعذر القبول: " + error.message); return; }
    showNotice("✓ تم قبول المحادثة");
    reloadThreads();
  }, [reloadThreads]);

  const rejectDmRequest = useCallback(async (otherId: string) => {
    const ok = await confirmDialog({ title: "رفض المحادثة", message: "سيتم رفض الطلب ومسح الرسالة التمهيدية.", confirmText: "رفض", cancelText: "إلغاء" });
    if (!ok) return;
    const { error } = await (supabase as any).rpc("dm_reject_request", { _other: otherId });
    if (error) { showNotice("تعذر الرفض: " + error.message); return; }
    showNotice("✗ تم رفض الطلب");
    if (dmWith === otherId) setDmWith(null);
    reloadThreads();
  }, [reloadThreads, dmWith]);

  const cancelDmRequest = useCallback(async (otherId: string) => {
    const { error } = await (supabase as any).rpc("dm_cancel_request", { _other: otherId });
    if (error) { showNotice("تعذر الإلغاء: " + error.message); return; }
    showNotice("تم إلغاء الطلب");
    if (dmWith === otherId) setDmWith(null);
    reloadThreads();
  }, [reloadThreads, dmWith]);

  const blockDmUser = useCallback(async (otherId: string) => {
    const ok = await confirmDialog({ title: "حظر اللاعب", message: "لن يقدر يرسل لك رسائل أو طلبات محادثة.", confirmText: "حظر", cancelText: "إلغاء" });
    if (!ok) return;
    const { error } = await (supabase as any).rpc("dm_block", { _other: otherId });
    if (error) { showNotice("تعذر الحظر: " + error.message); return; }
    showNotice("🚫 تم الحظر");
    reloadBlocks();
    if (dmWith === otherId) setDmWith(null);
  }, [reloadBlocks, dmWith]);

  const unblockDmUser = useCallback(async (otherId: string) => {
    const { error } = await (supabase as any).rpc("dm_unblock", { _other: otherId });
    if (error) { showNotice("تعذر فك الحظر: " + error.message); return; }
    showNotice("✓ تم فك الحظر");
    reloadBlocks();
  }, [reloadBlocks]);


  // Live DM unread map (per-friend counts + total). Refresh on every incoming DM.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const refresh = async () => {
      const { map, total } = await loadDmUnreadMap(user.id);
      if (cancelled) return;
      setDmMap(map);
      setDmTotal(total);
    };
    refresh();
    const ch = supabase.channel(`dm-unread:${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${user.id}` }, refresh)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [user]);

  // Mark a conversation as read whenever the user opens it
  useEffect(() => {
    if (!user || tab !== "dm" || !dmWith) return;
    markDmRead(user.id, dmWith);
    setDmMap((m) => {
      const entry = m.get(dmWith);
      if (!entry || entry.count === 0) return m;
      const next = new Map(m);
      next.set(dmWith, { ...entry, count: 0 });
      return next;
    });
    setDmTotal((t) => {
      const c = dmMap.get(dmWith)?.count ?? 0;
      return Math.max(0, t - c);
    });
  }, [user, tab, dmWith]);


  useEffect(() => {
    if (!user) return;
    const loadKey = `${tab}:${dmWith || ""}`;
    let active = true;
    setMsgs([]);
    setMsgsKey("");
    // Load the NEWEST 100 (was loading oldest 100 — caused new messages to disappear on reload)
    let q = supabase.from("messages").select("*").order("created_at", { ascending: false }).limit(100);
    if (tab === "public") q = q.eq("channel", "public");
    else if (tab === "tribe" && profile?.tribe_id) q = q.eq("channel", "tribe").eq("tribe_id", profile.tribe_id);
    else if (tab === "dm" && dmWith) q = q.eq("channel", "dm").or(`and(sender_id.eq.${user.id},recipient_id.eq.${dmWith}),and(sender_id.eq.${dmWith},recipient_id.eq.${user.id})`);
    else { setMsgsKey(loadKey); return; }

    q.then(async ({ data }) => {
      if (!active) return;
      const list = ((data || []) as Msg[]).slice().reverse(); // oldest -> newest for display
      setMsgs(list);
      setMsgsKey(loadKey);
      const ids = Array.from(new Set(list.map(m => m.sender_id)));
      if (ids.length) {
        const { data: ps } = await supabase.from("profiles").select("id,display_name,avatar_emoji,avatar_url,level,avatar_frame,name_frame,bubble_frame,profile_frame,elite_vip_level").in("id", ids);
        if (!active) return;
        setProfMap(new Map((ps || []).map((p: any) => [p.id, p])));
      }
    });

    // Ensure realtime uses the authenticated JWT so RLS-protected channels
    // (tribe + DM) actually deliver INSERT events. Without setAuth, realtime
    // runs as anon and silently drops events the user can't SELECT — which is
    // why messages used to "arrive in batches" via the fallback poller only.
    let ch: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        try { await supabase.realtime.setAuth(session.access_token); } catch { /* ignore */ }
      }
      if (!active) return;
      ch = supabase.channel(`msgs-${tab}-${dmWith || ""}-${Date.now()}`, {
        config: { broadcast: { self: false }, presence: { key: "" } },
      })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async (payload) => {
          const m = payload.new as Msg;
          let ok = false;
          if (tab === "public" && m.channel === "public") ok = true;
          else if (tab === "tribe" && m.channel === "tribe" && m.tribe_id === profile?.tribe_id) ok = true;
          else if (tab === "dm" && m.channel === "dm" && dmWith && ((m.sender_id === user.id && m.recipient_id === dmWith) || (m.sender_id === dmWith && m.recipient_id === user.id))) ok = true;
          if (!ok) return;
          setMsgs(s => s.some(x => x.id === m.id) ? s : [...s, m]);
          setProfMap(prev => {
            if (prev.has(m.sender_id)) return prev;
            supabase.from("profiles").select("id,display_name,avatar_emoji,avatar_url,level,avatar_frame,name_frame,bubble_frame,profile_frame,elite_vip_level").eq("id", m.sender_id).maybeSingle().then(({ data: p }) => {
              if (p) setProfMap(s => new Map(s).set((p as any).id, p as Prof));
            });
            return prev;
          });
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (payload) => {
          const oldId = (payload.old as any)?.id;
          if (!oldId) return;
          setMsgs(s => s.filter(x => x.id !== oldId));
        })
        .subscribe();
    })();

    // Fallback poller — kept as a safety net for flaky mobile sockets, but
    // tightened to 1.5s so missed messages still feel near-instant.
    const pollNewer = async () => {
      if (!active) return;
      let newestAt: string | null = null;
      setMsgs(cur => {
        newestAt = cur.length ? cur[cur.length - 1].created_at : null;
        return cur;
      });
      let pq = supabase.from("messages").select("*").order("created_at", { ascending: true }).limit(50);
      if (tab === "public") pq = pq.eq("channel", "public");
      else if (tab === "tribe" && profile?.tribe_id) pq = pq.eq("channel", "tribe").eq("tribe_id", profile.tribe_id);
      else if (tab === "dm" && dmWith) pq = pq.eq("channel", "dm").or(`and(sender_id.eq.${user.id},recipient_id.eq.${dmWith}),and(sender_id.eq.${dmWith},recipient_id.eq.${user.id})`);
      else return;
      if (newestAt) pq = pq.gt("created_at", newestAt);
      const { data } = await pq;
      if (!active || !data || data.length === 0) return;
      const fresh = data as Msg[];
      setMsgs(s => {
        const have = new Set(s.map(x => x.id));
        const add = fresh.filter(x => !have.has(x.id));
        return add.length ? [...s, ...add] : s;
      });
      const newIds = Array.from(new Set(fresh.map(m => m.sender_id)));
      if (newIds.length) {
        const { data: ps } = await supabase.from("profiles").select("id,display_name,avatar_emoji,avatar_url,level,avatar_frame,name_frame,bubble_frame,profile_frame,elite_vip_level").in("id", newIds);
        if (active && ps) setProfMap(prev => { const n = new Map(prev); (ps as any[]).forEach(p => n.set(p.id, p)); return n; });
      }
    };
    const pollTimer = window.setInterval(() => { if (!document.hidden) pollNewer(); }, 5000);
    const onVis = () => { if (document.visibilityState === "visible") pollNewer(); };
    document.addEventListener("visibilitychange", onVis);


    return () => {
      active = false;
      window.clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", onVis);
      if (ch) supabase.removeChannel(ch);
    };
  }, [tab, dmWith, user, profile?.tribe_id]);


  // Track first render per chat tab/conversation so we always land on the latest
  // messages when opening chat (instead of being stuck at the top).
  const firstScrollKey = useRef<string>("");
  useLayoutEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const key = `${tab}:${dmWith || ""}`;
    if (msgsKey !== key) return;
    const jumpToBottom = () => { el.scrollTop = el.scrollHeight; };
    const isFirst = firstScrollKey.current !== key;
    if (isFirst) {
      firstScrollKey.current = key;
      // Jump instantly to bottom after the real messages for this chat are rendered.
      jumpToBottom();
      requestAnimationFrame(jumpToBottom);
      window.setTimeout(jumpToBottom, 80);
      return;
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 240;
    if (nearBottom) jumpToBottom();
  }, [msgs.length, msgsKey, tab, dmWith]);

  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const showNotice = useCallback((m: string) => {
    setNotice(m);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 2500);
  }, []);
  const lastSendRef = useRef<{ body: string; at: number; channel: string; target: string }>({ body: "", at: 0, channel: "", target: "" });
  const moderateText = useServerFn(moderateChatText);
  const send = useCallback(async (override?: string) => {
    if (!user) return;
    const raw = override ?? "";
    const body = raw.trim().slice(0, 500);
    if (!body) return;
    if (tab === "tribe" && !profile?.tribe_id) return;
    if (tab === "dm" && !dmWith) return;
    if (!canChat) {
      showNotice(`📣 لا تقدر ترسل إلا بعد وصول سوق السفن للمستوى ${SHIP_MARKET_MIN} (مستواك الحالي ${marketLevel ?? 1})`);
      return;
    }
    if (containsLink(body)) {
      showNotice(LINK_BLOCK_MESSAGE);
      return;
    }

    // AI pre-check before showing the message in chat
    setSending(true);
    try {
      const mod = await moderateText({ data: { text: body } });
      if (!mod.safe) {
        showNotice("🚫 رسالتك تحتوي على ألفاظ غير مسموحة" + (mod.reason ? ` — ${mod.reason}` : ""));
        setSending(false);
        return;
      }
    } catch {
      // network/AI failure: continue and rely on DB-side filter
    }
    setSending(false);




    const now = Date.now();
    const target = tab === "dm" ? (dmWith || "") : tab === "tribe" ? (profile?.tribe_id || "") : "public";
    const last = lastSendRef.current;
    if (last.body === body && last.channel === tab && last.target === target && now - last.at < 3000) {
      showNotice("لا تكرر نفس الرسالة");
      return;
    }
    lastSendRef.current = { body, at: now, channel: tab, target };

    const tempId = `tmp-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Msg = {
      id: tempId,
      channel: tab,
      sender_id: user.id,
      recipient_id: tab === "dm" ? dmWith : null,
      tribe_id: tab === "tribe" ? (profile?.tribe_id || null) : null,
      body,
      created_at: new Date().toISOString(),
      reply_to_id: replyTo?.id ?? null,
      reply_to_body: replyTo?.body?.slice(0, 200) ?? null,
      reply_to_name: replyTo?.name?.slice(0, 60) ?? null,
    };
    if (profile) setProfMap(s => s.has(user.id) ? s : new Map(s).set(user.id, profile as any));
    setMsgs(s => [...s, optimistic]);
    // composer clears its own draft locally when it calls onSend
    setReplyTo(null);

    (supabase as any).rpc("send_chat_message_safe", {
      _channel: tab,
      _body: body,
      _recipient_id: tab === "dm" ? dmWith : null,
      _tribe_id: tab === "tribe" ? (profile?.tribe_id ?? null) : null,
      _reply_to_id: replyTo?.id ?? null,
      _reply_to_body: replyTo?.body?.slice(0, 200) ?? null,
      _reply_to_name: replyTo?.name?.slice(0, 60) ?? null,
    }).then(({ data, error }: { data: any; error: any }) => {
      if (error) {
        // remove optimistic on failure only — keep it visible while realtime arrives
        setMsgs(s => s.filter(x => x.id !== tempId));
        showNotice("تعذر الإرسال: " + (error.message || ""));
        restoreDraftRef.current(body);
        return;
      }
      // Swap the temp id with the real inserted id so the realtime INSERT dedupes
      // instead of briefly removing the message and re-adding it (which felt like a hang).
      const realId = data?.id as string | undefined;
      if (realId) {
        setMsgs(s => s.some(x => x.id === realId)
          ? s.filter(x => x.id !== tempId)
          : s.map(x => x.id === tempId ? { ...x, id: realId } : x));
      }
      const status = data?.status as string | undefined;
      if (status === "warned") {
        showNotice("⚠️ " + (data?.message || "تحذير من السب"));
        const warnId = `warn-${now}-${Math.random().toString(36).slice(2, 6)}`;
        setMsgs(s => [...s, {
          id: warnId,
          channel: tab,
          sender_id: "__system__",
          recipient_id: null,
          tribe_id: null,
          body: `⚠️ ${data?.message || "تحذير: ممنوع السب والشتم"}`,
          created_at: new Date().toISOString(),
        } as any]);
        return;
      }
      if (status === "muted" || status === "muted_already") {
        const msg = data?.message || data?.reason || "تم كتمك";
        showNotice("🔇 " + msg);
        setMyMute({ reason: data?.reason || "profanity", expires_at: data?.expires_at ?? null });
        return;
      }
      if (status === "level_locked") {
        setMsgs(s => s.filter(x => x.id !== tempId));
        const cur = (data?.current_level as number | undefined) ?? marketLevel ?? 1;
        showNotice(`📣 لا تقدر ترسل إلا بعد وصول سوق السفن للمستوى ${SHIP_MARKET_MIN} (مستواك الحالي ${cur})`);
        setMarketLevel(cur);
        restoreDraftRef.current(body);
        return;
      }
      if (status === "awaiting_acceptance" || status === "rejected_cooldown" || status === "blocked") {
        setMsgs(s => s.filter(x => x.id !== tempId));
        showNotice("⏳ " + (data?.message || "لا يمكن الإرسال حالياً"));
        restoreDraftRef.current(body);
        reloadThreads();
        return;
      }
      if (status === "request_sent") {
        showNotice("📨 تم إرسال طلب المحادثة — بانتظار قبول الطرف الآخر");
        reloadThreads();
        return;
      }
      if (status === "accepted_and_sent") {
        reloadThreads();
        return;
      }
    });
  }, [user, tab, profile, dmWith, showNotice, replyTo, canChat, marketLevel, moderateText]);



  const currentThread = dmWith ? dmThreads.find(t => t.other.id === dmWith) : null;
  const dmFriendInfo = dmWith ? (currentThread?.other || dmFriends.find(f => f.id === dmWith) || null) : null;
  const iBlockedCurrent = dmWith ? blockedIds.has(dmWith) : false;
  const currentBlockedMe = dmWith ? blockedBy.has(dmWith) : false;
  const iAmRequester = !!(currentThread && user && currentThread.requester_id === user.id);
  const awaitingMyAcceptance = !!(currentThread && currentThread.status === "pending" && !iAmRequester);
  const awaitingOtherAcceptance = !!(currentThread && currentThread.status === "pending" && iAmRequester);
  const incomingRequests = dmThreads.filter(t => t.status === "pending" && t.requester_id !== user?.id);
  const acceptedThreads = dmThreads.filter(t => t.status === "accepted");
  const outgoingRequests = dmThreads.filter(t => t.status === "pending" && t.requester_id === user?.id);


  return (
    <div className="fixed inset-x-0 top-0 overflow-hidden text-white" dir="rtl" style={{ height: "var(--app-height, 100dvh)", background: soloTribe
      ? "radial-gradient(ellipse at top, #3b1d0a 0%, #1a0f06 55%, #050302 100%)"
      : "radial-gradient(ellipse at top, #0c4a6e 0%, #082f49 55%, #020617 100%)" }}>
      {soloTribe && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.18]" style={{ backgroundImage: "radial-gradient(circle at 20% 10%, rgba(252,191,73,0.35), transparent 40%), radial-gradient(circle at 80% 90%, rgba(220,38,38,0.25), transparent 45%)" }} />
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-amber-500/10 to-transparent" />
        </>
      )}
      <div className="absolute top-0 left-0 right-0 z-30 px-2 pb-2 flex items-center gap-2" style={{ paddingTop: "max(1.25rem, calc(env(safe-area-inset-top) + 0.5rem))" }}>
        <Link to="/" className={`w-10 h-10 rounded-xl border-2 flex items-center justify-center ${soloTribe ? "bg-gradient-to-b from-amber-600 to-amber-800 border-amber-300 shadow-[0_0_12px_rgba(252,191,73,0.5)]" : "bg-amber-700 border-amber-300"}`}>↩</Link>
        <div className={`flex-1 text-center text-lg font-extrabold drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)] ${soloTribe ? "text-amber-200 tracking-wider" : "text-amber-300"}`}>
          {soloTribe ? "🏴‍☠️ القبيلة" : "💬 الشات"}
        </div>
        {tab === "tribe" && profile?.tribe_id && (
          <button onClick={() => setShowManage(true)} className={`w-10 h-10 rounded-xl border-2 flex items-center justify-center ${soloTribe ? "bg-gradient-to-b from-amber-600 to-amber-800 border-amber-300 shadow-[0_0_12px_rgba(252,191,73,0.5)]" : "bg-amber-700 border-amber-300"}`}>⚙️</button>
        )}
        {!(tab === "tribe" && profile?.tribe_id) && <div className="w-10" />}
      </div>

      {notice && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-stone-900/95 border-2 border-amber-400/70 text-amber-100 text-sm font-bold shadow-lg pointer-events-none">
          {notice}
        </div>
      )}

      {!soloTribe && (
        <div className="absolute left-2 right-2 z-20 flex gap-1" style={{ top: "max(4.25rem, calc(3.5rem + env(safe-area-inset-top)))" }}>
          {(["public", "tribe", "dm", "topics"] as Channel[]).map(t => (
            <button key={t} onClick={() => { setTab(t); setDmWith(null); }}
              className={`relative flex-1 py-1.5 rounded-t-lg text-[10px] font-bold border-2 border-b-0 ${tab === t ? "bg-amber-500 border-amber-200 text-amber-950" : "bg-stone-900/70 border-amber-900/60 text-amber-200/70"}`}>
              {t === "public" ? "🌍 عام" : t === "tribe" ? "🏴‍☠️ قبيلة" : t === "dm" ? "✉️ خاص" : "📝 مواضيع"}
              {t === "dm" && dmTotal > 0 && tab !== "dm" && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center border-2 border-amber-200 shadow animate-pulse">
                  {dmTotal > 9 ? "9+" : dmTotal}
                </span>
              )}
            </button>
          ))}
        </div>
      )}


      <div className={`absolute left-2 right-2 rounded-2xl border-2 overflow-hidden flex flex-col ${soloTribe ? "bg-gradient-to-b from-stone-950/85 to-stone-950/70 border-amber-500/60 shadow-[0_0_30px_rgba(252,191,73,0.25)]" : "bg-stone-950/70 border-amber-700/60"}`} style={{ top: soloTribe ? "max(4.5rem, calc(3.75rem + env(safe-area-inset-top)))" : "max(6.75rem, calc(6rem + env(safe-area-inset-top)))", bottom: (tab === "topics") ? "5rem" : "calc(8rem + var(--keyboard-inset, 0px))" }}>
        {tab === "topics" ? (
          <ForumTopics userId={user?.id || ""} />
        ) : tab === "dm" && !dmWith ? (
          <div className="flex-1 overflow-y-auto p-3">
            <div className="flex items-center gap-2 mb-3 px-1">
              <span className="text-xl">✉️</span>
              <div className="text-sm font-extrabold text-amber-200 tracking-wide">المحادثات الخاصة</div>
              <div className="flex-1 h-px bg-gradient-to-l from-transparent via-amber-500/40 to-transparent" />
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/40 text-amber-200">{acceptedThreads.length}</span>
            </div>

            {incomingRequests.length > 0 && (
              <div className="mb-4">
                <div className="text-[11px] font-black text-emerald-300 mb-1.5 px-1 flex items-center gap-1">
                  📨 طلبات محادثة جديدة
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/30 border border-emerald-400/40">{incomingRequests.length}</span>
                </div>
                <div className="space-y-2">
                  {incomingRequests.map(t => (
                    <div key={t.other.id} className="flex items-center gap-2 p-2.5 rounded-xl border-2 border-emerald-400/50 bg-gradient-to-l from-emerald-950/50 via-stone-900/80 to-stone-900/60">
                      <Avatar p={t.other} size={40} />
                      <button type="button" onClick={() => setDmWith(t.other.id)} className="flex-1 min-w-0 text-right active:scale-[0.98]">
                        <div className="text-sm font-extrabold text-amber-100 truncate">{t.other.display_name}</div>
                        <div className="text-[10px] text-emerald-300/90">يريد فتح محادثة معك</div>
                      </button>
                      <button onClick={() => acceptDmRequest(t.other.id)} className="px-2.5 py-1.5 rounded-lg bg-emerald-600 border border-emerald-300 text-white text-xs font-black active:scale-95 shadow">✓ قبول</button>
                      <button onClick={() => rejectDmRequest(t.other.id)} className="px-2.5 py-1.5 rounded-lg bg-red-700 border border-red-300 text-white text-xs font-black active:scale-95 shadow">✗ رفض</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {outgoingRequests.length > 0 && (
              <div className="mb-4">
                <div className="text-[11px] font-black text-amber-300/80 mb-1.5 px-1 flex items-center gap-1">
                  ⏳ طلبات مرسلة (بانتظار القبول)
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/40">{outgoingRequests.length}</span>
                </div>
                <div className="space-y-2">
                  {outgoingRequests.map(t => (
                    <div key={t.other.id} className="flex items-center gap-2 p-2.5 rounded-xl border-2 border-amber-700/40 bg-stone-900/70">
                      <Avatar p={t.other} size={40} />
                      <button type="button" onClick={() => setDmWith(t.other.id)} className="flex-1 min-w-0 text-right">
                        <div className="text-sm font-extrabold text-amber-100 truncate">{t.other.display_name}</div>
                        <div className="text-[10px] text-amber-300/70">بانتظار قبول الطرف الآخر</div>
                      </button>
                      <button onClick={() => cancelDmRequest(t.other.id)} className="px-2.5 py-1.5 rounded-lg bg-stone-700 border border-stone-500 text-white text-xs font-black active:scale-95">إلغاء</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {acceptedThreads.length === 0 && incomingRequests.length === 0 && outgoingRequests.length === 0 && (
              <div className="text-center py-10">
                <div className="text-4xl mb-2 opacity-60">💌</div>
                <div className="text-amber-100/70 text-sm font-bold">لا توجد محادثات بعد</div>
                <div className="text-amber-100/40 text-xs mt-1">يمكنك بدء محادثة من صفحة أي لاعب — أول رسالة تكون طلب محادثة</div>
              </div>
            )}
            {acceptedThreads.length > 0 && (
              <div className="text-[11px] font-black text-amber-300/80 mb-1.5 px-1">💬 المحادثات</div>
            )}
            <div className="space-y-2">
              {[...acceptedThreads].sort((a, b) => {
                const ea = dmMap.get(a.other.id); const eb = dmMap.get(b.other.id);
                if ((eb?.count ?? 0) !== (ea?.count ?? 0)) return (eb?.count ?? 0) - (ea?.count ?? 0);
                const ta = ea?.lastAt ?? a.last_request_at; const tb = eb?.lastAt ?? b.last_request_at;
                return (tb || "").localeCompare(ta || "");
              }).map(t => {
                const f = t.other;
                const entry = dmMap.get(f.id);
                const unread = entry?.count ?? 0;
                return (
                <div
                  key={f.id}
                  className={`group w-full flex items-center gap-3 p-2.5 rounded-xl border-2 ${unread > 0 ? "border-red-400/70 bg-gradient-to-l from-red-950/40 via-stone-900/80 to-amber-950/40 shadow-[0_0_14px_rgba(239,68,68,0.25)]" : "border-amber-700/40 bg-gradient-to-l from-stone-900/90 via-stone-900/70 to-amber-950/40"} hover:border-amber-400/80 hover:shadow-[0_0_18px_rgba(252,191,73,0.25)] transition-all relative overflow-hidden`}
                >
                  <div className="absolute inset-y-0 right-0 w-1 bg-gradient-to-b from-amber-300 via-amber-500 to-amber-700 opacity-60 group-hover:opacity-100" />
                  <Link
                    to="/p/$id"
                    params={{ id: f.id }}
                    className="relative shrink-0 active:scale-95 transition-transform"
                    aria-label={`محيط ${f.display_name}`}
                  >
                    <Avatar p={f} size={42} />
                    {unread > 0 && (
                      <span className="absolute -top-1 -left-1 min-w-[20px] h-[20px] px-1 rounded-full bg-red-600 text-white text-[11px] font-black flex items-center justify-center border-2 border-amber-200 shadow animate-pulse">
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                  </Link>
                  <button
                    type="button"
                    onClick={() => setDmWith(f.id)}
                    className="flex-1 min-w-0 text-right active:scale-[0.98] transition-transform"
                  >
                    <div className="text-sm font-extrabold text-amber-100 truncate">{f.display_name}</div>
                    {entry?.lastBody ? (
                      <div className={`text-[11px] truncate ${unread > 0 ? "text-amber-100 font-bold" : "text-amber-300/60"}`}>{entry.lastFromMe ? "↩︎ " : ""}{entry.lastBody}</div>
                    ) : (
                      <div className="text-[10px] text-amber-300/70 font-bold">⭐ المستوى {f.level ?? 1}</div>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDmWith(f.id)}
                    className="text-amber-300/70 group-hover:text-amber-200 text-lg px-1"
                    aria-label="فتح المحادثة"
                  >
                    ‹
                  </button>
                </div>
                );
              })}
            </div>
          </div>
        ) : tab === "tribe" && !profile?.tribe_id ? (
          <NoTribePanel userId={user?.id || ""} />
        ) : (
          <>
            {tab === "dm" && dmFriendInfo && (
              <div className="flex items-center gap-2 p-2.5 border-b-2 border-amber-500/40 bg-gradient-to-l from-amber-950/80 via-stone-900/80 to-stone-900/80 shadow-[inset_0_-2px_8px_rgba(0,0,0,0.4)]">
                <button onClick={() => setDmWith(null)} className="w-8 h-8 rounded-lg bg-stone-800 border border-amber-700/50 text-amber-300 text-sm active:scale-95 flex items-center justify-center">←</button>
                <div className="relative">
                  <Avatar p={dmFriendInfo} size={36} />
                  <span className={`absolute -bottom-0.5 -left-0.5 w-3 h-3 rounded-full border-2 border-stone-900 shadow ${iBlockedCurrent || currentBlockedMe ? "bg-red-500" : awaitingMyAcceptance || awaitingOtherAcceptance ? "bg-amber-400" : "bg-emerald-400"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-extrabold text-amber-100 truncate drop-shadow">{dmFriendInfo.display_name}</div>
                  <div className="text-[10px] font-bold">
                    {iBlockedCurrent ? <span className="text-red-300">🚫 محظور من قِبلك</span>
                      : currentBlockedMe ? <span className="text-red-300">🚫 حظرك</span>
                      : awaitingMyAcceptance ? <span className="text-emerald-300">📨 طلب محادثة</span>
                      : awaitingOtherAcceptance ? <span className="text-amber-300">⏳ بانتظار القبول</span>
                      : <span className="text-emerald-300/90">● محادثة خاصة</span>}
                  </div>
                </div>
                {iBlockedCurrent ? (
                  <button onClick={() => unblockDmUser(dmWith!)} className="px-2.5 py-1.5 rounded-lg bg-stone-700 border border-stone-400 text-xs font-black text-white shadow active:scale-95">فك الحظر</button>
                ) : (
                  <button onClick={() => blockDmUser(dmWith!)} className="px-2.5 py-1.5 rounded-lg bg-stone-800 border border-red-400/60 text-xs font-black text-red-300 shadow active:scale-95" aria-label="حظر">🚫</button>
                )}
                <button onClick={() => setWarTarget(dmFriendInfo)} className="px-2.5 py-1.5 rounded-lg bg-gradient-to-b from-red-500 to-red-800 border border-red-300/60 text-xs font-black text-white shadow active:scale-95">⚔️ حرب</button>
              </div>
            )}
            {tab === "dm" && dmWith && awaitingMyAcceptance && (
              <div className="p-2.5 border-b border-emerald-400/40 bg-emerald-950/40 flex items-center gap-2">
                <div className="flex-1 text-xs text-emerald-100 font-bold">📨 هذا اللاعب أرسل لك طلب محادثة</div>
                <button onClick={() => acceptDmRequest(dmWith!)} className="px-3 py-1.5 rounded-lg bg-emerald-600 border border-emerald-300 text-white text-xs font-black active:scale-95">✓ قبول</button>
                <button onClick={() => rejectDmRequest(dmWith!)} className="px-3 py-1.5 rounded-lg bg-red-700 border border-red-300 text-white text-xs font-black active:scale-95">✗ رفض</button>
              </div>
            )}
            {tab === "dm" && dmWith && awaitingOtherAcceptance && (
              <div className="p-2.5 border-b border-amber-700/40 bg-stone-900/70 flex items-center gap-2">
                <div className="flex-1 text-xs text-amber-100/90 font-bold">⏳ بانتظار قبول الطرف الآخر — لا يمكن إرسال رسائل إضافية</div>
                <button onClick={() => cancelDmRequest(dmWith!)} className="px-3 py-1.5 rounded-lg bg-stone-700 border border-stone-500 text-white text-xs font-black active:scale-95">إلغاء الطلب</button>
              </div>
            )}

            <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-2">
              {(pinned || isAdmin) && (
                <div className="sticky top-0 z-10 -mx-3 -mt-3 mb-1 px-3 py-2 bg-gradient-to-b from-amber-900/95 to-amber-950/95 border-b-2 border-amber-400/70 shadow-lg backdrop-blur">
                  <div className="flex items-start gap-2">
                    <div className="text-amber-300 text-lg leading-none">📌</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-extrabold text-amber-300/90">رسالة مثبتة من الإدارة</div>
                      <div className="text-xs text-amber-50 font-bold whitespace-pre-wrap break-words">
                        {pinned?.body || (isAdmin ? <span className="text-amber-200/60 italic">لا توجد رسالة مثبتة — اضغط ✏️ للإضافة</span> : null)}
                      </div>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => { setPinDraft(pinned?.body || ""); setPinEditOpen(true); }}
                        className="shrink-0 px-2 py-1 rounded-lg bg-amber-500 border border-amber-300 text-amber-950 text-xs font-black active:scale-95"
                      >✏️</button>
                    )}
                  </div>
                </div>
              )}
              {msgs.filter(m => !blockedIds.has(m.sender_id) && !blockedBy.has(m.sender_id)).length === 0 && <div className="text-center text-amber-100/40 text-sm py-8">لا توجد رسائل بعد — كن أول من يكتب</div>}
              {msgs.filter(m => !blockedIds.has(m.sender_id) && !blockedBy.has(m.sender_id)).map(m => {
                if (m.sender_id === "__system__") {
                  return (
                    <div key={m.id} className="mx-auto max-w-[90%] px-3 py-2 rounded-xl border-2 border-red-400/80 bg-red-950/70 text-red-100 text-xs font-extrabold text-center shadow-lg animate-pulse">
                      {m.body}
                    </div>
                  );
                }
                const p = profMap.get(m.sender_id);
                const mine = m.sender_id === user?.id;
                const senderName = (mine ? (profile as any)?.display_name : p?.display_name) || "مستخدم";
                const previewBody = m.audio_url ? "🎤 رسالة صوتية" : m.body;
                return (
                  <SwipeableRow
                    key={m.id}
                    onReply={() => setReplyTo({ id: m.id, body: previewBody, name: senderName })}
                  >
                    <div className={`flex gap-2 items-center ${mine ? "flex-row-reverse" : ""}`}>
                      <button type="button" onClick={() => !mine && p && setActionTarget(p)} className="shrink-0">
                        <Avatar p={p} size={56} />
                      </button>
                      {(() => {
                        const bubbleFrame = frameById((mine ? (profile as any)?.bubble_frame : p?.bubble_frame));
                        const bubbleCls = bubbleFrame?.kind === "bubble" && bubbleFrame.bubbleClass
                          ? bubbleFrame.bubbleClass
                          : (mine ? "bg-amber-600 text-amber-50" : "bg-stone-800 text-white");
                        return (
                            <div className={`max-w-[75%] rounded-2xl px-3 py-1.5 ${bubbleCls} ${bubbleFrame?.animClass ?? ""}`}>
                            {!mine && (
                              <button type="button" onClick={() => p && setActionTarget(p)} className="hover:opacity-90">
                                <NameBadge p={p} />
                              </button>
                            )}
                            {mine && (
                              <div className="mb-0.5"><NameBadge p={profile as any} mine /></div>
                            )}
                            {m.reply_to_id && (m.reply_to_body || m.reply_to_name) && (
                              <div className="mb-1 border-r-4 border-amber-300/80 bg-black/25 rounded-md px-2 py-1 text-[11px]">
                                <div className="font-black text-amber-200 truncate">↩︎ {m.reply_to_name || "رد"}</div>
                                <div className="opacity-80 truncate">{m.reply_to_body}</div>
                              </div>
                            )}
                            {m.audio_url ? (
                              <VoiceMessage src={m.audio_url} durationMs={m.audio_duration_ms || 0} mine={mine} />
                            ) : (
                              <div className="text-sm break-words">{m.body}</div>
                            )}
                            <div className={`text-[10px] mt-0.5 opacity-70 ${mine ? "text-amber-100 text-left" : "text-stone-300 text-right"}`}>
                              {new Date(m.created_at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", hour12: true })}
                            </div>
                          </div>

                        );
                      })()}
                      <button
                        type="button"
                        onClick={() => setReplyTo({ id: m.id, body: previewBody, name: senderName })}
                        className="shrink-0 w-9 h-9 rounded-full bg-amber-500/20 hover:bg-amber-500/40 active:scale-95 transition flex items-center justify-center text-amber-200 text-lg border border-amber-400/40"
                        title="رد"
                        aria-label="رد"
                      >
                        ↩︎
                      </button>
                      {!mine && (
                        <ReportMessageButton
                          reportedUserId={m.sender_id}
                          kind="chat"
                          messageBody={previewBody || ""}
                          sourceId={m.id}
                          compact
                        />
                      )}
                    </div>
                  </SwipeableRow>
                );
              })}
            </div>
          </>
        )}
      </div>

      {tab !== "topics" && (
        myMute ? (
          <div className="absolute left-2 right-2 z-40" style={{ bottom: "calc(12px + var(--keyboard-inset, 0px))" }}>
            <div className="rounded-2xl bg-amber-900/60 border-2 border-amber-500/60 text-amber-100 px-3 py-2 text-xs text-center backdrop-blur shadow-lg">
              🔇 أنت مكتوم من قِبل الإدارة — لا تقدر ترسل في أي محادثة (عام/قبيلة/خاص)
              {myMute.reason && <div className="text-[11px] mt-0.5 text-amber-200/80">السبب: {myMute.reason}</div>}
              {myMute.expires_at && <div className="text-[10px] mt-0.5 text-amber-300/70">ينتهي: {new Date(myMute.expires_at).toLocaleString("ar")}</div>}
            </div>
          </div>
        ) : !canChat ? (
          <div className="absolute left-2 right-2 z-40" style={{ bottom: "calc(12px + var(--keyboard-inset, 0px))" }}>
            <Link to="/ship-market" className="block rounded-2xl bg-sky-900/70 border-2 border-amber-400/70 text-amber-100 px-3 py-2 text-xs text-center hover:bg-sky-900/80 backdrop-blur shadow-lg">
              🔒 الكتابة في الشات مغلقة — تحتاج <b className="text-amber-300">سوق السفن مستوى {SHIP_MARKET_MIN}</b>
              <div className="text-[11px] mt-0.5 text-amber-200/80">مستواك الحالي: 🏪 {marketLevel ?? 1} — اضغط للذهاب لسوق السفن وترقيته</div>
            </Link>
          </div>
        ) : (
          <ChatComposer
            restoreDraftRef={restoreDraftRef}
            onSend={send}
            sending={sending}
            disabled={(tab === "tribe" && !profile?.tribe_id) || (tab === "dm" && !dmWith) || awaitingOtherAcceptance || iBlockedCurrent || currentBlockedMe}
            userId={user?.id || ""}
            onAudioSent={(m) => setMsgs(s => s.some(x => x.id === m.id) ? s : [...s, m])}
            channel={tab as "public" | "tribe" | "dm"}
            tribeId={profile?.tribe_id || null}
            dmWith={dmWith}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
          />
        )
      )}


      

      {showManage && profile?.tribe_id && user && (
        <TribeManageModal tribeId={profile.tribe_id} userId={user.id} onClose={() => setShowManage(false)} />
      )}
      {warTarget && user && (
        <WarModal sender={user.id} senderTribe={profile?.tribe_id || null} target={warTarget} onClose={() => setWarTarget(null)} />
      )}
      {actionTarget && user && (
        <ProfileActionsModal
          me={user.id}
          target={actionTarget}
          isBlocked={blockedIds.has(actionTarget.id)}
          onClose={() => setActionTarget(null)}
          onBlocksChanged={reloadBlocks}
        />
      )}
      {pinEditOpen && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPinEditOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-stone-900 border-2 border-amber-400 p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="text-amber-200 font-extrabold text-base flex items-center gap-2">📌 رسالة الإدارة المثبتة</div>
            <textarea
              value={pinDraft}
              onChange={(e) => setPinDraft(e.target.value.slice(0, 300))}
              rows={4}
              placeholder="اكتب رسالتك المثبتة هنا..."
              className="w-full p-3 rounded-xl bg-stone-950 border-2 border-amber-700/60 text-amber-50 text-sm font-bold resize-none focus:outline-none focus:border-amber-400"
              dir="rtl"
            />
            <div className="text-[10px] text-amber-300/70 text-end">{pinDraft.length}/300</div>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  const { error } = await (supabase as any).rpc("set_pinned_chat", { _body: pinDraft.trim() });
                  if (error) { showNotice("تعذر الحفظ: " + error.message); return; }
                  setPinEditOpen(false);
                }}
                className="flex-1 py-2 rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-700 text-white font-black text-sm active:scale-95"
              >💾 حفظ التثبيت</button>
              <button
                onClick={async () => {
                  await (supabase as any).rpc("set_pinned_chat", { _body: "" });
                  setPinEditOpen(false);
                }}
                className="px-3 py-2 rounded-xl bg-stone-800 border border-stone-600 text-stone-300 font-bold text-xs active:scale-95"
              >مسح</button>
              <button
                onClick={() => setPinEditOpen(false)}
                className="px-3 py-2 rounded-xl bg-stone-800 border border-stone-600 text-stone-300 font-bold text-xs active:scale-95"
              >إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===================== Profile Actions Modal =====================
function ProfileActionsModal({ me, target, isBlocked, onClose, onBlocksChanged }:
  { me: string; target: Prof; isBlocked: boolean; onClose: () => void; onBlocksChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { isAdmin } = useIsAdmin();
  const { isChatMod } = useIsChatMod();
  const canModerateChat = isAdmin || isChatMod;
  const [isBanned, setIsBanned] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);


  useEffect(() => {
    if (!canModerateChat) return;
    (async () => {
      const nowIso = new Date().toISOString();
      if (isAdmin) {
        const { data: b } = await supabase.from("bans").select("id,expires_at").eq("user_id", target.id).eq("active", true).maybeSingle();
        setIsBanned(!!b && (!b.expires_at || b.expires_at > nowIso));
      }
      const { data: m } = await supabase.from("chat_mutes").select("id,expires_at").eq("user_id", target.id).eq("active", true).maybeSingle();
      setIsMuted(!!m && (!m.expires_at || m.expires_at > nowIso));
    })();
  }, [canModerateChat, isAdmin, target.id]);

  const addFriend = async () => {
    setBusy(true); setMsg(null);
    const { data, error } = await (supabase as any).rpc("send_friend_request", { p_target: target.id });
    setBusy(false);
    const code = (data?.code || "").toString();
    const map: Record<string, string> = {
      sent: "تم إرسال طلب الصداقة ✓",
      accepted_existing: "تم قبول الصداقة ✓",
      already_sent: "تم إرسال الطلب مسبقاً",
      already_friends: "أنتم أصدقاء بالفعل",
      invalid_target: "طلب غير صالح",
    };
    if (error) setMsg(error.message);
    else setMsg(map[code] || "تم");
  };

  const toggleBlock = async () => {
    setBusy(true); setMsg(null);
    if (isBlocked) {
      await supabase.from("user_blocks").delete().eq("blocker_id", me).eq("blocked_id", target.id);
      setMsg("تم إلغاء الحظر");
    } else {
      const { error } = await supabase.from("user_blocks").insert({ blocker_id: me, blocked_id: target.id });
      if (error) setMsg(error.message);
      else setMsg("تم الحظر");
    }
    setBusy(false);
    onBlocksChanged();
  };

  const notify = async (title: string, body: string, anonymous = false) => {
    await supabase.from("notifications").insert({ recipient_id: target.id, title, body, kind: "warning", created_by: anonymous ? null : me });
  };
  const logAudit = async (action: string, details: Record<string, unknown>) => {
    await supabase.from("admin_audit").insert({ admin_id: me, action, target_user_id: target.id, details: details as never });
  };

  const adminToggleBan = async () => {
    if (isBanned) {
      const ok = await confirmDialog({ title: "رفع الحظر", message: `رفع الحظر عن ${target.display_name}؟` });
      if (!ok) return;
      setBusy(true);
      await supabase.from("bans").update({ active: false }).eq("user_id", target.id).eq("active", true);
      await logAudit("unban_user", { name: target.display_name, via: "chat" });
      await notify("✅ تم رفع الحظر", "يمكنك استخدام اللعبة بشكل طبيعي.");
      setIsBanned(false); setMsg("فُكّ الحظر");
      setBusy(false);
      return;
    }
    const ok = await confirmDialog({ title: "حظر من اللعبة", message: `هل أنت متأكد من حظر ${target.display_name}؟`, danger: true });
    if (!ok) return;
    const reason = prompt("سبب الحظر:", "مخالفة قواعد اللعبة") ?? "";
    const hoursStr = prompt("مدة الحظر بالساعات (فارغ = دائم):", "24");
    const hours = hoursStr ? Number(hoursStr) : 0;

    const expires_at = hours > 0 ? new Date(Date.now() + hours * 3600_000).toISOString() : null;
    setBusy(true);
    await supabase.from("bans").insert({ user_id: target.id, reason, banned_by: me, expires_at });
    await logAudit("ban_user", { name: target.display_name, reason, hours: hours || "permanent", via: "chat" });
    const dur = hours > 0 ? `لمدة ${hours} ساعة` : "نهائياً";
    await notify("🚫 تم حظرك", `تم حظرك ${dur}. السبب: ${reason || "غير محدد"}`);
    setIsBanned(true); setMsg(hours > 0 ? `حُظر لمدة ${hours} ساعة` : "حُظر نهائياً");
    setBusy(false);
  };

  const adminToggleMute = async () => {
    if (isMuted) {
      const ok = await confirmDialog({ title: "رفع الكتم", message: `رفع الكتم عن ${target.display_name}؟` });
      if (!ok) return;
      setBusy(true);
      await supabase.from("chat_mutes").update({ active: false }).eq("user_id", target.id).eq("active", true);
      if (isAdmin) await logAudit("unmute_user", { name: target.display_name, via: "chat" });
      await notify("✅ تم رفع الكتم", "يمكنك الكتابة في الدردشة الآن.");
      setIsMuted(false); setMsg("فُكّ الكتم");
      setBusy(false);
      return;
    }
    // Chat moderators: silent, fixed 24h, no reason prompt, no audit log
    if (!isAdmin && isChatMod) {
      const ok = await confirmDialog({ title: "كتم في الشات", message: `كتم ${target.display_name} لمدة 24 ساعة؟`, danger: true });
      if (!ok) return;
      const expires_at = new Date(Date.now() + 24 * 3600_000).toISOString();
      setBusy(true);
      const { error } = await supabase.from("chat_mutes").insert({ user_id: target.id, reason: "مخالفة قواعد الدردشة", muted_by: me, expires_at });
      if (error) { setMsg(error.message); setBusy(false); return; }
      await notify("🔇 تم كتمك", "تم كتمك من قبل مشرف لمدة 24 ساعة.", true);
      setIsMuted(true); setMsg("كُتم لمدة 24 ساعة");
      setBusy(false);
      return;
    }
    const ok = await confirmDialog({ title: "كتم في الشات", message: `هل أنت متأكد من كتم ${target.display_name}؟`, danger: true });
    if (!ok) return;
    const reason = prompt("سبب الكتم:", "إساءة في الدردشة") ?? "";
    const hoursStr = prompt("مدة الكتم بالساعات (فارغ = دائم):", "24");
    const hours = hoursStr ? Number(hoursStr) : 0;

    const expires_at = hours > 0 ? new Date(Date.now() + hours * 3600_000).toISOString() : null;
    setBusy(true);
    await supabase.from("chat_mutes").insert({ user_id: target.id, reason, muted_by: me, expires_at });
    await logAudit("mute_user", { name: target.display_name, reason, hours: hours || "permanent", via: "chat" });
    const dur = hours > 0 ? `لمدة ${hours} ساعة` : "نهائياً";
    await notify("🔇 تم كتمك", `لا يمكنك الكتابة ${dur}. السبب: ${reason || "غير محدد"}`);
    setIsMuted(true); setMsg(hours > 0 ? `كُتم لمدة ${hours} ساعة` : "كُتم نهائياً");
    setBusy(false);
  };

  const adminDeleteAllMsgs = async () => {
    const ok = await confirmDialog({ title: "حذف رسائل اللاعب", message: `حذف كل رسائل ${target.display_name}؟`, danger: true });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from("messages").delete().eq("sender_id", target.id);
    setBusy(false);
    setMsg(error ? error.message : "تم حذف الرسائل");
    await logAudit("delete_user_messages", { name: target.display_name });
  };

  const adminRedeemCodeFor = async () => {
    const ok = await confirmDialog({ title: "تفعيل كود", message: `تفعيل كود لـ ${target.display_name}؟` });
    if (!ok) return;
    const code = prompt(`تفعيل كود لـ ${target.display_name}\nأدخل الكود:`, "");
    if (!code || !code.trim()) return;

    setBusy(true); setMsg(null);
    const { data, error } = await (supabase as any).rpc("admin_redeem_code_for", {
      p_code: code.trim(),
      p_target_user: target.id,
    });
    setBusy(false);
    if (error) {
      const map: Record<string, string> = {
        invalid_code: "كود غير صحيح",
        code_disabled: "الكود معطّل",
        code_expired: "الكود منتهي",
        code_exhausted: "الكود استنفد",
        already_redeemed: "تم تفعيله مسبقاً لهذا اللاعب",
        admin_only: "للأدمن فقط",
      };
      const raw = (error.message || "").toString();
      const key = (raw.match(/(invalid_code|code_disabled|code_expired|code_exhausted|already_redeemed|admin_only)/) || [, ""])[1];
      setMsg(map[key] || raw);
    } else {
      setMsg(`✅ تم تفعيل الكود "${(data as any)?.code || code}" لـ ${target.display_name}`);
    }
  };


  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" dir="rtl" onClick={onClose}>
      <div className="w-full max-w-xs bg-stone-950 border-2 border-amber-600 rounded-2xl p-4 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <Avatar p={target} size={56} />
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-amber-200 truncate">{target.display_name}</div>
            {typeof target.level === "number" && <div className="text-xs text-amber-300/70">المستوى {target.level}</div>}
          </div>
          {isAdmin && <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-600 text-white">أدمن</span>}
        </div>
        <Link to="/p/$id" params={{ id: target.id }} onClick={onClose}
          className="block w-full py-2 rounded-lg bg-sky-600 text-white text-center font-bold text-sm">
          👤 زياره الملف الشخصي
        </Link>
        <button onClick={addFriend} disabled={busy}
          className="w-full py-2 rounded-lg bg-emerald-600 text-white font-bold text-sm disabled:opacity-50">
          ➕ إضافه صديق
        </button>
        <button onClick={toggleBlock} disabled={busy}
          className={`w-full py-2 rounded-lg text-white font-bold text-sm disabled:opacity-50 ${isBlocked ? "bg-stone-700" : "bg-red-700"}`}>
          {isBlocked ? "🔓 إلغاء الحظر" : "🚫 حظر"}
        </button>

        {isAdmin && (
          <div className="pt-2 mt-2 border-t border-rose-500/30 space-y-2">
            <button
              type="button"
              onClick={() => setAdminOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-rose-950/60 border border-rose-500/40 text-rose-200 font-black text-[12px]"
            >
              <span>⚙️ أوامر الإدارة</span>
              <span className="text-rose-300/80">{adminOpen ? "▲" : "▼"}</span>
            </button>
            {adminOpen && (
              <div className="space-y-2">
                <button onClick={adminToggleMute} disabled={busy}
                  className={`w-full py-2 rounded-lg text-white font-bold text-sm disabled:opacity-50 ${isMuted ? "bg-stone-700" : "bg-amber-700"}`}>
                  {isMuted ? "🔊 رفع الكتم" : "🔇 كتم في الشات"}
                </button>
                <button onClick={adminToggleBan} disabled={busy}
                  className={`w-full py-2 rounded-lg text-white font-bold text-sm disabled:opacity-50 ${isBanned ? "bg-stone-700" : "bg-rose-700"}`}>
                  {isBanned ? "🔓 رفع الحظر" : "🚫 حظر من اللعبة"}
                </button>
                <button onClick={adminDeleteAllMsgs} disabled={busy}
                  className="w-full py-2 rounded-lg bg-rose-900 text-white font-bold text-sm disabled:opacity-50">
                  🗑️ حذف كل رسائله
                </button>
                <button onClick={adminRedeemCodeFor} disabled={busy}
                  className="w-full py-2 rounded-lg bg-emerald-700 text-white font-bold text-sm disabled:opacity-50">
                  🎁 تفعيل كود لهذا اللاعب
                </button>
              </div>
            )}
          </div>
        )}

        {!isAdmin && isChatMod && target.id !== me && (
          <button onClick={adminToggleMute} disabled={busy}
            className={`w-full py-2 rounded-lg text-white font-bold text-sm disabled:opacity-50 ${isMuted ? "bg-stone-700" : "bg-amber-700"}`}>
            {isMuted ? "🔊 رفع الكتم" : "🔇 كتم 24 ساعة"}
          </button>
        )}



        {msg && <div className="text-xs text-amber-300 text-center">{msg}</div>}
        <button onClick={onClose} className="w-full py-2 rounded-lg bg-stone-800 text-amber-200 font-bold text-sm">إغلاق</button>
      </div>
    </div>
  );
}

// ===================== Tribe Management Modal =====================
type Member = { user_id: string; role: string; display_name: string; avatar_emoji: string; level: number; donation_coins: number };
type JoinReq = { id: string; user_id: string; display_name: string; avatar_emoji: string; level: number };
type TribeInfo = { name: string; emblem: string; description: string; banner: string; level: number; treasure_coins: number; total_donations: number; join_mode?: string };

const RENAME_COST_GEMS = 100;
const EMBLEM_CHOICES = ["🏴‍☠️","⚔️","🛡️","👑","⚓","🦈","🐙","🔱","🏆","🦅","🐉","💀","🌊","⛵","🗡️"];

// Matches DB public.tribe_level_from_donations thresholds
const TRIBE_LEVEL_THRESHOLDS = [0, 50000, 150000, 300000, 500000, 800000, 1200000, 1700000, 2300000, 3000000];
const TRIBE_MAX_LEVEL = 10;
function levelGoal(level: number): number {
  // total_donations required to reach (level + 1)
  if (level >= TRIBE_MAX_LEVEL) return TRIBE_LEVEL_THRESHOLDS[TRIBE_MAX_LEVEL - 1];
  return TRIBE_LEVEL_THRESHOLDS[level] ?? TRIBE_LEVEL_THRESHOLDS[TRIBE_MAX_LEVEL - 1];
}

function TribeManageModal({ tribeId, userId, onClose }: { tribeId: string; userId: string; onClose: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [requests, setRequests] = useState<JoinReq[]>([]);
  const [myRole, setMyRole] = useState<string>("member");
  const [info, setInfo] = useState<TribeInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingDetails, setEditingDetails] = useState(false);
  const [desc, setDesc] = useState("");
  const [banner, setBanner] = useState("");
  const [donateAmount, setDonateAmount] = useState<number>(500);

  const load = useCallback(async () => {
    const { data: t } = await supabase.from("tribes")
      .select("name,emblem,description,banner,level,treasure_coins,total_donations,join_mode")
      .eq("id", tribeId).maybeSingle();
    if (t) {
      const ti = t as any as TribeInfo;
      setInfo(ti);
      setNewName(ti.name);
      setDesc(ti.description || "");
      setBanner(ti.banner || "🏴‍☠️");
    }
    const { data: ms } = await supabase.from("tribe_members").select("user_id,role,donation_coins").eq("tribe_id", tribeId);
    const mIds = (ms || []).map((m: any) => m.user_id);
    const { data: ps } = mIds.length ? await supabase.from("profiles").select("id,display_name,avatar_emoji,level").in("id", mIds) : { data: [] };
    const pmap = new Map((ps || []).map((p: any) => [p.id, p]));
    const merged: Member[] = (ms || []).map((m: any) => ({
      user_id: m.user_id, role: m.role,
      display_name: (pmap.get(m.user_id) as any)?.display_name || "...",
      avatar_emoji: (pmap.get(m.user_id) as any)?.avatar_emoji || "👤",
      level: (pmap.get(m.user_id) as any)?.level || 1,
      donation_coins: Number(m.donation_coins || 0),
    })).sort((a, b) => b.donation_coins - a.donation_coins);
    setMembers(merged);
    const me = merged.find(x => x.user_id === userId);
    setMyRole(me?.role || "member");

    const { data: rs } = await supabase.from("tribe_join_requests").select("id,user_id").eq("tribe_id", tribeId).eq("status", "pending");
    const rIds = (rs || []).map((r: any) => r.user_id);
    const { data: rps } = rIds.length ? await supabase.from("profiles").select("id,display_name,avatar_emoji,level").in("id", rIds) : { data: [] };
    const rpmap = new Map((rps || []).map((p: any) => [p.id, p]));
    setRequests((rs || []).map((r: any) => ({
      id: r.id, user_id: r.user_id,
      display_name: (rpmap.get(r.user_id) as any)?.display_name || "...",
      avatar_emoji: (rpmap.get(r.user_id) as any)?.avatar_emoji || "👤",
      level: (rpmap.get(r.user_id) as any)?.level || 1,
    })));
  }, [tribeId, userId]);

  useEffect(() => { load(); }, [load]);

  const isOfficer = myRole === "owner" || myRole === "moderator";
  const isOwner = myRole === "owner";

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e: any) { setErr(e?.message || "خطأ"); }
    setBusy(false);
  };

  const acceptReq = (r: JoinReq) => wrap(async () => {
    const { error } = await supabase.rpc("accept_join_request" as never, { _request_id: r.id } as never);
    if (error) throw error;
    await load();
  });
  const rejectReq = (r: JoinReq) => wrap(async () => {
    await supabase.from("tribe_join_requests").update({ status: "rejected" }).eq("id", r.id);
    await load();
  });
  const kick = (m: Member) => {
    if (m.role === "owner") return alert("لا يمكن طرد المالك");
    if (!confirm(`طرد ${m.display_name}؟`)) return;
    wrap(async () => {
      await supabase.from("tribe_members").delete().eq("tribe_id", tribeId).eq("user_id", m.user_id);
      await officerSetTribe(m.user_id, null);
      await load();
    });
  };
  const promote = (m: Member) => wrap(async () => {
    const newRole = m.role === "moderator" ? "member" : "moderator";
    await supabase.from("tribe_members").update({ role: newRole }).eq("tribe_id", tribeId).eq("user_id", m.user_id);
    await load();
  });
  const leaveTribe = () => {
    if (!confirm("هل تريد مغادرة القبيلة؟\nإذا كنت القائد سيتم تحويل القيادة تلقائياً لأقدم عضو، وإن كنت العضو الوحيد ستُحذف القبيلة.")) return;
    wrap(async () => {
      const { error } = await supabase.rpc("leave_tribe" as never, { _tribe_id: tribeId } as never);
      if (error) throw error;
      await setMyTribe(null);
      window.location.reload();
    });
  };
  const saveRename = () => wrap(async () => {
    const { error } = await supabase.rpc("rename_tribe" as never, { _tribe_id: tribeId, _new_name: newName } as never);
    if (error) throw error;
    setEditingName(false);
    await load();
  });
  const saveDetails = () => wrap(async () => {
    const { error } = await supabase.rpc("update_tribe_details" as never, { _tribe_id: tribeId, _description: desc, _banner: banner } as never);
    if (error) throw error;
    setEditingDetails(false);
    await load();
  });
  const donate = () => wrap(async () => {
    if (!donateAmount || donateAmount < 100) throw new Error("الحد الأدنى 100 عملة");
    if (donateAmount > 10000) throw new Error("الحد الأقصى للتبرع 10,000 عملة في اليوم");
    const { error } = await supabase.rpc("donate_to_tribe" as never, { _tribe_id: tribeId, _amount: donateAmount } as never);
    if (error) {
      const msg = String(error.message || "");
      if (msg.includes("daily cap exceeded")) {
        throw new Error("تجاوزت حد التبرع اليومي (10,000 عملة). جرّب غداً.");
      }
      throw error;
    }
    await load();
  });

  const goal = info ? levelGoal(info.level) : 1;
  const progress = info ? Math.min(100, Math.floor((info.treasure_coins / goal) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" dir="rtl">
      <div className="w-full max-w-md max-h-[90vh] bg-stone-950 border-2 border-amber-700 rounded-2xl flex flex-col overflow-hidden">
        {info && (() => {
          const tier = getTribeBanner(info.level);
          return (
            <div className="relative w-full h-24 bg-gradient-to-b from-stone-900 to-stone-950 border-b border-amber-700/60 flex items-center justify-center overflow-hidden">
              <img src={tier.url} alt={`بنر مستوى ${info.level}`} loading="lazy" className="absolute inset-0 w-full h-full object-contain drop-shadow-[0_0_18px_rgba(251,191,36,0.35)]" />
              <div className="relative z-10 flex flex-col items-center">
                <div className="relative w-14 h-14">
                  <img src={tier.emblemUrl} alt="" loading="lazy" className="absolute inset-[14%] w-[72%] h-[72%] object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]" />
                  <img src={tier.frameUrl} alt="" aria-hidden loading="lazy" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
                </div>
                <div className="font-extrabold text-amber-100 text-sm drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">{info.name}</div>
                <div className="text-[10px] text-amber-200/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">⭐ {info.level} · {tier.name}</div>
              </div>
              <button onClick={onClose} className="absolute top-2 left-2 z-20 px-2 py-0.5 rounded bg-black/60 text-amber-200 text-sm">✕</button>
            </div>
          );
        })()}
        {!info && (
          <div className="flex items-center gap-2 p-3 border-b border-amber-700/60 bg-stone-900">
            <div className="text-2xl">🏴‍☠️</div>
            <div className="flex-1 font-extrabold text-amber-300 truncate">...</div>
            <button onClick={onClose} className="px-3 py-1 rounded bg-stone-800 text-amber-200">✕</button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {info && (
            <div className="rounded-xl border border-amber-700/40 bg-gradient-to-b from-stone-900 to-stone-950 p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="text-xs text-amber-300">المستوى</div>
                <div className="font-extrabold text-amber-200">⭐ {info.level}</div>
                <div className="flex-1" />
                <div className="text-[10px] text-amber-300/70 inline-flex items-center gap-1">إجمالي التبرعات: {info.total_donations.toLocaleString()} <CoinIcon size={10} /></div>
              </div>
              <div className="h-2 rounded bg-stone-800 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-500 to-yellow-300" style={{ width: `${progress}%` }} />
              </div>
              <div className="text-[10px] text-amber-300/70 mt-1 text-center inline-flex items-center justify-center gap-1 w-full">
                {info.treasure_coins.toLocaleString()} / {goal.toLocaleString()} <CoinIcon size={10} /> للمستوى {info.level + 1}
              </div>
              <div className="text-xs text-amber-200/90 mt-2 whitespace-pre-wrap break-words">
                {info.description || "لا يوجد وصف للقبيلة بعد."}
              </div>
              <div className="mt-2 text-[10px] text-amber-300/80 flex flex-wrap gap-x-3 gap-y-1">
                <span>🎁 شات خاص</span>
                <span>⚔️ إعلان حروب</span>
                <span>💰 خزنة مشتركة</span>
                <span>🏆 ترتيب بالقوة</span>
              </div>
            </div>
          )}

          {/* === Tribe features: achievements / enemy tribes / enemy players === */}
          <TribeFeatures tribeId={tribeId} canManage={isOfficer} />


          {isOfficer && (
            <div className="space-y-2">
              {isOwner && (!editingName ? (
                <button onClick={() => setEditingName(true)} className="w-full py-2 rounded-lg bg-amber-700/40 border border-amber-500/50 text-amber-100 text-xs font-bold">
                  ✏️ تغيير اسم القبيلة (💎 {RENAME_COST_GEMS})
                </button>
              ) : (
                <div className="p-2 rounded-lg bg-stone-900 border border-amber-700/40 space-y-2">
                  <input value={newName} onChange={e => setNewName(e.target.value)} maxLength={40}
                    className="w-full px-2 py-1.5 rounded bg-stone-800 border border-amber-700/40 text-amber-100 text-sm" />
                  <div className="flex gap-2">
                    <button disabled={busy} onClick={saveRename} className="flex-1 py-1.5 rounded bg-amber-600 text-stone-900 font-bold text-xs">حفظ (💎 {RENAME_COST_GEMS})</button>
                    <button onClick={() => setEditingName(false)} className="px-3 py-1.5 rounded bg-stone-800 text-amber-200 text-xs">إلغاء</button>
                  </div>
                </div>
              ))}

              {!editingDetails ? (
                <button onClick={() => setEditingDetails(true)} className="w-full py-2 rounded-lg bg-amber-700/40 border border-amber-500/50 text-amber-100 text-xs font-bold">
                  🎨 تعديل البنر والوصف
                </button>
              ) : (
                <div className="p-2 rounded-lg bg-stone-900 border border-amber-700/40 space-y-2">
                  <div className="text-[10px] text-amber-300">اختر البنر</div>
                  <div className="grid grid-cols-8 gap-1">
                    {EMBLEM_CHOICES.map(em => (
                      <button key={em} onClick={() => setBanner(em)}
                        className={`text-xl py-1 rounded ${banner === em ? "bg-amber-600/60 ring-2 ring-amber-300" : "bg-stone-800"}`}>{em}</button>
                    ))}
                  </div>
                  <textarea value={desc} onChange={e => setDesc(e.target.value.slice(0, 240))} placeholder="وصف القبيلة..."
                    rows={3} className="w-full px-2 py-1.5 rounded bg-stone-800 border border-amber-700/40 text-amber-100 text-sm resize-none" />
                  <div className="text-[10px] text-amber-300/60 text-left">{desc.length}/240</div>
                  <div className="flex gap-2">
                    <button disabled={busy} onClick={saveDetails} className="flex-1 py-1.5 rounded bg-amber-600 text-stone-900 font-bold text-xs">حفظ</button>
                    <button onClick={() => setEditingDetails(false)} className="px-3 py-1.5 rounded bg-stone-800 text-amber-200 text-xs">إلغاء</button>
                  </div>
                </div>
              )}

              {/* Join mode toggle */}
              <div className="p-2 rounded-lg bg-stone-900 border border-sky-700/40 space-y-2">
                <div className="text-xs font-bold text-sky-300">🚪 طريقة الانضمام</div>
                <div className="flex gap-2">
                  {(["open","request"] as const).map(m => (
                    <button key={m} disabled={busy}
                      onClick={() => wrap(async () => {
                        const { error } = await supabase.rpc("set_tribe_join_mode" as never, { _tribe_id: tribeId, _mode: m } as never);
                        if (error) throw error;
                        await load();
                      })}
                      className={`flex-1 py-1.5 rounded text-[11px] font-bold border-2 ${info?.join_mode === m ? "bg-sky-600 border-sky-300 text-white" : "bg-stone-800 border-sky-700/40 text-sky-200"}`}>
                      {m === "open" ? "🌍 الجميع ينضم مباشرة" : "📩 بطلب انضمام"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Delete tribe — owner only */}
              {isOwner && (
                <button disabled={busy}
                  onClick={async () => {
                    const ok = await confirmDialog({ title: "حذف القبيلة", message: "متأكد تبي تحذف القبيلة نهائياً؟ كل الأعضاء راح يطلعون والخزنة راح تروح.", confirmText: "احذف نهائياً", danger: true });
                    if (!ok) return;
                    wrap(async () => {
                      const { error } = await supabase.from("tribes").delete().eq("id", tribeId);
                      if (error) throw error;
                      onClose();
                      window.location.reload();
                    });
                  }}
                  className="w-full py-2 rounded-lg bg-red-900 border-2 border-red-500 text-white font-bold text-sm">
                  🗑️ حذف القبيلة نهائياً
                </button>
              )}
            </div>
          )}

          <div className="p-2 rounded-lg bg-stone-900 border border-emerald-700/40 space-y-2">
            <div className="text-xs font-bold text-emerald-300">💰 تبرع للقبيلة (يرفع مستواها)</div>
            <div className="flex gap-1">
              {[500, 1000, 5000, 10000].map(v => (
                <button key={v} onClick={() => setDonateAmount(v)}
                  className={`flex-1 py-1 rounded text-[11px] font-bold ${donateAmount === v ? "bg-emerald-600 text-white" : "bg-stone-800 text-emerald-200"}`}>
                  {v.toLocaleString()}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input type="number" min={100} value={donateAmount} onChange={e => setDonateAmount(Math.max(0, parseInt(e.target.value) || 0))}
                className="flex-1 px-2 py-1.5 rounded bg-stone-800 border border-emerald-700/40 text-emerald-100 text-sm" />
              <button disabled={busy} onClick={donate} className="px-4 py-1.5 rounded bg-emerald-600 text-white font-bold text-xs">تبرع</button>
            </div>
          </div>

          {err && <div className="text-xs text-red-400 text-center">{err}</div>}

          {isOfficer && requests.length > 0 && (
            <div>
              <div className="text-xs font-bold text-amber-300 mb-2">📩 طلبات الانضمام ({requests.length})</div>
              <div className="space-y-1">
                {requests.map(r => (
                  <div key={r.id} className="flex items-center gap-2 p-2 rounded-lg bg-stone-900 border border-amber-700/30">
                    <div className="w-8 h-8 rounded-full bg-sky-700 flex items-center justify-center">{r.avatar_emoji}</div>
                    <div className="flex-1 text-sm">
                      <div className="font-bold">{r.display_name}</div>
                      <div className="text-[10px] text-amber-300/70">المستوى {r.level}</div>
                    </div>
                    <button disabled={busy} onClick={() => acceptReq(r)} className="px-2 py-1 rounded bg-emerald-600 text-xs font-bold">قبول</button>
                    <button disabled={busy} onClick={() => rejectReq(r)} className="px-2 py-1 rounded bg-red-700 text-xs font-bold">رفض</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="text-xs font-bold text-amber-300 mb-2">👥 الأعضاء ({members.length})</div>
            <div className="space-y-1">
              {members.map(m => (
                <div key={m.user_id} className="flex items-center gap-2 p-2 rounded-lg bg-stone-900 border border-amber-700/30">
                  <div className="w-8 h-8 rounded-full bg-sky-700 flex items-center justify-center">{m.avatar_emoji}</div>
                  <div className="flex-1 text-sm">
                    <div className="font-bold">{m.display_name} {m.role === "owner" ? "👑" : m.role === "moderator" ? "🛡️" : ""}</div>
                    <div className="text-[10px] text-amber-300/70">المستوى {m.level} • {m.role === "owner" ? "المالك" : m.role === "moderator" ? "مشرف" : "عضو"} • 🤝 تبرّع: {m.donation_coins.toLocaleString()} 🪙</div>
                  </div>
                  {isOwner && m.user_id !== userId && m.role !== "owner" && (
                    <>
                      <button disabled={busy} onClick={() => promote(m)} className="px-2 py-1 rounded bg-sky-600 text-xs font-bold">
                        {m.role === "moderator" ? "تنزيل" : "مشرف"}
                      </button>
                      <button disabled={busy} onClick={() => kick(m)} className="px-2 py-1 rounded bg-red-700 text-xs font-bold">طرد</button>
                    </>
                  )}
                  {isOfficer && !isOwner && m.user_id !== userId && m.role === "member" && (
                    <button disabled={busy} onClick={() => kick(m)} className="px-2 py-1 rounded bg-red-700 text-xs font-bold">طرد</button>
                  )}
                </div>
              ))}
            </div>
          </div>
          {!isOwner && (
            <button onClick={leaveTribe} disabled={busy} className="w-full py-2 rounded-lg bg-red-800 text-white font-bold text-sm">مغادرة القبيلة</button>
          )}
        </div>
      </div>
    </div>
  );
}


// ===================== War Modal =====================
function WarModal({ sender, senderTribe, target, onClose }: { sender: string; senderTribe: string | null; target: Prof; onClose: () => void }) {
  const [msg, setMsg] = useState("استعد للمعركه!");
  const [busy, setBusy] = useState(false);

  const declare = async () => {
    setBusy(true);
    const { data: tp } = await supabase.from("profiles").select("tribe_id").eq("id", target.id).maybeSingle();
    await supabase.from("tribe_wars").insert({
      declarer_id: sender, target_id: target.id,
      declarer_tribe_id: senderTribe, target_tribe_id: (tp as any)?.tribe_id || null,
      message: msg.slice(0, 200),
    });
    await supabase.from("messages").insert({
      sender_id: sender, recipient_id: target.id, channel: "dm",
      body: `⚔️ إعلان حرب: ${msg}`,
    });
    setBusy(false); onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3" dir="rtl">
      <div className="w-full max-w-sm bg-stone-950 border-2 border-red-700 rounded-2xl p-4 space-y-3">
        <div className="font-extrabold text-red-400">⚔️ إعلان حرب على {target.display_name}</div>
        <div className="text-xs text-red-200/70">سيتم إرسال إشعار للطرف الآخر وتسجيل الحرب.</div>
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={200} rows={3}
          className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-red-700/40 text-sm text-white" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-stone-800 text-white font-bold text-sm">إلغاء</button>
          <button onClick={declare} disabled={busy} className="flex-1 py-2 rounded-lg bg-red-600 text-white font-bold text-sm disabled:opacity-50">
            {busy ? "..." : "أعلن الحرب"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===================== No Tribe Panel (join/create) =====================
type TribeRow = { id: string; name: string; emblem: string; members: number; power: number; join_mode: string; };

function NoTribePanel({ userId }: { userId: string }) {
  const [name, setName] = useState("");
  const [emblem, setEmblem] = useState("⚔️");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tribes, setTribes] = useState<TribeRow[]>([]);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"join" | "create">("join");
  const [myRequests, setMyRequests] = useState<Set<string>>(new Set());

  const loadTribes = async () => {
    const { data: ts } = await supabase.from("tribes").select("id,name,emblem,join_mode").limit(200);
    if (!ts) { setTribes([]); return; }
    const ids = ts.map((t) => t.id);
    if (ids.length === 0) { setTribes([]); return; }
    const { data: mems } = await supabase.from("tribe_members").select("tribe_id,user_id").in("tribe_id", ids);
    const memberByTribe = new Map<string, string[]>();
    (mems || []).forEach((m: any) => {
      const arr = memberByTribe.get(m.tribe_id) || [];
      arr.push(m.user_id);
      memberByTribe.set(m.tribe_id, arr);
    });
    const allUserIds = Array.from(new Set((mems || []).map((m: any) => m.user_id)));
    const levelMap = new Map<string, number>();
    if (allUserIds.length > 0) {
      const { data: profs } = await supabase.from("profiles").select("id,level,xp").in("id", allUserIds);
      (profs || []).forEach((p: any) => {
        levelMap.set(p.id, (p.level || 1) * 100 + Math.floor((p.xp || 0) / 10));
      });
    }
    const rows: TribeRow[] = ts.map((t: any) => {
      const uids = memberByTribe.get(t.id) || [];
      const power = uids.reduce((sum, uid) => sum + (levelMap.get(uid) || 0), 0);
      return { id: t.id, name: t.name, emblem: t.emblem, members: uids.length, power, join_mode: t.join_mode || "request" };
    }).sort((a, b) => (b.power + b.members * 50) - (a.power + a.members * 50));
    setTribes(rows);

    const { data: reqs } = await supabase.from("tribe_join_requests").select("tribe_id").eq("user_id", userId).eq("status", "pending");
    setMyRequests(new Set((reqs || []).map((r: any) => r.tribe_id)));
  };

  useEffect(() => { loadTribes(); }, []);

  const filtered = q.trim() ? tribes.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase())) : tribes;

  const createTribe = async () => {
    if (!userId || !name.trim()) return;
    setBusy(true); setErr(null);
    const { data: tribe, error: e1 } = await supabase.from("tribes").insert({ owner_id: userId, name: name.trim().slice(0, 40), emblem }).select("id").single();
    if (e1 || !tribe) { setErr(e1?.message || "تعذر إنشاء القبيلة"); setBusy(false); return; }
    const { error: e2 } = await supabase.from("tribe_members").insert({ tribe_id: tribe.id, user_id: userId, role: "owner" });
    if (e2) { setErr(e2.message); setBusy(false); return; }
    const { error: e3 } = await setMyTribe(tribe.id);
    if (e3) { setErr(e3.message); setBusy(false); return; }
    // Clear any pending join requests so other tribes can't pull the owner in later
    await supabase.from("tribe_join_requests").delete().eq("user_id", userId).eq("status", "pending");
    setBusy(false);
    window.location.reload();
  };

  const requestJoin = async (tribeId: string) => {
    if (!userId) return;
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("request_join_tribe" as never, { _tribe_id: tribeId } as never);
    const status = (data as any)?.status;
    if (error) setErr(error.message);
    else if (status === "already_in_tribe") setErr("أنت موجود في قبيلة بالفعل");
    else if (status === "open_tribe") setErr("هذه القبيلة مفتوحة — اضغط انضمام");
    setBusy(false); loadTribes();
  };


  const joinOpen = async (tribeId: string) => {
    if (!userId) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("join_tribe_open" as never, { _tribe_id: tribeId } as never);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    window.location.reload();
  };

  return (
    <div className="flex-1 overflow-y-auto p-3">
      <div className="flex gap-1 mb-3">
        <button onClick={() => setMode("join")}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold border ${mode === "join" ? "bg-amber-500 text-amber-950 border-amber-200" : "bg-stone-900 text-amber-200 border-amber-700/40"}`}>
          انضم لقبيلة
        </button>
        <button onClick={() => setMode("create")}
          className={`flex-1 py-1.5 rounded-lg text-xs font-bold border ${mode === "create" ? "bg-amber-500 text-amber-950 border-amber-200" : "bg-stone-900 text-amber-200 border-amber-700/40"}`}>
          أنشئ قبيلة
        </button>
      </div>

      {mode === "create" ? (
        <div className="space-y-2">
          <div className="text-xs text-amber-200/70">اختر شعار واسم القبيلة:</div>
          <div className="flex gap-1 flex-wrap">
            {["⚔️", "🏴‍☠️", "⚓", "🐉", "🦈", "👑", "🛡️", "🔱"].map(e => (
              <button key={e} onClick={() => setEmblem(e)}
                className={`w-10 h-10 rounded-lg text-xl border-2 ${emblem === e ? "bg-amber-500 border-amber-200" : "bg-stone-900 border-amber-700/40"}`}>{e}</button>
            ))}
          </div>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="اسم القبيلة..."
            className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-amber-700/40 text-sm text-white" />
          <button onClick={createTribe} disabled={busy || !name.trim()}
            className="w-full py-2 rounded-lg bg-amber-500 text-amber-950 font-bold text-sm disabled:opacity-50">
            {busy ? "جاري الإنشاء…" : "إنشاء القبيلة"}
          </button>
          {err && <div className="text-xs text-red-400">{err}</div>}
        </div>
      ) : (
        <div className="space-y-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث باسم القبيلة..."
            className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-amber-700/40 text-sm text-white" />
          {filtered.length === 0 && <div className="text-center text-amber-100/40 text-sm py-4">لا توجد قبائل</div>}
          {filtered.map(t => {
            const pending = myRequests.has(t.id);
            const isOpen = t.join_mode === "open";
            return (
              <div key={t.id} className="flex items-center gap-2 p-2 rounded-lg bg-stone-900/70 border border-amber-700/40">
                <div className="w-10 h-10 rounded-full bg-sky-800 flex items-center justify-center text-lg">{t.emblem}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-amber-100 truncate flex items-center gap-1">
                    {t.name}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${isOpen ? "bg-emerald-700 text-emerald-100" : "bg-sky-800 text-sky-200"}`}>
                      {isOpen ? "🌍 مفتوحة" : "📩 بطلب"}
                    </span>
                  </div>
                  <div className="text-[10px] text-amber-300/70">👥 {t.members} • ⚡ {t.power.toLocaleString()}</div>
                </div>
                {isOpen ? (
                  <button onClick={() => joinOpen(t.id)} disabled={busy}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500 text-emerald-950 font-bold text-xs disabled:opacity-50">
                    🚀 انضمام
                  </button>
                ) : (
                  <button onClick={() => requestJoin(t.id)} disabled={busy || pending}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 text-amber-950 font-bold text-xs disabled:opacity-50">
                    {pending ? "بانتظار القبول" : "طلب انضمام"}
                  </button>
                )}
              </div>
            );
          })}
          {err && <div className="text-xs text-red-400">{err}</div>}
        </div>
      )}
    </div>
  );
}

// ===================== Chat Composer with Voice Recorder =====================
function ChatComposer({ restoreDraftRef, onSend, sending, disabled, userId, onAudioSent, channel, tribeId, dmWith, replyTo, onClearReply }: {
  restoreDraftRef: React.MutableRefObject<(body: string) => void>;
  onSend: (override?: string) => void; sending?: boolean; disabled: boolean; userId: string;
  onAudioSent: (m: Msg) => void; channel: Channel; tribeId: string | null; dmWith: string | null;
  replyTo?: { id: string; body: string; name: string } | null; onClearReply?: () => void;
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    restoreDraftRef.current = (body: string) => setText(t => t ? t : body);
    return () => { restoreDraftRef.current = () => {}; };
  }, [restoreDraftRef]);
  const submit = () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    onSend(body);
  };
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef<boolean>(false);
  const MAX_REC_SECONDS = 30;

  const stopTimer = () => { if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; } };

  const startRec = async () => {
    if (disabled || recording || uploading) return;
    try {
      // High-quality mic capture: 48kHz mono with noise suppression
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
        } as MediaTrackConstraints,
      });
      // Prefer Opus in WebM for best quality/size ratio
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : MediaRecorder.isTypeSupported("audio/mp4;codecs=mp4a.40.2")
            ? "audio/mp4;codecs=mp4a.40.2"
            : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128000 });
      chunksRef.current = [];
      cancelledRef.current = false;
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        // If user cancelled, drop the recording entirely — never upload or send
        if (cancelledRef.current) {
          chunksRef.current = [];
          return;
        }
        const duration = Date.now() - startedAtRef.current;
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        if (blob.size < 500) return;
        setUploading(true);
        const ext = mime.includes("webm") ? "webm" : "m4a";
        const path = `${userId}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("chat-audio").upload(path, blob, { contentType: mime, upsert: false });
        if (upErr) { setUploading(false); alert("فشل رفع التسجيل: " + upErr.message); return; }
        const { data: pub } = supabase.storage.from("chat-audio").getPublicUrl(path);
        const row: any = { sender_id: userId, body: "", channel, audio_url: pub.publicUrl, audio_duration_ms: Math.round(Math.min(duration, MAX_REC_SECONDS * 1000)) };
        if (channel === "tribe") row.tribe_id = tribeId;
        if (channel === "dm") row.recipient_id = dmWith;
        const { data, error } = await supabase.from("messages").insert(row).select("*").maybeSingle();
        setUploading(false);
        if (error) { alert("تعذر الإرسال: " + error.message); return; }
        if (data) onAudioSent(data as Msg);
      };
      recRef.current = rec;
      startedAtRef.current = Date.now();
      setElapsed(0);
      timerRef.current = window.setInterval(() => {
        const sec = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setElapsed(sec);
        // Auto-stop & send at the max recording length
        if (sec >= MAX_REC_SECONDS) {
          stopRec(false);
        }
      }, 250);
      // Collect data every 250ms for smoother chunking
      rec.start(250);
      setRecording(true);
    } catch (e: any) {
      alert("لا يمكن الوصول إلى الميكروفون: " + (e?.message || ""));
    }
  };

  const stopRec = (cancel = false) => {
    if (!recording || !recRef.current) return;
    stopTimer();
    setRecording(false);
    cancelledRef.current = cancel;
    if (cancel) chunksRef.current = [];
    try { recRef.current.stop(); } catch {}
  };

  useEffect(() => () => stopTimer(), []);

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="absolute left-2 right-2 z-40 flex flex-col gap-1.5" style={{ bottom: "calc(76px + var(--keyboard-inset, 0px) + env(safe-area-inset-bottom, 0px))" }}>
      {replyTo && (
        <div className="flex items-stretch gap-2 rounded-xl border-r-4 border-amber-400 bg-stone-900/95 px-2 py-1.5 shadow-lg">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-black text-amber-300 truncate">↩︎ رد على {replyTo.name}</div>
            <div className="text-xs text-amber-100/80 truncate">{replyTo.body}</div>
          </div>
          <button type="button" onClick={onClearReply} className="px-2 text-amber-300 hover:text-white font-black">✕</button>
        </div>
      )}
      <div className="flex gap-2">
      {recording ? (
        <>
          <div className={`flex-1 px-3 py-2 rounded-lg border text-sm text-white flex items-center gap-2 ${elapsed >= MAX_REC_SECONDS - 5 ? "bg-red-900/80 border-red-400/80" : "bg-red-900/60 border-red-500/60"}`}>
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            🎤 جاري التسجيل... {elapsed}ث / {MAX_REC_SECONDS}ث
          </div>
          <button type="button" onClick={() => stopRec(true)} className="px-3 rounded-lg bg-stone-700 text-white font-bold">إلغاء</button>
          <button type="button" onClick={() => stopRec(false)} className="px-4 rounded-lg bg-emerald-500 text-emerald-950 font-bold">إرسال</button>
        </>
      ) : (
        <>
          <QuickReplies onSend={(t) => onSend(t)} disabled={disabled || uploading} />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            disabled={disabled || uploading}
            placeholder={uploading ? "جاري رفع التسجيل..." : "اكتب رساله..."}
            className="flex-1 px-3 py-2 rounded-lg bg-stone-900 border border-amber-700/40 text-sm text-white disabled:opacity-50"
          />
          <button type="button" onClick={startRec} disabled={disabled || uploading}
            className="px-3 rounded-lg bg-red-600 text-white font-bold disabled:opacity-50" title="تسجيل صوتي">🎤</button>
          <button type="submit" disabled={disabled || uploading || sending || !text.trim()} className="px-4 rounded-lg bg-amber-500 text-amber-950 font-bold disabled:opacity-50">{sending ? "..." : "إرسال"}</button>
        </>
      )}
      </div>
    </form>
  );
}

function SwipeableRow({ children }: { children: React.ReactNode; onReply?: () => void }) {
  // Touch gesture disabled per user request — messages should not move on touch.
  return <div className="relative">{children}</div>;
}

// ===================== Voice Message Player =====================
// Custom player: reliable across iOS Safari & Android Chrome (webm/opus + mp4/aac),
// uses playsInline, shows explicit error, and pauses any other playing voice message.
let __activeVoiceAudio: HTMLAudioElement | null = null;

function VoiceMessage({ src, durationMs, mine }: { src: string; durationMs: number; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0); // 0..1
  const [current, setCurrent] = useState(0);
  const [dur, setDur] = useState(durationMs > 0 ? durationMs / 1000 : 0);

  // Guess MIME type from URL extension to help Safari pick the right decoder
  const inferredType = (() => {
    const s = src.toLowerCase();
    if (s.includes(".webm")) return "audio/webm";
    if (s.includes(".m4a") || s.includes(".mp4")) return "audio/mp4";
    if (s.includes(".mp3")) return "audio/mpeg";
    if (s.includes(".ogg")) return "audio/ogg";
    return undefined;
  })();

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      setCurrent(a.currentTime);
      if (a.duration && isFinite(a.duration)) setProgress(a.currentTime / a.duration);
    };
    const onMeta = () => { if (a.duration && isFinite(a.duration)) setDur(a.duration); };
    const onEnd = () => { setPlaying(false); setProgress(0); setCurrent(0); try { a.currentTime = 0; } catch {} };
    const onErr = () => { setLoading(false); setPlaying(false); setError("تعذر تشغيل التسجيل"); };
    const onPlay = () => { setPlaying(true); setLoading(false); };
    const onPause = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnd);
    a.addEventListener("error", onErr);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("error", onErr);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    };
  }, []);

  const toggle = async () => {
    const a = audioRef.current;
    if (!a) return;
    setError(null);
    if (playing) { a.pause(); return; }
    // Pause any other playing voice message first
    if (__activeVoiceAudio && __activeVoiceAudio !== a) {
      try { __activeVoiceAudio.pause(); } catch {}
    }
    __activeVoiceAudio = a;
    setLoading(true);
    try {
      // Ensure it's loaded (Safari sometimes needs an explicit load after user gesture)
      if (a.readyState < 2) { try { a.load(); } catch {} }
      await a.play();
    } catch (e: any) {
      setLoading(false);
      setError(e?.message ? `تعذر التشغيل: ${e.message}` : "تعذر تشغيل التسجيل");
    }
  };

  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const totalLabel = fmt(playing || current > 0 ? current : (dur || 0));

  return (
    <div className={`flex items-center gap-2 rounded-lg px-2 py-1.5 min-w-[180px] max-w-[220px] ${mine ? "bg-amber-950/30" : "bg-stone-900/40"}`}>
      <audio ref={audioRef} src={src} preload="auto" playsInline />

      <button
        type="button"
        onClick={toggle}
        className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-lg active:scale-95 ${playing ? "bg-red-600" : "bg-emerald-600"}`}
        aria-label={playing ? "إيقاف" : "تشغيل"}
      >
        {loading ? "…" : playing ? "⏸" : "▶"}
      </button>
      <div className="flex-1 min-w-0">
        <div className="h-1.5 rounded-full bg-stone-700/70 overflow-hidden">
          <div className="h-full bg-amber-400" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-[10px] text-stone-300">🎤</span>
          <span className="text-[10px] text-stone-300 tabular-nums">{totalLabel}</span>
        </div>
        {error && <div className="text-[10px] text-red-300 mt-0.5 truncate">{error}</div>}
      </div>
    </div>
  );
}

