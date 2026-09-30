import type { EvidenceCheck, Quest, RuleSet } from "./contract";
import { fetchGame, parseGameId, type LichessGame } from "./lichess";

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
  const id = parseGameId(gameId);
  return evaluateGame(await fetchGame(id), id, rules, claimantLichessId);
}

export function evaluateGame(game: LichessGame, gameId: string, rules: RuleSet, claimantLichessId: string): ReplayResult {
  const checks: EvidenceCheck[] = [];
  const missing = typeof game.rated !== "boolean" ||
    [game.id, game.variant, game.speed, game.status, game.source, game.players?.white?.user?.id, game.players?.black?.user?.id, game.moves].some((item) => typeof item !== "string" || !item) ||
    [game.createdAt, game.lastMoveAt].some((item) => !Number.isSafeInteger(item) || (item ?? 0) <= 0);
  if (missing) {
    return { gameId, status: "INSUFFICIENT_EVIDENCE", checks: [{ condition: "Required game fields", status: "INSUFFICIENT_EVIDENCE", reason_code: "MISSING_GAME_FIELD", observed: null }], note: "The public game record is missing fields needed by this replay." };
  }

  const ruleSet = rules;
  const status = (game.status ?? "").toLowerCase();
  const whiteId = game.players?.white?.user?.id?.toLowerCase();
  const blackId = game.players?.black?.user?.id?.toLowerCase();
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
  pass(checks, "No bot accounts", game.players?.white?.user?.title !== "BOT" && game.players?.black?.user?.title !== "BOT", "BOT_GAME_DISALLOWED", { white: game.players?.white?.user?.title ?? "human", black: game.players?.black?.user?.title ?? "human" });
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

export function preflightGame(game: LichessGame, gameId: string, quest: Quest, username: string, enrolledAt: number): ReplayResult {
  if (!quest.rules) throw new Error("This quest has no compiled rules yet.");
  const result = evaluateGame(game, gameId, quest.rules, username);
  const checks = result.checks.filter((check) => check.reason_code !== "HISTORICAL_REPLAY_ONLY");
  if (result.status !== "INSUFFICIENT_EVIDENCE") {
    pass(checks, "Game started after activation", (game.createdAt ?? 0) > quest.activated_at_ms, "GAME_BEFORE_ACTIVATION", game.createdAt);
    pass(checks, "Game started after enrollment", enrolledAt > 0 && (game.createdAt ?? 0) > enrolledAt, "GAME_BEFORE_ENROLLMENT", { game_started: game.createdAt, enrolled_at: enrolledAt });
    pass(checks, "Game completed in play window", (game.createdAt ?? 0) >= quest.starts_at_ms && (game.lastMoveAt ?? 0) >= (game.createdAt ?? 0) && (game.lastMoveAt ?? 0) <= quest.ends_at_ms, "GAME_OUTSIDE_WINDOW", { started_at_ms: game.createdAt, completed_at_ms: game.lastMoveAt, ends_at_ms: quest.ends_at_ms });
  }
  return { gameId, checks, status: checks.some((check) => check.status === "INSUFFICIENT_EVIDENCE") ? "INSUFFICIENT_EVIDENCE" : checks.some((check) => check.status === "FAIL") ? "DOES_NOT_MATCH" : "MATCHES_RULES", note: "Browser check only. Validators independently fetch the game; the contract checks enrollment, deadlines, game reuse and settlement before awarding DEMO." };
}
