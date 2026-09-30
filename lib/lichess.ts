export type LichessUser = { id?: string; name?: string; title?: string };
export type LichessGame = {
  id?: string; rated?: boolean; variant?: string; speed?: string; status?: string;
  source?: string; winner?: string; createdAt?: number; lastMoveAt?: number;
  initialFen?: string; moves?: string;
  players?: { white?: { user?: LichessUser }; black?: { user?: LichessUser } };
};

export const SAVED_GAME = { id: "yQjRuAAG", player: "Wattxbt" };

export function parseGameId(input: string): string {
  const value = input.trim();
  if (/^[A-Za-z0-9]{8}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "lichess.org" || url.port || url.username || url.password) throw new Error();
    const match = url.pathname.match(/^\/(?:([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:\/(?:white|black))?|analysis\/([A-Za-z0-9]{8})(?:\/(?:white|black))?)\/?$/);
    if (match) return match[1] ?? match[2];
  } catch { /* Show the same field-level recovery for invalid URLs and IDs. */ }
  throw new Error("Paste a full https://lichess.org/ game link or its 8-character game ID.");
}

export function isGameInput(input: string): boolean {
  try { parseGameId(input); return true; } catch { return false; }
}

// Lichess asks clients to make one request at a time and pause after HTTP 429.
let pending: Promise<unknown> = Promise.resolve();
let retryAfter = 0;
async function sourceText(url: string, accept: string): Promise<string> {
  const request = pending.catch(() => undefined).then(async () => {
    if (Date.now() < retryAfter) throw new Error("Lichess is rate limiting requests. Wait a minute, then try again.");
    let response: Response;
    try {
      response = await fetch(url, { headers: { Accept: accept }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new Error("Couldn’t reach Lichess. Check your connection and try again; your input is saved.");
    }
    if (response.status === 429) {
      retryAfter = Date.now() + 60_000;
      throw new Error("Lichess is rate limiting requests. Wait a minute, then try again.");
    }
    if (!response.ok) throw new Error(response.status === 404 ? "Lichess couldn’t find that game or account. Check the link or username." : `Lichess returned HTTP ${response.status}. Try again shortly.`);
    return response.text();
  });
  pending = request;
  return request;
}

export async function fetchGame(input: string): Promise<LichessGame> {
  const id = parseGameId(input);
  return JSON.parse(await sourceText(`https://lichess.org/game/export/${id}?moves=true&tags=true&clocks=false&evals=false&opening=false`, "application/json")) as LichessGame;
}

export async function recentGames(username: string, since?: number): Promise<LichessGame[]> {
  if (!/^[A-Za-z0-9_-]{3,30}$/.test(username)) throw new Error("Enter a valid Lichess username.");
  const params = new URLSearchParams({ max: "12", moves: "true", tags: "true", clocks: "false", evals: "false", opening: "false", ongoing: "false", finished: "true" });
  if (since && Number.isSafeInteger(since)) params.set("since", String(since));
  const body = await sourceText(`https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params}`, "application/x-ndjson");
  return body.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as LichessGame).filter((game) => typeof game.id === "string" && /^[A-Za-z0-9]{8}$/.test(game.id));
}
