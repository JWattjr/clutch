import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHAIN_ID, EXPLORER_URL, RUNNER, ROOT, checkNetwork, contractAddress,
  ensurePinnedRunner, ensureWriteAcknowledgement, integrationRecordPath, loadEnv,
  makeReader, makeWriter, read, writeAndWait, writeJson,
} from "./lib.ts";

type RuleSet = {
  platform: string;
  variant: string;
  rated: string;
  speed: string;
  player_color: string;
  result: string;
  max_plies?: number;
};
type Quest = {
  id: string;
  sponsor: string;
  state: string;
  compile_status: string;
  reason_codes: string[];
  rules: RuleSet | null;
  rule_hash: string;
  reward: number;
  starts_at_ms: number;
  ends_at_ms: number;
};
type LinkChallenge = { nonce: string; wallet: string; lichess_id: string; text: string; expires_at_ms: number; state: string };
type Enrollment = { enrolled?: boolean; lichess_id?: string; enrolled_at_ms?: number };
type Claim = { id: string; game_id: string; claimant: string; outcome: string; evidence_hash: string; reward_demo_units: number };
type IntegrationRecord = {
  network: "studionet";
  chainId: number;
  contractAddress: string;
  sponsor: string;
  player: string;
  lichessId?: string;
  description: string;
  reward: number;
  questId: string;
  rules?: RuleSet;
  ruleHash?: string;
  createTx?: string;
  compileTx?: string;
  activationTx?: string;
  challengeNonce?: string;
  challengeText?: string;
  challengeExpiresAt?: number;
  linkTx?: string;
  enrollmentTx?: string;
  gameId?: string;
  claimId?: string;
  claimTx?: string;
  claimOutcome?: string;
  unsupportedQuestId?: string;
  unsupportedCreateTx?: string;
  unsupportedCompileTx?: string;
  unsupportedCompileStatus?: string;
  unsupportedReasonCodes?: string[];
};

const EXPECTED_DESCRIPTION = "Win a rated blitz game as White in no more than 40 full moves.";
const UNSUPPORTED_DESCRIPTION = "Win three games consecutively.";
const usage = `Usage: npm run test:integration -- <phase>

Phases: status, prepare, activate, link-challenge, verify-link, join, claim
Writes require CLUTCH_ALLOW_STUDIONET_WRITES=I_APPROVE_STUDIONET_DEMO_STATE_CHANGES.
`;

function loadRecord(path: string): IntegrationRecord {
  return JSON.parse(readFileSync(path, "utf8")) as IntegrationRecord;
}

function saveRecord(path: string, state: IntegrationRecord): void {
  writeJson(path, state);
}

function sameAddress(left: string | undefined, right: string): boolean {
  return Boolean(left && left.toLowerCase() === right.toLowerCase());
}

async function main(): Promise<void> {
  loadEnv();
  const phase = process.argv[2] ?? "status";
  const path = integrationRecordPath();
  if (!["status", "prepare", "activate", "link-challenge", "verify-link", "join", "claim"].includes(phase)) {
    console.log(usage);
    throw new Error(`Unknown integration phase: ${phase}`);
  }

  if (phase === "status") {
    if (existsSync(path)) console.log(JSON.stringify(loadRecord(path), null, 2));
    else console.log(`No integration run record exists at ${path}. Start with the prepare phase.`);
    return;
  }
  await checkNetwork();
  const address = contractAddress();
  const reader = makeReader();
  ensureWriteAcknowledgement();

  if (phase === "prepare") {
    if (existsSync(path)) throw new Error(`A record already exists at ${path}; choose a new CLUTCH_INTEGRATION_RUN_ID to preserve the prior run.`);
    const source = readFileSync(resolve(ROOT, "contracts", "clutch.py"), "utf8");
    ensurePinnedRunner(source);
    const sponsor = makeWriter("CLUTCH_PROBE_SPONSOR_PRIVATE_KEY");
    const player = makeWriter("CLUTCH_PROBE_PLAYER_PRIVATE_KEY");
    const lichessId = process.env.CLUTCH_PROBE_LICHESS_ID?.trim().toLowerCase();
    if (lichessId && !/^[a-z0-9_-]{3,30}$/.test(lichessId)) throw new Error("Set a valid public CLUTCH_PROBE_LICHESS_ID in .env.");
    if (sameAddress(sponsor.account.address, player.account.address)) throw new Error("Use separate sponsor and player wallets for the integration flow.");

    const info = await read<{ version?: string; chain_id?: number; runner?: string }>(reader, address, "get_contract_info");
    if (info.version !== "clutch/0.1.1" || info.chain_id !== CHAIN_ID || !info.runner?.includes(RUNNER)) {
      throw new Error("Configured contract is not the pinned Clutch build on stable Studionet.");
    }
    const sponsorAccount = await read<{ starter_claimed?: boolean; sponsor_available?: number }>(reader, address, "get_account", [sponsor.account.address]);
    if (!sponsorAccount.starter_claimed) await writeAndWait(sponsor.client, address, "claim_starter_allocation", [], "Claim sponsor demo allocation");
    const fundedAccount = await read<{ sponsor_available?: number }>(reader, address, "get_account", [sponsor.account.address]);
    if ((fundedAccount.sponsor_available ?? 0) < 25) throw new Error("Sponsor needs at least 25 available DEMO units before this probe can create its quest.");

    const before = await read<number>(reader, address, "get_quest_count");
    const reward = 25;
    const startsAt = Date.now() + 24 * 60 * 60_000;
    const endsAt = startsAt + 48 * 60 * 60_000;
    const create = await writeAndWait(sponsor.client, address, "create_draft", [EXPECTED_DESCRIPTION, reward, startsAt, endsAt], "Create integration quest draft");
    const created = await read<Quest[]>(reader, address, "list_quests", [before, 1]);
    const quest = created[0];
    if (!quest?.id || !sameAddress(quest.sponsor, sponsor.account.address)) throw new Error("Could not read back the newly created sponsor draft.");
    const state: IntegrationRecord = {
      network: "studionet", chainId: CHAIN_ID, contractAddress: address,
      sponsor: sponsor.account.address, player: player.account.address, lichessId,
      description: EXPECTED_DESCRIPTION, reward, questId: quest.id, createTx: create.hash,
    };
    saveRecord(path, state);

    const compile = await writeAndWait(sponsor.client, address, "compile_draft", [quest.id], "Compile integration quest");
    const compiled = await read<Quest>(reader, address, "get_quest", [quest.id]);
    if (compiled.compile_status !== "COMPILED" || !compiled.rules || !compiled.rule_hash) {
      saveRecord(path, { ...state, compileTx: compile.hash, rules: compiled.rules ?? undefined, ruleHash: compiled.rule_hash || undefined });
      throw new Error(`Consensus compiler returned ${compiled.compile_status}: ${compiled.reason_codes.join(", ") || "no reason supplied"}. The draft remains inspectable.`);
    }
    if (compiled.rules.platform !== "LICHESS" || compiled.rules.variant !== "STANDARD" || compiled.rules.result !== "WIN" || compiled.rules.rated !== "REQUIRED" || compiled.rules.speed !== "BLITZ" || compiled.rules.player_color !== "WHITE" || compiled.rules.max_plies !== 80) {
      saveRecord(path, { ...state, compileTx: compile.hash, rules: compiled.rules, ruleHash: compiled.rule_hash });
      throw new Error("The live compiler did not preserve the exact supported integration conditions; review the draft before activation.");
    }
    saveRecord(path, { ...state, compileTx: compile.hash, rules: compiled.rules, ruleHash: compiled.rule_hash });
    const afterSupportedCompile: IntegrationRecord = { ...state, compileTx: compile.hash, rules: compiled.rules, ruleHash: compiled.rule_hash };
    const unsupportedCount = await read<number>(reader, address, "get_quest_count");
    const unsupportedCreate = await writeAndWait(
      sponsor.client, address, "create_draft", [UNSUPPORTED_DESCRIPTION, 1, startsAt, endsAt], "Create unsupported compiler probe draft",
    );
    const unsupportedDrafts = await read<Quest[]>(reader, address, "list_quests", [unsupportedCount, 1]);
    const unsupportedQuest = unsupportedDrafts[0];
    if (!unsupportedQuest?.id || !sameAddress(unsupportedQuest.sponsor, sponsor.account.address)) {
      throw new Error("Could not read back the unsupported-condition compiler draft.");
    }
    const unsupportedCompile = await writeAndWait(
      sponsor.client, address, "compile_draft", [unsupportedQuest.id], "Compile unsupported integration quest",
    );
    const rejected = await read<Quest>(reader, address, "get_quest", [unsupportedQuest.id]);
    const withUnsupported: IntegrationRecord = {
      ...afterSupportedCompile,
      unsupportedQuestId: unsupportedQuest.id,
      unsupportedCreateTx: unsupportedCreate.hash,
      unsupportedCompileTx: unsupportedCompile.hash,
      unsupportedCompileStatus: rejected.compile_status,
      unsupportedReasonCodes: rejected.reason_codes,
    };
    saveRecord(path, withUnsupported);
    if (rejected.compile_status !== "UNSUPPORTED" || rejected.rules !== null || !rejected.reason_codes.includes("UNSUPPORTED_MULTIGAME")) {
      throw new Error(`Live unsupported-condition check returned ${rejected.compile_status}: ${rejected.reason_codes.join(", ") || "no reason supplied"}.`);
    }
    console.log(`Compiled ${quest.id} with the expected canonical rules.`);
    console.log(`Rejected ${unsupportedQuest.id} with ${rejected.reason_codes.join(", ")}.`);
    console.log(`Progress record: ${path}`);
    console.log("Next run activate to reserve the supported quest's DEMO reward; the script does not activate either draft without an explicit phase call.");
    return;
  }

  const state = loadRecord(path);
  if (state.contractAddress.toLowerCase() !== address.toLowerCase()) throw new Error("The progress record belongs to a different contract address.");

  if (phase === "activate") {
    const { account, client } = makeWriter("CLUTCH_PROBE_SPONSOR_PRIVATE_KEY");
    if (!sameAddress(state.sponsor, account.address) || !state.ruleHash) throw new Error("Sponsor key or compiled rule hash does not match the saved integration draft.");
    const result = await writeAndWait(client, address, "confirm_and_activate", [state.questId, state.ruleHash], "Activate integration quest");
    const quest = await read<Quest>(reader, address, "get_quest", [state.questId]);
    if (quest.state !== "ACTIVE") throw new Error("Activation transaction finalized, but the quest view is not ACTIVE.");
    saveRecord(path, { ...state, activationTx: result.hash });
    console.log(`Quest ${state.questId} is active. Its current play window is in the public contract record.`);
    return;
  }

  if (phase === "link-challenge") {
    const { account, client } = makeWriter("CLUTCH_PROBE_PLAYER_PRIVATE_KEY");
    if (!sameAddress(state.player, account.address) || !state.activationTx) throw new Error("Activate the quest first and use the saved player key.");
    const lichessId = process.env.CLUTCH_PROBE_LICHESS_ID?.trim().toLowerCase() || state.lichessId;
    if (!lichessId || !/^[a-z0-9_-]{3,30}$/.test(lichessId)) throw new Error("Set CLUTCH_PROBE_LICHESS_ID to a public Lichess account you control before requesting its profile challenge.");
    await writeAndWait(client, address, "request_link_challenge", [lichessId], "Request Lichess bio challenge");
    const challenge = await read<LinkChallenge>(reader, address, "get_active_link_challenge", [account.address]);
    if (!challenge.nonce || !challenge.text || challenge.state !== "PENDING") throw new Error("The contract did not expose a pending profile challenge.");
    saveRecord(path, { ...state, lichessId, challengeNonce: challenge.nonce, challengeText: challenge.text, challengeExpiresAt: challenge.expires_at_ms });
    console.log(`Add this exact text to @${lichessId}'s public profile bio before ${new Date(challenge.expires_at_ms).toISOString()}:`);
    console.log(challenge.text);
    console.log("The script will not edit the Lichess profile. Remove the challenge after the contract verifies it.");
    return;
  }

  if (phase === "verify-link") {
    const { account, client } = makeWriter("CLUTCH_PROBE_PLAYER_PRIVATE_KEY");
    if (!sameAddress(state.player, account.address) || !state.challengeNonce) throw new Error("Request a profile challenge first and use the saved player key.");
    const result = await writeAndWait(client, address, "verify_link_challenge", [state.challengeNonce], "Verify Lichess profile ownership");
    const link = await read<{ wallet: string; lichess_id: string }>(reader, address, "get_link_for_wallet", [account.address]);
    if (!sameAddress(link.wallet, account.address) || link.lichess_id !== state.lichessId) throw new Error("The finalized profile transaction did not create the expected public account binding.");
    console.log(`Profile link verified in ${EXPLORER_URL}/tx/${result.hash}. Remove the temporary bio challenge when ready.`);
    saveRecord(path, { ...state, linkTx: result.hash });
    return;
  }

  if (phase === "join") {
    const { account, client } = makeWriter("CLUTCH_PROBE_PLAYER_PRIVATE_KEY");
    if (!sameAddress(state.player, account.address) || !state.linkTx) throw new Error("Verify the profile challenge first and use the saved player key.");
    const quest = await read<Quest>(reader, address, "get_quest", [state.questId]);
    if (quest.state !== "ACTIVE") throw new Error(`Quest ${state.questId} is ${quest.state}; enrollment requires an active quest.`);
    if (Date.now() < quest.starts_at_ms) throw new Error(`The play window opens ${new Date(quest.starts_at_ms).toISOString()}. Join after it opens and before starting a game.`);
    if (Date.now() > quest.ends_at_ms) throw new Error(`The play window closed ${new Date(quest.ends_at_ms).toISOString()}; new enrollment is unavailable.`);
    const result = await writeAndWait(client, address, "join_quest", [state.questId], "Join the integration quest");
    const enrollment = await read<Enrollment>(reader, address, "get_enrollment", [state.questId, account.address]);
    if (!enrollment.enrolled) throw new Error("Join transaction finalized, but the enrollment view did not confirm it.");
    saveRecord(path, { ...state, enrollmentTx: result.hash });
    console.log(`Enrolled @${enrollment.lichess_id} at ${new Date(enrollment.enrolled_at_ms ?? 0).toISOString()}. Play a fresh qualifying game after activation and enrollment.`);
    return;
  }

  if (phase === "claim") {
    const { account, client } = makeWriter("CLUTCH_PROBE_PLAYER_PRIVATE_KEY");
    if (!sameAddress(state.player, account.address) || !state.enrollmentTx || !state.activationTx) throw new Error("Activate, verify the link, and enroll before submitting a game.");
    const gameId = process.env.CLUTCH_PROBE_GAME_ID?.trim();
    if (!gameId || !/^[A-Za-z0-9]{8}$/.test(gameId)) throw new Error("Set CLUTCH_PROBE_GAME_ID to the 8-character ID of a freshly played Lichess game.");
    const submitted = await writeAndWait(client, address, "submit_game", [state.questId, gameId], "Submit fresh Lichess game");
    const claims = await read<Claim[]>(reader, address, "list_claims", [state.questId, 0, 50]);
    const claim = claims.find((item) => item.game_id.toLowerCase() === gameId.toLowerCase() && sameAddress(item.claimant, account.address));
    if (!claim) throw new Error("The finalized claim transaction has no matching public claim receipt.");
    saveRecord(path, { ...state, gameId, claimId: claim.id, claimTx: submitted.hash, claimOutcome: claim.outcome });
    console.log(`Claim ${claim.id}: ${claim.outcome}; evidence hash ${claim.evidence_hash}.`);
    if (claim.outcome === "VERIFIED" && claim.reward_demo_units === state.reward) {
      console.log("PASS: contract awarded the frozen DEMO reward. Run npm run verify:proof to check the public receipt.");
      return;
    }
    console.error("The game did not produce a verified award. The on-chain receipt records the actual outcome; this is not a passing live claim.");
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(`Integration phase failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
