import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHAIN_ID, DEPLOYMENT_PATH, EXPLORER_URL, RPC_URL, RUNNER, ROOT, checkNetwork,
  loadEnv, privateKey, read, writeJson, waitForSuccessfulReceipt,
} from "./lib.ts";

type ContractInfo = {
  version?: string;
  schema_version?: string;
  source_policy_version?: string;
  runner?: string;
  chain_id?: number;
  contract?: string;
};

async function main(): Promise<void> {
  loadEnv();
  const source = readFileSync(resolve(ROOT, "contracts", "clutch.py"), "utf8");
  if (!source.split(/\r?\n/, 1)[0]?.includes(RUNNER)) throw new Error(`Clutch must pin ${RUNNER}.`);
  const account = createAccount(privateKey("CLUTCH_DEPLOYER_PRIVATE_KEY"));
  const reader = createClient({ chain: studionet, endpoint: RPC_URL });
  const client = createClient({ chain: studionet, endpoint: RPC_URL, account });

  console.log(`Checking stable Studionet ${RPC_URL} (chain ${CHAIN_ID})…`);
  await checkNetwork();
  console.log("Asking Studionet to compile the exact pinned contract source…");
  const schema = await reader.getContractSchemaForCode(source);
  const methods = Object.keys(schema.methods ?? {}).sort();
  if (methods.length !== 23 || !methods.includes("get_contract_info") || !methods.includes("submit_game") || !methods.includes("get_link_for_wallet")) {
    throw new Error(`Unexpected Clutch contract schema (${methods.length} methods); deployment stopped.`);
  }
  console.log(`Studio accepted the schema (${methods.length} methods).`);

  const hash = await client.deployContract({ code: source, args: [] });
  console.log(`Deployment transaction: ${hash}`);
  const receipt = await waitForSuccessfulReceipt(client, hash, "Clutch deployment");
  const transaction = await reader.getTransaction({ hash: hash as never }) as {
    txDataDecoded?: { contractAddress?: string };
    data?: { contract_address?: string };
  };
  const address = transaction.txDataDecoded?.contractAddress ?? transaction.data?.contract_address;
  if (!address || !/^0x[\da-fA-F]{40}$/.test(address)) {
    throw new Error("Deployment finalized, but Studio did not return a valid contract address.");
  }
  const info = await read<ContractInfo>(reader, address as `0x${string}`, "get_contract_info");
  if (info.version !== "clutch/0.1.1" || info.chain_id !== CHAIN_ID || !info.runner?.includes(RUNNER)) {
    throw new Error("Deployed Clutch did not report the expected version, chain, and pinned runner.");
  }
  const record = {
    network: "studionet",
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
    explorerUrl: EXPLORER_URL,
    contractAddress: address,
    deployer: account.address,
    deployTx: hash,
    deployStatus: receipt.statusName,
    deployExecution: receipt.txExecutionResultName,
    deployConsensus: receipt.resultName,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    schemaMethods: methods,
    contractInfo: info,
    deployedAt: new Date().toISOString(),
    runner: RUNNER,
  };
  writeJson(DEPLOYMENT_PATH, record);
  console.log(`Verified contract address: ${address}`);
  console.log(`Explorer: ${EXPLORER_URL}/address/${address}`);
  console.log(`Deployment evidence: ${DEPLOYMENT_PATH}`);
  console.log("The deployer private key was not printed or written to the deployment record.");
}

main().catch((error: unknown) => {
  console.error(`Deploy failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
