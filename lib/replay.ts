import type { EvidenceCheck, RuleSet } from "./contract";

type LichessUser = { id?: string; title?: string };
type LichessGame = {
  id?: string;
  rated?: boolean;
  variant?: string;
  speed?: string;
  status?: string;
  source?: string;
  winner?: string;
  createdAt?: number;
  lastMoveAt?: number;
  initialFen?: string;
  moves?: string;
  players?: { white?: LichessUser; black?: LichessUser };
};

export type ReplayResult = {
  gameId: string;
  status: "MATCHES_RULES" | "DOES_NOT_MATCH" | "INSUFFICIENT_EVIDENCE";
  checks: EvidenceCheck[];
  note: string;
};

const WIN_ENDINGS = new Set(["mate", "resign", "outoftime", "timeout"]);
const DRAW_ENDINGS = new Set(["draw", "stalemate"]);
const LIVE_SOURCES = new Set(["api", "arena", "friend", "pool", "simul", "swiss"]);

function pass(checks: EvidenceCheck[], condition: string, ok: boolean, code: string, observed: unknown) {
  checks.push({ condition, status: ok ? "PASS" : "FAIL", reason_code: ok ? "" : code, observed });
}

export async function replayGame(gameId: string, rules: RuleSet, claimantLichessId: string): Promise<ReplayResult> {
  if (!/^[A-Za-z0-9]{8}$/.test(gameId)) throw new Error("Lichess game IDs contain exactly 8 letters or numbers.");
  const response = await fetch(`https://lichess.org/game/export/${gameId}?moves=true&tags=true&clocks=false&evals=false&opening=false`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    return { gameId, status: "INSUFFICIENT_EVIDENCE", checks: [{ condition: "Lichess response", status: "INSUFFICIENT_EVIDENCE", reason_code: "SOURCE_UNAVAILABLE", observed: response.status }], note: "Lichess did not return a usable game record. No reward path was called." };
  }
  const game = await response.json() as LichessGame;
  const checks: EvidenceCheck[] = [];
  const missing = [game.id, game.rated, game.variant, game.speed, game.status, game.source, game.createdAt, game.lastMoveAt, game.players?.white?.id, game.players?.black?.id, game.moves]
    .some((item) => item === undefined || item === null);
  if (missing) {
    return { gameId, status: "INSUFFICIENT_EVIDENCE", checks: [{ condition: "Required game fields", status: "INSUFFICIENT_EVIDENCE", reason_code: "MISSING_GAME_FIELD", observed: null }], note: "The public game record is missing fields needed by this replay." };
  }

  const ruleSet = rules;
  const status = (game.status ?? "").toLowerCase();
  const whiteId = game.players?.white?.id?.toLowerCase();
  const blackId = game.players?.black?.id?.toLowerCase();
  const claimantId = claimantLichessId.trim().toLowerCase();
  const color = claimantId && claimantId === whiteId ? "WHITE" : claimantId && claimantId === blackId ? "BLACK" : "NONE";
  const source = (game.source ?? "").toLowerCase();
  const plies = (game.moves ?? "").trim().split(/\s+/).filter(Boolean).length;
  const winFinished = WIN_ENDINGS.has(status);
  const drawFinished = DRAW_ENDINGS.has(status);
  const finished = winFinished || drawFinished;
  const starterFen = game.initialFen === undefined || game.initialFen === "startpos" || game.initialFen === "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  pass(checks, "Returned game ID", game.id === gameId, "WRONG_GAME_ID", game.id);
  pass(checks, "Replay player identity", Boolean(claimantId && (claimantId === whiteId || claimantId === blackId)), "CLAIMANT_NOT_IN_GAME", claimantId || "enter the Lichess account to check");
  pass(checks, "Standard chess", game.variant?.toLowerCase() === "standard", "VARIANT_MISMATCH", game.variant);
  pass(checks, "Standard starting position", starterFen, "INVALID_VARIANT_START", game.initialFen ?? "standard start");
  pass(checks, "Finished game category", finished, "GAME_NOT_FINISHED", status);
  pass(checks, "Supported game source", LIVE_SOURCES.has(source), "GAME_SOURCE_DISALLOWED", source);
  pass(checks, "No bot accounts", game.players?.white?.title !== "BOT" && game.players?.black?.title !== "BOT", "BOT_GAME_DISALLOWED", { white: game.players?.white?.title ?? "human", black: game.players?.black?.title ?? "human" });
  pass(checks, "Rated status", ruleSet.rated === "ANY" || (ruleSet.rated === "REQUIRED" ? game.rated === true : game.rated === false), "RATED_MISMATCH", game.rated);
  pass(checks, "Time control", ruleSet.speed === "ANY" || game.speed?.toUpperCase() === ruleSet.speed, "SPEED_MISMATCH", game.speed);
  pass(checks, "Player color", ruleSet.player_color === "ANY" || color === ruleSet.player_color, "COLOR_MISMATCH", color);
  const resultMatches = ruleSet.result === "WIN"
    ? winFinished && game.winner === color.toLowerCase() && color !== "NONE"
    : drawFinished && game.winner === undefined;
  pass(checks, "Game result", resultMatches, "RESULT_MISMATCH", { status, winner: game.winner ?? null });
  pass(checks, "Move limit", ruleSet.max_plies == null || plies <= ruleSet.max_plies, "MAX_PLIES_EXCEEDED", { plies, max_plies: ruleSet.max_plies ?? null });
  const timingCheck = {
    condition: "Live quest timing and enrollment",
    status: "INSUFFICIENT_EVIDENCE",
    reason_code: "HISTORICAL_REPLAY_ONLY",
    observed: { createdAt: game.createdAt, lastMoveAt: game.lastMoveAt },
  } satisfies EvidenceCheck;
  checks.push(timingCheck);

  const predicateChecks = checks.filter((check) => check.condition !== timingCheck.condition);
  const incomplete = predicateChecks.some((check) => check.status === "INSUFFICIENT_EVIDENCE");
  const failed = predicateChecks.some((check) => check.status === "FAIL");
  const resultStatus = incomplete ? "INSUFFICIENT_EVIDENCE" : failed ? "DOES_NOT_MATCH" : "MATCHES_RULES";
  return {
    gameId,
    status: resultStatus,
    checks,
    note: "Historical replay is a client-side sandbox. It cannot enroll, claim, or credit DEMO units.",
  };
}
