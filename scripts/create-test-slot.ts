import { existsSync, readFileSync } from "node:fs";
import {
  CHAIN_ID, EXPLORER_URL, checkNetwork, contractAddress, ensureWriteAcknowledgement,
  integrationRecordPath, loadEnv, makeReader, makeWriter, read, writeAndWait, writeJson,
} from "./lib.ts";

type Quest = {
  id: string;
  sponsor: string;
  state: string;
  compile_status: string;
  reason_codes: string[];
  rules: Record<string, unknown> | null;
  rule_hash: string;
  reward: number;
  starts_at_ms: number;
  ends_at_ms: number;
};

const DESCRIPTION = "Win a rated blitz game as White in no more than 40 full moves.";
const EXPECTED_RULES = {
  platform: "LICHESS",
  variant: "STANDARD",
  rated: "REQUIRED",
  speed: "BLITZ",
  player_color: "WHITE",
  result: "WIN",
  max_plies: 80,
};
const REWARD = 1;
const WINDOW_MS = 60 * 60 * 1000;
const START_DELAY_MS = 20 * 60 * 1000;

function sameAddress(left: string | undefined, right: string): boolean {
  return Boolean(left && left.toLowerCase() === right.toLowerCase());
}

function wat(timestamp: number): string {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

async function main(): Promise<void> {
  loadEnv();
  await checkNetwork();
  ensureWriteAcknowledgement();

  const address = contractAddress();
  const reader = makeReader();
  const sponsor = makeWriter("CLUTCH_PROBE_SPONSOR_PRIVATE_KEY");
  const player = makeWriter("CLUTCH_PROBE_PLAYER_PRIVATE_KEY");
  const basePath = integrationRecordPath();
  const baseState = JSON.parse(readFileSync(basePath, "utf8")) as Record<string, unknown>;
  const linkTx = baseState.linkTx;
  if (typeof linkTx !== "string" || !/^0x[\da-f]{64}$/i.test(linkTx) || !sameAddress(baseState.player as string, player.account.address)) {
    throw new Error(`The base integration record at ${basePath} has no verified link transaction for this player wallet.`);
  }
  const slotId = process.env.CLUTCH_TEST_SLOT_ID?.trim() || `fast-slot-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
  if (!/^[a-z0-9][a-z0-9-]{2,47}$/i.test(slotId)) throw new Error("CLUTCH_TEST_SLOT_ID must be 3–48 letters, digits, or hyphens.");
  process.env.CLUTCH_INTEGRATION_RUN_ID = slotId;
  const path = integrationRecordPath();
  if (existsSync(path)) throw new Error(`Refusing to overwrite existing slot record ${path}; choose another CLUTCH_TEST_SLOT_ID.`);
  if (baseState.contractAddress !== address) throw new Error("The base integration record belongs to a different contract.");
  const link = await read<{ wallet: string; lichess_id: string }>(reader, address, "get_link_for_wallet", [player.account.address]);
  if (!sameAddress(link.wallet, player.account.address) || link.lichess_id !== "wattxbt") {
    throw new Error("The configured player wallet is not linked to wattxbt on this contract.");
  }

  const account = await read<{ sponsor_available: number }>(reader, address, "get_account", [sponsor.account.address]);
  if ((account.sponsor_available ?? 0) < REWARD) throw new Error("The throwaway sponsor wallet has insufficient available DEMO for the test slot.");

  const count = await read<number>(reader, address, "get_quest_count");
  const quests = count > 0 ? await read<Quest[]>(reader, address, "list_quests", [0, Math.min(count, 50)]) : [];
  const startsAt = Date.now() + START_DELAY_MS;
  const endsAt = startsAt + WINDOW_MS;
  const overlapping = quests.find((quest) => quest.state === "ACTIVE" && startsAt <= quest.ends_at_ms && endsAt >= quest.starts_at_ms);
  if (overlapping) throw new Error(`The new slot would overlap active ${overlapping.id}; choose a non-overlapping window to prevent one game being claimed by multiple quests.`);

  const created = await writeAndWait(
    sponsor.client,
    address,
    "create_draft",
    [DESCRIPTION, REWARD, startsAt, endsAt],
    "Create same-day test slot",
  );
  const createdQuests = await read<Quest[]>(reader, address, "list_quests", [count, 1]);
  const quest = createdQuests[0];
  if (!quest?.id || !sameAddress(quest.sponsor, sponsor.account.address)) {
    throw new Error("The new test-slot draft could not be confirmed on-chain.");
  }

  const compiledTx = await writeAndWait(sponsor.client, address, "compile_draft", [quest.id], "Compile test-slot rules");
  const compiled = await read<Quest>(reader, address, "get_quest", [quest.id]);
  const rulesMatch = compiled.rules !== null && Object.entries(EXPECTED_RULES).every(([key, value]) => compiled.rules?.[key] === value);
  if (compiled.compile_status !== "COMPILED" || !rulesMatch || !/^[a-f0-9]{64}$/.test(compiled.rule_hash)) {
    throw new Error(`Test slot compiler output did not match the previously reviewed rules: ${compiled.reason_codes.join(", ") || compiled.compile_status}. Draft ${quest.id} remains unactivated.`);
  }
  if (Date.now() >= compiled.starts_at_ms) throw new Error(`Compilation finished after the scheduled start. Draft ${quest.id} remains unactivated.`);

  const activationTx = await writeAndWait(
    sponsor.client,
    address,
    "confirm_and_activate",
    [quest.id, compiled.rule_hash],
    "Activate same-day test slot",
  );
  const active = await read<Quest>(reader, address, "get_quest", [quest.id]);
  if (active.state !== "ACTIVE") throw new Error(`Activation finalized, but ${quest.id} is not ACTIVE.`);

  writeJson(path, {
    ...baseState,
    network: "studionet",
    chainId: CHAIN_ID,
    contractAddress: address,
    questId: quest.id,
    sponsor: sponsor.account.address,
    player: player.account.address,
    lichessId: link.lichess_id,
    description: DESCRIPTION,
    reward: REWARD,
    rules: compiled.rules,
    ruleHash: compiled.rule_hash,
    startsAt: compiled.starts_at_ms,
    endsAt: compiled.ends_at_ms,
    createTx: created.hash,
    compileTx: compiledTx.hash,
    activationTx: activationTx.hash,
    linkTx,
    enrollmentTx: undefined,
    claimTx: undefined,
  });

  console.log(`Activated ${quest.id} for @${link.lichess_id}; reward ${REWARD} DEMO.`);
  console.log(`Join after ${wat(active.starts_at_ms)} WAT and before starting the game.`);
  console.log(`Play window ends ${wat(active.ends_at_ms)} WAT; game must finish by then.`);
  console.log(`Activation receipt: ${EXPLORER_URL}/tx/${activationTx.hash}`);
  console.log(`Local record: ${path}`);
}

main().catch((error: unknown) => {
  console.error(`Test slot creation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
