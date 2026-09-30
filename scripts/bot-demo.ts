import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Account, Claim, LinkChallenge, Quest } from "../lib/contract.ts";
import { ROOT, CHAIN_ID, RUNNER, EXPLORER_URL, loadEnv, makeReader, makeWriter, read, checkNetwork, writeJson, ensureWriteAcknowledgement, waitForSuccessfulReceipt, type Hex, type ScriptClient } from "./lib.ts";
import { botAccount, challenge, acceptChallenge, gameState, move, draw, publicGame, upgradeEmptyDemoAccounts } from "./lichess-bot.ts";

const DESCRIPTION = "Draw a casual standard Lichess game with either color and any time control. No move limit.";
const ENV_PATH = resolve(ROOT, ".env.bot-demo");
const RECORD_PATH = resolve(ROOT, "deployments", "bot-demo-run.json");
const DEPLOY_PATH = resolve(ROOT, "deployments", "studionet-bot-demo.json");
const SEQUENCE = ["g1f3", "g8f6", "b1c3", "b8c6", "f3g1", "f6g8", "c3b1", "c6b8"];
type Journal = { hash: Hex; done: boolean };
type RecordState = {
  chainId: number; contractAddress: Hex; sponsor: string; player: string;
  transactions: Record<string, Journal>; questOffset?: number; questId?: string;
  whiteId?: string; blackId?: string; challengeId?: string; gameId?: string;
  linkText?: string; claimId?: string; outcome?: string; reward?: number;
};

function loadBotEnv(): void {
  if (!existsSync(ENV_PATH)) return;
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && match[2].trim() && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

function init(): void {
  let content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "# Local BOT demo secrets. Gitignored. Never paste tokens into chat.\n";
  for (const name of ["CLUTCH_BOT_SPONSOR_PRIVATE_KEY", "CLUTCH_BOT_PLAYER_PRIVATE_KEY"]) {
    if (!process.env[name]) {
      const key = `0x${randomBytes(32).toString("hex")}`;
      const empty = new RegExp(`^${name}=\\s*$`, "m");
      content = empty.test(content) ? content.replace(empty, `${name}=${key}`) : `${content}\n${name}=${key}\n`;
      process.env[name] = key;
    }
  }
  for (const name of ["CLUTCH_BOT_WHITE_TOKEN", "CLUTCH_BOT_BLACK_TOKEN", "CLUTCH_BOT_WHITE_ID", "CLUTCH_BOT_BLACK_ID"]) {
    if (!new RegExp(`^${name}=`, "m").test(content)) content += `${name}=\n`;
  }
  writeFileSync(ENV_PATH, content, { mode: 0o600 });
  console.log(`Local secrets file prepared: ${ENV_PATH}`);
  console.log(`Sponsor wallet: ${makeWriter("CLUTCH_BOT_SPONSOR_PRIVATE_KEY").account.address}`);
  console.log(`Player wallet: ${makeWriter("CLUTCH_BOT_PLAYER_PRIVATE_KEY").account.address}`);
}

function address(): Hex {
  const value = process.env.CLUTCH_BOT_DEMO_CONTRACT_ADDRESS || (existsSync(DEPLOY_PATH) ? (JSON.parse(readFileSync(DEPLOY_PATH, "utf8")) as { contractAddress: string }).contractAddress : "");
  if (!/^0x[\da-fA-F]{40}$/.test(value)) throw new Error("Deploy the BOT demo contract first: npm run deploy:bot.");
  return value as Hex;
}

function token(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Add ${name} to .env.bot-demo. Account setup steps: docs/AUTOMATED_DEMO.md.`);
  return value;
}

async function main(): Promise<void> {
  loadEnv(); loadBotEnv();
  const phase = process.argv[2] ?? "status";
  if (!["init", "upgrade", "preflight", "prepare", "run", "status"].includes(phase)) throw new Error("Use init, upgrade, preflight, prepare, run, or status.");
  if (phase === "init") { init(); return; }
  if (phase === "upgrade") {
    if (!process.argv.includes("--confirm-irreversible-bot-upgrade")) throw new Error("BOT conversion is irreversible. Use upgrade --confirm-irreversible-bot-upgrade only for the two dedicated, never-played demo accounts.");
    await upgradeEmptyDemoAccounts([
      { token: token("CLUTCH_BOT_WHITE_TOKEN"), expectedId: token("CLUTCH_BOT_WHITE_ID") },
      { token: token("CLUTCH_BOT_BLACK_TOKEN"), expectedId: token("CLUTCH_BOT_BLACK_ID") },
    ]);
    return;
  }
  const reader = makeReader(); const contract = address();
  await checkNetwork();
  const info = await read<{ version: string; chain_id: number; contract: string; runner: string; participant_modes: string[] }>(reader, contract, "get_contract_info");
  if (info.version !== "clutch/0.2.0" || info.chain_id !== CHAIN_ID || info.contract.toLowerCase() !== contract.toLowerCase() || !info.runner.includes(RUNNER) || !info.participant_modes.includes("BOT_DEMO")) throw new Error("The configured contract is not the pinned Clutch BOT demo deployment.");
  if (phase === "status") {
    console.log(`Live demo contract: ${contract} (${info.version})`);
    if (!existsSync(RECORD_PATH)) { console.log("No automated run recorded yet."); return; }
    const saved = JSON.parse(readFileSync(RECORD_PATH, "utf8")) as RecordState;
    if (saved.contractAddress.toLowerCase() !== contract.toLowerCase()) throw new Error("Saved run belongs to a different contract.");
    console.log(`Quest: ${saved.questId ?? "not created"}; game: ${saved.gameId ?? "not played"}; outcome: ${saved.outcome ?? "not claimed"}`);
    if (saved.questId) console.log(JSON.stringify(await read<Quest>(reader, contract, "get_quest", [saved.questId]), null, 2));
    return;
  }
  // Account verification is sequential to respect Lichess API guidance.
  const whiteToken = phase === "prepare" ? undefined : token("CLUTCH_BOT_WHITE_TOKEN");
  const blackToken = phase === "prepare" ? undefined : token("CLUTCH_BOT_BLACK_TOKEN");
  const white = whiteToken ? await botAccount(whiteToken) : undefined;
  const black = blackToken ? await botAccount(blackToken) : undefined;
  if (white && black && white.id === black.id) throw new Error("Use two different controlled BOT accounts.");
  if (phase === "preflight") { console.log(`Ready: ${white!.username} vs ${black!.username}; casual BOT API only.`); return; }
  ensureWriteAcknowledgement();
  const sponsor = makeWriter("CLUTCH_BOT_SPONSOR_PRIVATE_KEY");
  const player = makeWriter("CLUTCH_BOT_PLAYER_PRIVATE_KEY");
  mkdirSync(resolve(ROOT, "deployments"), { recursive: true });
  const lockPath = `${RECORD_PATH}.lock`;
  let lock: number;
  try { lock = openSync(lockPath, "wx"); } catch { throw new Error("Another run may be active. If it crashed, inspect pending transactions before removing deployments/bot-demo-run.json.lock."); }
  try {
    const state: RecordState = existsSync(RECORD_PATH) ? JSON.parse(readFileSync(RECORD_PATH, "utf8")) as RecordState : {
      chainId: CHAIN_ID, contractAddress: contract, sponsor: sponsor.account.address, player: player.account.address, transactions: {},
    };
    if (state.contractAddress.toLowerCase() !== contract.toLowerCase() || state.sponsor.toLowerCase() !== sponsor.account.address.toLowerCase() || state.player.toLowerCase() !== player.account.address.toLowerCase()) throw new Error("Run record and configured wallets/contract differ. Preserve the original run record.");
    const save = () => writeJson(RECORD_PATH, state);
    save();
    for (const [label, transaction] of Object.entries(state.transactions)) {
      if (!transaction.done) {
        await waitForSuccessfulReceipt(reader, transaction.hash, `Resume ${label}`);
        transaction.done = true; save();
      }
    }
    async function execute(label: string, client: ScriptClient, fn: string, args: unknown[]): Promise<void> {
      let transaction = state.transactions[label];
      if (transaction?.done) return;
      if (!transaction) {
        const hash = await client.writeContract({ address: contract, functionName: fn, args: args as never, value: 0n }) as Hex;
        transaction = { hash, done: false }; state.transactions[label] = transaction; save();
      }
      console.log(`${label}: ${transaction.hash}`);
      await waitForSuccessfulReceipt(client, transaction.hash, label);
      transaction.done = true; save();
    }
    async function publishAward(claim: Claim, settled: Quest): Promise<void> {
      state.claimId = claim.id; state.outcome = claim.outcome; state.reward = claim.reward_demo_units; save();
      if (claim.outcome !== "VERIFIED" || claim.reward_demo_units !== 1 || claim.participant_policy !== "BOT_DEMO" || claim.claimant !== state.player.toLowerCase() || claim.lichess_id !== state.whiteId || claim.game_id !== state.gameId || claim.rule_hash !== settled.activation_hash) throw new Error("Claim does not match the controlled BOT run. Inspect its public receipt; no successful proof was published.");
      const accounting = await read<Account>(reader, contract, "get_account", [state.player]);
      if (settled.state !== "AWARDED" || settled.winning_claim_id !== claim.id || settled.winner !== state.player.toLowerCase() || accounting.awarded < 1 || accounting.total_issued !== accounting.total_available + accounting.total_reserved + accounting.total_awarded) throw new Error("Receipt and award accounting do not agree.");
      const index = Number(claim.id.split("-claim-").at(-1)) - 1;
      const transaction = state.transactions[`claim-${index}`];
      if (!transaction) throw new Error("The successful claim's transaction is missing from the run record; inspect the explorer before publishing proof.");
      await waitForSuccessfulReceipt(player.client, transaction.hash, "Recorded successful claim");
      transaction.done = true; save();
      writeJson(resolve(ROOT, "public", "bot-demo-proof.json"), {
        label: "Scripted casual BOT demo; DEMO has no cash value", chainId: CHAIN_ID,
        contractAddress: contract, questId: state.questId, gameId: state.gameId,
        white: state.whiteId, black: state.blackId, claimId: claim.id, claimTx: transaction.hash,
        outcome: claim.outcome, reward: claim.reward_demo_units, evidenceHash: claim.evidence_hash, ruleHash: settled.rule_hash,
      });
      console.log(`Verified BOT demo: ${state.gameId}, ${claim.id}, 1 DEMO. ${EXPLORER_URL}/address/${contract}`);
    }
    if (!state.questId) {
      const account = await read<Account>(reader, contract, "get_account", [state.sponsor]);
      if (!account.starter_claimed) await execute("starter", sponsor.client, "claim_starter_allocation", []);
      state.questOffset ??= await read<number>(reader, contract, "get_quest_count"); save();
      await execute("draft", sponsor.client, "create_bot_demo_draft", [DESCRIPTION, 1, 3_600_000]);
      const candidates = (await read<Quest[]>(reader, contract, "list_quests", [state.questOffset, 50])).filter(q => q.sponsor === state.sponsor.toLowerCase() && q.participant_policy === "BOT_DEMO" && q.description === DESCRIPTION);
      if (candidates.length !== 1) throw new Error("Cannot identify a unique BOT draft from the recorded transaction; inspect the explorer before continuing.");
      state.questId = candidates[0].id; save();
    }
    let quest = await read<Quest>(reader, contract, "get_quest", [state.questId]);
    if (quest.state === "DRAFT") { await execute("compile", sponsor.client, "compile_draft", [state.questId]); quest = await read<Quest>(reader, contract, "get_quest", [state.questId]); }
    const rules = quest.rules;
    if (quest.participant_policy !== "BOT_DEMO" || quest.window_mode !== "ACTIVATION_RELATIVE" || quest.window_duration_ms !== 3_600_000 || quest.reward !== 1 || quest.description !== DESCRIPTION || !rules || rules.platform !== "LICHESS" || rules.variant !== "STANDARD" || rules.rated !== "FORBIDDEN" || rules.speed !== "ANY" || rules.player_color !== "ANY" || rules.result !== "DRAW" || rules.max_plies != null || !/^[a-f0-9]{64}$/.test(quest.rule_hash)) throw new Error("Compiled rules or frozen demo policy differ from the exact intended casual draw quest. Inspect before activation.");
    if (phase === "prepare") { console.log(`Prepared ${state.questId}: frozen casual BOT draw, 1 DEMO; window opens on activation. No chess required.`); return; }
    if (!white || !black || !whiteToken || !blackToken) throw new Error("Both BOT tokens are required.");
    if ((state.whiteId && state.whiteId !== white.id) || (state.blackId && state.blackId !== black.id)) throw new Error("Tokens belong to different accounts than the saved run.");
    state.whiteId = white.id; state.blackId = black.id; save();
    const linked = await read<{ lichess_id?: string }>(reader, contract, "get_link_for_wallet", [state.player]);
    if (linked.lichess_id && linked.lichess_id !== white.id) throw new Error("The demo player wallet is linked to a different Lichess account.");
    if (!linked.lichess_id) {
      let link: LinkChallenge | undefined;
      try { link = await read<LinkChallenge>(reader, contract, "get_active_link_challenge", [state.player]); }
      catch (error) { if (!(error instanceof Error) || !error.message.includes("NO_ACTIVE_CHALLENGE")) throw error; }
      if (!link?.nonce || link.expires_at_ms <= Date.now()) {
        await execute(`link-challenge-${link?.nonce ?? "initial"}`, player.client, "request_link_challenge", [white.id]);
        link = await read<LinkChallenge>(reader, contract, "get_active_link_challenge", [state.player]);
      }
      state.linkText = link.text; save();
      const profileResponse = await fetch(`https://lichess.org/api/user/${encodeURIComponent(white.id)}?profile=true`, { signal: AbortSignal.timeout(20_000) });
      if (!profileResponse.ok) throw new Error(`BOT profile: HTTP ${profileResponse.status}.`);
      const profile = await profileResponse.json() as { profile?: { bio?: string } };
      if (!profile.profile?.bio?.includes(link.text)) {
        console.log(`One-time ownership setup: put this exact public line in ${white.username}'s Lichess bio, then rerun. It expires at ${new Date(link.expires_at_ms).toISOString()}.`);
        console.log(link.text); return;
      }
      const prefix = `verify-link-${link.nonce}-`;
      const pending = Object.entries(state.transactions).find(([label, tx]) => label.startsWith(prefix) && !tx.done);
      const attempts = Object.keys(state.transactions).filter(key => key.startsWith(prefix)).length;
      await execute(pending?.[0] ?? `${prefix}${attempts}`, player.client, "verify_link_challenge", [link.nonce]);
      const verified = await read<{ lichess_id?: string }>(reader, contract, "get_link_for_wallet", [state.player]);
      if (verified.lichess_id !== white.id) throw new Error("Validators have not confirmed BOT profile ownership yet. The quest has not been activated; inspect the link transaction and rerun.");
    }
    if (quest.state === "COMPILED") {
      await execute("activate", sponsor.client, "confirm_and_activate", [state.questId, quest.rule_hash]);
      quest = await read<Quest>(reader, contract, "get_quest", [state.questId]);
    }
    if (quest.state === "AWARDED") {
      const claim = await read<Claim>(reader, contract, "get_claim", [quest.winning_claim_id]);
      await publishAward(claim, quest); return;
    }
    if (quest.state !== "ACTIVE" || Date.now() >= quest.ends_at_ms) throw new Error("The demo play window is closed. Inspect/refund this run before preparing a new one.");
    const enrollment = await read<{ enrolled?: boolean }>(reader, contract, "get_enrollment", [state.questId, state.player]);
    if (!enrollment.enrolled) await execute("enroll", player.client, "join_quest", [state.questId]);
    if (!state.challengeId) { state.challengeId = await challenge(whiteToken, black.id); save(); }
    if (!state.gameId) {
      // Accept immediately: a live challenge can expire within twenty seconds.
      // If acceptance already succeeded before a crash, recover the same game.
      try { await acceptChallenge(blackToken, state.challengeId); }
      catch (failure) {
        if (!(failure instanceof Error) || !/HTTP (400|404)\b/.test(failure.message)) throw failure;
        await gameState(whiteToken, state.challengeId);
      }
      state.gameId = state.challengeId; save();
    }
    let finished = false;
    for (let step = 0; step < 24; step++) {
      const game = await gameState(whiteToken, state.gameId);
      if (game.id !== state.gameId || game.rated !== false || game.variant.key !== "standard" || game.white.id !== white.id || game.black.id !== black.id || game.white.title !== "BOT" || game.black.title !== "BOT") throw new Error("Live game differs from the two controlled casual BOT accounts. No moves sent.");
      if (game.state.status === "draw" || game.state.status === "stalemate") { finished = true; break; }
      if (game.state.status !== "started") throw new Error(`Game ended as ${game.state.status}; expected a draw.`);
      const played = game.state.moves.trim() ? game.state.moves.trim().split(/\s+/) : [];
      if (played.length > SEQUENCE.length || played.some((uci, i) => uci !== SEQUENCE[i])) throw new Error("Game moves differ from the known legal demo sequence. No further moves sent.");
      if (played.length < SEQUENCE.length) {
        await move(played.length % 2 === 0 ? whiteToken : blackToken, state.gameId, SEQUENCE[played.length]);
      } else {
        await draw(whiteToken, state.gameId); await draw(blackToken, state.gameId);
      }
    }
    if (!finished) throw new Error("Lichess has not confirmed the draw yet. Rerun to resume the same game.");
    const exported = await publicGame(state.gameId);
    if (exported.id !== state.gameId || exported.rated !== false || exported.status !== "draw" || typeof exported.moves !== "string" || !exported.moves.trim()) throw new Error("Public game export is not yet a finished casual draw with moves. Rerun when the export updates.");
    const existing = await read<Claim[]>(reader, contract, "list_claims", [state.questId, 0, 50]);
    let claim = existing.find(c => c.game_id === state.gameId && c.outcome !== "INSUFFICIENT_EVIDENCE");
    if (!claim) {
      // One attempt per invocation; the contract enforces retry cooldown and rejects processed games.
      await execute(`claim-${existing.length}`, player.client, "submit_game", [state.questId, state.gameId]);
      const claims = await read<Claim[]>(reader, contract, "list_claims", [state.questId, 0, 50]);
      claim = claims.filter(c => c.game_id === state.gameId).at(-1);
    }
    if (!claim) throw new Error("Claim transaction completed but no public receipt was found.");
    const settled = await read<Quest>(reader, contract, "get_quest", [state.questId]);
    await publishAward(claim, settled);
  } finally { closeSync(lock); unlinkSync(lockPath); }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "BOT demo stopped. Inspect the local run record before retrying.");
  process.exitCode = 1;
});
