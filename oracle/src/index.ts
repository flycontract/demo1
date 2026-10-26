import { getAddress } from "ethers";
import { config } from "./config.js";
import { getContract, getOracleWallet, getProvider } from "./contract.js";
import { bindDb, openDb } from "./db.js";
import { OracleService } from "./service.js";

function safeError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [config.rpcUrl, config.oraclePrivateKey]) {
    if (secret) message = message.replaceAll(secret, "[redacted]");
  }
  return message;
}

async function main() {
  if (![11155111, 31337].includes(config.chainId) ||
      (config.chainId === 31337 && process.env.ALLOW_LOCAL_CHAIN !== "true")) {
    throw new Error("Unsupported oracle CHAIN_ID; local chain needs ALLOW_LOCAL_CHAIN=true");
  }
  if (!Number.isInteger(config.deployBlock) || config.deployBlock < 0 ||
      config.maxDailyRefresh < 1 || config.minRefreshIntervalMs < 3600000 ||
      config.pollIntervalMs < 1000 || config.confirmations < 1 ||
      config.eventChunkSize < 1 || config.reorgOverlap < 1) {
    throw new Error("Invalid oracle timing or block configuration");
  }
  const contractAddress = getAddress(config.contractAddress);
  const provider = getProvider(config.rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(config.chainId)) throw new Error("Oracle RPC chain ID mismatch");
  if ((await provider.getCode(contractAddress)) === "0x") throw new Error("Insurance contract has no bytecode");
  const wallet = getOracleWallet(provider, config.oraclePrivateKey);
  const readContract = getContract(provider, contractAddress);
  if (getAddress(await readContract.oracle()) !== getAddress(await wallet.getAddress())) {
    throw new Error("Configured oracle signer does not match contract oracle address");
  }
  const db = openDb(config.dbPath);
  bindDb(db, network.chainId, contractAddress);
  const service = new OracleService(db, provider, readContract, getContract(wallet, contractAddress), config);
  console.log(`[oracle] chain=${network.chainId} contract=${contractAddress} signer=${await wallet.getAddress()} polling=${config.pollIntervalMs}ms`);
  const loop = async () => {
    try { await service.tick(); }
    catch (error) { console.error("[oracle] tick failed:", safeError(error)); }
    setTimeout(loop, config.pollIntervalMs);
  };
  await loop();
}

main().catch((error) => {
  console.error("[oracle] fatal:", safeError(error));
  process.exitCode = 1;
});
