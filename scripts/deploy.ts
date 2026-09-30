import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
  const botDemo = process.argv.includes("--bot-demo");
  const deploymentPath = botDemo ? resolve(ROOT, "deployments", "studionet-bot-demo.json") : DEPLOYMENT_PATH;
  const source = readFileSync(resolve(ROOT, "contracts", "clutch.py"), "utf8").replace(/\r\n/g, "\n");
  if (!source.split(/\r?\n/, 1)[0]?.includes(RUNNER)) throw new Error(`Clutch must pin ${RUNNER}.`);
  const account = createAccount(privateKey("CLUTCH_DEPLOYER_PRIVATE_KEY"));
  const reader = createClient({ chain: studionet, endpoint: RPC_URL });
  const client = createClient({ chain: studionet, endpoint: RPC_URL, account });

  console.log(`Checking stable Studionet ${RPC_URL} (chain ${CHAIN_ID})…`);
  await checkNetwork();
  console.log("Asking Studionet to compile the exact pinned contract source…");
  const schema = await reader.getContractSchemaForCode(source);
  const methods = Object.keys(schema.methods ?? {}).sort();
  if (methods.length !== 24 || !methods.includes("get_contract_info") || !methods.includes("submit_game") || !methods.includes("get_link_for_wallet") || !methods.includes("create_bot_demo_draft")) {
    throw new Error(`Unexpected Clutch contract schema (${methods.length} methods); deployment stopped.`);
  }
  console.log(`Studio accepted the schema (${methods.length} methods).`);

  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  if (existsSync(deploymentPath)) {
    const saved = JSON.parse(readFileSync(deploymentPath, "utf8")) as { contractAddress?: string; sourceSha256?: string };
    if (saved.contractAddress) {
      if (saved.sourceSha256 !== sourceSha256) throw new Error("A deployment already exists with different source. Preserve its record and select a new deployment target explicitly.");
      const live = await read<ContractInfo>(reader, saved.contractAddress as `0x${string}`, "get_contract_info");
      if (live.version !== "clutch/0.2.0" || live.chain_id !== CHAIN_ID) throw new Error("Saved deployment does not match live contract.");
      console.log(`Existing verified deployment: ${saved.contractAddress}`);
      return;
    }
  }
  const pendingPath = `${deploymentPath}.pending`;
  const pending = existsSync(pendingPath) ? JSON.parse(readFileSync(pendingPath, "utf8")) as { hash: `0x${string}`; sourceSha256: string } : undefined;
  if (pending && pending.sourceSha256 !== sourceSha256) throw new Error("Pending deployment has different source; inspect its transaction first.");
  const hash = pending?.hash ?? await client.deployContract({ code: source, args: [] });
  writeJson(pendingPath, { hash, sourceSha256 });
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
  if (info.version !== "clutch/0.2.0" || info.chain_id !== CHAIN_ID || !info.runner?.includes(RUNNER)) {
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
    sourceSha256,
    schemaMethods: methods,
    contractInfo: info,
    deployedAt: new Date().toISOString(),
    runner: RUNNER,
  };
  writeJson(deploymentPath, record);
  console.log(`Verified contract address: ${address}`);
  console.log(`Explorer: ${EXPLORER_URL}/address/${address}`);
  console.log(`Deployment evidence: ${deploymentPath}`);
  console.log("The deployer private key was not printed or written to the deployment record.");
}

main().catch((error: unknown) => {
  console.error(`Deploy failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
