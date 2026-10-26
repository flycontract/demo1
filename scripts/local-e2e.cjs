const assert = require("node:assert/strict");
const { readFileSync, mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createHash } = require("node:crypto");
const { ethers, network } = require("hardhat");

const DAY = 86400;
const hk = (day, time) => Math.floor(Date.parse(`${day}T${time}:00+08:00`) / 1000);
const isoDay = (timestamp) => new Date((timestamp + 8 * 3600) * 1000).toISOString().slice(0, 10);
const moveTo = async (timestamp) => {
  await network.provider.send("evm_setNextBlockTimestamp", [timestamp]);
  await network.provider.send("evm_mine");
};
const hash = (bytes) => ethers.keccak256(bytes);

async function main() {
  assert.equal(network.name, "hardhat");
  assert.equal((await ethers.provider.getNetwork()).chainId, 31337n);
  const oracleDir = join(__dirname, "..", "oracle", "dist");
  const { OracleService } = await import(`file:///${join(oracleDir, "service.js").replaceAll("\\", "/")}`);
  const { openDb, bindDb, getEvidence, getRequestById } = await import(`file:///${join(oracleDir, "db.js").replaceAll("\\", "/")}`);
  const { getPastFlights, buildUrl } = await import(`file:///${join(oracleDir, "hkAirport.js").replaceAll("\\", "/")}`);
  const [insurer, oracleSigner, buyerHistoric, buyerDelay, buyerOnTime, buyerCancel, buyerUnknown, outsider] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("DemoToken", insurer)).deploy(10000n);
  await token.waitForDeployment();
  const insurance = await (await ethers.getContractFactory("FlightDelayInsurance", insurer)).deploy(await token.getAddress(), oracleSigner.address);
  await insurance.waitForDeployment();
  const deployBlock = (await insurance.deploymentTransaction().wait()).blockNumber;
  await (await token.approve(await insurance.getAddress(), 10000n)).wait();
  await (await insurance.fundPool(10000n)).wait();
  assert.equal(await insurance.poolBalance(), 10000n);

  const cases = [
    { name: "historical", no: "CX 636", origin: "SIN", day: "2026-10-25", arrival: "00:10", buyer: buyerHistoric, status: 3, balance: 190n, aliases: ["GF 4062"] },
    { name: "simulated delay", no: "SIM 001", origin: "BKK", day: "2026-10-29", arrival: "12:00", buyer: buyerDelay, status: 2, balance: 290n },
    { name: "simulated on-time", no: "SIM 002", origin: "SIN", day: "2026-10-29", arrival: "13:00", buyer: buyerOnTime, status: 3, balance: 190n },
    { name: "simulated cancellation", no: "SIM 003", origin: "TPE", day: "2026-10-29", arrival: "14:00", buyer: buyerCancel, status: 2, balance: 290n },
    { name: "simulated unknown/refund", no: "SIM 004", origin: "ICN", day: "2026-10-29", arrival: "15:00", buyer: buyerUnknown, status: 4, balance: 200n },
  ];
  for (const c of cases) {
    const arrival = hk(c.day, c.arrival);
    const departure = arrival - 6 * 3600;
    const fetched = (await ethers.provider.getBlock("latest")).timestamp;
    const planBytes = Buffer.from(`LOCAL E2E PLAN ASSUMPTION ${c.name} ${c.day} ${c.arrival}`);
    await (await insurance.registerFlight({
      flightNo: c.no, origin: c.origin, departureDate: isoDay(departure),
      scheduledDeparture: departure, scheduledArrival: arrival,
      planEvidenceHash: hash(planBytes), planSourceUrl: "https://example.org/local-e2e-plan-assumption",
      planFetchedAt: fetched, aliases: c.aliases ?? [], sellable: true,
    })).wait();
    c.flightId = Number(await insurance.flightCount());
    c.arrivalUnix = arrival;
    await (await token.connect(c.buyer).faucet()).wait();
    await (await token.connect(c.buyer).approve(await insurance.getAddress(), 10n)).wait();
    c.policyId = Number(await insurance.policyCount());
    await (await insurance.connect(c.buyer).buyPolicy(c.flightId)).wait();
    assert.equal(await token.balanceOf(c.buyer.address), 190n);
  }
  assert.equal(await insurance.poolBalance(), 10050n);
  assert.equal(await insurance.reservedPayouts(), 500n);
  await assert.rejects(insurance.registerFlight({
    flightNo: "GF 4062", origin: "SIN", departureDate: isoDay(cases[0].arrivalUnix - 6 * 3600),
    scheduledDeparture: cases[0].arrivalUnix - 6 * 3600, scheduledArrival: cases[0].arrivalUnix,
    planEvidenceHash: hash(Buffer.from("duplicate")), planSourceUrl: "https://example.org/duplicate",
    planFetchedAt: (await ethers.provider.getBlock("latest")).timestamp, aliases: [], sellable: true,
  }));

  const rawHistoric = readFileSync(join(__dirname, "..", "oracle", "fixtures", "hkia-past-2026-10-25.raw"));
  const simulated = Buffer.from(JSON.stringify([{
    date: "2026-10-29", list: [
      { flight: [{ no: "SIM 001", airline: "TEST" }], origin: ["BKK"], time: "12:00", status: "At gate 14:00" },
      { flight: [{ no: "SIM 002", airline: "TEST" }], origin: ["SIN"], time: "13:00", status: "At gate 13:00" },
      { flight: [{ no: "SIM 003", airline: "TEST" }], origin: ["TPE"], time: "14:00", status: "Cancelled" },
      { flight: [{ no: "SIM 004", airline: "TEST" }], origin: ["ICN"], time: "15:00", status: "Estimated 15:30" },
    ],
  }]));
  let fetchCount = 0;
  const fetchFlights = (db, date, options) => getPastFlights(db, date, {
    ...options, fetchImpl: async () => { fetchCount++; return new Response(date === "2026-10-25" ? rawHistoric : simulated, { status: 200 }); },
  });
  const isolatedPath = join(mkdtempSync(join(tmpdir(), "comp7610-phase2-e2e-")), "local-31337.sqlite");
  let db = openDb(isolatedPath);
  bindDb(db, 31337n, await insurance.getAddress());
  const opts = { deployBlock, pollIntervalMs: 1000, httpTimeoutMs: 1000, maxDailyRefresh: 3,
    minRefreshIntervalMs: 14400000, confirmations: 1, eventChunkSize: 2, reorgOverlap: 2 };
  const service = () => new OracleService(db, ethers.provider, insurance, insurance.connect(oracleSigner), opts, fetchFlights);
  let worker = service();

  await moveTo(Number((await insurance.flights(1)).earliestVerification));
  await (await insurance.connect(buyerHistoric).requestVerification(cases[0].policyId)).wait();
  cases[0].requestId = Number(await insurance.requestCount());
  await assert.rejects(insurance.connect(outsider).fulfillVerification(cases[0].requestId, false, cases[0].arrivalUnix, "2026-10-25", hash(Buffer.from("bad"))));
  await worker.tick();
  assert.equal(Number((await insurance.policies(cases[0].policyId)).status), 3);
  assert.equal(await token.balanceOf(buyerHistoric.address), 190n);
  assert.equal(fetchCount, 1);

  await moveTo(Number((await insurance.flights(2)).earliestVerification));
  for (const c of cases.slice(1)) {
    await (await insurance.connect(c.buyer).requestVerification(c.policyId)).wait();
    c.requestId = Number(await insurance.requestCount());
  }
  await worker.tick();
  assert.equal(fetchCount, 2, "one shared date cache, not a fetch per policy");
  assert.equal(Number((await insurance.policies(cases[4].policyId)).status), 1);
  assert.equal(await insurance.reservedPayouts(), 100n);
  assert.equal(await insurance.poolBalance(), 9850n);
  for (const c of cases.slice(0, 4)) {
    const policy = await insurance.policies(c.policyId);
    assert.equal(Number(policy.status), c.status, c.name);
    assert.equal(await token.balanceOf(c.buyer.address), c.balance, c.name);
    const evidence = getEvidence(db, c.flightId);
    assert.ok(evidence, `${c.name} evidence exists`);
    assert.equal(evidence.submit_status, "confirmed");
    assert.equal(evidence.raw_sha256, createHash("sha256").update(evidence.raw_bytes).digest("hex"));
    assert.equal(evidence.evidence_hash, hash(evidence.raw_bytes));
    assert.equal(evidence.source_url, buildUrl(c.day));
    assert.equal((await ethers.provider.getTransactionReceipt(evidence.tx_hash)).status, 1);
    assert.equal((await insurance.flightResults(c.flightId)).evidenceHash, evidence.evidence_hash);
    assert.equal(getRequestById(db, c.requestId).status, "fulfilled");
    console.log(`${c.name}: ${c.status === 2 ? "paid 100" : "closed without payout"}, evidence and receipt verified`);
  }
  assert.equal(getEvidence(db, cases[4].flightId), undefined);
  const balanceBeforeRestart = await insurance.poolBalance();
  db.close();
  db = openDb(isolatedPath);
  bindDb(db, 31337n, await insurance.getAddress());
  worker = service();
  await worker.tick();
  assert.equal(await insurance.poolBalance(), balanceBeforeRestart);
  assert.equal(fetchCount, 2);
  await assert.rejects(insurance.connect(oracleSigner).fulfillVerification(cases[0].requestId, false, cases[0].arrivalUnix, "2026-10-25", hash(Buffer.from("duplicate"))));
  await moveTo(cases[4].arrivalUnix + 7 * DAY);
  await (await insurance.connect(buyerUnknown).refundUnresolved(cases[4].policyId)).wait();
  await worker.tick();
  assert.equal(Number((await insurance.policies(cases[4].policyId)).status), 4);
  assert.equal(await token.balanceOf(buyerUnknown.address), 200n);
  assert.equal(await insurance.poolBalance(), 9840n);
  assert.equal(await insurance.reservedPayouts(), 0n);
  assert.equal(getRequestById(db, cases[4].requestId).status, "blocked");
  db.close();
  console.log("simulated unknown: refunded 10 at deadline; no evidence or callback");
  console.log("restart/replay: no extra fetch, callback, settlement or balance change");
  console.log("LOCAL E2E PASS: chain 31337, isolated DB, final pool 9840 FDT, reserved 0 FDT");
  console.log("Historical CX 636 uses HKIA 2026-10-25 raw response; its planned 00:10 is a demo assumption, not verified original schedule.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
