import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import {
  CHAIN_ID, EXPLORER_URL, RPC_URL, ROOT, RUNNER, checkNetwork, ensurePinnedRunner,
  loadEnv, makeReader, privateKey, read, waitForSuccessfulReceipt, writeJson,
  type Hex, type TxReceipt,
} from "./lib.ts";

const SOURCE_PATH = resolve(ROOT, "contracts", "lichess_validator_probe.py");
const RECORD_PATH = resolve(ROOT, "deployments", "validator-probe-studionet.json");
const WRITE_ACKNOWLEDGEMENT = "I_APPROVE_STUDIONET_VALIDATOR_PROBE";

type Evidence = { status?: string; execution?: string; consensus?: string };
type GameResult = {
  fetch_status?: string;
  id?: string;
  rated?: boolean;
  variant?: string;
  speed?: string;
  status?: string;
  source?: string;
  created_at_ms?: number;
  last_move_at_ms?: number;
  white_id?: string;
  black_id?: string;
  plies?: number;
};
type ProfileResult = { fetch_status?: string; id?: string; bio_is_string?: boolean };
type ProbeResults = { game?: GameResult | null; profile?: ProfileResult | null };
type ProbeInfo = { version?: string; runner?: string; chain_id?: number; game_id?: string; profile_id?: string };
type ProbeRecord = {
  network: "studionet";
  chainId: number;
  rpcUrl: string;
  sourceSha256: string;
  runner: string;
  deployer: string;
  createdAt: string;
  updatedAt: string;
  deployTx?: Hex;
  contractAddress?: Hex;
  deployReceipt?: Evidence;
  gameTx?: Hex;
  gameReceipt?: Evidence;
  game?: GameResult;
  profileTx?: Hex;
  profileReceipt?: Evidence;
  profile?: ProfileResult;
};

function receiptEvidence(receipt: TxReceipt): Evidence {
  return {
    status: receipt.statusName,
    execution: receipt.txExecutionResultName,
    consensus: receipt.resultName,
  };
}

function save(record: ProbeRecord): void {
  record.updatedAt = new Date().toISOString();
  writeJson(RECORD_PATH, record);
}

function requireGame(result: GameResult | null | undefined): GameResult {
  if (!result || result.fetch_status !== "OK" || result.id !== "q7ZvsdUF" || result.rated !== true
    || result.variant !== "standard" || result.status !== "draw" || !result.speed || !result.source
    || !Number.isSafeInteger(result.created_at_ms) || !Number.isSafeInteger(result.last_move_at_ms)
    || !result.white_id || !result.black_id || !Number.isSafeInteger(result.plies) || (result.plies ?? 0) < 1) {
    throw new Error("Finalized game probe did not expose the expected complete public game fields.");
  }
  return result;
}

function requireProfile(result: ProfileResult | null | undefined): ProfileResult {
  if (!result || result.fetch_status !== "OK" || result.id !== "thibault" || result.bio_is_string !== true) {
    throw new Error("Finalized profile probe did not expose a public bio field.");
  }
  return result;
}

async function main(): Promise<void> {
  loadEnv();
  const mode = process.argv[2] ?? "preflight";
  if (!["preflight", "run", "status"].includes(mode)) throw new Error("Use preflight, run, or status.");
  if (mode === "status") {
    console.log(existsSync(RECORD_PATH) ? readFileSync(RECORD_PATH, "utf8") : `No validator probe record at ${RECORD_PATH}.`);
    return;
  }

  const source = readFileSync(SOURCE_PATH, "utf8");
  ensurePinnedRunner(source);
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  await checkNetwork();
  const reader = makeReader();
  const schema = await reader.getContractSchemaForCode(source);
  const methods = Object.keys(schema.methods ?? {}).sort();
  if (methods.length !== 4 || !["get_probe_info", "get_results", "probe_game", "probe_profile"].every((name) => methods.includes(name))) {
    throw new Error(`Studionet returned an unexpected validator-probe schema: ${methods.join(", ")}`);
  }
  console.log(`PASS: chain ${CHAIN_ID}, pinned runner ${RUNNER}, four accepted probe methods.`);
  console.log(`Source SHA-256: ${sourceSha256}`);
  if (mode === "preflight") return;

  if (process.env.CLUTCH_ALLOW_VALIDATOR_PROBE_WRITES !== WRITE_ACKNOWLEDGEMENT) {
    throw new Error(`Set CLUTCH_ALLOW_VALIDATOR_PROBE_WRITES=${WRITE_ACKNOWLEDGEMENT} for an intentional public Studionet probe.`);
  }
  const account = createAccount(privateKey("CLUTCH_DEPLOYER_PRIVATE_KEY"));
  const client = createClient({ chain: studionet, endpoint: RPC_URL, account });
  const record = existsSync(RECORD_PATH)
    ? JSON.parse(readFileSync(RECORD_PATH, "utf8")) as ProbeRecord
    : {
      network: "studionet", chainId: CHAIN_ID, rpcUrl: RPC_URL, sourceSha256,
      runner: RUNNER, deployer: account.address, createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies ProbeRecord;
  if (record.sourceSha256 !== sourceSha256 || record.deployer.toLowerCase() !== account.address.toLowerCase() || record.chainId !== CHAIN_ID) {
    throw new Error("Existing probe record belongs to a different source, wallet, or chain; inspect it before proceeding.");
  }

  if (!record.deployTx) {
    record.deployTx = await client.deployContract({ code: source, args: [] }) as Hex;
    save(record);
    console.log(`Probe deployment submitted: ${record.deployTx}`);
  }
  if (!record.contractAddress) {
    const receipt = await waitForSuccessfulReceipt(client, record.deployTx, "Validator probe deployment");
    const transaction = await reader.getTransaction({ hash: record.deployTx as never }) as {
      txDataDecoded?: { contractAddress?: string };
      data?: { contract_address?: string };
    };
    const address = transaction.txDataDecoded?.contractAddress ?? transaction.data?.contract_address;
    if (!address || !/^0x[\da-fA-F]{40}$/.test(address)) throw new Error("Deployment succeeded but no valid probe contract address was returned.");
    record.contractAddress = address as Hex;
    record.deployReceipt = receiptEvidence(receipt);
    save(record);
  }
  const address = record.contractAddress;
  const info = await read<ProbeInfo>(reader, address, "get_probe_info");
  if (info.version !== "clutch-lichess-validator-probe/1" || info.chain_id !== CHAIN_ID || info.runner !== RUNNER
    || info.game_id !== "q7ZvsdUF" || info.profile_id !== "thibault") {
    throw new Error("Deployed probe code or chain identity does not match the reviewed source.");
  }
  console.log(`Probe contract: ${EXPLORER_URL}/address/${address}`);

  if (!record.gameTx) {
    record.gameTx = await client.writeContract({ address, functionName: "probe_game", args: [], value: 0n }) as Hex;
    save(record);
    console.log(`Game consensus submitted: ${record.gameTx}`);
  }
  if (!record.game) {
    const receipt = await waitForSuccessfulReceipt(client, record.gameTx, "Lichess game consensus probe");
    const results = await read<ProbeResults>(reader, address, "get_results");
    record.game = requireGame(results.game);
    record.gameReceipt = receiptEvidence(receipt);
    save(record);
    console.log(`PASS: independent game retrieval agreed; ${EXPLORER_URL}/tx/${record.gameTx}`);
  }

  if (!record.profileTx) {
    record.profileTx = await client.writeContract({ address, functionName: "probe_profile", args: [], value: 0n }) as Hex;
    save(record);
    console.log(`Profile consensus submitted: ${record.profileTx}`);
  }
  if (!record.profile) {
    const receipt = await waitForSuccessfulReceipt(client, record.profileTx, "Lichess profile consensus probe");
    const results = await read<ProbeResults>(reader, address, "get_results");
    record.profile = requireProfile(results.profile);
    record.profileReceipt = receiptEvidence(receipt);
    save(record);
    console.log(`PASS: independent profile retrieval agreed; ${EXPLORER_URL}/tx/${record.profileTx}`);
  }
  console.log(`Sanitized validator evidence: ${RECORD_PATH}`);
}

main().catch((error: unknown) => {
  console.error(`Validator probe failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
