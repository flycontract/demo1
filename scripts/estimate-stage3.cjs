// Read-only Sepolia account/fee checks plus isolated Hardhat 31337 gas measurements.
// No Sepolia transaction is signed or sent by this script.
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");
const { JsonRpcProvider, Wallet, formatEther, formatUnits } = require("ethers");
const dotenv = require("dotenv");

async function main() {
  const root = path.resolve(__dirname, "..");
  const base = dotenv.parse(fs.readFileSync(path.join(root, ".env")));
  const oracle = dotenv.parse(fs.readFileSync(path.join(root, "oracle", ".env")));
  const insurerAddress = new Wallet(base.DEPLOYER_PRIVATE_KEY).address;
  const oracleAddress = new Wallet(oracle.ORACLE_PRIVATE_KEY).address;
  if (insurerAddress === oracleAddress || base.ORACLE_ADDRESS?.toLowerCase() !== oracleAddress.toLowerCase()) {
    throw Error("Configured insurer/oracle addresses do not match independent local keys");
  }
  const rpc = new JsonRpcProvider(base.SEPOLIA_RPC_URL);
  try {
    const network = await rpc.getNetwork();
    if (network.chainId !== 11155111n) throw Error("RPC is not Sepolia");
    const fee = await rpc.getFeeData();
    const feeCap = fee.maxFeePerGas ?? fee.gasPrice;
    if (!feeCap) throw Error("RPC returned no fee estimate");
    const insurerBalance = await rpc.getBalance(insurerAddress);
    const oracleBalance = await rpc.getBalance(oracleAddress);
    const insurerNonce = await rpc.getTransactionCount(insurerAddress);
    console.log(`Sepolia block ${await rpc.getBlockNumber()}, max fee estimate ${formatUnits(feeCap, "gwei")} gwei`);
    console.log(`Insurer ${insurerAddress}: ${formatEther(insurerBalance)} ETH, nonce ${insurerNonce}`);
    console.log(`Oracle ${oracleAddress}: ${formatEther(oracleBalance)} ETH`);
    const { ethers } = hre;
    const [localInsurer] = await ethers.getSigners();
    const gas = [];
    const Token = await ethers.getContractFactory("DemoToken", localInsurer);
    const token = await Token.deploy(10_000n);
    gas.push(["deploy DemoToken", (await token.deploymentTransaction().wait()).gasUsed]);
    const Insurance = await ethers.getContractFactory("FlightDelayInsurance", localInsurer);
    const insurance = await Insurance.deploy(await token.getAddress(), oracleAddress);
    gas.push(["deploy FlightDelayInsurance", (await insurance.deploymentTransaction().wait()).gasUsed]);
    const insuranceAddress = await insurance.getAddress();
    gas.push(["approve 10000 FDT", (await (await token.approve(insuranceAddress, 10_000n)).wait()).gasUsed]);
    gas.push(["fund pool 10000 FDT", (await (await insurance.fundPool(10_000n)).wait()).gasUsed]);
    gas.push(["pause on-chain sales", (await (await insurance.pause()).wait()).gasUsed]);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const departure = now + 3 * 86400;
    const arrival = departure + 4 * 3600;
    const registrationGas = (await (await insurance.registerFlight({
      flightNo: "SQ 898", origin: "SIN", departureDate: new Date(departure * 1000).toISOString().slice(0, 10),
      scheduledDeparture: departure, scheduledArrival: arrival,
      planEvidenceHash: ethers.keccak256(ethers.toUtf8Bytes("gas-estimate-only")),
      planSourceUrl: "https://www.singaporeair.com/", planFetchedAt: now,
      aliases: [], sellable: false,
    })).wait()).gasUsed;
    let total = 0n;
    for (const [label, units] of gas) {
      total += units;
      console.log(`${label}: ${units} gas, ${formatEther(units * feeCap)} ETH at current max-fee estimate`);
    }
    const bufferCost = total * feeCap * 15n / 10n;
    const conservativeCost = total * 10_000_000_000n * 15n / 10n;
    console.log(`Five deployment/pause transactions: ${total} measured gas; 1.5x buffered current-fee estimate ${formatEther(bufferCost)} ETH`);
    console.log(`Deployment/pause scenario at 10 gwei and 1.5x gas: ${formatEther(conservativeCost)} ETH`);
    console.log(`Separate future flight registration: ${registrationGas} gas, 10 gwei/1.5x ${formatEther(registrationGas * 10_000_000_000n * 15n / 10n)} ETH`);
    console.log(`Current insurer balance covers that scenario: ${insurerBalance >= conservativeCost}`);
    console.log("Local gas units and current network fee are estimates, not a transaction cap or broadcast.");
  } finally { rpc.destroy(); }
}

main().catch((error) => {
  // Error objects may contain URLs or private RPC credentials; never print them.
  console.error(`Stage-three estimate failed (${error?.code ?? "local or RPC error"})`);
  process.exitCode = 1;
});
