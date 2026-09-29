import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const RPC_URL = process.env.CLUTCH_RPC_URL ?? "https://studio.genlayer.com/api";
export const EXPLORER_URL = "https://explorer-studio.genlayer.com";
export const CHAIN_ID = 61999;
export const RUNNER = "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6";
export const DEPLOYMENT_PATH = resolve(ROOT, "deployments", "studionet.json");

export function integrationRecordPath(): string {
  const runId = process.env.CLUTCH_INTEGRATION_RUN_ID ?? "local-trial";
  if (!/^[a-z0-9][a-z0-9-]{2,47}$/i.test(runId)) throw new Error("CLUTCH_INTEGRATION_RUN_ID must be 3–48 letters, digits, or hyphens.");
  return resolve(ROOT, "deployments", `integration-${runId}.json`);
}

export type Hex = `0x${string}`;
export type ScriptClient = ReturnType<typeof createClient>;
export type TxReceipt = {
  statusName?: string;
  status?: number | string;
  txExecutionResultName?: string;
  txExecutionResult?: number | string;
  resultName?: string;
  result?: number | string;
  consensus_data?: {
    leader_receipt?: Array<{ execution_result?: string; vote?: string | null }>;
  };
  txDataDecoded?: { contractAddress?: string };
  data?: Record<string, unknown>;
};

export function loadEnv(): void {
  const path = resolve(ROOT, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(?:"(.*)"|'(.*)')$/, (_, doubleQuoted: string, singleQuoted: string) => doubleQuoted ?? singleQuoted);
  }
}

export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} in the gitignored .env file first.`);
  return value;
}

export function privateKey(name: string): Hex {
  const value = required(name);
  if (!/^0x[\da-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a 32-byte hex private key stored only in .env.`);
  return value as Hex;
}

export function contractAddress(): Hex {
  const address = process.env.CLUTCH_CONTRACT_ADDRESS?.trim() || process.env.NEXT_PUBLIC_CONTRACT_ADDRESS?.trim() || "";
  if (!/^0x[\da-fA-F]{40}$/.test(address)) throw new Error("Set CLUTCH_CONTRACT_ADDRESS to the deployed Clutch address.");
  return address as Hex;
}

export function makeReader() {
  return createClient({ chain: studionet, endpoint: RPC_URL });
}

export function makeWriter(keyName: string) {
  const account = createAccount(privateKey(keyName));
  const client = createClient({ chain: studionet, endpoint: RPC_URL, account });
  return { account, client };
}

export async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${method}: RPC returned HTTP ${response.status}.`);
  const body = await response.json() as { result?: T; error?: { code?: number; message?: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message ?? `RPC error ${body.error.code ?? ""}`}`);
  if (!Object.hasOwn(body, "result")) throw new Error(`${method}: RPC response did not include result.`);
  return body.result as T;
}

export async function checkNetwork(): Promise<void> {
  if (studionet.id !== CHAIN_ID) throw new Error(`genlayer-js chain pin is ${studionet.id}; Clutch expects ${CHAIN_ID}.`);
  const observed = Number.parseInt(await rpc<string>("eth_chainId"), 16);
  if (observed !== CHAIN_ID) throw new Error(`RPC reports chain ${observed}; expected stable Studionet ${CHAIN_ID}.`);
}

export async function waitForSuccessfulReceipt(client: ScriptClient, hash: Hex, label: string): Promise<TxReceipt> {
  await client.waitForTransactionReceipt({
    hash: hash as never,
    status: TransactionStatus.FINALIZED,
    interval: 6_000,
    retries: 120,
  });
  const receipt = await client.getTransaction({ hash: hash as never }) as TxReceipt;
  const statusNames: Record<string, string> = {
    "0": "UNINITIALIZED", "1": "PENDING", "2": "PROPOSING", "3": "COMMITTING",
    "4": "REVEALING", "5": "ACCEPTED", "6": "UNDETERMINED", "7": "FINALIZED",
  };
  const resultNames: Record<string, string> = {
    "0": "IDLE", "1": "AGREE", "2": "DISAGREE", "3": "TIMEOUT",
    "4": "DETERMINISTIC_VIOLATION", "5": "NO_MAJORITY", "6": "MAJORITY_AGREE", "7": "MAJORITY_DISAGREE",
  };
  const executionNames: Record<string, string> = {
    "0": "NOT_VOTED", "1": "FINISHED_WITH_RETURN", "2": "FINISHED_WITH_ERROR",
  };
  const statusName = receipt.statusName ?? statusNames[String(receipt.status)];
  const resultName = receipt.resultName ?? resultNames[String(receipt.result)];
  const leaders = (receipt.consensus_data?.leader_receipt ?? []).filter((round) => !round.vote);
  const leaderExecution = leaders[leaders.length - 1]?.execution_result?.toUpperCase();
  const txExecutionResultName = receipt.txExecutionResultName
    ?? executionNames[String(receipt.txExecutionResult)]
    ?? (leaderExecution === "SUCCESS"
      ? "FINISHED_WITH_RETURN"
      : leaderExecution === "ERROR"
        ? "FINISHED_WITH_ERROR"
        : leaderExecution);
  if (String(statusName ?? "").toUpperCase() !== "FINALIZED") {
    throw new Error(`${label} ended with lifecycle ${statusName ?? "UNKNOWN"}, execution ${txExecutionResultName ?? "UNKNOWN"}, consensus ${resultName ?? "UNKNOWN"}.`);
  }
  if (String(txExecutionResultName ?? "").toUpperCase() !== "FINISHED_WITH_RETURN") {
    throw new Error(`${label} finalized with execution ${txExecutionResultName ?? "UNKNOWN"}, consensus ${resultName ?? "UNKNOWN"}; state was not confirmed.`);
  }
  if (String(resultName ?? "").toUpperCase() !== "MAJORITY_AGREE") {
    throw new Error(`${label} finalized with execution ${txExecutionResultName}, consensus ${resultName ?? "UNKNOWN"}.`);
  }
  return { ...receipt, statusName, txExecutionResultName, resultName };
}

export async function writeAndWait(
  client: ScriptClient,
  address: Hex,
  functionName: string,
  args: unknown[],
  label = functionName,
): Promise<{ hash: Hex; receipt: TxReceipt }> {
  const hash = await client.writeContract({
    address,
    functionName,
    args: args as never,
    value: 0n,
  }) as Hex;
  console.log(`${label}: ${hash}`);
  const receipt = await waitForSuccessfulReceipt(client, hash, label);
  return { hash, receipt };
}

export async function read<T>(reader: ScriptClient, address: Hex, functionName: string, args: unknown[] = []): Promise<T> {
  const value = await reader.readContract({
    address,
    functionName,
    args: args as never,
    jsonSafeReturn: true,
  });
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { /* keep ordinary strings intact */ }
  }
  return value as T;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function ensureWriteAcknowledgement(): void {
  const expected = "I_APPROVE_STUDIONET_DEMO_STATE_CHANGES";
  if (process.env.CLUTCH_ALLOW_STUDIONET_WRITES !== expected) {
    throw new Error(`Set CLUTCH_ALLOW_STUDIONET_WRITES=${expected} only for an intentional throwaway Studionet run.`);
  }
}

export function ensurePinnedRunner(source: string): void {
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  if (!firstLine.includes(RUNNER)) throw new Error(`Contract runner header must pin exactly ${RUNNER}.`);
}
