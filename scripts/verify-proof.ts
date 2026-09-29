import { existsSync, readFileSync } from "node:fs";
import { contractAddress, EXPLORER_URL, checkNetwork, integrationRecordPath, loadEnv, makeReader, read } from "./lib.ts";

type Claim = {
  id: string;
  quest_id: string;
  game_id: string;
  claimant: string;
  outcome: string;
  evidence_hash: string;
  reward_demo_units: number;
  settled_at_ms?: number;
};
type Quest = { id: string; state: string; winner: string; winning_claim_id: string; reward: number };
type Account = { awarded: number };
type ContractInfo = { version: string; chain_id: number; runner: string };
type IntegrationRecord = { claimId?: string; claimTx?: string };

async function main(): Promise<void> {
  loadEnv();
  await checkNetwork();
  const address = contractAddress();
  const reader = makeReader();
  const info = await read<ContractInfo>(reader, address, "get_contract_info");
  if (info.version !== "clutch/0.1.1" || info.chain_id !== 61999) throw new Error("Configured address is not the expected Clutch contract on Studionet.");

  let integration: IntegrationRecord = {};
  const recordPath = integrationRecordPath();
  if (existsSync(recordPath)) integration = JSON.parse(readFileSync(recordPath, "utf8")) as IntegrationRecord;
  const claimId = process.env.CLUTCH_PROOF_CLAIM_ID?.trim() || integration.claimId;
  if (!claimId) throw new Error("Set CLUTCH_PROOF_CLAIM_ID to a claim ID returned by the Clutch contract.");

  const claim = await read<Claim>(reader, address, "get_claim", [claimId]);
  const quest = await read<Quest>(reader, address, "get_quest", [claim.quest_id]);
  const account = await read<Account>(reader, address, "get_account", [claim.claimant]);
  if (claim.id !== claimId || claim.outcome !== "VERIFIED" || !/^[0-9a-f]{64}$/i.test(claim.evidence_hash) || claim.reward_demo_units <= 0 || !claim.settled_at_ms) {
    throw new Error("The on-chain claim is not a complete verified receipt with a settled DEMO award.");
  }
  if (quest.state !== "AWARDED" || quest.winning_claim_id !== claim.id || quest.winner.toLowerCase() !== claim.claimant.toLowerCase() || quest.reward !== claim.reward_demo_units) {
    throw new Error("Quest state, winning claim, beneficiary, and awarded amount do not agree.");
  }
  if (account.awarded < claim.reward_demo_units) throw new Error("The beneficiary account does not reflect the award recorded by this receipt.");

  console.log("PASS: public contract state contains a finalized verified claim and matching single-award quest state.");
  console.log(`Contract: ${EXPLORER_URL}/address/${address}`);
  console.log(`Claim: ${claim.id} · quest ${claim.quest_id} · Lichess game ${claim.game_id}`);
  console.log(`Evidence SHA-256: ${claim.evidence_hash}`);
  console.log(`Award: ${claim.reward_demo_units} DEMO (non-monetary)`);
  console.log(`Game record: https://lichess.org/${claim.game_id}`);
  const txHash = process.env.CLUTCH_PROOF_TX_HASH?.trim() || integration.claimTx;
  if (txHash) console.log(`Claim transaction: ${EXPLORER_URL}/tx/${txHash}`);
  else console.log("Claim transaction hash unavailable; the on-chain receipt and public claim remain independently readable.");
}

main().catch((error: unknown) => {
  console.error(`Proof verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
