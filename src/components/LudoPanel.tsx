import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { frameById } from "@/lib/frames";

// ============================================================
// LUDO — Admin-only prototype (2 or 4 players)
// ============================================================

type Room = {
  id: string;
  host_id: string;
  status: string;
  max_players: number;
  current_turn_seat: number;
  last_dice: number | null;
  turn_deadline: string | null;
  winner_id: string | null;
};

type Player = {
  id: string;
  room_id: string;
  user_id: string;
  seat: number;
  color: "green" | "red" | "yellow" | "blue";
  tokens: number[];
  finished_count: number;
};

type Prof = {
  id: string;
  display_name: string | null;
  avatar_url?: string | null;
  avatar_emoji?: string | null;
  avatar_frame?: string | null;
  name_frame?: string | null;
  level?: number | null;
};

const COLOR_HEX: Record<string, string> = {
  green: "#22c55e", red: "#ef4444", yellow: "#eab308", blue: "#3b82f6",
};
const COLOR_LIGHT: Record<string, string> = {
  green: "#86efac", red: "#fca5a5", yellow: "#fde68a", blue: "#93c5fd",
};

const CELL = 22;
const BOARD = 15 * CELL;

const PATH: [number, number][] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7],
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14],
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7],
  [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0], [6, 0],
];

const HOME_STRETCH: Record<string, [number, number][]> = {
  green:  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  red:    [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  yellow: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  blue:   [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
};

const BASE_SLOTS: Record<string, [number, number][]> = {
  green:  [[1.5, 1.5], [3.5, 1.5], [1.5, 3.5], [3.5, 3.5]],
  red:    [[10.5, 1.5], [12.5, 1.5], [10.5, 3.5], [12.5, 3.5]],
  yellow: [[1.5, 10.5], [3.5, 10.5], [1.5, 12.5], [3.5, 12.5]],
  blue:   [[10.5, 10.5], [12.5, 10.5], [10.5, 12.5], [12.5, 12.5]],
};

const SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

function tokenCoords(color: string, pos: number, tokenIdx: number): { x: number; y: number } {
  if (pos === -1) {
    const [gx, gy] = BASE_SLOTS[color][tokenIdx];
    return { x: gx * CELL, y: gy * CELL };
  }
  if (pos === 999) {
    const [gx, gy] = [7 + (tokenIdx % 2 - 0.5) * 0.3, 7 + (Math.floor(tokenIdx / 2) - 0.5) * 0.3];
    return { x: (gx + 0.5) * CELL, y: (gy + 0.5) * CELL };
  }
  if (pos >= 100 && pos <= 104) {
    const [gx, gy] = HOME_STRETCH[color][pos - 100];
    return { x: (gx + 0.5) * CELL, y: (gy + 0.5) * CELL };
  }
  const [gx, gy] = PATH[pos];
  return { x: (gx + 0.5) * CELL, y: (gy + 0.5) * CELL };
}

// ============================================================
// Player card (avatar + frame + name)
// ============================================================
function PlayerCard({
  color, prof, active, finished, isEmpty,
}: {
  color?: string; prof?: Prof | null; active?: boolean; finished?: number; isEmpty?: boolean;
}) {
  const frame = frameById(prof?.avatar_frame);
  const ringCls = frame?.kind === "avatar" ? frame.ring || "" : "";
  const nameFrame = frameById(prof?.name_frame);
  const nameCls = nameFrame?.kind === "name" ? nameFrame.nameClass || "" : "";

  if (isEmpty) {
    return (
      <div className="flex-1 min-w-0 p-2 rounded-xl border-2 border-dashed border-stone-700 bg-stone-900/40 flex items-center justify-center min-h-[68px]">
        <span className="text-[10px] text-stone-500 font-bold">بانتظار لاعب...</span>
      </div>
    );
  }

  return (
    <div className={`flex-1 min-w-0 p-1.5 rounded-xl border-2 ${active ? "border-amber-400 bg-gradient-to-b from-amber-500/25 to-amber-900/10 shadow-[0_0_14px_rgba(252,191,73,0.4)]" : "border-stone-700 bg-stone-900/70"}`}>
      <div className="flex items-center gap-1.5">
        <div className="relative shrink-0 w-11 h-11 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full" style={{ background: `radial-gradient(circle,${COLOR_HEX[color || "green"]}55,transparent 65%)` }} />
          {prof?.avatar_url ? (
            <img src={prof.avatar_url} alt="" loading="lazy"
              className={`w-[70%] h-[70%] rounded-full object-cover ring-2 ${ringCls}`}
              style={{ boxShadow: `0 0 8px ${COLOR_HEX[color || "green"]}88` }} />
          ) : (
            <div className={`w-[70%] h-[70%] rounded-full flex items-center justify-center text-lg bg-sky-700 ring-2 ${ringCls}`}
              style={{ boxShadow: `0 0 8px ${COLOR_HEX[color || "green"]}88` }}>
              {prof?.avatar_emoji || "👤"}
            </div>
          )}
          {frame?.imageUrl && (
            <img src={frame.imageUrl} alt="" loading="lazy"
              className={`absolute inset-0 w-full h-full object-contain pointer-events-none ${frame.animClass ?? ""}`}
              style={{ filter: "drop-shadow(0 0 6px rgba(252,191,73,0.7))" }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-[11px] font-black truncate ${nameCls || "text-amber-100"}`}>
            {prof?.display_name || "لاعب"}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: COLOR_HEX[color || "green"] }} />
            <span className="text-[9px] text-amber-300/80 font-bold">أنهى: {finished ?? 0}/4</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Board
// ============================================================
function LudoBoard({
  players, myColor, lastDice, onTokenClick,
}: {
  players: Player[]; myColor: string | null; lastDice: number | null;
  onTokenClick: (tokenIdx: number) => void;
}) {
  const me = players.find(p => p.color === myColor);
  const canMoveToken = useCallback((tokenIdx: number): boolean => {
    if (!me || lastDice == null) return false;
    const pos = me.tokens[tokenIdx];
    if (pos === 999) return false;
    if (pos === -1) return lastDice === 6;
    if (pos >= 100) return pos + lastDice <= 105;
    return true;
  }, [me, lastDice]);

  return (
    <svg viewBox={`0 0 ${BOARD} ${BOARD}`} className="w-full h-auto select-none block"
      style={{ filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.6))" }}>
      <defs>
        <radialGradient id="boardBg" cx="50%" cy="50%" r="75%">
          <stop offset="0%" stopColor="#fffaf0" />
          <stop offset="70%" stopColor="#fde8c4" />
          <stop offset="100%" stopColor="#d9b382" />
        </radialGradient>
        {(["green", "red", "yellow", "blue"] as const).map(c => (
          <radialGradient key={`qg-${c}`} id={`q-${c}`} cx="30%" cy="30%" r="90%">
            <stop offset="0%" stopColor={COLOR_LIGHT[c]} />
            <stop offset="100%" stopColor={COLOR_HEX[c]} />
          </radialGradient>
        ))}
        {(["green", "red", "yellow", "blue"] as const).map(c => (
          <radialGradient key={`tg-${c}`} id={`tk-${c}`} cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.95} />
            <stop offset="25%" stopColor={COLOR_LIGHT[c]} />
            <stop offset="100%" stopColor={COLOR_HEX[c]} />
          </radialGradient>
        ))}
        <radialGradient id="goldStar" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#fff8b0" />
          <stop offset="55%" stopColor="#f5c518" />
          <stop offset="100%" stopColor="#a5720a" />
        </radialGradient>
        <linearGradient id="cellGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fffdf5" />
          <stop offset="100%" stopColor="#f2dfb3" />
        </linearGradient>
        {(["green", "red", "yellow", "blue"] as const).map(c => (
          <linearGradient key={`cg-${c}`} id={`ct-${c}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={COLOR_LIGHT[c]} />
            <stop offset="100%" stopColor={COLOR_HEX[c]} />
          </linearGradient>
        ))}
        <filter id="tokenShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1.2" stdDeviation="1.2" floodColor="#000" floodOpacity="0.55" />
        </filter>
        <filter id="glowGold" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <rect x={0} y={0} width={BOARD} height={BOARD} rx={14} fill="url(#boardBg)" />
      <rect x={2} y={2} width={BOARD - 4} height={BOARD - 4} rx={12}
        fill="none" stroke="#8b5a2b" strokeWidth={1.5} opacity={0.35} />

      {(["green", "red", "yellow", "blue"] as const).map(color => {
        const positions: Record<string, [number, number]> = {
          green: [0, 0], red: [9, 0], yellow: [0, 9], blue: [9, 9],
        };
        const [x, y] = positions[color];
        return (
          <g key={color}>
            <rect x={x * CELL + 3} y={y * CELL + 3} width={6 * CELL - 6} height={6 * CELL - 6}
              fill={`url(#q-${color})`} rx={10} stroke="rgba(0,0,0,0.25)" strokeWidth={1} />
            <rect x={(x + 1) * CELL} y={(y + 1) * CELL} width={4 * CELL} height={4 * CELL}
              fill="#fffaf0" rx={6} stroke="rgba(0,0,0,0.15)" strokeWidth={0.8} />
            {BASE_SLOTS[color].map(([gx, gy], i) => (
              <circle key={i} cx={gx * CELL} cy={gy * CELL} r={CELL * 0.5}
                fill="rgba(255,255,255,0.55)" stroke="rgba(0,0,0,0.15)" strokeWidth={0.6} />
            ))}
          </g>
        );
      })}

      {PATH.map(([gx, gy], i) => (
        <rect key={`p-${i}`} x={gx * CELL + 1.2} y={gy * CELL + 1.2}
          width={CELL - 2.4} height={CELL - 2.4} rx={3}
          fill="url(#cellGrad)" stroke="#8b5a2b" strokeWidth={0.6} opacity={0.95} />
      ))}

      {(["green", "red", "yellow", "blue"] as const).map((color, seat) => {
        const cellIdx = seat * 13;
        const [gx, gy] = PATH[cellIdx];
        return (
          <rect key={`start-${color}`} x={gx * CELL + 1.2} y={gy * CELL + 1.2}
            width={CELL - 2.4} height={CELL - 2.4} rx={3}
            fill={`url(#q-${color})`} opacity={0.75} />
        );
      })}

      {(["green", "red", "yellow", "blue"] as const).map(color =>
        HOME_STRETCH[color].map(([gx, gy], i) => (
          <rect key={`hs-${color}-${i}`} x={gx * CELL + 1.2} y={gy * CELL + 1.2}
            width={CELL - 2.4} height={CELL - 2.4} rx={3}
            fill={`url(#q-${color})`} opacity={0.85}
            stroke="#8b5a2b" strokeWidth={0.5} />
        )),
      )}

      {[...SAFE_CELLS].map(i => {
        const [gx, gy] = PATH[i];
        const cx = (gx + 0.5) * CELL;
        const cy = (gy + 0.5) * CELL;
        const r = CELL * 0.36;
        const pts = Array.from({ length: 10 }, (_, k) => {
          const ang = (Math.PI / 5) * k - Math.PI / 2;
          const rr = k % 2 === 0 ? r : r * 0.45;
          return `${cx + Math.cos(ang) * rr},${cy + Math.sin(ang) * rr}`;
        }).join(" ");
        return (
          <polygon key={`s-${i}`} points={pts}
            fill="url(#goldStar)" stroke="#7a4b06" strokeWidth={0.6}
            filter="url(#glowGold)" />
        );
      })}

      <polygon points={`${6 * CELL},${6 * CELL} ${9 * CELL},${6 * CELL} ${7.5 * CELL},${7.5 * CELL}`} fill="url(#ct-red)" stroke="#5c1a1a" strokeWidth={0.6} />
      <polygon points={`${9 * CELL},${6 * CELL} ${9 * CELL},${9 * CELL} ${7.5 * CELL},${7.5 * CELL}`} fill="url(#ct-blue)" stroke="#0f2d5c" strokeWidth={0.6} />
      <polygon points={`${9 * CELL},${9 * CELL} ${6 * CELL},${9 * CELL} ${7.5 * CELL},${7.5 * CELL}`} fill="url(#ct-yellow)" stroke="#6b4c05" strokeWidth={0.6} />
      <polygon points={`${6 * CELL},${9 * CELL} ${6 * CELL},${6 * CELL} ${7.5 * CELL},${7.5 * CELL}`} fill="url(#ct-green)" stroke="#0f4a1e" strokeWidth={0.6} />
      <circle cx={7.5 * CELL} cy={7.5 * CELL} r={CELL * 0.32} fill="url(#goldStar)" stroke="#7a4b06" strokeWidth={0.8} filter="url(#glowGold)" />

      {players.flatMap(p =>
        p.tokens.map((pos, idx) => {
          const { x, y } = tokenCoords(p.color, pos, idx);
          const isMine = p.color === myColor;
          const clickable = isMine && canMoveToken(idx);
          const r = CELL * 0.4;
          return (
            <g key={`${p.id}-${idx}`}
              onClick={() => clickable && onTokenClick(idx)}
              style={{ cursor: clickable ? "pointer" : "default", transition: "transform 0.35s ease" }}
              filter="url(#tokenShadow)">
              {clickable && (
                <circle cx={x} cy={y} r={r + 3} fill="none"
                  stroke="#facc15" strokeWidth={1.8} opacity={0.9}>
                  <animate attributeName="opacity" values="0.4;1;0.4" dur="1.2s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={x} cy={y + 0.6} r={r} fill="rgba(0,0,0,0.25)" />
              <circle cx={x} cy={y} r={r} fill={`url(#tk-${p.color})`}
                stroke={clickable ? "#fde047" : "rgba(0,0,0,0.55)"} strokeWidth={clickable ? 1.4 : 1} />
              <ellipse cx={x - r * 0.28} cy={y - r * 0.38} rx={r * 0.45} ry={r * 0.22}
                fill="#ffffff" opacity={0.75} />
              <circle cx={x} cy={y} r={r * 0.42} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={0.8} />
            </g>
          );
        }),
      )}
    </svg>
  );
}

// ============================================================
// Fancy animated 3D dice
// ============================================================
function Dice3D({ value, rolling }: { value: number | null; rolling: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!rolling) return;
    const iv = setInterval(() => setTick(t => t + 1), 80);
    return () => clearInterval(iv);
  }, [rolling]);

  const displayed = rolling ? ((tick % 6) + 1) : (value ?? 1);
  const dots: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [[0.25, 0.25], [0.75, 0.75]],
    3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
    4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
    5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
    6: [[0.25, 0.2], [0.75, 0.2], [0.25, 0.5], [0.75, 0.5], [0.25, 0.8], [0.75, 0.8]],
  };

  return (
    <div className="relative" style={{ perspective: "300px", width: 72, height: 72 }}>
      <div
        className="absolute inset-0 rounded-2xl"
        style={{
          background: "linear-gradient(145deg,#ffffff 0%,#f5f5f5 45%,#d4d4d4 100%)",
          border: "2px solid #a8a29e",
          boxShadow: rolling
            ? "0 0 24px rgba(252,191,73,0.85), 0 8px 16px rgba(0,0,0,0.5), inset 0 2px 4px rgba(255,255,255,0.9), inset 0 -3px 6px rgba(0,0,0,0.15)"
            : "0 6px 14px rgba(0,0,0,0.4), inset 0 2px 4px rgba(255,255,255,0.9), inset 0 -3px 6px rgba(0,0,0,0.15)",
          transform: rolling
            ? `rotateX(${tick * 73}deg) rotateY(${tick * 91}deg) rotateZ(${tick * 47}deg)`
            : "rotateX(-8deg) rotateY(8deg)",
          transformStyle: "preserve-3d",
          transition: rolling ? "transform 0.08s linear, box-shadow 0.2s" : "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s",
        }}
      >
        {dots[displayed].map(([x, y], i) => (
          <div key={i}
            className="absolute rounded-full"
            style={{
              width: 10, height: 10,
              left: `calc(${x * 100}% - 5px)`,
              top: `calc(${y * 100}% - 5px)`,
              background: "radial-gradient(circle at 30% 30%, #4a4a4a, #0a0a0a 70%)",
              boxShadow: "inset 0 1px 2px rgba(0,0,0,0.8), 0 1px 1px rgba(255,255,255,0.4)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Main Panel
// ============================================================
export function LudoPanel({ userId, fullscreen = false }: { userId: string; fullscreen?: boolean }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [profs, setProfs] = useState<Record<string, Prof>>({});
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [notice, setNotice] = useState<string>("");
  const [now, setNow] = useState(Date.now());
  const [wantPlayers, setWantPlayers] = useState<2 | 4>(2);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const flash = useCallback((m: string) => {
    setNotice(m);
    setTimeout(() => setNotice(""), 3000);
  }, []);

  const loadRooms = useCallback(async () => {
    const { data } = await supabase
      .from("ludo_rooms" as never).select("*")
      .in("status", ["waiting", "playing"])
      .order("created_at", { ascending: false }).limit(20);
    setRooms((data as unknown as Room[]) || []);
  }, []);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  useEffect(() => {
    if (!activeRoom) return;
    const roomId = activeRoom.id;
    let cancelled = false;

    const loadPlayers = async () => {
      const { data } = await supabase
        .from("ludo_players" as never).select("*").eq("room_id", roomId);
      const ps = ((data as unknown as Player[]) || []).map(p => ({
        ...p, tokens: Array.isArray(p.tokens) ? p.tokens : [-1, -1, -1, -1],
      }));
      if (cancelled) return;
      setPlayers(ps);

      // Load profiles
      const ids = ps.map(p => p.user_id).filter(id => !profs[id]);
      if (ids.length > 0) {
        const { data: pr } = await supabase
          .from("profiles" as never)
          .select("id,display_name,avatar_url,avatar_emoji,avatar_frame,name_frame,level")
          .in("id", ids);
        if (!cancelled && pr) {
          const map: Record<string, Prof> = {};
          (pr as unknown as Prof[]).forEach(x => { map[x.id] = x; });
          setProfs(prev => ({ ...prev, ...map }));
        }
      }
    };
    const loadRoom = async () => {
      const { data } = await supabase
        .from("ludo_rooms" as never).select("*").eq("id", roomId).maybeSingle();
      if (!cancelled && data) setActiveRoom(data as unknown as Room);
    };

    loadPlayers();

    const ch = supabase.channel(`ludo-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ludo_players", filter: `room_id=eq.${roomId}` }, loadPlayers)
      .on("postgres_changes", { event: "*", schema: "public", table: "ludo_rooms", filter: `id=eq.${roomId}` }, loadRoom)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoom?.id]);

  const me = useMemo(() => players.find(p => p.user_id === userId) || null, [players, userId]);
  const isMyTurn = activeRoom?.status === "playing" && me?.seat === activeRoom.current_turn_seat;
  const secondsLeft = activeRoom?.turn_deadline
    ? Math.max(0, Math.floor((new Date(activeRoom.turn_deadline).getTime() - now) / 1000))
    : null;

  const quickMatch = async (players: 2 | 4) => {
    setBusy(true);
    const { data, error } = await supabase.rpc("ludo_quick_match" as never, { _players: players } as never);
    setBusy(false);
    if (error) return flash(`❌ ${error.message}`);
    await loadRooms();
    const { data: r } = await supabase.from("ludo_rooms" as never).select("*").eq("id", data as unknown as string).maybeSingle();
    if (r) setActiveRoom(r as unknown as Room);
  };

  const createRoom = async (players: 2 | 4) => {
    setBusy(true);
    const { data, error } = await supabase.rpc("ludo_create_room" as never, { _max_players: players } as never);
    setBusy(false);
    if (error) return flash(`❌ ${error.message}`);
    await loadRooms();
    const { data: r } = await supabase.from("ludo_rooms" as never).select("*").eq("id", data as unknown as string).maybeSingle();
    if (r) setActiveRoom(r as unknown as Room);
  };

  const joinRoom = async (roomId: string) => {
    setBusy(true);
    const { error } = await supabase.rpc("ludo_join_room" as never, { _room_id: roomId } as never);
    setBusy(false);
    if (error) return flash(`❌ ${error.message}`);
    const { data: r } = await supabase.from("ludo_rooms" as never).select("*").eq("id", roomId).maybeSingle();
    if (r) setActiveRoom(r as unknown as Room);
  };

  const rollDice = async () => {
    if (!activeRoom) return;
    setRolling(true);
    setTimeout(() => setRolling(false), 900);
    const { error } = await supabase.rpc("ludo_roll_dice" as never, { _room_id: activeRoom.id } as never);
    if (error) { setRolling(false); flash(`❌ ${error.message}`); }
  };

  const moveToken = async (tokenIdx: number) => {
    if (!activeRoom) return;
    const { error } = await supabase.rpc("ludo_move_token" as never, { _room_id: activeRoom.id, _token_idx: tokenIdx } as never);
    if (error) flash(`❌ ${error.message}`);
  };

  const skipTurn = async () => {
    if (!activeRoom) return;
    const { error } = await supabase.rpc("ludo_skip_turn" as never, { _room_id: activeRoom.id } as never);
    if (error) flash(`❌ ${error.message}`);
  };

  // ---- Lobby view ----
  if (!activeRoom) {
    return (
      <div className={`${fullscreen ? "max-w-2xl mx-auto" : ""} p-3 text-amber-100`}>
        <div className="mb-4 flex items-center gap-2">
          <span className="text-2xl">🎲</span>
          <div className="text-base font-extrabold text-amber-200">لعبة لودو</div>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-amber-200 font-black">تجريبي</span>
        </div>

        {/* Player count toggle */}
        <div className="mb-3 p-3 rounded-2xl bg-stone-900/70 border border-amber-700/40">
          <div className="text-[11px] font-black text-amber-300 mb-2">عدد اللاعبين</div>
          <div className="grid grid-cols-2 gap-2">
            {([2, 4] as const).map(n => (
              <button key={n} onClick={() => setWantPlayers(n)}
                className={`py-3 rounded-xl font-black text-sm border-2 transition ${wantPlayers === n
                  ? "bg-gradient-to-b from-amber-400 to-amber-600 text-amber-950 border-amber-200 shadow-[0_0_14px_rgba(252,191,73,0.5)]"
                  : "bg-stone-800 text-amber-200 border-stone-600"}`}>
                {n === 2 ? "👥 لاعبان (1×1)" : "👨‍👩‍👧‍👦 أربعة (2×2 مع الأصدقاء)"}
              </button>
            ))}
          </div>
        </div>

        <button onClick={() => quickMatch(wantPlayers)} disabled={busy}
          className="w-full py-4 rounded-2xl bg-gradient-to-b from-emerald-400 via-emerald-500 to-emerald-700 text-white font-black shadow-[0_8px_20px_rgba(16,185,129,0.4),inset_0_1px_0_rgba(255,255,255,0.4)] mb-2 disabled:opacity-50 flex items-center justify-center gap-2 border-2 border-emerald-300 active:scale-[0.98]">
          <span className="text-xl">🎯</span>
          <span>ابدأ اللعب — بحث عن {wantPlayers === 2 ? "منافس" : "٣ لاعبين"}</span>
        </button>
        <button onClick={() => createRoom(wantPlayers)} disabled={busy}
          className="w-full py-2.5 rounded-xl bg-stone-800 border border-amber-700/50 text-amber-200 font-bold shadow mb-4 disabled:opacity-50 text-xs active:scale-[0.98]">
          + إنشاء غرفة خاصة ({wantPlayers} لاعبين)
        </button>

        <div className="text-xs font-black text-amber-300/80 mb-2">🏛️ الغرف المتاحة</div>
        {rooms.length === 0 && (
          <div className="text-xs text-amber-200/50 text-center py-8 rounded-xl bg-stone-900/40 border border-stone-800">لا توجد غرف حالياً</div>
        )}
        <div className="space-y-2">
          {rooms.map(r => (
            <div key={r.id} className="p-3 rounded-xl bg-stone-900/70 border border-amber-700/40 flex items-center justify-between">
              <div>
                <div className="text-xs font-black text-amber-200">
                  {r.status === "waiting" ? "⏳ بانتظار لاعبين" : "🎮 قيد اللعب"}
                </div>
                <div className="text-[10px] text-amber-300/60 mt-0.5">{r.max_players} لاعبين</div>
              </div>
              <button onClick={() => (r.status === "waiting" ? joinRoom(r.id) : setActiveRoom(r))}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-amber-500 text-amber-950 text-xs font-black active:scale-95">
                {r.status === "waiting" ? "انضم" : "شاهد"}
              </button>
            </div>
          ))}
        </div>

        {notice && <div className="mt-3 text-center text-xs text-red-300">{notice}</div>}
      </div>
    );
  }

  // ---- Game view ----
  const winner = activeRoom.winner_id
    ? players.find(p => p.user_id === activeRoom.winner_id) : null;

  // Fill empty seats for display
  const seats = Array.from({ length: activeRoom.max_players }, (_, i) => {
    return players.find(p => p.seat === i) || null;
  });

  return (
    <div className={`${fullscreen ? "max-w-2xl mx-auto" : ""} p-2 text-amber-100`}>
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => { setActiveRoom(null); setPlayers([]); }}
          className="px-3 py-1.5 rounded-lg bg-stone-800 text-amber-200 text-xs font-bold border border-amber-700/40 active:scale-95">
          ← الغرف
        </button>
        <div className="text-xs font-black text-amber-300">
          {activeRoom.status === "waiting" && `بانتظار ${activeRoom.max_players - players.length} لاعبين...`}
          {activeRoom.status === "playing" && (isMyTurn ? "🎯 دورك الآن" : `دور ${seats.find(s => s?.seat === activeRoom.current_turn_seat)?.color || "?"}`)}
          {activeRoom.status === "finished" && `🏆 الفائز: ${winner?.color || "?"}`}
        </div>
      </div>

      {/* Player cards */}
      <div className={`grid gap-2 mb-2 ${activeRoom.max_players === 2 ? "grid-cols-2" : "grid-cols-2"}`}>
        {seats.map((p, i) => (
          <PlayerCard key={i}
            color={p?.color || (["green", "red", "yellow", "blue"] as const)[i]}
            prof={p ? profs[p.user_id] : null}
            active={activeRoom.status === "playing" && activeRoom.current_turn_seat === (p?.seat ?? -1)}
            finished={p?.finished_count}
            isEmpty={!p}
          />
        ))}
      </div>

      {/* Board */}
      <div className="rounded-2xl overflow-hidden border-2 border-amber-500/50 mb-2 p-2 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.15)]"
        style={{ background: "linear-gradient(145deg,#3a2412,#1a0f08)" }}>
        <LudoBoard
          players={players}
          myColor={me?.color || null}
          lastDice={isMyTurn ? activeRoom.last_dice : null}
          onTokenClick={moveToken}
        />
      </div>

      {/* Controls */}
      {activeRoom.status === "playing" && (
        <div className="flex items-center gap-3 justify-center p-3 rounded-2xl bg-gradient-to-b from-stone-900/90 to-stone-950/90 border border-amber-700/40 shadow-inner">
          <Dice3D value={activeRoom.last_dice} rolling={rolling} />
          <div className="flex flex-col gap-1.5">
            <button onClick={rollDice}
              disabled={!isMyTurn || activeRoom.last_dice != null || busy || rolling}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 text-amber-950 text-sm font-black disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 shadow-[0_4px_10px_rgba(252,191,73,0.4)] border border-amber-300">
              🎲 ارمِ النرد
            </button>
            <button onClick={skipTurn}
              disabled={!isMyTurn || activeRoom.last_dice != null || busy}
              className="px-4 py-1 rounded-lg bg-stone-700 text-amber-100 text-[11px] font-bold disabled:opacity-40 active:scale-95">
              تخطي الدور
            </button>
          </div>
          {secondsLeft != null && isMyTurn && (
            <div className={`text-lg font-black tabular-nums ${secondsLeft <= 5 ? "text-red-400 animate-pulse" : "text-amber-300"}`}>
              ⏱ {secondsLeft}s
            </div>
          )}
        </div>
      )}

      {isMyTurn && activeRoom.last_dice != null && (
        <div className="mt-2 text-center text-[11px] text-amber-300 animate-pulse">
          اضغط على أي قطعة متوهجة لتحريكها
        </div>
      )}

      {notice && <div className="mt-2 text-center text-xs text-red-300">{notice}</div>}
    </div>
  );
}
