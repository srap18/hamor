import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { frameById } from "@/lib/frames";
import { confirmDialog } from "@/components/ConfirmDialog";
import { sound } from "@/lib/sound";


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

// Outer loop traversed CLOCKWISE. Each color's exit tile sits on the arm-side
// closer to its own base (blue on top-right col of top arm, yellow on bottom row
// of right arm, red on left col of bottom arm, green on top row of left arm).
const PATH: [number, number][] = [
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],              // 0-4  top arm RIGHT col ↓  (blue start = 0)
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6], // 5-10 right arm TOP row →
  [14, 7],                                              // 11
  [14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8], // 12-17 right arm BOTTOM row ← (yellow start = 13 → [13,8])
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14], // 18-23 bottom arm RIGHT col ↓
  [7, 14],                                              // 24
  [6, 14], [6, 13], [6, 12], [6, 11], [6, 10], [6, 9], // 25-30 bottom arm LEFT col ↑ (red start = 26 → [6,13])
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],      // 31-36 left arm BOTTOM row ←
  [0, 7],                                               // 37
  [0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],      // 38-43 left arm TOP row → (green start = 39 → [1,6])
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],      // 44-49 top arm LEFT col ↑
  [7, 0], [8, 0],                                       // 50-51
];

// Home stretch = 5 colored cells leading each color to center, entering from the base's own side.
// Each color's home stretch sits on the SAME arm as its exit tile.
const HOME_STRETCH: Record<string, [number, number][]> = {
  blue:   [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],     // TR base → TOP arm middle col, going down
  green:  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],     // TL base → LEFT arm middle row, going right
  yellow: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]], // BR base → RIGHT arm middle row, going left
  red:    [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]], // BL base → BOTTOM arm middle col, going up
};

// Bases placed adjacent to each color's exit tile (unchanged from previous fix).
const BASE_SLOTS: Record<string, [number, number][]> = {
  green:  [[1.5, 1.5], [3.5, 1.5], [1.5, 3.5], [3.5, 3.5]],         // TL
  blue:   [[10.5, 1.5], [12.5, 1.5], [10.5, 3.5], [12.5, 3.5]],     // TR
  yellow: [[10.5, 10.5], [12.5, 10.5], [10.5, 12.5], [12.5, 12.5]], // BR
  red:    [[1.5, 10.5], [3.5, 10.5], [1.5, 12.5], [3.5, 12.5]],     // BL
};

// Must match server seat→color assignment in ludo_join_room().
const SEAT_COLORS: Record<2 | 4, readonly Player["color"][]> = {
  2: ["green", "yellow"],
  4: ["green", "red", "yellow", "blue"],
};

const SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

const ERR_MSG: Record<string, string> = {
  dice_pending_move: "لديك نرد لم تُستخدم بعد — حرّك قطعة أولاً",
  no_dice: "ارمِ النرد أولاً",
  not_your_turn: "ليس دورك الآن",
  invalid_move: "حركة غير صالحة",
  room_full: "الغرفة ممتلئة",
  already_joined: "أنت في الغرفة بالفعل",
  not_in_room: "لست في هذه الغرفة",
  game_not_started: "اللعبة لم تبدأ بعد",
  game_finished: "انتهت اللعبة",
  turn_expired: "انتهى وقت الدور",
  roll_first: "ارمِ النرد أولاً",
  need_six_to_leave: "تحتاج رقم ٦ لإخراج قطعة من البيت",
  overshoot: "هذه القطعة تتجاوز خط النهاية",
  token_finished: "هذه القطعة وصلت للنهاية",
  move_available: "عندك حركة متاحة — حرّك قطعة أولاً",
  room_not_playing: "الغرفة لم تبدأ اللعب بعد",
};
function translateErr(m: string): string {
  const key = (m || "").trim();
  return ERR_MSG[key] ? `❌ ${ERR_MSG[key]}` : (key.startsWith("❌") ? key : `❌ ${key}`);
}

// Rotate board so each player sees their own base at bottom-left (red's corner in raw layout).
const ROTATION: Record<string, number> = {
  red: 0,       // BL already
  yellow: 90,   // BR → BL
  blue: 180,    // TR → BL
  green: 270,   // TL → BL
};

// Match server seat→color (seat * 13). SEAT_COLORS[4] = green, red, yellow, blue.
const COLOR_START_OFFSET: Record<string, number> = {
  green: 0,     // seat 0 → PATH[0]  = (6,1)  → top arm, adjacent to TL (green)
  red: 13,     // seat 1 → PATH[13] = (1,8)  → left arm, adjacent to BL (red)
  yellow: 26,  // seat 2 → PATH[26] = (8,13) → bottom arm, adjacent to BR (yellow)
  blue: 39,    // seat 3 → PATH[39] = (13,6) → right arm, adjacent to TR (blue)
};


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

function hasLegalMove(player: Player | null, dice: number | null): boolean {
  if (!player || dice == null) return false;
  const startOffset = COLOR_START_OFFSET[player.color] ?? player.seat * 13;
  return player.tokens.some(pos => {
    if (pos === -1) return dice === 6;
    if (pos >= 999) return false;
    if (pos >= 100) return pos + dice <= 105;
    const rel = ((pos - startOffset + 52) % 52);
    const distToEntry = 50 - rel;
    if (dice <= distToEntry) return true;
    return 100 + (dice - distToEntry - 1) <= 105;
  });
}

function canTokenMove(player: Player | null, tokenIdx: number, dice: number | null): boolean {
  if (!player || dice == null) return false;
  const pos = player.tokens[tokenIdx];
  const startOffset = COLOR_START_OFFSET[player.color] ?? player.seat * 13;
  if (pos === -1) return dice === 6;
  if (pos >= 999) return false;
  if (pos >= 100) return pos + dice <= 105;
  const rel = ((pos - startOffset + 52) % 52);
  const distToEntry = 50 - rel;
  if (dice <= distToEntry) return true;
  return 100 + (dice - distToEntry - 1) <= 105;
}

// Compute the list of intermediate positions between two token states so
// the piece visibly hops one cell at a time instead of teleporting.
function pathBetween(color: string, from: number, to: number): number[] {
  if (from === to) return [];
  const steps: number[] = [];
  const start = COLOR_START_OFFSET[color] ?? 0;
  const homeEntryPrev = (start + 50) % 52; // last main-track cell before home stretch

  // Reset back home (captured) or reached finish center — snap.
  if (to === -1 || to === 999) return [to];

  // Leaving the base to the start cell.
  if (from === -1) {
    steps.push(start);
    if (to !== start) {
      if (to >= 100) {
        for (let h = 100; h <= to; h++) steps.push(h);
      } else if (to !== start) {
        let cur = start;
        while (cur !== to) { cur = (cur + 1) % 52; steps.push(cur); }
      }
    }
    return steps;
  }

  // Along the main loop.
  if (from >= 0 && from < 52 && to >= 0 && to < 52) {
    let cur = from;
    while (cur !== to) { cur = (cur + 1) % 52; steps.push(cur); }
    return steps;
  }

  // Main loop → home stretch: walk to entry then step into stretch.
  if (from >= 0 && from < 52 && to >= 100) {
    let cur = from;
    while (cur !== homeEntryPrev) { cur = (cur + 1) % 52; steps.push(cur); }
    for (let h = 100; h <= to; h++) steps.push(h);
    return steps;
  }

  // Within the home stretch.
  if (from >= 100 && to >= 100) {
    for (let h = from + 1; h <= to; h++) steps.push(h);
    return steps;
  }

  return [to];
}

function AnimatedToken({
  color, tokenIdx, pos, clickable, onClick,
}: {
  color: string; tokenIdx: number; pos: number;
  clickable: boolean; onClick: () => void;
}) {
  const [displayPos, setDisplayPos] = useState(pos);
  const [hopping, setHopping] = useState(false);
  const prevRef = useRef(pos);

  useEffect(() => {
    if (pos === prevRef.current) return;
    const prev = prevRef.current;
    const steps = pathBetween(color, prev, pos);
    prevRef.current = pos;

    // Instant transitions (no walk): capture (sent home) or teleport
    if (steps.length === 0) {
      setDisplayPos(pos);
      if (pos === -1 && prev !== -1) sound.play("capture");
      if (pos === 999 && prev !== 999) sound.play("home");
      return;
    }
    // Reset back to base (captured mid-move)
    if (pos === -1 && prev !== -1) {
      sound.play("capture");
      setDisplayPos(pos);
      return;
    }

    let i = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stepMs = 150;
    const walk = () => {
      if (cancelled) return;
      if (i >= steps.length) {
        setHopping(false);
        if (pos === 999) sound.play("home");
        return;
      }
      const stepTo = steps[i];
      setDisplayPos(stepTo);
      setHopping(true);
      // Play a light hop for each intermediate step (skip when reaching home center)
      if (stepTo !== 999 && stepTo !== -1) sound.play("hop");
      i += 1;
      timer = setTimeout(walk, stepMs);
    };
    walk();
    return () => { cancelled = true; if (timer) clearTimeout(timer); setHopping(false); };
  }, [pos, color]);


  const { x, y } = tokenCoords(color, displayPos, tokenIdx);
  const r = CELL * 0.4;

  return (
    <g
      onClick={() => clickable && onClick()}
      style={{
        cursor: clickable ? "pointer" : "default",
        transform: `translate(${x}px, ${y}px)${hopping ? " translateY(-3px)" : ""}`,
        transition: "transform 140ms cubic-bezier(0.4, 0.0, 0.2, 1)",
      }}
      filter="url(#tokenShadow)"
    >
      {clickable && (
        <circle cx={0} cy={0} r={r + 3} fill="none"
          stroke="#facc15" strokeWidth={1.8} opacity={0.9}>
          <animate attributeName="opacity" values="0.4;1;0.4" dur="1.2s" repeatCount="indefinite" />
        </circle>
      )}
      {/* Shadow */}
      <ellipse cx={0} cy={r * 0.85} rx={r * 0.85} ry={r * 0.22} fill="rgba(0,0,0,0.35)" />
      {/* Outer colored disc */}
      <circle cx={0} cy={0} r={r} fill={`url(#tk-${color})`}
        stroke={clickable ? "#fde047" : "rgba(0,0,0,0.6)"} strokeWidth={clickable ? 1.4 : 1.1} />
      {/* Inner white disc */}
      <circle cx={0} cy={0} r={r * 0.72} fill="#ffffff" stroke="rgba(0,0,0,0.15)" strokeWidth={0.6} />
      {/* Star in player's color */}
      <polygon
        points={Array.from({ length: 10 }, (_, k) => {
          const ang = (Math.PI / 5) * k - Math.PI / 2;
          const rr = k % 2 === 0 ? r * 0.62 : r * 0.28;
          return `${Math.cos(ang) * rr},${Math.sin(ang) * rr}`;
        }).join(" ")}
        fill={COLOR_HEX[color]}
        stroke="rgba(0,0,0,0.35)" strokeWidth={0.5}
      />
      {/* Highlight */}
      <ellipse cx={-r * 0.32} cy={-r * 0.48} rx={r * 0.32} ry={r * 0.14}
        fill="#ffffff" opacity={0.55} />

    </g>
  );
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
    return canTokenMove(me || null, tokenIdx, lastDice);
  }, [me, lastDice]);

  return (
    <svg viewBox={`${-CELL * 0.6} ${-CELL * 0.6} ${BOARD + CELL * 1.2} ${BOARD + CELL * 1.2}`}
      className="w-full h-auto select-none block"
      style={{ filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.7))" }}>
      <defs>
        <linearGradient id="woodFrame" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c69257" />
          <stop offset="50%" stopColor="#8b5a2b" />
          <stop offset="100%" stopColor="#5d3a17" />
        </linearGradient>
        <linearGradient id="boardBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbe9c7" />
          <stop offset="100%" stopColor="#f0d5a0" />
        </linearGradient>
        {(["green", "red", "yellow", "blue"] as const).map(c => (
          <linearGradient key={`qg-${c}`} id={`q-${c}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLOR_LIGHT[c]} />
            <stop offset="100%" stopColor={COLOR_HEX[c]} />
          </linearGradient>
        ))}
        {(["green", "red", "yellow", "blue"] as const).map(c => (
          <radialGradient key={`tg-${c}`} id={`tk-${c}`} cx="35%" cy="30%" r="80%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.98} />
            <stop offset="30%" stopColor={COLOR_LIGHT[c]} />
            <stop offset="100%" stopColor={COLOR_HEX[c]} />
          </radialGradient>
        ))}
        <radialGradient id="goldStar" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#fff8b0" />
          <stop offset="55%" stopColor="#f5c518" />
          <stop offset="100%" stopColor="#a5720a" />
        </radialGradient>
        {(["green", "red", "yellow", "blue"] as const).map(c => (
          <linearGradient key={`cg-${c}`} id={`ct-${c}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={COLOR_LIGHT[c]} />
            <stop offset="100%" stopColor={COLOR_HEX[c]} />
          </linearGradient>
        ))}
        <filter id="tokenShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1.4" stdDeviation="1.2" floodColor="#000" floodOpacity="0.55" />
        </filter>
        <filter id="glowGold" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.0" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Wooden outer frame */}
      <rect x={-CELL * 0.55} y={-CELL * 0.55} width={BOARD + CELL * 1.1} height={BOARD + CELL * 1.1}
        rx={16} fill="url(#woodFrame)" stroke="#3d2410" strokeWidth={1.5} />
      <rect x={-CELL * 0.15} y={-CELL * 0.15} width={BOARD + CELL * 0.3} height={BOARD + CELL * 0.3}
        rx={8} fill="none" stroke="#3d2410" strokeWidth={0.8} opacity={0.6} />

      {/* Board playing surface */}
      <rect x={0} y={0} width={BOARD} height={BOARD} fill="url(#boardBg)" />

      {/* Full 15x15 white grid for path cells (behind everything else) */}
      {Array.from({ length: 15 * 15 }).map((_, k) => {
        const gx = k % 15, gy = Math.floor(k / 15);
        // Only draw grid on the cross arms (not inside the 4 bases nor center 3x3)
        const inBase =
          (gx < 6 && gy < 6) || (gx > 8 && gy < 6) ||
          (gx < 6 && gy > 8) || (gx > 8 && gy > 8);
        const inCenter = gx >= 6 && gx <= 8 && gy >= 6 && gy <= 8;
        if (inBase || inCenter) return null;
        return (
          <rect key={`grid-${k}`} x={gx * CELL} y={gy * CELL} width={CELL} height={CELL}
            fill="#ffffff" stroke="#2d1b0e" strokeWidth={0.6} />
        );
      })}

      {/* Colored home-stretch cells */}
      {(["blue", "red", "green", "yellow"] as const).map(color =>
        HOME_STRETCH[color].map(([gx, gy], i) => (
          <rect key={`hs-${color}-${i}`} x={gx * CELL} y={gy * CELL}
            width={CELL} height={CELL}
            fill={`url(#q-${color})`}
            stroke="#2d1b0e" strokeWidth={0.6} />
        )),
      )}

      {/* Colored start cells (bigger, matches base color) */}
      {(["blue", "red", "green", "yellow"] as const).map(color => {
        const cellIdx = COLOR_START_OFFSET[color];
        const [gx, gy] = PATH[cellIdx];
        return (
          <rect key={`start-${color}`} x={gx * CELL} y={gy * CELL}
            width={CELL} height={CELL}
            fill={`url(#q-${color})`}
            stroke="#2d1b0e" strokeWidth={0.8} />
        );
      })}

      {/* Directional arrows on the outer track (small triangles at midpoints) */}
      {[
        { at: [3, 6], dir: "down" },   // left arm going down toward BL
        { at: [6, 11], dir: "right" }, // bottom arm going right toward BR
        { at: [11, 8], dir: "up" },    // right arm going up toward TR
        { at: [8, 3], dir: "left" },   // top arm going left toward TL
      ].map(({ at, dir }, k) => {
        const [gx, gy] = at as [number, number];
        const cx = (gx + 0.5) * CELL;
        const cy = (gy + 0.5) * CELL;
        const s = CELL * 0.28;
        let pts = "";
        if (dir === "down")  pts = `${cx - s},${cy - s * 0.9} ${cx + s},${cy - s * 0.9} ${cx},${cy + s * 0.9}`;
        if (dir === "up")    pts = `${cx - s},${cy + s * 0.9} ${cx + s},${cy + s * 0.9} ${cx},${cy - s * 0.9}`;
        if (dir === "right") pts = `${cx - s * 0.9},${cy - s} ${cx - s * 0.9},${cy + s} ${cx + s * 0.9},${cy}`;
        if (dir === "left")  pts = `${cx + s * 0.9},${cy - s} ${cx + s * 0.9},${cy + s} ${cx - s * 0.9},${cy}`;
        return <polygon key={`arr-${k}`} points={pts} fill="#4b3a1e" opacity={0.55} />;
      })}

      {/* Safe-cell stars removed — only the colored start cell per color remains, to avoid visual confusion with the exit tile */}

      {/* Star inside each colored start cell (matching player color) */}
      {(["blue", "red", "green", "yellow"] as const).map(color => {
        const cellIdx = COLOR_START_OFFSET[color];
        const [gx, gy] = PATH[cellIdx];
        const cx = (gx + 0.5) * CELL;
        const cy = (gy + 0.5) * CELL;
        const r = CELL * 0.34;
        const pts = Array.from({ length: 10 }, (_, k) => {
          const ang = (Math.PI / 5) * k - Math.PI / 2;
          const rr = k % 2 === 0 ? r : r * 0.45;
          return `${cx + Math.cos(ang) * rr},${cy + Math.sin(ang) * rr}`;
        }).join(" ");
        return (
          <polygon key={`ss-${color}`} points={pts}
            fill="#ffffff" stroke="rgba(0,0,0,0.4)" strokeWidth={0.6} opacity={0.95} />
        );
      })}

      {/* Four bases with colored squares + inner white rounded rect + slot circles */}
      {(["green", "blue", "red", "yellow"] as const).map(color => {
        const positions: Record<string, [number, number]> = {
          green:  [0, 0],  // TL — matches BASE_SLOTS.green
          blue:   [9, 0],  // TR — matches BASE_SLOTS.blue
          red:    [0, 9],  // BL — matches BASE_SLOTS.red
          yellow: [9, 9],  // BR — matches BASE_SLOTS.yellow
        };
        const [x, y] = positions[color];
        return (
          <g key={color}>
            {/* Outer colored square */}
            <rect x={x * CELL} y={y * CELL} width={6 * CELL} height={6 * CELL}
              fill={`url(#q-${color})`} stroke="#2d1b0e" strokeWidth={0.8} />
            {/* Inner white rounded rectangle */}
            <rect x={(x + 1) * CELL} y={(y + 1) * CELL} width={4 * CELL} height={4 * CELL}
              fill="#ffffff" rx={CELL * 0.35}
              stroke={COLOR_HEX[color]} strokeWidth={1.2} />
            {/* Token slot rings */}
            {BASE_SLOTS[color].map(([gx, gy], i) => (
              <g key={i}>
                <circle cx={gx * CELL} cy={gy * CELL} r={CELL * 0.44}
                  fill="none" stroke={COLOR_HEX[color]} strokeWidth={0.9} opacity={0.35} />
              </g>
            ))}
          </g>
        );
      })}

      {/* Center: four triangles pointing to gold star — each matches its arm's color */}
      <polygon points={`${6 * CELL},${6 * CELL} ${9 * CELL},${6 * CELL} ${7.5 * CELL},${7.5 * CELL}`}
        fill="url(#ct-green)" stroke="#0f4a1e" strokeWidth={0.7} />
      <polygon points={`${9 * CELL},${6 * CELL} ${9 * CELL},${9 * CELL} ${7.5 * CELL},${7.5 * CELL}`}
        fill="url(#ct-blue)" stroke="#0f2d5c" strokeWidth={0.7} />
      <polygon points={`${9 * CELL},${9 * CELL} ${6 * CELL},${9 * CELL} ${7.5 * CELL},${7.5 * CELL}`}
        fill="url(#ct-yellow)" stroke="#6b4c05" strokeWidth={0.7} />
      <polygon points={`${6 * CELL},${9 * CELL} ${6 * CELL},${6 * CELL} ${7.5 * CELL},${7.5 * CELL}`}
        fill="url(#ct-red)" stroke="#5c1a1a" strokeWidth={0.7} />

      {/* Center star */}
      {(() => {
        const cx = 7.5 * CELL, cy = 7.5 * CELL;
        const r = CELL * 0.55;
        const pts = Array.from({ length: 10 }, (_, k) => {
          const ang = (Math.PI / 5) * k - Math.PI / 2;
          const rr = k % 2 === 0 ? r : r * 0.42;
          return `${cx + Math.cos(ang) * rr},${cy + Math.sin(ang) * rr}`;
        }).join(" ");
        return (
          <polygon points={pts}
            fill="url(#goldStar)" stroke="#7a4b06" strokeWidth={0.9}
            filter="url(#glowGold)" />
        );
      })()}


      {players.flatMap(p =>
        p.tokens.map((pos, idx) => (
          <AnimatedToken
            key={`${p.id}-${idx}`}
            color={p.color}
            tokenIdx={idx}
            pos={pos}
            clickable={p.color === myColor && canMoveToken(idx)}
            onClick={() => onTokenClick(idx)}
          />
        )),
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
  const [localDice, setLocalDice] = useState<number | null>(null);
  const [notice, setNotice] = useState<string>("");
  const [now, setNow] = useState(Date.now());
  const [wantPlayers, setWantPlayers] = useState<2 | 4>(2);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const flash = useCallback((m: string) => {
    setNotice(translateErr(m));
    setTimeout(() => setNotice(""), 3000);
  }, []);

  const loadRooms = useCallback(async () => {
    // Cleanup stale/empty rooms silently (never surface errors to UI)
    try { await supabase.rpc("ludo_cleanup_stale_rooms" as never); } catch { /* ignore */ }
    const { data, error } = await supabase
      .from("ludo_rooms" as never).select("*")
      .in("status", ["waiting", "playing"])
      .order("created_at", { ascending: false }).limit(20);
    if (error) {
      // Don't spam UI with transient auth errors during session hydration
      if (!/unauthor/i.test(error.message)) flash(error.message);
      return;
    }
    setRooms((data as unknown as Room[]) || []);
  }, [flash]);

  // Auto-refresh rooms list every 20s
  useEffect(() => {
    const t = setInterval(() => { loadRooms(); }, 20000);
    return () => clearInterval(t);
  }, [loadRooms]);

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
      if (cancelled) return;
      if (data) setActiveRoom(data as unknown as Room);
      else {
        setActiveRoom(null);
        setPlayers([]);
        loadRooms();
      }
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
  const shownDice = activeRoom?.last_dice ?? localDice;
  const hasMoveNow = hasLegalMove(me, activeRoom?.last_dice ?? null);
  const secondsLeft = activeRoom?.turn_deadline
    ? Math.max(0, Math.floor((new Date(activeRoom.turn_deadline).getTime() - now) / 1000))
    : null;

  const refreshActiveRoom = useCallback(async (roomId?: string) => {
    const rid = roomId || activeRoom?.id;
    if (!rid) return;
    const [{ data: room }, { data: psData }] = await Promise.all([
      supabase.from("ludo_rooms" as never).select("*").eq("id", rid).maybeSingle(),
      supabase.from("ludo_players" as never).select("*").eq("room_id", rid),
    ]);
    if (!room) {
      setActiveRoom(null);
      setPlayers([]);
      loadRooms();
      return;
    }
    setActiveRoom(room as unknown as Room);
    setPlayers(((psData as unknown as Player[]) || []).map(p => ({
      ...p,
      tokens: Array.isArray(p.tokens) ? p.tokens : [-1, -1, -1, -1],
    })));
  }, [activeRoom?.id, loadRooms]);

  const quickMatch = async (players: 2 | 4) => {
    setBusy(true);
    const { data, error } = await supabase.rpc("ludo_quick_match" as never, { _players: players } as never);
    setBusy(false);
    if (error) return flash(error.message);
    await loadRooms();
    const { data: r } = await supabase.from("ludo_rooms" as never).select("*").eq("id", data as unknown as string).maybeSingle();
    if (r) setActiveRoom(r as unknown as Room);
  };

  const createRoom = async (players: 2 | 4) => {
    setBusy(true);
    const { data, error } = await supabase.rpc("ludo_create_room" as never, { _max_players: players } as never);
    setBusy(false);
    if (error) return flash(error.message);
    await loadRooms();
    const { data: r } = await supabase.from("ludo_rooms" as never).select("*").eq("id", data as unknown as string).maybeSingle();
    if (r) setActiveRoom(r as unknown as Room);
  };

  const joinRoom = async (roomId: string) => {
    setBusy(true);
    const { error } = await supabase.rpc("ludo_join_room" as never, { _room_id: roomId } as never);
    setBusy(false);
    if (error) return flash(error.message);
    const { data: r } = await supabase.from("ludo_rooms" as never).select("*").eq("id", roomId).maybeSingle();
    if (r) setActiveRoom(r as unknown as Room);
  };

  const rollDice = async () => {
    if (!activeRoom) return;
    sound.resume();
    sound.play("dice");
    setRolling(true);
    setTimeout(() => setRolling(false), 900);

    const prevSeat = activeRoom.current_turn_seat;
    const { data, error } = await supabase.rpc("ludo_roll_dice" as never, { _room_id: activeRoom.id } as never);
    if (error) { setRolling(false); flash(error.message); }
    else {
      const dice = typeof data === "number" ? data : Number(data);
      if (Number.isFinite(dice)) {
        setLocalDice(dice);
        setTimeout(() => setLocalDice(null), 1800);
      }
      await refreshActiveRoom(activeRoom.id);
      // Detect the "three consecutive sixes" forfeit and notify the player.
      if (dice === 6) {
        const { data: fresh } = await supabase
          .from("ludo_rooms" as never)
          .select("current_turn_seat,last_dice")
          .eq("id", activeRoom.id)
          .maybeSingle();
        const f = fresh as unknown as { current_turn_seat: number; last_dice: number | null } | null;
        if (f && f.last_dice === null && f.current_turn_seat !== prevSeat) {
          flash("🎲 ثلاث ستّات متتالية — خسرت الدور!");
        }
      }
    }
  };

  const moveToken = async (tokenIdx: number) => {
    if (!activeRoom) return;
    const { error } = await supabase.rpc("ludo_move_token" as never, { _room_id: activeRoom.id, _token_idx: tokenIdx } as never);
    if (error) flash(error.message);
    else {
      setLocalDice(null);
      await refreshActiveRoom(activeRoom.id);
    }
  };

  const skipTurn = async () => {
    if (!activeRoom) return;
    const { error } = await supabase.rpc("ludo_skip_turn" as never, { _room_id: activeRoom.id } as never);
    if (error) flash(error.message);
    else {
      setLocalDice(null);
      await refreshActiveRoom(activeRoom.id);
    }
  };

  const leaveRoom = useCallback(async (roomId: string) => {
    try { await supabase.rpc("ludo_forfeit" as never, { _room_id: roomId } as never); } catch { /* ignore */ }
  }, []);

  // Auto-resume: if the user is already in an active room (e.g. after refresh
  // or backgrounding), jump straight back into it instead of showing the lobby.
  useEffect(() => {
    if (activeRoom || !userId) return;
    let cancelled = false;
    (async () => {
      const { data: rid } = await supabase.rpc("ludo_active_room_for" as never, { _uid: userId } as never);
      if (cancelled || !rid) return;
      const { data: r } = await supabase
        .from("ludo_rooms" as never).select("*").eq("id", rid as unknown as string).maybeSingle();
      if (!cancelled && r) setActiveRoom(r as unknown as Room);
    })();
    return () => { cancelled = true; };
  }, [activeRoom, userId]);

  // Bot auto-play: when the current seat's turn deadline passes, the bot rolls
  // and moves for them until they come back. Also refresh local room state
  // if a stale/missing seat is showing.
  useEffect(() => {
    if (!activeRoom || activeRoom.status !== "playing") return;
    const roomId = activeRoom.id;
    let stopped = false;

    const tick = async () => {
      const deadline = activeRoom.turn_deadline ? new Date(activeRoom.turn_deadline).getTime() : 0;
      const currentSeatExists = players.some(p => p.seat === activeRoom.current_turn_seat);
      const expired = deadline > 0 && deadline <= Date.now();
      if (expired || !currentSeatExists) {
        try { await supabase.rpc("ludo_bot_play" as never, { _room_id: roomId } as never); } catch { /* ignore */ }
        if (stopped) return;
        const { data } = await supabase
          .from("ludo_rooms" as never).select("*").eq("id", roomId).maybeSingle();
        if (stopped) return;
        if (data) setActiveRoom(data as unknown as Room);
        else {
          setActiveRoom(null);
          setPlayers([]);
          loadRooms();
        }
      }
    };

    const timer = setInterval(tick, 1500);
    return () => { stopped = true; clearInterval(timer); };
  }, [activeRoom, players, loadRooms]);

  // Realtime can be delayed on mobile; poll active rooms lightly so both players stay synced.
  useEffect(() => {
    if (!activeRoom) return;
    const roomId = activeRoom.id;
    const timer = setInterval(() => { refreshActiveRoom(roomId); }, 2500);
    return () => clearInterval(timer);
  }, [activeRoom?.id, refreshActiveRoom]);

  // If a dice result has no legal move, advance the turn automatically.
  useEffect(() => {
    if (!activeRoom || !isMyTurn || activeRoom.last_dice == null || hasMoveNow || busy) return;
    const timer = setTimeout(() => { skipTurn(); }, 650);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoom?.id, activeRoom?.last_dice, isMyTurn, hasMoveNow, busy]);

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
        <button onClick={async () => {
            const isLive = activeRoom.status === "playing" && !activeRoom.winner_id;
            if (isLive) {
              const ok = await confirmDialog({
                title: "الخروج من اللعبة",
                message: "إذا خرجت الآن سيفوز الخصم وتُغلق الغرفة فوراً.\nهل أنت متأكد؟",
                confirmText: "نعم، اخرج",
                cancelText: "متابعة اللعب",
                danger: true,
              });
              if (!ok) return;
            }
            const rid = activeRoom.id;
            setActiveRoom(null); setPlayers([]);
            await leaveRoom(rid);
            loadRooms();
          }}
          className="px-3 py-1.5 rounded-lg bg-stone-800 text-amber-200 text-xs font-bold border border-amber-700/40 active:scale-95">
          ← الغرف
        </button>
        <div className="text-xs font-black text-amber-300">
          {activeRoom.status === "waiting" && `بانتظار ${activeRoom.max_players - players.length} لاعبين...`}
          {activeRoom.status === "playing" && (isMyTurn ? "🎯 دورك الآن" : `دور ${seats.find(s => s?.seat === activeRoom.current_turn_seat)?.color || "?"}`)}
          {activeRoom.status === "finished" && `🏆 الفائز: ${winner?.color || "?"}`}
        </div>
      </div>

      {/* Player cards — put ME first so I always appear on the leading side */}
      <div className={`grid gap-2 mb-2 ${activeRoom.max_players === 2 ? "grid-cols-2" : "grid-cols-2"}`}>
        {(() => {
          const ordered = [...seats];
          if (me) {
            const myIdx = ordered.findIndex(p => p?.user_id === userId);
            if (myIdx > 0) { const [mine] = ordered.splice(myIdx, 1); ordered.unshift(mine); }
          }
          return ordered.map((p, i) => (
            <PlayerCard key={i}
              color={p?.color || SEAT_COLORS[activeRoom.max_players as 2 | 4]?.[i] || "green"}
              prof={p ? profs[p.user_id] : null}
              active={activeRoom.status === "playing" && activeRoom.current_turn_seat === (p?.seat ?? -1)}
              finished={p?.finished_count}
              isEmpty={!p}
            />
          ));
        })()}
      </div>

      {/* Board — rotated so my color's home corner appears bottom-left */}
      <div className="rounded-2xl overflow-hidden border-2 border-amber-500/50 mb-2 p-2 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.15)]"
        style={{ background: "linear-gradient(145deg,#3a2412,#1a0f08)" }}>
        <div style={{ transform: `rotate(${ROTATION[me?.color || "yellow"] ?? 0}deg)`, transition: "transform 0.5s ease" }}>
          <LudoBoard
            players={players}
            myColor={me?.color || null}
            lastDice={isMyTurn ? activeRoom.last_dice : null}
            onTokenClick={moveToken}
          />
        </div>
      </div>

      {/* Controls */}
      {activeRoom.status === "playing" && (
        <div className="grid grid-cols-[78px_minmax(132px,1fr)_78px] items-center gap-3 p-3 rounded-2xl bg-gradient-to-b from-stone-900/90 to-stone-950/90 border border-amber-700/40 shadow-inner">
          <div className="min-h-[72px] flex items-center justify-center">
            {secondsLeft != null && isMyTurn && (
              <div className={`text-lg font-black tabular-nums ${secondsLeft <= 5 ? "text-red-400 animate-pulse" : "text-amber-300"}`}>
                {secondsLeft}s ⏱
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5 items-stretch">
            <button onClick={rollDice}
              disabled={!isMyTurn || activeRoom.last_dice != null || busy || rolling}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 text-amber-950 text-sm font-black disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 shadow-[0_4px_10px_rgba(252,191,73,0.4)] border border-amber-300">
              🎲 ارمِ النرد
            </button>
            <button onClick={skipTurn}
              disabled={!isMyTurn || busy || activeRoom.last_dice == null || hasMoveNow}
              className="px-4 py-1 rounded-lg bg-stone-700 text-amber-100 text-[11px] font-bold disabled:opacity-40 active:scale-95">
              تخطي الدور
            </button>
          </div>
          <div className="flex items-center justify-center">
            <Dice3D value={shownDice} rolling={rolling} />
          </div>
        </div>
      )}

      {isMyTurn && activeRoom.last_dice != null && hasMoveNow && (
        <div className="mt-2 text-center text-[11px] text-amber-300 animate-pulse">
          اضغط على أي قطعة متوهجة لتحريكها
        </div>
      )}

      {isMyTurn && activeRoom.last_dice != null && !hasMoveNow && (
        <div className="mt-2 text-center text-[11px] text-amber-300 animate-pulse">
          لا توجد حركة متاحة — سيتم تخطي الدور تلقائياً
        </div>
      )}

      {notice && <div className="mt-2 text-center text-xs text-red-300">{notice}</div>}
    </div>
  );
}
