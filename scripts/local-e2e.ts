import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import hre from "hardhat";

/**
 * Local end-to-end run (no MetaMask, no Sepolia).
 *
 * Unlike the in-process eth-tester harness in test_python/ (which feeds the
 * contract simulated results), this script drives the *real* chain and leaves
 * the flight result to the real oracle service, which fetches Hong Kong
 * International Airport's official data over HTTP.
 *
 * It exercises the "real historical replay" layer of PRD §8:
 *   register a trusted plan time -> buy before the 24h cutoff -> request
 *   verification -> oracle queries the real HKIA record -> contract settles.
 * It does NOT prove "bought before a real departure", which stays a documented
 * claim the project makes no attempt at (PRD §4).
 *
 * Usage (three terminals, see ENVIRONMENT notes):
 *   1. npm run local:node                                   # chain, started in the past
 *   2. npm run local:e2e                                    # deploy + register + buy + request
 *   3. cd oracle && npm start                               # oracle fulfils, contract settles
 *
 * The scheduled arrival of every case below is the `time` field of the matching
 * real HKIA record for 2026-09-19. Note PRD §4: the official dictionary only
 * calls `time` "Time of arrival", so using it as the insured plan time is a
 * deliberate, documented choice for the replay -- not verified underwriting.
 */

interface ReplayCase {
  flightNo: string;
  origin: string;
  /** HKIA record date the official result is expected in. */
  recordDate: string;
  /** Trusted plan time registered on-chain, as Hong Kong local time "HH:MM". */
  planHkTime: string;
  /** What the real HKIA record says, for the console summary. */
  expectation: string;
}

const REPLAY: ReplayCase[] = [
  {
    flightNo: "CX 750",
    origin: "BKK",
    recordDate: "2026-09-19",
    planHkTime: "15:05",
    expectation: 'real record "At gate 17:20" -> 135 min delay -> payout 100',
  },
  {
    flightNo: "CX 774",
    origin: "BKK",
    recordDate: "2026-09-19",
    planHkTime: "16:15",
    expectation: 'real record "At gate 16:15" -> 0 min delay -> no payout',
  },
  {
    flightNo: "BX 3935",
    origin: "ICN",
    recordDate: "2026-09-19",
    planHkTime: "00:15",
    expectation: 'real record "Cancelled" -> payout 100',
  },
];

const POLICY_STATUS = ["Active", "Verifying", "PaidOut", "ClosedNoPay", "Refunded"];
const TERMINAL_STATUS = new Set([2, 3, 4]);
const SALE_CUTOFF_SECONDS = 24 * 3600;

/** Hong Kong is UTC+8 with no DST, so a HK wall-clock time maps to UTC by shifting 8h back. */
function hkTimeToUnix(recordDate: string, hkHHMM: string): number {
  const [y, m, d] = recordDate.split("-").map(Number);
  const [hh, mm] = hkHHMM.split(":").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, hh - 8, mm) / 1000);
}

/** Same formula the oracle uses to pick HKIA record dates from a scheduled arrival. */
function hkDateFromUnix(ts: number): string {
  return new Date((ts + 8 * 3600) * 1000).toISOString().slice(0, 10);
}

/** Update KEY=value lines in an existing .env file, appending missing keys. */
function upsertEnvFile(path: string, values: Record<string, string>) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const m = /^([A-Z0-9_]+)=/.exec(line);
    if (m && values[m[1]] !== undefined) {
      seen.add(m[1]);
      return `${m[1]}=${values[m[1]]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(values)) {
    if (!seen.has(k)) out.push(`${k}=${v}`);
  }
  writeFileSync(path, out.join("\n").replace(/\n*$/, "\n"), "utf8");
}

async function main() {
  const { ethers, network } = hre;
  const signers = await ethers.getSigners();
  const [insurer, oracleAccount, ...buyers] = signers;
  if (buyers.length < REPLAY.length) {
    throw new Error(`need ${REPLAY.length} buyer accounts, hardhat only exposed ${buyers.length}`);
  }

  const latest = await ethers.provider.getBlock("latest");
  const chainNow = Number(latest!.timestamp);
  console.log(`network   : ${network.name}`);
  console.log(`chain time: ${new Date(chainNow * 1000).toISOString()} (block ${latest!.number})`);
  console.log(`insurer   : ${insurer.address}`);
  console.log(`oracle    : ${oracleAccount.address}`);
  console.log("");

  // --- guard: the chain clock must be early enough for every case -------------
  for (const c of REPLAY) {
    const scheduled = hkTimeToUnix(c.recordDate, c.planHkTime);
    const latestBuy = scheduled - SALE_CUTOFF_SECONDS;
    const ok = chainNow <= latestBuy;
    console.log(
      `${c.flightNo.padEnd(8)} plan ${c.recordDate} ${c.planHkTime} HKT = unix ${scheduled}; ` +
        `sale cutoff at unix ${latestBuy} -> ${ok ? "sellable" : "ALREADY PAST CUTOFF"}`
    );
    if (!ok) {
      throw new Error(
        `chain time ${new Date(chainNow * 1000).toISOString()} is later than ${c.flightNo}'s sale cutoff. ` +
          `Set LOCAL_INITIAL_DATE to an earlier date (e.g. 2026-09-16T00:00:00Z) in .env and restart 'npm run local:node'.`
      );
    }
  }
  console.log("");

  // --- deploy ------------------------------------------------------------------
  const DemoToken = await ethers.getContractFactory("DemoToken");
  const token = await DemoToken.deploy(10_000n);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();

  const FlightDelayInsurance = await ethers.getContractFactory("FlightDelayInsurance");
  const insurance = await FlightDelayInsurance.deploy(tokenAddress, oracleAccount.address);
  await insurance.waitForDeployment();
  const insuranceAddress = await insurance.getAddress();

  await (await token.approve(insuranceAddress, 10_000n)).wait();
  await (await insurance.fundPool(10_000n)).wait();
  const deployBlock = await ethers.provider.getBlockNumber();

  console.log(`DemoToken             : ${tokenAddress}`);
  console.log(`FlightDelayInsurance  : ${insuranceAddress}`);
  console.log(`pool funded with 10,000 FDT (deploy block ${deployBlock})`);

  // --- point the local oracle + frontend at this deployment ---------------------
  const writeEnv = !process.argv.includes("--no-write-env");
  if (writeEnv) {
    upsertEnvFile(resolve(__dirname, "..", "oracle", ".env"), {
      RPC_URL: process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545",
      CONTRACT_ADDRESS: insuranceAddress,
      DEPLOY_BLOCK: String(deployBlock),
    });
    upsertEnvFile(resolve(__dirname, "..", "frontend", ".env"), {
      VITE_RPC_URL: process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545",
      VITE_TOKEN_ADDRESS: tokenAddress,
      VITE_INSURANCE_ADDRESS: insuranceAddress,
      VITE_CHAIN_ID: "31337",
      VITE_CHAIN_NAME: "Hardhat Local",
    });
    console.log("updated oracle/.env and frontend/.env with this deployment (--no-write-env to skip)");
  }
  console.log("");

  // --- register flights (the insurer's manual trust step) -----------------------
  const flightIds: number[] = [];
  for (const c of REPLAY) {
    const scheduled = hkTimeToUnix(c.recordDate, c.planHkTime);
    const tx = await insurance.registerFlight(c.flightNo, c.origin, scheduled, true);
    await tx.wait();
    const id = Number(await insurance.flightCount());
    flightIds.push(id);
    console.log(
      `registered flight ${id}: ${c.flightNo} from ${c.origin}, plan ${new Date(scheduled * 1000).toISOString()} ` +
        `(HK record date ${hkDateFromUnix(scheduled)}) -- expect ${c.expectation}`
    );
  }
  console.log("");

  // --- buy + request verification ----------------------------------------------
  const policyIds: number[] = [];
  const requestIds: number[] = [];
  for (let i = 0; i < REPLAY.length; i++) {
    const buyer = buyers[i];
    const c = REPLAY[i];
    await (await token.connect(buyer).faucet()).wait();
    await (await token.connect(buyer).approve(insuranceAddress, 10n)).wait();
    const policyId = Number(await insurance.policyCount());
    await (await insurance.connect(buyer).buyPolicy(flightIds[i])).wait();
    const requestId = Number(await insurance.requestCount()) + 1;
    await (await insurance.connect(buyer).requestVerification(policyId)).wait();
    policyIds.push(policyId);
    requestIds.push(requestId);
    console.log(
      `policy ${policyId} / request ${requestId}: ${buyer.address} bought ${c.flightNo} (premium 10) and requested verification`
    );
  }

  const poolAfterSales = await insurance.poolBalance();
  const reserved = await insurance.reservedPayouts();
  console.log(`\npool balance ${poolAfterSales} FDT, reserved payouts ${reserved} FDT`);
  console.log("\n=== NOW START THE ORACLE IN ANOTHER TERMINAL: cd oracle && npm start ===");
  console.log("(it will fetch the real HKIA records and call fulfillVerification)\n");

  // --- wait for the oracle to settle -------------------------------------------
  const waitSeconds = Number(process.env.WAIT_SECONDS ?? "300");
  const deadline = Date.now() + waitSeconds * 1000;
  let settled = false;
  while (Date.now() < deadline) {
    const states: string[] = [];
    let allTerminal = true;
    for (const policyId of policyIds) {
      const p = await insurance.policies(policyId);
      const status = Number(p.status);
      if (!TERMINAL_STATUS.has(status)) allTerminal = false;
      states.push(`${REPLAY[policyIds.indexOf(policyId)].flightNo}:${POLICY_STATUS[status]}`);
    }
    process.stdout.write(`  waiting... ${states.join("  ")}\n`);
    if (allTerminal) {
      settled = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  // --- final report -------------------------------------------------------------
  console.log("\n================ RESULT ================");
  const settledEvents = await insurance.queryFilter(insurance.filters.PolicySettled(), deployBlock);
  const reasonByPolicy = new Map<number, string>();
  for (const ev of settledEvents) {
    if ("args" in ev) reasonByPolicy.set(Number(ev.args[0]), String(ev.args[3]));
  }

  for (let i = 0; i < REPLAY.length; i++) {
    const c = REPLAY[i];
    const result = await insurance.flightResults(flightIds[i]);
    const p = await insurance.policies(policyIds[i]);
    const status = Number(p.status);
    const balance = await token.balanceOf(buyers[i].address);
    console.log(
      `${c.flightNo.padEnd(8)} plan ${c.recordDate} ${c.planHkTime} HKT | ` +
        `final=${result.isFinal} cancelled=${result.cancelled} delay=${result.delayMinutes}min dataDate=${result.dataDate} | ` +
        `policy=${POLICY_STATUS[status]} reason="${reasonByPolicy.get(policyIds[i]) ?? "-"}" | buyer balance ${balance} FDT`
    );
    console.log(`         expected: ${c.expectation}`);
  }
  console.log(`pool balance at end: ${await insurance.poolBalance()} FDT, reserved ${await insurance.reservedPayouts()} FDT`);
  if (!settled) {
    console.log(`\n!! not every policy reached a terminal state within ${waitSeconds}s.`);
    console.log("!! Is the oracle running, and did it find a final record for the target date?");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
