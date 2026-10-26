import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Contract, getAddress, getCreateAddress, isAddress, parseUnits, type TransactionRequest } from "ethers";
import hre from "hardhat";

// Sepolia broadcaster. Durable intent, hash, and receipt make confirmed steps
// resumable. Unknown transaction outcomes stop rather than risking duplication.
const root = resolve(__dirname, "..");
const manifestPath = resolve(root, "deployments/sepolia.json");
const fundAmount = 10_000n;
type Step = { nonce?: number; predictedAddress?: string; hash?: string; receipt?: Record<string, unknown> };
type Manifest = {
  chainId: 11155111; sourceCommit: string; compiler: Record<string, unknown>;
  hardhatConfigSha256: string; tokenAbiSha256: string; insuranceAbiSha256: string;
  insurer: string; oracle: string; tokenAddress?: string; insuranceAddress?: string;
  insuranceDeployBlock?: number; steps: Record<string, Step>; totalSpentWei: string;
};

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function persist(manifest: Manifest) {
  mkdirSync(resolve(root, "deployments"), { recursive: true });
  const tmp = `${manifestPath}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  renameSync(tmp, manifestPath);
}
function publicReceipt(receipt: any): Record<string, unknown> {
  return { transactionHash: receipt.hash, blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber, status: receipt.status, from: receipt.from,
    to: receipt.to, contractAddress: receipt.contractAddress,
    gasUsed: receipt.gasUsed.toString(), gasPrice: receipt.gasPrice.toString(),
    cumulativeGasUsed: receipt.cumulativeGasUsed.toString(), transactionIndex: receipt.index,
    logs: receipt.logs.map((log: any) => ({ address: log.address, topics: log.topics,
      data: log.data, index: log.index })) };
}

async function main() {
  const { ethers } = hre;
  const [signer] = await ethers.getSigners();
  const insurer = await signer.getAddress();
  const oracleRaw = process.env.ORACLE_ADDRESS?.trim() ?? "";
  if (!isAddress(oracleRaw) || /^0x0{40}$/i.test(oracleRaw)) throw Error("Valid ORACLE_ADDRESS required");
  const oracle = getAddress(oracleRaw);
  if (oracle === insurer) throw Error("Oracle must differ from insurer");
  if ((await ethers.provider.getNetwork()).chainId !== 11155111n) throw Error("Sepolia chain 11155111 required");
  if (process.env.SEPOLIA_BROADCAST_AUTHORIZED !== "true") throw Error("Explicit broadcast flag required");
  const budgetRaw = process.env.SEPOLIA_BUDGET_ETH ?? "";
  const capRaw = process.env.SEPOLIA_MAX_FEE_GWEI ?? "";
  if (!/^\d+(?:\.\d{1,18})?$/.test(budgetRaw) || !/^\d+(?:\.\d{1,9})?$/.test(capRaw))
    throw Error("Explicit SEPOLIA_BUDGET_ETH and SEPOLIA_MAX_FEE_GWEI required");
  const budget = parseUnits(budgetRaw, 18);
  const feeCap = parseUnits(capRaw, 9);
  if (budget <= 0n || feeCap <= 0n) throw Error("Budget and fee cap must be positive");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  for (const args of [["diff", "--quiet"], ["diff", "--cached", "--quiet"]]) {
    try { execFileSync("git", args, { cwd: root, stdio: "ignore" }); }
    catch { throw Error("Tracked source changes must be committed before deployment"); }
  }
  const tokenArtifact = await hre.artifacts.readArtifact("DemoToken");
  const insuranceArtifact = await hre.artifacts.readArtifact("FlightDelayInsurance");
  const identity = {
    chainId: 11155111 as const, sourceCommit,
    compiler: { solc: "0.8.24", optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" },
    hardhatConfigSha256: sha256(readFileSync(resolve(root, "hardhat.config.ts"))),
    tokenAbiSha256: sha256(JSON.stringify(tokenArtifact.abi)),
    insuranceAbiSha256: sha256(JSON.stringify(insuranceArtifact.abi)), insurer, oracle,
  };
  let manifest: Manifest;
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    for (const [key, value] of Object.entries(identity))
      if (JSON.stringify((manifest as any)[key]) !== JSON.stringify(value))
        throw Error(`Existing deployment identity mismatch: ${key}`);
  } else {
    if (await ethers.provider.getTransactionCount(insurer, "pending") !== 0)
      throw Error("No manifest but insurer nonce is nonzero; inspect prior transactions first");
    manifest = { ...identity, steps: {}, totalSpentWei: "0" };
    persist(manifest);
  }
  const fees = await ethers.provider.getFeeData();
  const priority = fees.maxPriorityFeePerGas && fees.maxPriorityFeePerGas > 100_000_000n
    ? fees.maxPriorityFeePerGas : 100_000_000n;
  const quotedFee = (fees.maxFeePerGas ?? 0n) > 1_000_000_000n ? fees.maxFeePerGas! : 1_000_000_000n;
  const maxFeePerGas = quotedFee > priority ? quotedFee : priority;
  if (maxFeePerGas > feeCap || priority > feeCap) throw Error("Current fee exceeds approved cap");
  console.log(`Sepolia source ${sourceCommit}, insurer ${insurer}, oracle ${oracle}`);

  async function step(name: string, request: TransactionRequest, predictedAddress?: string) {
    let saved = manifest.steps[name];
    if (saved?.receipt) {
      const live = await ethers.provider.getTransactionReceipt(String(saved.receipt.transactionHash));
      if (!live || live.status !== 1 || live.blockNumber !== saved.receipt.blockNumber)
        throw Error(`${name}: saved receipt not confirmed on current chain`);
      return live;
    }
    if (saved?.hash) {
      const mined = await ethers.provider.getTransactionReceipt(saved.hash);
      if (!mined) throw Error(`${name}: pending; resume after confirmation`);
      if (mined.status !== 1) throw Error(`${name}: saved transaction reverted`);
      saved.receipt = publicReceipt(mined);
      manifest.totalSpentWei = (BigInt(manifest.totalSpentWei) + mined.gasUsed * mined.gasPrice).toString();
      persist(manifest);
      return mined;
    }
    if (saved) throw Error(`${name}: intent without hash; inspect chain before retry`);
    const nonce = await ethers.provider.getTransactionCount(insurer, "pending");
    const estimated = await ethers.provider.estimateGas({ ...request, from: insurer });
    const gasLimit = estimated * 12n / 10n + 10_000n;
    const worstCase = gasLimit * maxFeePerGas;
    if (BigInt(manifest.totalSpentWei) + worstCase > budget) throw Error(`${name}: budget exceeded`);
    if (await ethers.provider.getBalance(insurer) < worstCase) throw Error(`${name}: insufficient ETH`);
    saved = { nonce, predictedAddress };
    manifest.steps[name] = saved;
    persist(manifest); // intent before broadcast
    const tx = await signer.sendTransaction({ ...request, nonce, gasLimit,
      maxFeePerGas, maxPriorityFeePerGas: priority });
    saved.hash = tx.hash;
    persist(manifest); // hash before waiting
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw Error(`${name}: transaction failed or receipt unavailable`);
    saved.receipt = publicReceipt(receipt);
    manifest.totalSpentWei = (BigInt(manifest.totalSpentWei) + receipt.gasUsed * receipt.gasPrice).toString();
    persist(manifest);
    return receipt;
  }

  const Token = await ethers.getContractFactory("DemoToken");
  const tokenNonce = manifest.steps.tokenDeploy?.nonce ?? await ethers.provider.getTransactionCount(insurer, "pending");
  const tokenAddress = manifest.tokenAddress ?? getCreateAddress({ from: insurer, nonce: tokenNonce });
  const tokenReceipt = await step("tokenDeploy", await Token.getDeployTransaction(fundAmount), tokenAddress);
  if (getAddress(tokenReceipt.contractAddress ?? tokenAddress) !== tokenAddress ||
      (await ethers.provider.getCode(tokenAddress)) === "0x") throw Error("Token deployment mismatch");
  manifest.tokenAddress = tokenAddress; persist(manifest);

  const Insurance = await ethers.getContractFactory("FlightDelayInsurance");
  const insuranceNonce = manifest.steps.insuranceDeploy?.nonce ?? await ethers.provider.getTransactionCount(insurer, "pending");
  const insuranceAddress = manifest.insuranceAddress ?? getCreateAddress({ from: insurer, nonce: insuranceNonce });
  const insuranceReceipt = await step("insuranceDeploy",
    await Insurance.getDeployTransaction(tokenAddress, oracle), insuranceAddress);
  if (getAddress(insuranceReceipt.contractAddress ?? insuranceAddress) !== insuranceAddress ||
      (await ethers.provider.getCode(insuranceAddress)) === "0x") throw Error("Insurance deployment mismatch");
  manifest.insuranceAddress = insuranceAddress;
  manifest.insuranceDeployBlock = insuranceReceipt.blockNumber; persist(manifest);

  const token = new Contract(tokenAddress, tokenArtifact.abi, signer);
  const insurance = new Contract(insuranceAddress, insuranceArtifact.abi, signer);
  if (getAddress(await insurance.token()) !== tokenAddress ||
      getAddress(await insurance.oracle()) !== oracle ||
      getAddress(await insurance.insurer()) !== insurer) throw Error("Insurance role mismatch");
  if (manifest.steps.approve)
    await step("approve", await token.approve.populateTransaction(insuranceAddress, fundAmount));
  else if (BigInt(await token.allowance(insurer, insuranceAddress)) < fundAmount)
    await step("approve", await token.approve.populateTransaction(insuranceAddress, fundAmount));
  else throw Error("Allowance exists without saved approval receipt");
  const pool = BigInt(await insurance.poolBalance());
  if (manifest.steps.fundPool)
    await step("fundPool", await insurance.fundPool.populateTransaction(fundAmount));
  else if (pool < fundAmount) {
    if (pool !== 0n) throw Error("Unexpected partial pool; inspect before funding");
    await step("fundPool", await insurance.fundPool.populateTransaction(fundAmount));
  } else throw Error("Pool funded without saved receipt");
  if (BigInt(await insurance.poolBalance()) !== fundAmount ||
      BigInt(await insurance.reservedPayouts()) !== 0n) throw Error("Initial pool/reserve mismatch");
  if (manifest.steps.pause || !(await insurance.paused()))
    await step("pause", await insurance.pause.populateTransaction());
  else throw Error("Already paused without a saved pause receipt");
  if (!(await insurance.paused())) throw Error("On-chain sales are not paused");
  console.log(`Confirmed token ${tokenAddress}, insurance ${insuranceAddress}, block ${manifest.insuranceDeployBlock}`);
  console.log(`Public receipt manifest: ${manifestPath}`);
}

main().catch((error) => {
  let message = error instanceof Error ? error.message : "Unknown error";
  for (const secret of [process.env.SEPOLIA_RPC_URL, process.env.DEPLOYER_PRIVATE_KEY])
    if (secret) message = message.replaceAll(secret, "[redacted]");
  console.error(`Deployment stopped: ${message}`);
  process.exitCode = 1;
});
