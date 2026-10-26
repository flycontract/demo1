import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Wallet } from "ethers";

const root = resolve(import.meta.dirname, "..");
const rpc = "https://ethereum-sepolia-rpc.publicnode.com";
const files = [resolve(root, ".env"), resolve(root, "oracle/.env"), resolve(root, "frontend/.env")];
if (files.some(existsSync)) throw new Error("At least one .env exists; no files were changed. Check it manually before filling missing values.");

// Generate only for this project, and persist both keys before exposing public addresses.
const insurer = Wallet.createRandom();
const oracle = Wallet.createRandom();
if (insurer.address === oracle.address) throw new Error("Account collision");
const contents = [
  `SEPOLIA_RPC_URL=${rpc}\nDEPLOYER_PRIVATE_KEY=${insurer.privateKey}\nORACLE_ADDRESS=${oracle.address}\n`,
  `RPC_URL=${rpc}\nCHAIN_ID=11155111\nCONTRACT_ADDRESS=UNDEPLOYED\nDEPLOY_BLOCK=UNDEPLOYED\nORACLE_PRIVATE_KEY=${oracle.privateKey}\nDB_PATH=./oracle-sepolia.sqlite\nPOLL_INTERVAL_MS=60000\nHTTP_TIMEOUT_MS=20000\nMAX_DAILY_REFRESH=3\nMIN_REFRESH_INTERVAL_MS=14400000\nCONFIRMATIONS=2\nEVENT_CHUNK_SIZE=500\nREORG_OVERLAP=12\n`,
  `VITE_RPC_URL=${rpc}\nVITE_TOKEN_ADDRESS=UNDEPLOYED\nVITE_INSURANCE_ADDRESS=UNDEPLOYED\nVITE_CHAIN_ID=11155111\nVITE_CHAIN_NAME=Sepolia\nVITE_EXPLORER_URL=https://sepolia.etherscan.io\nVITE_SALES_ENABLED=false\n`,
];
for (let i = 0; i < files.length; i++) {
  mkdirSync(dirname(files[i]), { recursive: true });
  writeFileSync(files[i], contents[i], { encoding: "utf8", flag: "wx", mode: 0o600 });
}
console.log("Created three Git-ignored local .env files. No secret values printed.");
console.log(`Insurer public address: ${insurer.address}`);
console.log(`Oracle public address: ${oracle.address}`);
console.log("Contract addresses and deployment block: UNDEPLOYED");
