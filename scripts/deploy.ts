import "dotenv/config";
import { getAddress, isAddress } from "ethers";
import hre from "hardhat";

/**
 * Deploys DemoToken + FlightDelayInsurance, seeds the pool with the PRD's
 * 10,000-token initial underwriting fund, and prints the addresses to paste
 * into oracle/.env and frontend/.env.
 *
 * Env: ORACLE_ADDRESS (the address oracle/.env's ORACLE_PRIVATE_KEY controls).
 * A dedicated oracle account is mandatory; an empty value is never accepted.
 */
async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  const oracleRaw = process.env.ORACLE_ADDRESS?.trim() ?? "";
  if (!isAddress(oracleRaw) || /^0x0{40}$/i.test(oracleRaw)) throw new Error("Valid nonzero ORACLE_ADDRESS required");
  const oracleAddress = getAddress(oracleRaw);
  if (oracleAddress === deployer.address) throw new Error("Oracle must be independent from deployer");
  if ((await ethers.provider.getNetwork()).chainId !== 11155111n) throw new Error("Sepolia chain ID required");
  const initialFund = 10_000n;

  console.log(`Deploying with account ${deployer.address}`);
  console.log(`Oracle account will be set to ${oracleAddress}`);

  const DemoToken = await ethers.getContractFactory("DemoToken");
  const token = await DemoToken.deploy(initialFund);
  await token.waitForDeployment();
  console.log(`DemoToken deployed at ${await token.getAddress()}`);

  const FlightDelayInsurance = await ethers.getContractFactory("FlightDelayInsurance");
  const insurance = await FlightDelayInsurance.deploy(await token.getAddress(), oracleAddress);
  await insurance.waitForDeployment();
  const deploymentTx = insurance.deploymentTransaction();
  const deploymentReceipt = deploymentTx && await deploymentTx.wait();
  if (!deploymentReceipt || deploymentReceipt.status !== 1) throw new Error("Insurance deployment receipt missing or failed");
  const insuranceAddress = await insurance.getAddress();
  console.log(`FlightDelayInsurance deployed at ${insuranceAddress}`);

  const approveTx = await token.approve(insuranceAddress, initialFund);
  await approveTx.wait();
  const fundTx = await insurance.fundPool(initialFund);
  await fundTx.wait();
  console.log(`Funded pool with ${initialFund} FDT`);

  // insurance is already mined at this point (waitForDeployment resolved above).
  const deployBlock = deploymentReceipt.blockNumber;

  console.log("\n--- paste into oracle/.env ---");
  console.log("RPC_URL=<configured Sepolia RPC; value redacted>");
  console.log(`CONTRACT_ADDRESS=${insuranceAddress}`);
  console.log(`DEPLOY_BLOCK=${deployBlock}`);

  console.log("\n--- paste into frontend/.env ---");
  console.log("VITE_RPC_URL=<configured Sepolia RPC; value redacted>");
  console.log(`VITE_TOKEN_ADDRESS=${await token.getAddress()}`);
  console.log(`VITE_INSURANCE_ADDRESS=${insuranceAddress}`);
}

main().catch((err) => {
  let message = err instanceof Error ? err.message : String(err);
  for (const secret of [process.env.SEPOLIA_RPC_URL, process.env.DEPLOYER_PRIVATE_KEY]) {
    if (secret) message = message.replaceAll(secret, "[redacted]");
  }
  console.error(`Deployment failed: ${message}`);
  process.exitCode = 1;
});
