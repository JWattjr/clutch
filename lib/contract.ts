import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

export const CHAIN_ID = 61999;
export const CHAIN_ID_HEX = `0x${CHAIN_ID.toString(16)}`;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://studio.genlayer.com/api";
export const EXPLORER_URL = "https://explorer-studio.genlayer.com";
export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? "";
export const BOT_DEMO_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_BOT_DEMO_CONTRACT_ADDRESS ?? "";
export const RUNNER = "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6";

export type RuleSet = {
  platform: "LICHESS";
  variant: "STANDARD";
  rated: "ANY" | "REQUIRED" | "FORBIDDEN";
  speed: "ANY" | "BULLET" | "BLITZ" | "RAPID" | "CLASSICAL";
  player_color: "ANY" | "WHITE" | "BLACK";
  result: "WIN" | "DRAW";
  max_plies?: number | null;
};

export type Quest = {
  participant_policy?: "HUMAN_ONLY" | "BOT_DEMO";
  window_mode?: "SCHEDULED" | "ACTIVATION_RELATIVE";
  window_duration_ms?: number;
  id: string;
  sponsor: string;
  description: string;
  state: "DRAFT" | "COMPILED" | "ACTIVE" | "AWARDED" | "EXPIRED_REFUNDED" | string;
  compile_status: "COMPILED" | "NEEDS_CLARIFICATION" | "UNSUPPORTED" | string;
  reason_codes: string[];
  rules: RuleSet | null;
  rule_hash: string;
  activation_hash?: string;
  reward: number;
  starts_at_ms: number;
  ends_at_ms: number;
  activated_at_ms: number;
  claim_deadline_ms: number;
  claim_grace_ms: number;
  winner: string;
  winning_claim_id: string;
  created_at_ms: number;
};

export type Account = {
  wallet: string;
  sponsor_available: number;
  awarded: number;
  starter_claimed: boolean;
  total_issued: number;
  total_available: number;
  total_reserved: number;
  total_awarded: number;
  total_refunded: number;
};

export type LinkChallenge = {
  nonce: string;
  wallet: string;
  lichess_id: string;
  text: string;
  requested_at_ms: number;
  expires_at_ms: number;
  state: string;
};

export type EvidenceCheck = {
  condition: string;
  status: "PASS" | "FAIL" | "INSUFFICIENT_EVIDENCE" | string;
  reason_code: string;
  observed: unknown;
};

export type Claim = {
  participant_policy?: "HUMAN_ONLY" | "BOT_DEMO";
  source_policy_version?: string;
  rule_hash?: string;
  id: string;
  quest_id: string;
  game_id: string;
  claimant: string;
  lichess_id: string;
  submitted_at_ms: number;
  outcome: "VERIFIED" | "NOT_QUALIFIED" | "INSUFFICIENT_EVIDENCE" | string;
  reason_codes: string[];
  checks: EvidenceCheck[];
  evidence: Record<string, unknown>;
  evidence_hash: string;
  reward_demo_units: number;
  settled_at_ms?: number;
};

type BrowserWallet = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, callback: (...args: unknown[]) => void): void;
  removeListener?(event: string, callback: (...args: unknown[]) => void): void;
};

declare global {
  interface Window { ethereum?: BrowserWallet }
}

function decode<T>(value: unknown): T {
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { /* plain string return */ }
  }
  return value as T;
}

export function hasContractAddress(): boolean {
  return /^0x[\da-fA-F]{40}$/.test(CONTRACT_ADDRESS);
}

export async function readContract<T>(functionName: string, args: unknown[] = []): Promise<T> {
  return readContractAt<T>(CONTRACT_ADDRESS, functionName, args);
}

export async function readContractAt<T>(address: string, functionName: string, args: unknown[] = []): Promise<T> {
  if (!/^0x[\da-fA-F]{40}$/.test(address)) throw new Error("No deployed Clutch contract address is configured.");
  const reader = createClient({ chain: studionet, endpoint: RPC_URL });
  const result = await reader.readContract({
    address: address as `0x${string}`,
    functionName,
    args: args as never,
    jsonSafeReturn: true,
  });
  return decode<T>(result);
}

export type ReceiptProgress = {
  hash: `0x${string}`;
  status: string;
  execution: string;
  consensus: string;
};

function named(value: string | number | null | undefined, names: Record<string, string>): string {
  if (value === null || value === undefined) return "UNKNOWN";
  const input = String(value);
  return names[input] ?? input.toUpperCase();
}

export async function writeContract(
  wallet: BrowserWallet,
  account: string,
  functionName: string,
  args: unknown[],
  onSubmitted?: (hash: `0x${string}`) => void,
): Promise<ReceiptProgress> {
  if (!hasContractAddress()) throw new Error("No deployed Clutch contract address is configured.");
  const client = createClient({
    chain: studionet,
    endpoint: RPC_URL,
    provider: wallet as never,
    account: account as `0x${string}`,
  });
  const txHash = await client.writeContract({
    address: CONTRACT_ADDRESS as `0x${string}`,
    functionName,
    args: args as never,
    value: 0n,
  }) as `0x${string}`;
  onSubmitted?.(txHash);
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash as never,
    status: TransactionStatus.FINALIZED,
    interval: 6_000,
    retries: 120,
  });
  const status = named(receipt.statusName ?? receipt.status as string | number | undefined, {
    "1": "PENDING", "2": "PROPOSING", "3": "COMMITTING", "4": "REVEALING", "5": "ACCEPTED", "7": "FINALIZED",
  });
  const execution = named(receipt.txExecutionResultName ?? receipt.txExecutionResult as string | number | undefined, {
    "0": "NOT_VOTED", "1": "FINISHED_WITH_RETURN", "2": "FINISHED_WITH_ERROR",
  });
  const consensus = named(receipt.resultName ?? receipt.result as string | number | undefined, {
    "1": "AGREE", "2": "DISAGREE", "6": "MAJORITY_AGREE", "7": "MAJORITY_DISAGREE",
  });
  const progress = { hash: txHash, status, execution, consensus };
  if (status !== "FINALIZED") throw new Error(`Transaction lifecycle ended as ${status}.`);
  if (execution !== "FINISHED_WITH_RETURN") throw new Error(`Transaction finalized with ${execution}; Clutch state did not update.`);
  if (consensus !== "MAJORITY_AGREE") throw new Error(`Transaction finalized with ${consensus} consensus; inspect the transaction before continuing.`);
  return progress;
}

export async function checkRpcChain(): Promise<number> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Studio Net RPC returned HTTP ${response.status}.`);
  const body = await response.json() as { result?: string; error?: { message?: string } };
  if (body.error?.message) throw new Error(body.error.message);
  const chainId = Number.parseInt(body.result ?? "0x0", 16);
  if (chainId !== CHAIN_ID) throw new Error(`RPC reports chain ${chainId}; expected ${CHAIN_ID}.`);
  return chainId;
}
