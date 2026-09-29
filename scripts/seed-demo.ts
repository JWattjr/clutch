import {
  checkNetwork, contractAddress, ensureWriteAcknowledgement, loadEnv, makeReader,
  makeWriter, read, writeAndWait,
} from "./lib.ts";

type ContractInfo = { version?: string; chain_id?: number };
type Account = { starter_claimed?: boolean; sponsor_available?: number };
type Quest = { id: string; sponsor: string };

async function main(): Promise<void> {
  loadEnv();
  ensureWriteAcknowledgement();
  const address = contractAddress();
  const reader = makeReader();
  const { account, client } = makeWriter("CLUTCH_DEMO_PRIVATE_KEY");
  await checkNetwork();

  const info = await read<ContractInfo>(reader, address, "get_contract_info");
  if (info.version !== "clutch/0.1.1") throw new Error(`Expected clutch/0.1.1 at ${address}, got ${info.version ?? "unknown"}.`);
  const current = await read<Account>(reader, address, "get_account", [account.address]);
  if (!current.starter_claimed) {
    await writeAndWait(client, address, "claim_starter_allocation", [], "Claim one-time demo allocation");
  }
  const available = await read<Account>(reader, address, "get_account", [account.address]);

  const description = process.env.CLUTCH_SEED_DESCRIPTION?.trim()
    ?? "Win a rated blitz game as White in no more than 40 full moves.";
  if (description.length < 8 || description.length > 1000) throw new Error("CLUTCH_SEED_DESCRIPTION must be 8–1000 characters.");
  const reward = Number(process.env.CLUTCH_SEED_REWARD ?? 25);
  if (!Number.isSafeInteger(reward) || reward < 1 || reward > 100) throw new Error("CLUTCH_SEED_REWARD must be an integer from 1 to 100.");
  if ((available.sponsor_available ?? 0) < reward) throw new Error(`Wallet has ${available.sponsor_available ?? 0} available DEMO units; ${reward} are required for this draft.`);
  const startsAt = Date.now() + 30 * 60_000;
  const endsAt = startsAt + 24 * 60 * 60_000;
  const countBefore = await read<number>(reader, address, "get_quest_count");
  const created = await writeAndWait(client, address, "create_draft", [description, reward, startsAt, endsAt], "Create a sample draft");
  const quests = await read<Quest[]>(reader, address, "list_quests", [countBefore, 1]);
  const quest = quests[0];
  if (!quest?.id || quest.sponsor.toLowerCase() !== account.address.toLowerCase()) throw new Error("The draft transaction finalized, but the new sponsor draft could not be identified.");
  const questId = quest.id;
  console.log(`Draft ${questId} created for ${account.address}.`);
  console.log(`Explorer: https://explorer-studio.genlayer.com/tx/${created.hash}`);
  console.log("Open Sponsor a quest to inspect and compile the draft.");
  console.log("This seeds a draft only. It does not invent a player, game, proof, badge, or awarded reward.");
}

main().catch((error: unknown) => {
  console.error(`Demo seed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
