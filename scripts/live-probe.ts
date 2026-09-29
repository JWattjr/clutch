import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RUNNER, ROOT, RPC_URL, checkNetwork, loadEnv, makeReader } from "./lib.ts";

type LichessGameProbe = {
  id?: string;
  rated?: boolean;
  variant?: string;
  speed?: string;
  status?: string;
  winner?: string;
  createdAt?: number;
  lastMoveAt?: number;
  moves?: string;
  source?: string;
  players?: {
    white?: { user?: { id?: string } };
    black?: { user?: { id?: string } };
  };
};

async function main(): Promise<void> {
  loadEnv();
  const source = readFileSync(resolve(ROOT, "contracts", "clutch.py"), "utf8");
  if (!source.split(/\r?\n/, 1)[0]?.includes(RUNNER)) throw new Error(`Contract header must pin ${RUNNER}.`);

  console.log(`Read-only Studionet preflight: ${RPC_URL}`);
  await checkNetwork();
  console.log("PASS: RPC reports stable Studionet chain 61999.");

  const schema = await makeReader().getContractSchemaForCode(source);
  const methods = Object.keys(schema.methods ?? {}).sort();
  if (methods.length !== 23 || !methods.includes("get_contract_info") || !methods.includes("submit_game") || !methods.includes("get_link_for_wallet")) {
    throw new Error(`Studio compiled an unexpected schema (${methods.length} methods).`);
  }
  console.log(`PASS: Studio accepted the pinned contract schema (${methods.length} methods).`);

  const gameId = process.env.CLUTCH_PROBE_GAME_ID?.trim();
  if (gameId) {
    if (!/^[A-Za-z0-9]{8}$/.test(gameId)) throw new Error("CLUTCH_PROBE_GAME_ID must be an 8-character Lichess game ID.");
    const response = await fetch(`https://lichess.org/game/export/${gameId}?moves=true&tags=true&clocks=false&evals=false&opening=false`, {
      headers: { accept: "application/json", "user-agent": "Clutch/0.1" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Lichess game export returned HTTP ${response.status}.`);
    const game = await response.json() as LichessGameProbe;
    const status = game.status?.toLowerCase();
    const plies = game.moves?.split(/\s+/).filter(Boolean).length ?? 0;
    const completed = ["mate", "resign", "outoftime", "timeout", "draw", "stalemate"].includes(status ?? "");
    const hasWinner = status === "draw" || status === "stalemate" || ["white", "black"].includes(game.winner?.toLowerCase() ?? "");
    const hasRequiredFields = game.id?.toLowerCase() === gameId.toLowerCase()
      && typeof game.rated === "boolean"
      && game.variant?.toLowerCase() === "standard"
      && typeof game.speed === "string" && game.speed.length > 0
      && completed && hasWinner
      && typeof game.source === "string" && game.source.length > 0
      && Number.isSafeInteger(game.createdAt) && (game.createdAt ?? 0) > 0
      && Number.isSafeInteger(game.lastMoveAt) && (game.lastMoveAt ?? 0) >= (game.createdAt ?? 0)
      && typeof game.players?.white?.user?.id === "string" && game.players.white.user.id.length > 0
      && typeof game.players?.black?.user?.id === "string" && game.players.black.user.id.length > 0
      && plies > 0;
    if (!hasRequiredFields) throw new Error("Lichess returned a game record without the completed-game fields Clutch needs to normalize.");
    console.log(`PASS: Lichess returned public game ${game.id} with the completed-game fields Clutch needs; status=${status}, speed=${game.speed}, plies=${plies}.`);
    console.log("This is a host-side endpoint check. It does not establish GenLayer validator agreement or claim eligibility.");
  } else {
    console.log("SKIP: set CLUTCH_PROBE_GAME_ID to check a public game record from this host.");
  }

  const lichessId = process.env.CLUTCH_PROBE_LICHESS_ID?.trim();
  if (lichessId) {
    if (!/^[a-z0-9_-]{3,30}$/i.test(lichessId)) throw new Error("CLUTCH_PROBE_LICHESS_ID must be a 3–30 character Lichess ID.");
    const response = await fetch(`https://lichess.org/api/user/${encodeURIComponent(lichessId)}?profile=true`, {
      headers: { accept: "application/json", "user-agent": "Clutch/0.1" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Lichess public profile returned HTTP ${response.status}; anonymous bio access is required for account linking.`);
    const profile = await response.json() as { id?: string; profile?: { bio?: string } };
    if (profile.id?.toLowerCase() !== lichessId.toLowerCase() || typeof profile.profile?.bio !== "string") {
      throw new Error("Lichess profile response did not expose the stable ID and bio required for account linking.");
    }
    console.log(`PASS: anonymous public profile lookup returned @${profile.id} and a bio field.`);
    console.log("This is a host-side endpoint check. The account-link contract path still needs a separate live consensus transaction.");
  } else {
    console.log("SKIP: set CLUTCH_PROBE_LICHESS_ID to check anonymous profile-bio access from this host.");
  }
}

main().catch((error: unknown) => {
  console.error(`Live preflight failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
