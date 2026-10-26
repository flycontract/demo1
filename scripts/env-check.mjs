import { readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { Wallet, JsonRpcProvider, Contract, getAddress, isAddress } from "ethers";
import dotenv from "dotenv";

const root = resolve(import.meta.dirname, "..");
const mode = process.argv[2] ?? "prepare";
if (!["prepare", "deployed"].includes(mode)) throw new Error("Usage: npm run env:check -- [prepare|deployed]");
const paths = [".env", "oracle/.env", "frontend/.env"];
const failures = [];
const envs = paths.map((path) => {
  const abs = resolve(root, path);
  if (!existsSync(abs)) { failures.push(`${path}: missing`); return {}; }
  try { execFileSync("git", ["check-ignore", "-q", path], { cwd: root, stdio: "ignore" }); console.log(`${path}: present, Git ignored`); }
  catch { failures.push(`${path}: not Git ignored`); }
  return dotenv.parse(readFileSync(abs));
});
const [base, oracle, front] = envs;
function needed(obj, key, label) { if (!obj[key]) failures.push(`${label}.${key}: missing`); return obj[key] ?? ""; }
function address(value, label, allowPending = false) {
  if (allowPending && value === "UNDEPLOYED" && mode === "prepare") { console.log(`${label}: pending deployment`); return null; }
  if (!isAddress(value) || /^0x0{40}$/i.test(value)) { failures.push(`${label}: invalid or pending`); return null; }
  return getAddress(value);
}
function positiveInt(value, label, min = 1) {
  if (!/^\d+$/.test(value ?? "") || Number(value) < min) failures.push(`${label}: invalid`);
}
for (const [obj, key, label] of [[base,"SEPOLIA_RPC_URL","root"],[oracle,"RPC_URL","oracle"],[front,"VITE_RPC_URL","frontend"]]) {
  const v = needed(obj,key,label);
  try { const u = new URL(v); if (u.protocol !== "https:" || u.username || u.password) failures.push(`${label}.${key}: use HTTPS without URL credentials`); }
  catch { failures.push(`${label}.${key}: invalid URL`); }
}
if (base.SEPOLIA_RPC_URL !== oracle.RPC_URL || base.SEPOLIA_RPC_URL !== front.VITE_RPC_URL) failures.push("RPC URLs differ");
let insurer = null; let oracleSigner = null;
for (const [obj,key,label] of [[base,"DEPLOYER_PRIVATE_KEY","insurer"],[oracle,"ORACLE_PRIVATE_KEY","oracle"]]) {
  try { const keyValue = needed(obj,key,label); if (!/^0x[\da-fA-F]{64}$/.test(keyValue)) throw Error();
    const signer = new Wallet(keyValue).address; console.log(`${label} public address: ${signer}`);
    if (label === "insurer") insurer = signer; else oracleSigner = signer;
  } catch { failures.push(`${label} key: invalid`); }
}
if (insurer && oracleSigner && insurer === oracleSigner) failures.push("Insurer and oracle accounts must differ");
const oracleAddress = address(needed(base,"ORACLE_ADDRESS","root"),"ORACLE_ADDRESS");
if (oracleAddress && oracleSigner && oracleAddress !== oracleSigner) failures.push("ORACLE_ADDRESS does not match oracle private key");
if (front.VITE_CHAIN_ID !== "11155111" || oracle.CHAIN_ID !== "11155111") failures.push("chain IDs must be Sepolia 11155111");
if (!["true", "false"].includes(front.VITE_SALES_ENABLED ?? "")) failures.push("VITE_SALES_ENABLED must be boolean");
if (mode === "prepare" && front.VITE_SALES_ENABLED !== "false") failures.push("Real sales must stay disabled during preparation");
for (const key of Object.keys(front)) if (/private|secret|password|token_key/i.test(key)) failures.push(`frontend.${key}: secret-shaped key forbidden`);
for (const [k,min] of [["POLL_INTERVAL_MS",1000],["HTTP_TIMEOUT_MS",1000],["MAX_DAILY_REFRESH",1],["MIN_REFRESH_INTERVAL_MS",3600000],["CONFIRMATIONS",1],["EVENT_CHUNK_SIZE",1],["REORG_OVERLAP",1]]) positiveInt(oracle[k],`oracle.${k}`,min);
const dbPath = needed(oracle,"DB_PATH","oracle");
const resolvedDb = resolve(root,"oracle",dbPath);
if (relative(resolve(root,"oracle"),resolvedDb).startsWith("..") || !resolvedDb.toLowerCase().includes("sepolia")) failures.push("Oracle DB_PATH must stay under oracle/ and identify Sepolia separately");
if (resolvedDb.toLowerCase().includes("local") || resolvedDb.toLowerCase().includes("31337")) failures.push("Oracle DB_PATH appears to be local-chain data");
try { execFileSync("git", ["check-ignore", "-q", relative(root, resolvedDb)], { cwd: root, stdio: "ignore" }); }
catch { failures.push("Oracle DB_PATH is not Git ignored"); }
const tokenAddress = address(needed(front,"VITE_TOKEN_ADDRESS","frontend"),"token",true);
const insuranceAddress = address(needed(front,"VITE_INSURANCE_ADDRESS","frontend"),"insurance",true);
const oracleContractAddress = address(needed(oracle,"CONTRACT_ADDRESS","oracle"),"oracle contract",true);
if (insuranceAddress && oracleContractAddress && insuranceAddress !== oracleContractAddress) failures.push("Insurance addresses differ");
if (existsSync(resolvedDb)) {
  try {
    const requireOracle = createRequire(resolve(root, "oracle/package.json"));
    const Database = requireOracle("better-sqlite3");
    const db = new Database(resolvedDb, { readonly: true, fileMustExist: true });
    const row = db.prepare("SELECT value FROM meta WHERE key = 'scope'").get();
    db.close();
    if (!row || !String(row.value).startsWith("11155111:") || (insuranceAddress && row.value !== `11155111:${insuranceAddress.toLowerCase()}`)) failures.push("Oracle DB scope does not match Sepolia insurance contract");
    else console.log("Oracle DB scope: Sepolia contract matched");
  } catch { failures.push("Oracle DB metadata unreadable"); }
} else console.log("Oracle DB: new isolated path; scope will be bound on first start");
if (oracle.DEPLOY_BLOCK === "UNDEPLOYED" && mode === "prepare") console.log("DEPLOY_BLOCK: pending deployment");
else positiveInt(oracle.DEPLOY_BLOCK,"DEPLOY_BLOCK",1);

try {
  const rpc = new JsonRpcProvider(base.SEPOLIA_RPC_URL, 11155111, { staticNetwork: true });
  const id = BigInt(await rpc.send("eth_chainId", []));
  console.log(`RPC chain ID: ${id}`);
  if (id !== 11155111n) failures.push("RPC is not Sepolia");
  if (mode === "deployed" && tokenAddress && insuranceAddress) {
    if (await rpc.getCode(tokenAddress) === "0x" || await rpc.getCode(insuranceAddress) === "0x") failures.push("Deployed contract bytecode missing");
    else {
      const c = new Contract(insuranceAddress,["function token() view returns (address)","function oracle() view returns (address)","function insurer() view returns (address)"],rpc);
      if (getAddress(await c.token()) !== tokenAddress) failures.push("insurance.token mismatch");
      if (getAddress(await c.oracle()) !== oracleSigner) failures.push("insurance.oracle mismatch");
      if (getAddress(await c.insurer()) !== insurer) failures.push("insurance.insurer mismatch");
      const block = await rpc.getBlock(Number(oracle.DEPLOY_BLOCK));
      if (!block) failures.push("DEPLOY_BLOCK not found");
    }
  }
  rpc.destroy();
} catch { failures.push("RPC read or deployed contract check failed"); }
console.log(`Mode ${mode}: ${failures.length ? "FAILED" : "PASS"}`);
for (const issue of failures) console.log(`- ${issue}`);
if (failures.length) process.exitCode = 1;
