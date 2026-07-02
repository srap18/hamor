export type PlayerReturnSource = {
  kind: "leaderboard";
  tab: string;
  q?: string;
  tribeQ?: string;
  at: number;
};

export const PLAYER_RETURN_SOURCE_KEY = "mk-player-return-source";
const MAX_RETURN_SOURCE_AGE_MS = 30 * 60 * 1000;

function readRawSource(): PlayerReturnSource | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PLAYER_RETURN_SOURCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlayerReturnSource;
    if (parsed?.kind !== "leaderboard" || !parsed.tab || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > MAX_RETURN_SOURCE_AGE_MS) {
      window.sessionStorage.removeItem(PLAYER_RETURN_SOURCE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function savePlayerReturnSource(source: Omit<PlayerReturnSource, "at">) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PLAYER_RETURN_SOURCE_KEY, JSON.stringify({ ...source, at: Date.now() }));
  } catch {
    // Normal browser back can still work if storage is unavailable.
  }
}

export function consumePlayerReturnSource(): PlayerReturnSource | null {
  const source = readRawSource();
  if (typeof window !== "undefined" && source) {
    try { window.sessionStorage.removeItem(PLAYER_RETURN_SOURCE_KEY); } catch { /* noop */ }
  }
  return source;
}

export function hasPlayerReturnSource() {
  return !!readRawSource();
}

export function isPlayerRoutePath(pathname: string) {
  return pathname.startsWith("/players/") || pathname.startsWith("/u/");
}