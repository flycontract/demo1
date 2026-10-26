import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Contract, formatEther, getAddress, parseUnits, type TransactionRequest } from "ethers";
import hre from "hardhat";

// Exactly one future flight. No synthetic data or automatic substitution.
const root = resolve(__dirname, "..");
const deployment = JSON.parse(readFileSync(resolve(root, "deployments/sepolia.json"), "utf8"));
const manifestPath = resolve(root, "deployments/flight-sq898-2026-10-29.json");
const evidenceDir = resolve(root, "../evidence");
const planPath = resolve(root, "docs/evidence/sq898-plan-input-2026-10-29.txt");
const planHash = "1075e638cf62a9b3499f8e5cd4b07fcfb90f927ee6c32f48c01c8e38490597cd";
const airlineUrl = "https://www.singaporeair.com/en_UK/vn/flying-withus/cabins/business-class/business-class-4/";
const airportUrl = "https://www.hongkongairport.com/flightinfo-rest/rest/flights?date=2026-10-29&arrival=true&cargo=false&lang=en";
const scheduledDeparture = 1793271300;
const scheduledArrival = 1793285100;
const cutoff = scheduledDeparture - 86400;
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
type Step = { nonce?: number; hash?: string; receipt?: Record<string, unknown> };
type Admission = { sourceCommit: string; chainId: number; deploymentInsurance: string;
  planSha256: string; airlineRecheck?: { url: string; fetchedAt: string; sha256: string; path: string };
  airportRecheck?: { url: string; fetchedAt: string; sha256: string; path: string };
  steps: Record<string, Step>; totalSpentWei: string };

function save(m: Admission) {
  mkdirSync(resolve(root, "deployments"), { recursive: true });
  const tmp = `${manifestPath}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(m, null, 2) + "\n", { flag: "wx" });
  renameSync(tmp, manifestPath);
}
function receiptData(r: any): Record<string, unknown> {
  return { transactionHash: r.hash, blockHash: r.blockHash, blockNumber: r.blockNumber,
    status: r.status, from: r.from, to: r.to, gasUsed: r.gasUsed.toString(),
    gasPrice: r.gasPrice.toString(), transactionIndex: r.index,
    logs: r.logs.map((x: any) => ({ address: x.address, topics: x.topics, data: x.data, index: x.index })) };
}
async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Official source HTTP ${response.status}; sales stay paused`);
  return Buffer.from(await response.arrayBuffer());
}
async function officialRecheck(m: Admission) {
  // Both live sources must still agree on this exact operation and arrival plan.
  const airline = await fetchBytes(airlineUrl);
  const airlineText = airline.toString("utf8");
  const timetableRows = [...airlineText.matchAll(/<strong>SQ\s+898<\/strong>[\s\S]{0,700}/g)]
    .map((match) => match[0]);
  if (!timetableRows.some((row) => row.includes("18:55 - 22:45") &&
      row.includes("2026-10-25 to 2027-03-27") && row.includes("Daily")))
    throw Error("Airline timetable no longer supports the frozen plan");
  const airport = await fetchBytes(airportUrl);
  let groups: any;
  try { groups = JSON.parse(airport.toString("utf8")); }
  catch { throw Error("HKIA future response is not JSON"); }
  if (!Array.isArray(groups)) throw Error("HKIA future response shape changed");
  const rows = groups.flatMap((g: any) => (g.date === "2026-10-29" && Array.isArray(g.list))
    ? g.list.filter((x: any) => Array.isArray(x.flight) &&
        x.flight.some((f: any) => String(f.no).replace(/\s/g, "") === "SQ898")) : []);
  if (rows.length !== 1 || rows[0].time !== "22:45" ||
      !Array.isArray(rows[0].origin) || !rows[0].origin.includes("SIN") ||
      (rows[0].status !== null && rows[0].status !== ""))
    throw Error("HKIA future identity, plan or pending status changed");
  mkdirSync(evidenceDir, { recursive: true });
  const fetchedAt = new Date().toISOString();
  const stamp = fetchedAt.replace(/[:.]/g, "-");
  const airlinePath = `phase3-sq898-airline-admission-${stamp}.html`;
  const airportPath = `phase3-sq898-hkia-admission-${stamp}.json`;
  writeFileSync(resolve(evidenceDir, airlinePath), airline, { flag: "wx" });
  writeFileSync(resolve(evidenceDir, airportPath), airport, { flag: "wx" });
  m.airlineRecheck = { url: airlineUrl, fetchedAt, sha256: hash(airline), path: `../evidence/${airlinePath}` };
  m.airportRecheck = { url: airportUrl, fetchedAt, sha256: hash(airport), path: `../evidence/${airportPath}` };
  save(m);
}

async function main() {
  const { ethers } = hre;
  const [signer] = await ethers.getSigners();
  const insurer = await signer.getAddress();
  if ((await ethers.provider.getNetwork()).chainId !== 11155111n) throw Error("Sepolia required");
  if (getAddress(insurer) !== getAddress(deployment.insurer)) throw Error("Insurer signer mismatch");
  if (hash(readFileSync(planPath)) !== planHash) throw Error("Frozen plan bytes differ from approved candidate");
  const artifact = await hre.artifacts.readArtifact("FlightDelayInsurance");
  if (hash(JSON.stringify(artifact.abi)) !== deployment.insuranceAbiSha256)
    throw Error("Current ABI differs from deployed contract");
  if ((await ethers.provider.getCode(deployment.insuranceAddress)) === "0x")
    throw Error("Insurance bytecode missing");
  const contract = new Contract(deployment.insuranceAddress, artifact.abi, signer);
  if (getAddress(await contract.insurer()) !== getAddress(insurer) ||
      getAddress(await contract.oracle()) !== getAddress(deployment.oracle) ||
      getAddress(await contract.token()) !== getAddress(deployment.tokenAddress))
    throw Error("Deployed roles differ from public manifest");
  if (process.env.FLIGHT_BROADCAST_AUTHORIZED !== "true" ||
      process.env.FLIGHT_BUDGET_ETH !== "0.02" ||
      process.env.FLIGHT_MAX_FEE_GWEI !== "10")
    throw Error("Specific SQ898 broadcast flag and approved 0.02 ETH / 10 gwei caps required");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  for (const args of [["diff", "--quiet"], ["diff", "--cached", "--quiet"]]) {
    try { execFileSync("git", args, { cwd: root, stdio: "ignore" }); }
    catch { throw Error("Tracked source/evidence changes must be committed before admission"); }
  }
  let m: Admission;
  if (existsSync(manifestPath)) {
    m = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (m.sourceCommit !== sourceCommit || m.chainId !== 11155111 ||
        m.deploymentInsurance !== deployment.insuranceAddress || m.planSha256 !== planHash)
      throw Error("Existing admission identity differs; inspect before continuing");
  } else {
    if (BigInt(await contract.flightCount()) !== 0n || !(await contract.paused()))
      throw Error("Expected empty paused deployment before first admission");
    m = { sourceCommit, chainId: 11155111, deploymentInsurance: deployment.insuranceAddress,
      planSha256: planHash, steps: {}, totalSpentWei: "0" };
    save(m);
  }
  if (BigInt(await contract.poolBalance()) < 8000n || BigInt(await contract.reservedPayouts()) !== 0n)
    throw Error("Pool or reserve changed before sale");
  const plan = { flightNo: "SQ898", origin: "SIN", departureDate: "2026-10-29",
    scheduledDeparture, scheduledArrival, planEvidenceHash: `0x${planHash}`,
    planSourceUrl: airlineUrl, planFetchedAt: Math.floor(Date.parse("2026-10-26T10:41:45Z") / 1000),
    aliases: [], sellable: true };
  const budget = parseUnits("0.02", 18);
  const feeData = await ethers.provider.getFeeData();
  const priority = feeData.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas > 100_000_000n
    ? feeData.maxPriorityFeePerGas : 100_000_000n;
  const quoted = feeData.maxFeePerGas && feeData.maxFeePerGas > 1_000_000_000n
    ? feeData.maxFeePerGas : 1_000_000_000n;
  const maxFeePerGas = quoted > priority ? quoted : priority;
  if (maxFeePerGas > parseUnits("10", 9) || priority > parseUnits("10", 9))
    throw Error("Current gas fee exceeds approved cap");
  async function step(name: string, request: TransactionRequest) {
    let s = m.steps[name];
    if (s?.receipt) {
      const live = await ethers.provider.getTransactionReceipt(String(s.receipt.transactionHash));
      if (!live || live.status !== 1 || live.blockNumber !== s.receipt.blockNumber)
        throw Error(`${name}: saved receipt differs from chain`);
      return live;
    }
    if (s?.hash) {
      const live = await ethers.provider.getTransactionReceipt(s.hash);
      if (!live) throw Error(`${name}: saved transaction still pending`);
      if (live.status !== 1) throw Error(`${name}: saved transaction failed`);
      s.receipt = receiptData(live);
      m.totalSpentWei = (BigInt(m.totalSpentWei) + live.gasUsed * live.gasPrice).toString();
      save(m);
      return live;
    }
    if (s) throw Error(`${name}: intent lacks hash; inspect nonce/chain before retry`);
    const block = await ethers.provider.getBlock("latest");
    if (!block || block.timestamp > cutoff - 3600)
      throw Error("Less than one hour remains before the 24-hour sale cutoff");
    await officialRecheck(m);
    const nonce = await ethers.provider.getTransactionCount(insurer, "pending");
    const estimate = await ethers.provider.estimateGas({ ...request, from: insurer });
    const gasLimit = estimate * 13n / 10n + 10_000n;
    const worst = gasLimit * maxFeePerGas;
    if (BigInt(m.totalSpentWei) + worst > budget || await ethers.provider.getBalance(insurer) < worst)
      throw Error(`${name}: approved budget or balance insufficient`);
    s = { nonce }; m.steps[name] = s; save(m);
    const tx = await signer.sendTransaction({ ...request, nonce, gasLimit,
      maxFeePerGas, maxPriorityFeePerGas: priority });
    s.hash = tx.hash; save(m);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw Error(`${name}: receipt failed or unavailable`);
    s.receipt = receiptData(receipt);
    m.totalSpentWei = (BigInt(m.totalSpentWei) + receipt.gasUsed * receipt.gasPrice).toString();
    save(m);
    console.log(`${name}: ${receipt.hash}, block ${receipt.blockNumber}, spent ${formatEther(receipt.gasUsed * receipt.gasPrice)} ETH`);
    return receipt;
  }
  if (!(await contract.paused()) && !m.steps.unpause)
    throw Error("Contract already unpaused without this admission record");
  await step("register", await contract.registerFlight.populateTransaction(plan));
  const flight = await contract.flights(1);
  if (BigInt(await contract.flightCount()) !== 1n || flight.flightNo !== "SQ898" ||
      flight.origin !== "SIN" || flight.departureDate !== "2026-10-29" ||
      BigInt(flight.scheduledDeparture) !== BigInt(scheduledDeparture) ||
      BigInt(flight.scheduledArrival) !== BigInt(scheduledArrival) ||
      flight.planEvidenceHash.toLowerCase() !== `0x${planHash}` || !flight.sellable ||
      (!m.steps.unpause?.hash && !(await contract.paused())))
    throw Error("Registered flight or pause state mismatch");
  await step("unpause", await contract.unpause.populateTransaction());
  if (await contract.paused()) throw Error("Unpause transaction confirmed but sales remain paused");
  console.log(`SQ898 registered as flight 1; public admission manifest ${manifestPath}`);
}

main().catch((error) => {
  let message = error instanceof Error ? error.message : "Unknown error";
  for (const secret of [process.env.SEPOLIA_RPC_URL, process.env.DEPLOYER_PRIVATE_KEY])
    if (secret) message = message.replaceAll(secret, "[redacted]");
  console.error(`Flight admission stopped: ${message}`);
  process.exitCode = 1;
});
