"use client";

import { useRef, useState } from "react";
import type { EvidenceCheck, Quest } from "@/lib/contract";
import { fetchGame, isGameInput, parseGameId, recentGames, type LichessGame } from "@/lib/lichess";
import { preflightGame, type ReplayResult } from "@/lib/replay";

function observedValue(value: unknown): string {
  if (typeof value === "number" && value > 1_000_000_000_000) return new Date(value).toLocaleString();
  if (value === null || value === undefined) return "Not available";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${key.replaceAll("_", " ")}: ${observedValue(item)}`).join(" · ");
  return String(value);
}

export function EvidenceChecks({ checks }: { checks: EvidenceCheck[] }) {
  const ordered = checks.slice().sort((a, b) => Number(a.status === "PASS") - Number(b.status === "PASS"));
  return <div className="evidence-checks">{ordered.map((check, index) => <div className={`evidence-check ${check.status === "FAIL" ? "failed-check" : ""}`} key={`${check.condition}-${index}`}>
    <span className={`check-status ${check.status === "PASS" ? "pass" : check.status === "FAIL" ? "fail" : "missing"}`}>{check.status === "PASS" ? "✓" : check.status === "FAIL" ? "!" : "?"}</span>
    <span>{check.condition}{check.status !== "PASS" && <small className="observed-value">Observed: {observedValue(check.observed)}</small>}</span>
    <strong>{check.status === "PASS" ? "Passed" : check.status === "FAIL" ? "Did not match" : "Not checked"}</strong>
  </div>)}</div>;
}

export function GameEvidence({ quest, username, enrolledAt, canSubmit, busy, onSubmit }: {
  quest: Quest; username: string; enrolledAt: number; canSubmit: boolean; busy: string; onSubmit: (id: string) => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [games, setGames] = useState<LichessGame[] | null>(null);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReplayResult | null>(null);
  const requestLock = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const locked = Boolean(loading || busy);

  function changeInput(value: string) { setInput(value); setResult(null); setError(""); }
  async function findGames() {
    if (requestLock.current) return;
    requestLock.current = true; setLoading("Finding games…"); setError("");
    try { setGames(await recentGames(username, Math.max(quest.starts_at_ms, quest.activated_at_ms, enrolledAt))); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { requestLock.current = false; setLoading(""); }
  }
  async function checkGame(game?: LichessGame) {
    if (requestLock.current) return;
    requestLock.current = true; setLoading("Checking game…"); setError(""); setResult(null);
    try {
      const id = parseGameId(game?.id ?? input);
      const record = game ?? await fetchGame(id);
      setInput(id); setResult(preflightGame(record, id, quest, username, enrolledAt));
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { requestLock.current = false; setLoading(""); }
  }

  return <div className="game-evidence">
    <div className="game-actions"><a className="button-secondary" href="https://lichess.org/" target="_blank" rel="noreferrer">Play on Lichess ↗</a><button type="button" className="button-secondary" disabled={locked} onClick={() => void findGames()}>Find my recent games</button></div>
    <p className="field-help">Finds up to 12 finished games for @{username}, started after this quest’s play and enrollment boundaries. Refresh after finishing.</p>
    {games && <div className="recent-game-list" aria-label="Recent Lichess games">{games.length ? games.map((game) => {
      const preview = preflightGame(game, game.id!, quest, username, enrolledAt);
      const white = game.players?.white?.user; const black = game.players?.black?.user;
      const mineIsWhite = white?.id?.toLowerCase() === username.toLowerCase();
      const opponent = mineIsWhite ? black : white;
      return <button type="button" className="recent-game" key={game.id} disabled={locked} onClick={() => void checkGame(game)}>
        <span><strong>vs {opponent?.name ?? opponent?.id ?? "unknown player"}</strong><small>{game.speed} · {game.rated ? "Rated" : "Casual"} · {mineIsWhite ? "White" : "Black"} · {new Date(game.createdAt ?? 0).toLocaleString()}</small></span>
        <span className={`game-match ${preview.status === "MATCHES_RULES" ? "mint" : "coral"}`}>{preview.status === "MATCHES_RULES" ? "Looks eligible" : preview.status === "INSUFFICIENT_EVIDENCE" ? "Needs evidence" : "Rules differ"}</span>
      </button>;
    }) : <p>No finished games found for this enrollment. Finish a new qualifying game, then refresh—or paste its link below.</p>}</div>}
    <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void checkGame(); }}>
      <label htmlFor="game-link">Game link or ID</label><input ref={inputRef} id="game-link" value={input} onChange={(event) => changeInput(event.target.value)} required maxLength={200} placeholder="https://lichess.org/…" autoComplete="off" readOnly={locked} />
      <p className="field-help">Paste the whole game link. Only its public 8-character ID is sent to the contract.</p>
      <button className="button-secondary" type="submit" disabled={locked || !isGameInput(input)}>Check before signing</button>
    </form>
    {loading && <p role="status" className="field-help">{loading}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {result && <div className="preflight-result" role="status"><h4>{result.status === "MATCHES_RULES" ? "Looks ready for verification" : result.status === "DOES_NOT_MATCH" ? "This game misses a quest rule" : "The game record needs more evidence"}</h4><p>{result.status === "MATCHES_RULES" ? "The browser checks match. Review them, then sign to ask validators for the final decision." : "Review the checks below. Select another game or retry if the public record is incomplete."}</p><EvidenceChecks checks={result.checks} /><p className="field-help">{result.note}</p>
      {result.status === "MATCHES_RULES" && <button className="button-primary full-width" type="button" disabled={locked || !canSubmit} onClick={() => void onSubmit(result.gameId)}>{busy || "Verify game · sign claim"}</button>}
      {result.status !== "MATCHES_RULES" && <button className="text-button" type="button" disabled={locked} onClick={() => { changeInput(""); inputRef.current?.focus(); }}>Choose another game</button>}
    </div>}
  </div>;
}
