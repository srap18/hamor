import { useEffect, useRef, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { createJungle } from "@/lib/jungle";
import { transformVoice } from "@/lib/voicechanger.functions";
import { deductGemsForVoiceChange } from "@/lib/economy";
import { frameById } from "@/lib/frames";


type Room = { id: string; name: string; topic: string; created_by: string; max_users: number; created_at: string };
type Participant = { id: string; room_id: string; user_id: string; is_muted: boolean; joined_at: string };
type Prof = { id: string; display_name: string; avatar_emoji: string; avatar_url?: string | null; avatar_frame?: string | null; name_frame?: string | null; bubble_frame?: string | null };

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

function Avatar({ p, size = 48, speaking, muted }: { p?: Prof | null; size?: number; speaking?: boolean; muted?: boolean }) {
  const style = { width: size, height: size };
  const ring = speaking ? "ring-4 ring-emerald-400 animate-pulse" : "ring-2 ring-amber-500/40";
  const frame = frameById(p?.avatar_frame);
  return (
    <div style={style} className="relative shrink-0 flex items-center justify-center">
      {p?.avatar_url ? (
        <img src={p.avatar_url} alt="" className={`w-[68%] h-[68%] rounded-full object-cover bg-sky-700 shadow-[0_0_10px_rgba(252,191,73,0.5)] ${ring}`} />
      ) : (
        <div className={`w-[68%] h-[68%] rounded-full bg-sky-700 flex items-center justify-center text-2xl shadow-[0_0_10px_rgba(252,191,73,0.5)] ${ring}`}>
          {p?.avatar_emoji || "👤"}
        </div>
      )}
      {frame?.imageUrl && <img src={frame.imageUrl} alt="" className={`absolute inset-0 w-full h-full object-contain pointer-events-none ${frame.animClass ?? ""}`} style={{ filter: "drop-shadow(0 0 8px rgba(252,191,73,0.7)) saturate(1.35) contrast(1.1)" }} />}
      {muted && (
        <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-red-600 border-2 border-stone-950 flex items-center justify-center text-xs">🔇</div>
      )}
    </div>
  );
}

export function VoiceRooms({ userId }: { userId: string }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);

  const loadRooms = useCallback(async () => {
    const { data: rs } = await supabase.from("voice_rooms").select("*").eq("is_active", true).order("created_at", { ascending: false });
    setRooms((rs || []) as Room[]);
    const { data: ps } = await supabase.from("voice_room_participants").select("room_id");
    const c: Record<string, number> = {};
    (ps || []).forEach((p: any) => { c[p.room_id] = (c[p.room_id] || 0) + 1; });
    setCounts(c);
  }, []);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  useEffect(() => {
    const ch = supabase.channel("voice-rooms-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "voice_rooms" }, () => loadRooms())
      .on("postgres_changes", { event: "*", schema: "public", table: "voice_room_participants" }, () => loadRooms())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadRooms]);

  if (activeRoom) {
    return <VoiceRoomView room={activeRoom} userId={userId} onLeave={() => { setActiveRoom(null); loadRooms(); }} />;
  }

  return (
    <div className="flex-1 overflow-y-auto p-3">
      <button onClick={() => setShowCreate(true)} className="w-full mb-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold text-sm border-2 border-emerald-300">
        ➕ إنشاء غرفة صوتية
      </button>
      {rooms.length === 0 && (
        <div className="text-center text-amber-100/50 text-sm py-8">لا توجد غرف نشطة — كن أول من ينشئ غرفة!</div>
      )}
      <div className="space-y-2">
        {rooms.map(r => (
          <button key={r.id} onClick={() => setActiveRoom(r)}
            className="w-full text-right p-3 rounded-xl bg-stone-900/80 hover:bg-stone-800 border-2 border-amber-700/40 hover:border-amber-500">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-amber-700 flex items-center justify-center text-xl">🎙️</div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-amber-200 text-sm truncate">{r.name}</div>
                {r.topic && <div className="text-xs text-amber-100/60 truncate">{r.topic}</div>}
              </div>
              <div className="text-xs text-emerald-300 font-bold">{counts[r.id] || 0}/{r.max_users} 🟢</div>
            </div>
          </button>
        ))}
      </div>
      {showCreate && <CreateRoomModal userId={userId} onClose={() => setShowCreate(false)} onCreated={(r) => { setShowCreate(false); setActiveRoom(r); }} />}
    </div>
  );
}

function CreateRoomModal({ userId, onClose, onCreated }: { userId: string; onClose: () => void; onCreated: (r: Room) => void }) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const { data, error } = await supabase.from("voice_rooms").insert({ name: name.trim().slice(0, 60), topic: topic.trim().slice(0, 120), created_by: userId, max_users: 8 }).select().single();
    setBusy(false);
    if (error || !data) { alert("فشل إنشاء الغرفة"); return; }
    onCreated(data as Room);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-stone-900 border-2 border-amber-500 rounded-2xl p-4 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="text-lg font-bold text-amber-300 mb-3">🎙️ غرفة جديدة</div>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="اسم الغرفة" className="w-full mb-2 px-3 py-2 rounded-lg bg-stone-950 border border-amber-700 text-white text-sm" />
        <input value={topic} onChange={e => setTopic(e.target.value)} maxLength={120} placeholder="الموضوع (اختياري)" className="w-full mb-3 px-3 py-2 rounded-lg bg-stone-950 border border-amber-700 text-white text-sm" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-stone-700 text-sm font-bold">إلغاء</button>
          <button onClick={create} disabled={!name.trim() || busy} className="flex-1 py-2 rounded-lg bg-emerald-600 text-sm font-bold disabled:opacity-50">{busy ? "..." : "إنشاء"}</button>
        </div>
      </div>
    </div>
  );
}

type PeerEntry = { pc: RTCPeerConnection; stream: MediaStream | null };

type ChatMsg = { id: string; user_id: string; text?: string; voice_url?: string; preset?: string; at: number };
type VoiceFx = "none" | "girl" | "woman" | "man" | "kid" | "monster" | "robot" | "echo";

const FX_LABELS: Record<VoiceFx, string> = {
  none: "🎤 طبيعي",
  girl: "👧 بنت",
  woman: "👩 امرأة",
  man: "🧔 رجل غليظ",
  kid: "🧒 طفل",
  monster: "👹 وحش",
  robot: "🤖 روبوت",
  echo: "🌀 صدى",
};

// Recorder voice presets (تحويل احترافي عبر ElevenLabs)
const VOICE_PRESETS: Array<{ id: string; label: string; group: "natural" | "fx" }> = [
  { id: "girl_nat",  label: "👧 بنت — طبيعي",   group: "natural" },
  { id: "woman_nat", label: "👩 امرأة — طبيعي", group: "natural" },
  { id: "laura_nat", label: "💁 لورا — طبيعي",  group: "natural" },
  { id: "man_nat",   label: "🧔 رجل — طبيعي",   group: "natural" },
  { id: "guy_nat",   label: "👨 شاب — طبيعي",   group: "natural" },
  { id: "brian_nat", label: "🎙️ بريان — طبيعي", group: "natural" },
  { id: "girl",      label: "👧 بنت — مرح",      group: "fx" },
  { id: "woman",     label: "👩 امرأة — مرح",   group: "fx" },
  { id: "man",       label: "🧔 رجل غليظ",      group: "fx" },
  { id: "kid",       label: "🧒 طفل",            group: "fx" },
  { id: "santa",     label: "🎅 بابا نويل",      group: "fx" },
  { id: "elf",       label: "🧝 قزم",            group: "fx" },
];
const VOICE_PRESET_LABEL: Record<string, string> = Object.fromEntries(VOICE_PRESETS.map(p => [p.id, p.label]));

// Pitch offsets for Jungle (-1..1)
const FX_PITCH: Partial<Record<VoiceFx, number>> = {
  girl: 0.55,
  woman: 0.35,
  man: -0.40,
  kid: 0.75,
  monster: -0.75,
};




function buildProcessedStream(raw: MediaStream, fx: VoiceFx): { stream: MediaStream; ctx: AudioContext; cleanup: () => void } {
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(raw);
  const dest = ctx.createMediaStreamDestination();
  const toClose: Array<() => void> = [];

  // Master polish chain: compressor -> makeup gain -> dest (louder + cleaner, no clipping)
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.knee.value = 30;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  const makeup = ctx.createGain();
  makeup.gain.value = 2.2; // ~+7dB
  comp.connect(makeup); makeup.connect(dest);
  const out: AudioNode = comp;

  const pitch = FX_PITCH[fx];
  if (pitch !== undefined) {
    const jungle = createJungle(ctx);
    jungle.setPitchOffset(pitch);
    src.connect(jungle.input);
    if (pitch > 0) {
      const shelf = ctx.createBiquadFilter();
      shelf.type = "highshelf";
      shelf.frequency.value = 2000;
      shelf.gain.value = 4 + pitch * 4;
      const lowcut = ctx.createBiquadFilter();
      lowcut.type = "highpass";
      lowcut.frequency.value = 120 + pitch * 80;
      const presence = ctx.createBiquadFilter();
      presence.type = "peaking";
      presence.frequency.value = 3500;
      presence.Q.value = 1.1;
      presence.gain.value = 3;
      jungle.output.connect(lowcut); lowcut.connect(shelf); shelf.connect(presence); presence.connect(out);
    } else {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowshelf";
      lp.frequency.value = 400;
      lp.gain.value = 3;
      jungle.output.connect(lp); lp.connect(out);
    }
    toClose.push(() => jungle.destroy());
  } else if (fx === "robot") {
    const osc = ctx.createOscillator(); osc.frequency.value = 60;
    const modGain = ctx.createGain(); modGain.gain.value = 0;
    osc.connect(modGain.gain); src.connect(modGain); osc.start();
    toClose.push(() => { try { osc.stop(); } catch {} });
    const boost = ctx.createGain(); boost.gain.value = 1.4;
    modGain.connect(boost); boost.connect(out);
  } else if (fx === "echo") {
    const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.25;
    const fb = ctx.createGain(); fb.gain.value = 0.45;
    src.connect(out);
    src.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(out);
  } else {
    // Clean voice: rumble cut + presence lift
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 90;
    const presence = ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 3000;
    presence.Q.value = 1.0;
    presence.gain.value = 2.5;
    src.connect(hp); hp.connect(presence); presence.connect(out);
  }

  return {
    stream: dest.stream,
    ctx,
    cleanup: () => {
      toClose.forEach(f => { try { f(); } catch {} });
      try { ctx.close(); } catch {}
    },
  };
}


function VoiceRoomView({ room, userId, onLeave }: { room: Room; userId: string; onLeave: () => void }) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [profs, setProfs] = useState<Map<string, Prof>>(new Map());
  const [muted, setMuted] = useState(false);
  const [speakingPeers, setSpeakingPeers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [showChat, setShowChat] = useState(true);
  const [fx, setFx] = useState<VoiceFx>("none");
  const [showFx, setShowFx] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [transforming, setTransforming] = useState(false);
  const [voicePreset, setVoicePreset] = useState<string>("girl_nat");
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const [gems, setGems] = useState(0);
  const [voiceFeaturesUnlocked, setVoiceFeaturesUnlocked] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null); // raw mic
  const sentStreamRef = useRef<MediaStream | null>(null);  // processed stream sent to peers
  const fxCleanupRef = useRef<(() => void) | null>(null);
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const analyserTimerRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordStartRef = useRef<number>(0);
  const transformVoiceFn = useServerFn(transformVoice);
  const isOwner = room.created_by === userId;


  // Load participants list
  const reloadParticipants = useCallback(async () => {
    const { data: ps } = await supabase.from("voice_room_participants").select("*").eq("room_id", room.id);
    const list = (ps || []) as Participant[];
    setParticipants(list);
    const ids = Array.from(new Set(list.map(p => p.user_id)));
    if (ids.length) {
      const { data: prs } = await supabase.from("profiles").select("id,display_name,avatar_emoji,avatar_url,avatar_frame,name_frame,bubble_frame").in("id", ids);
      setProfs(new Map((prs || []).map((p: any) => [p.id, p])));
    }
  }, [room.id]);

  // Setup mic + signaling
  useEffect(() => {
    let cancelled = false;
    let analyserCtx: AudioContext | null = null;

    const sendSignal = (to: string, kind: string, payload: any) => {
      channelRef.current?.send({ type: "broadcast", event: "signal", payload: { from: userId, to, kind, payload } });
    };

    const createPeer = async (otherId: string, initiator: boolean) => {
      if (peersRef.current.has(otherId)) return peersRef.current.get(otherId)!;
      const pc = new RTCPeerConnection(ICE_SERVERS);
      const entry: PeerEntry = { pc, stream: null };
      peersRef.current.set(otherId, entry);

      const outgoing = sentStreamRef.current;
      if (outgoing) outgoing.getTracks().forEach(t => pc.addTrack(t, outgoing));

      pc.onicecandidate = (e) => { if (e.candidate) sendSignal(otherId, "ice", e.candidate); };
      pc.ontrack = (e) => {
        const remote = e.streams[0];
        entry.stream = remote;
        let audio = audioElsRef.current.get(otherId);
        if (!audio) {
          audio = document.createElement("audio");
          audio.autoplay = true;
          audio.style.display = "none";
          document.body.appendChild(audio);
          audioElsRef.current.set(otherId, audio);
        }
        audio.srcObject = remote;
        audio.play().catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          // peer dropped
        }
      };

      if (initiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal(otherId, "offer", offer);
      }
      return entry;
    };

    const closePeer = (otherId: string) => {
      const e = peersRef.current.get(otherId);
      if (e) { try { e.pc.close(); } catch {} peersRef.current.delete(otherId); }
      const a = audioElsRef.current.get(otherId);
      if (a) { try { a.srcObject = null; a.remove(); } catch {} audioElsRef.current.delete(otherId); }
    };

    (async () => {
      try {
        let stream: MediaStream | null = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
              sampleRate: 48000,
            } as MediaTrackConstraints,
            video: false,
          });
        } catch (micErr) {
          console.warn("mic denied or unavailable - joining as listener/chat only", micErr);
          stream = null;
        }
        if (cancelled) { stream?.getTracks().forEach(t => t.stop()); return; }
        localStreamRef.current = stream;
        if (stream) {
          const proc = buildProcessedStream(stream, "none");
          sentStreamRef.current = proc.stream;
          fxCleanupRef.current = proc.cleanup;
        }
        if (!stream) setMuted(true);

        // Insert participant row
        await supabase.from("voice_room_participants").upsert({ room_id: room.id, user_id: userId, is_muted: !stream }, { onConflict: "room_id,user_id" });
        await reloadParticipants();

        // Load gems balance
        supabase.from("profiles").select("gems").eq("id", userId).single().then(({ data: p }) => {
          if (p) setGems(p.gems ?? 0);
        });


        // Setup channel with presence + signaling
        const ch = supabase.channel(`voice-room-${room.id}`, { config: { presence: { key: userId }, broadcast: { self: false } } });
        channelRef.current = ch;

        ch.on("presence", { event: "sync" }, () => {
          const state = ch.presenceState() as Record<string, any[]>;
          const others = Object.keys(state).filter(id => id !== userId);
          // Connect to new peers (only one side initiates: lexicographically smaller id)
          others.forEach(otherId => {
            if (!peersRef.current.has(otherId) && userId < otherId) {
              createPeer(otherId, true);
            }
          });
          // Cleanup peers that left
          peersRef.current.forEach((_e, id) => { if (!state[id]) closePeer(id); });
        });

        ch.on("broadcast", { event: "signal" }, async ({ payload }) => {
          if (!payload || payload.to !== userId) return;
          const fromId = payload.from as string;
          const kind = payload.kind as string;
          let entry = peersRef.current.get(fromId);
          if (!entry && kind === "offer") {
            entry = await createPeer(fromId, false);
          }
          if (!entry) return;
          try {
            if (kind === "offer") {
              await entry.pc.setRemoteDescription(new RTCSessionDescription(payload.payload));
              const answer = await entry.pc.createAnswer();
              await entry.pc.setLocalDescription(answer);
              channelRef.current?.send({ type: "broadcast", event: "signal", payload: { from: userId, to: fromId, kind: "answer", payload: answer } });
            } else if (kind === "answer") {
              await entry.pc.setRemoteDescription(new RTCSessionDescription(payload.payload));
            } else if (kind === "ice") {
              await entry.pc.addIceCandidate(new RTCIceCandidate(payload.payload));
            }
          } catch (err) {
            console.error("signal err", err);
          }
        });

        ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "voice_room_messages", filter: `room_id=eq.${room.id}` }, ({ new: row }: any) => {
          if (!row) return;
          const m: ChatMsg = {
            id: row.id,
            user_id: row.user_id,
            text: row.text || undefined,
            voice_url: row.voice_url || undefined,
            preset: row.preset || undefined,
            at: new Date(row.created_at).getTime(),
          };
          if (!m.text && !m.voice_url) return;
          setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev.slice(-199), m]);
        });

        ch.on("postgres_changes", { event: "*", schema: "public", table: "voice_room_participants", filter: `room_id=eq.${room.id}` }, () => reloadParticipants());

        // Load chat history for this room
        supabase.from("voice_room_messages").select("*").eq("room_id", room.id).order("created_at", { ascending: true }).limit(200).then(({ data }) => {
          if (!data) return;
          const hist: ChatMsg[] = data.map((r: any) => ({
            id: r.id, user_id: r.user_id,
            text: r.text || undefined, voice_url: r.voice_url || undefined,
            preset: r.preset || undefined, at: new Date(r.created_at).getTime(),
          }));
          setMessages(hist);
          // Load profiles for message authors
          const ids = Array.from(new Set(hist.map(h => h.user_id)));
          if (ids.length) supabase.from("profiles").select("id,display_name,avatar_emoji,avatar_url,avatar_frame,name_frame,bubble_frame").in("id", ids).then(({ data: prs }) => {
            if (prs) setProfs(prev => { const n = new Map(prev); prs.forEach((p: any) => n.set(p.id, p)); return n; });
          });
        });

        await ch.subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            await ch.track({ user_id: userId, online_at: new Date().toISOString() });
            setConnecting(false);
          }
        });

        // Speaking detection via AudioContext (only if we have a local mic stream)
        if (stream) try {
          analyserCtx = new AudioContext();
          const source = analyserCtx.createMediaStreamSource(stream);
          const analyser = analyserCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

          const tick = () => {
            const peerAnalysers: Array<[string, AnalyserNode, Uint8Array<ArrayBuffer>]> = [];
            peersRef.current.forEach((e, id) => {
              if (e.stream && analyserCtx) {
                try {
                  const src = analyserCtx.createMediaStreamSource(e.stream);
                  const an = analyserCtx.createAnalyser();
                  an.fftSize = 256;
                  src.connect(an);
                  const buf = new Uint8Array(new ArrayBuffer(an.frequencyBinCount)) as Uint8Array<ArrayBuffer>;
                  peerAnalysers.push([id, an, buf]);
                } catch {}
              }
            });

            const loop = () => {
              const active = new Set<string>();
              analyser.getByteFrequencyData(data as Uint8Array<ArrayBuffer>);
              const localVol = data.reduce((a, b) => a + b, 0) / data.length;
              if (localVol > 20 && !muted) active.add(userId);
              peerAnalysers.forEach(([id, an, buf]) => {
                an.getByteFrequencyData(buf);
                const v = buf.reduce((a, b) => a + b, 0) / buf.length;
                if (v > 20) active.add(id);
              });
              setSpeakingPeers(active);
              analyserTimerRef.current = requestAnimationFrame(loop);
            };
            loop();
          };
          tick();
        } catch (err) {
          console.warn("analyser failed", err);
        }
      } catch (err: any) {
        console.error("voice room init failed", err);
        setError(err?.message || "فشل الوصول للمايك");
        setConnecting(false);
      }
    })();

    return () => {
      cancelled = true;
      if (analyserTimerRef.current) cancelAnimationFrame(analyserTimerRef.current);
      try { analyserCtx?.close(); } catch {}
      peersRef.current.forEach((_e, id) => closePeer(id));
      peersRef.current.clear();
      audioElsRef.current.forEach(a => { try { a.srcObject = null; a.remove(); } catch {} });
      audioElsRef.current.clear();
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
      sentStreamRef.current?.getTracks().forEach(t => t.stop());
      sentStreamRef.current = null;
      try { fxCleanupRef.current?.(); } catch {}
      fxCleanupRef.current = null;
      if (channelRef.current) { try { channelRef.current.unsubscribe(); supabase.removeChannel(channelRef.current); } catch {} channelRef.current = null; }
      supabase.from("voice_room_participants").delete().eq("room_id", room.id).eq("user_id", userId).then(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id, userId]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    localStreamRef.current?.getAudioTracks().forEach(t => t.enabled = !next);
    sentStreamRef.current?.getAudioTracks().forEach(t => t.enabled = !next);
    supabase.from("voice_room_participants").update({ is_muted: next }).eq("room_id", room.id).eq("user_id", userId).then(() => {});
  };

  const applyFx = (next: VoiceFx) => {
    const raw = localStreamRef.current;
    if (!raw) return;
    // tear down previous processing
    try { fxCleanupRef.current?.(); } catch {}
    sentStreamRef.current?.getTracks().forEach(t => t.stop());
    const proc = buildProcessedStream(raw, next);
    sentStreamRef.current = proc.stream;
    fxCleanupRef.current = proc.cleanup;
    const newTrack = proc.stream.getAudioTracks()[0];
    if (newTrack) {
      newTrack.enabled = !muted;
      peersRef.current.forEach(({ pc }) => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === "audio");
        if (sender) sender.replaceTrack(newTrack).catch(err => console.warn("replaceTrack failed", err));
      });
    }
    setFx(next);
    setShowFx(false);
  };

  const ensureVoiceUnlocked = async (): Promise<boolean> => {
    if (voiceFeaturesUnlocked) return true;
    if (gems < 200) { alert("💎 تحتاج 200 جوهرة لفتح مميزات الصوت"); return false; }
    if (!confirm("🎙️ فتح جميع مميزات تغيير الصوت (لايف + تسجيل) مقابل 200 جوهرة؟")) return false;
    const { data, error } = await deductGemsForVoiceChange(userId, 200);
    if (error || !(data as any)?.ok) { alert("❌ فشل الخصم أو الرصيد غير كافٍ"); return false; }
    setGems((data as any).remaining as number);
    setVoiceFeaturesUnlocked(true);
    return true;
  };

  const toggleFxPanel = async () => {
    if (!showFx) {
      const ok = await ensureVoiceUnlocked();
      if (!ok) return;
    }
    setShowFx(s => !s);
  };

  const deleteRoom = async () => {
    if (!isOwner) return;
    if (!confirm("حذف الغرفة وطرد الجميع؟")) return;
    await supabase.from("voice_rooms").delete().eq("id", room.id);
    onLeave();
  };

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    const { error } = await supabase.from("voice_room_messages").insert({
      room_id: room.id, user_id: userId, text: text.slice(0, 300),
    });
    if (error) { console.error(error); alert("تعذر الإرسال: " + error.message); setChatInput(text); }
  };

  const MAX_RECORD_SECS = 15;

  const startRecording = async () => {
    if (recording || transforming) return;
    const ok = await ensureVoiceUnlocked();
    if (!ok) return;
    try {
      const stream = localStreamRef.current || await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
      recordChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordChunksRef.current.push(e.data); };
      rec.start();
      recorderRef.current = rec;
      recordStartRef.current = Date.now();
      setRecording(true);
      setRecordSecs(0);
      recordTimerRef.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - recordStartRef.current) / 1000);
        setRecordSecs(s);
        if (s >= MAX_RECORD_SECS) stopRecording(true);
      }, 250);
    } catch (err) {
      console.error(err);
      alert("ما قدرنا نوصل للمايك");
    }
  };

  const cleanupRecorder = () => {
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    setRecording(false);
    setRecordSecs(0);
    recorderRef.current = null;
  };

  const stopRecording = async (send: boolean) => {
    const rec = recorderRef.current;
    if (!rec) { cleanupRecorder(); return; }
    const finished: Promise<Blob> = new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(recordChunksRef.current, { type: rec.mimeType || "audio/webm" });
        recordChunksRef.current = [];
        resolve(blob);
      };
    });
    try { rec.stop(); } catch {}
    const blob = await finished;
    cleanupRecorder();
    if (!send || blob.size < 800) return;
    await sendVoiceNote(blob);
  };

  const sendVoiceNote = async (blob: Blob) => {
    if (!channelRef.current) return;
    setTransforming(true);
    try {
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      const b64 = btoa(bin);
      const out = await transformVoiceFn({ data: { audioB64: b64, preset: voicePreset, mimeType: blob.type } });
      // Upload transformed mp3 to storage
      const mp3 = Uint8Array.from(atob(out.audioB64), c => c.charCodeAt(0));
      const path = `${userId}/${crypto.randomUUID()}.mp3`;
      const { error: upErr } = await supabase.storage.from("voice-notes").upload(path, mp3, { contentType: "audio/mpeg", upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("voice-notes").getPublicUrl(path);
      const url = pub.publicUrl;
      await supabase.from("voice_room_messages").insert({
        room_id: room.id, user_id: userId, voice_url: url, preset: voicePreset,
      });
    } catch (err: any) {
      console.error("voice note error", err);
      const m = String(err?.message || "");
      let userMsg = "فشل تحويل الصوت، حاول مرة ثانية";
      if (m.includes("voice_quota")) userMsg = "⚠️ انتهى رصيد خدمة الصوت — تواصل مع الإدارة";
      else if (m.includes("voice_auth") || m.includes("voice_unavailable")) userMsg = "⚠️ خدمة الصوت غير مفعّلة حالياً";
      else if (m.includes("voice_network")) userMsg = "⚠️ فشل الاتصال بخدمة الصوت — تحقق من الإنترنت";
      else if (m.includes("voice_server")) userMsg = "⚠️ خدمة الصوت غير متاحة الآن، حاول لاحقاً";
      alert(userMsg);
    } finally {
      setTransforming(false);
    }
  };


  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [messages, showChat]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="p-3 border-b border-amber-700/40 bg-stone-900/80 flex items-center gap-2">
        <button onClick={onLeave} className="px-3 py-1.5 rounded-lg bg-red-700 text-sm font-bold">← خروج</button>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-amber-200 text-sm truncate">🎙️ {room.name}</div>
          {room.topic && <div className="text-xs text-amber-100/60 truncate">{room.topic}</div>}
        </div>
        <button onClick={() => setShowChat(s => !s)} className="px-2 py-1 rounded bg-sky-700 text-[11px] font-bold">{showChat ? "🎙️ صوت" : "💬 شات"}</button>
        {isOwner && <button onClick={deleteRoom} className="px-2 py-1 rounded bg-red-800 text-[10px] font-bold">حذف</button>}
      </div>

      {error && <div className="p-3 m-3 rounded-lg bg-red-900/60 border border-red-500 text-sm text-red-100">⚠️ {error}</div>}
      {connecting && !error && <div className="p-3 text-center text-amber-200/70 text-sm">🔄 جاري الاتصال...</div>}
      {!connecting && !localStreamRef.current && (
        <div className="px-3 py-2 mx-3 mt-2 rounded-lg bg-sky-900/40 border border-sky-600/40 text-[11px] text-sky-100">
          🔇 انضممت كمستمع/شات فقط (المايك غير متاح). تقدر تكتب بالشات تحت.
        </div>
      )}

      {showChat ? (
        <>
          <div className="px-3 py-2 border-b border-amber-700/30 bg-stone-900/40">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {participants.map(p => {
                const prof = profs.get(p.user_id);
                const isMe = p.user_id === userId;
                const isSpeaking = speakingPeers.has(p.user_id);
                return (
                  <div key={p.id} className="flex flex-col items-center gap-1 shrink-0">
                    <Avatar p={prof} size={64} speaking={isSpeaking} muted={isMe ? muted : p.is_muted} />
                    <div className={`text-[10px] font-bold truncate max-w-[70px] px-1 ${frameById(prof?.name_frame)?.kind === "name" ? frameById(prof?.name_frame)?.nameClass : "text-amber-100/80"} ${frameById(prof?.name_frame)?.animClass ?? ""}`}>{isMe ? "أنت" : (prof?.display_name || "...")}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
            {messages.length === 0 && <div className="text-center text-amber-100/40 text-xs py-6">لا توجد رسائل بعد — ابدأ المحادثة 💬</div>}
            {messages.map(m => {
              const prof = profs.get(m.user_id);
              const isMe = m.user_id === userId;
              return (
                <div key={m.id} className={`flex gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
                  <Avatar p={prof} size={52} />
                  <div className={`max-w-[78%] px-3 py-1.5 rounded-2xl text-sm ${frameById(prof?.bubble_frame)?.kind === "bubble" ? frameById(prof?.bubble_frame)?.bubbleClass : (isMe ? "bg-emerald-700 text-white" : "bg-stone-800 text-amber-100")} ${frameById(prof?.bubble_frame)?.animClass ?? ""}`}>
                    {!isMe && <div className={`inline-flex text-[10px] font-bold mb-0.5 px-1 ${frameById(prof?.name_frame)?.kind === "name" ? frameById(prof?.name_frame)?.nameClass : "text-amber-300/80"} ${frameById(prof?.name_frame)?.animClass ?? ""}`}>{prof?.display_name || "..."}</div>}
                    {m.text && <div className="break-words whitespace-pre-wrap">{m.text}</div>}
                    {m.voice_url && (
                      <div className="flex flex-col gap-1 min-w-[180px]">
                        <audio controls src={m.voice_url} className="w-full h-8" preload="metadata" />
                        {m.preset && <div className="text-[9px] opacity-70">🎭 صوت: {VOICE_PRESET_LABEL[m.preset] || FX_LABELS[m.preset as VoiceFx] || m.preset}</div>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-3 gap-3">
            {participants.map(p => {
              const prof = profs.get(p.user_id);
              const isMe = p.user_id === userId;
              const isSpeaking = speakingPeers.has(p.user_id);
              return (
                <div key={p.id} className="flex flex-col items-center gap-1">
                  <Avatar p={prof} size={104} speaking={isSpeaking} muted={isMe ? muted : p.is_muted} />
                  <div className={`text-xs font-bold truncate max-w-full px-1.5 ${frameById(prof?.name_frame)?.kind === "name" ? frameById(prof?.name_frame)?.nameClass : "text-amber-100"} ${frameById(prof?.name_frame)?.animClass ?? ""}`}>{prof?.display_name || "..."}</div>
                  {isMe && <div className="text-[10px] text-emerald-300">(أنت)</div>}
                  {p.user_id === room.created_by && <div className="text-[10px] text-amber-400">👑 مالك</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showFx && localStreamRef.current && (
        <div className="px-3 py-2 border-t border-amber-700/40 bg-stone-950/80">
          <div className="text-[11px] text-amber-200/80 mb-1.5 font-bold">🎚️ غيّر صوتك</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {(Object.keys(FX_LABELS) as VoiceFx[]).map(k => (
              <button key={k} onClick={() => applyFx(k)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border-2 ${fx === k ? "bg-amber-500 border-amber-200 text-stone-950" : "bg-stone-800 border-amber-700/40 text-amber-100"}`}>
                {FX_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
      )}

      {showVoicePicker && (
        <div className="px-3 py-2 border-t border-amber-700/40 bg-stone-950/80 max-h-56 overflow-y-auto">
          <div className="text-[11px] text-emerald-300 mb-1.5 font-bold">✨ أصوات طبيعية واقعية (تخفي هويتك تماماً)</div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {VOICE_PRESETS.filter(p => p.group === "natural").map(p => (
              <button key={p.id} onClick={() => { setVoicePreset(p.id); setShowVoicePicker(false); }}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 ${voicePreset === p.id ? "bg-emerald-500 border-emerald-200 text-stone-950" : "bg-stone-800 border-emerald-700/40 text-emerald-100"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-amber-200/80 mb-1.5 font-bold">🎭 أصوات مرحة</div>
          <div className="flex flex-wrap gap-1.5">
            {VOICE_PRESETS.filter(p => p.group === "fx").map(p => (
              <button key={p.id} onClick={() => { setVoicePreset(p.id); setShowVoicePicker(false); }}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 ${voicePreset === p.id ? "bg-pink-500 border-pink-200 text-stone-950" : "bg-stone-800 border-amber-700/40 text-amber-100"}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="p-2 border-t border-amber-700/40 bg-stone-900/80 flex items-center gap-1.5 flex-wrap">
        <div className="shrink-0 flex flex-col items-center gap-0.5">
          <div className="text-[10px] text-cyan-200 font-bold leading-none">💎{gems}</div>
          <div className="text-[9px] text-amber-200/60 leading-none">جواهر</div>
        </div>
        {localStreamRef.current && (
          <>
            <button onClick={toggleMute} title={muted ? "إلغاء الكتم" : "كتم الميكروفون"} className={`w-10 h-10 shrink-0 rounded-full text-lg font-bold border-2 ${muted ? "bg-red-600 border-red-300" : "bg-emerald-600 border-emerald-300"}`}>
              {muted ? "🔇" : "🎤"}
            </button>
            <button onClick={toggleFxPanel} title={voiceFeaturesUnlocked ? "تغيير الصوت اللايف" : "🔒 200 جوهرة لفتح"}
              className={`relative w-10 h-10 shrink-0 rounded-full text-base font-bold border-2 ${showFx || fx !== "none" ? "bg-purple-600 border-purple-300" : "bg-stone-700 border-amber-700/40"}`}>
              {!voiceFeaturesUnlocked && <span className="absolute -top-1 -right-1 text-[10px]">🔒</span>}
              🎚️
            </button>
          </>
        )}

        {recording ? (
          <button onClick={() => stopRecording(true)}
            className="flex-1 h-11 rounded-full bg-red-600 border-2 border-red-300 text-white text-sm font-bold animate-pulse flex items-center justify-center gap-2">
            ⏺️ تسجيل... {recordSecs}s / {MAX_RECORD_SECS}s — اضغط للإرسال
          </button>
        ) : transforming ? (
          <button disabled className="flex-1 h-11 rounded-full bg-pink-700 text-white text-sm font-bold flex items-center justify-center gap-2 opacity-80">
            🎭 يحوّل الصوت...
          </button>
        ) : (
          <>
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); sendChat(); } }}
              maxLength={300}
              placeholder="اكتب أو سجل صوت..."
              className="flex-1 px-3 py-2 rounded-full bg-stone-950 border border-amber-700/60 text-white text-sm focus:outline-none focus:border-amber-400"
            />
            {chatInput.trim() ? (
              <button onClick={sendChat} className="px-4 py-2 rounded-full bg-emerald-600 text-sm font-bold">إرسال</button>
            ) : (
              <>
                <button onClick={() => setShowVoicePicker(s => !s)} title="اختر الصوت"
                  className="w-11 h-11 shrink-0 rounded-full bg-pink-700 border-2 border-pink-300 text-base font-bold">
                  🎭
                </button>
                <button onClick={startRecording} title={voiceFeaturesUnlocked ? `سجل رسالة صوتية بصوت ${VOICE_PRESET_LABEL[voicePreset] || voicePreset}` : "🔒 200 جوهرة لتسجيل صوت محوّل"}
                  className="relative w-11 h-11 shrink-0 rounded-full bg-rose-600 border-2 border-rose-300 text-xl font-bold">
                  {!voiceFeaturesUnlocked && <span className="absolute -top-1 -right-1 text-[10px]">🔒</span>}
                  🎙️
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

