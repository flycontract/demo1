import "dotenv/config";
import hre from "hardhat";

/**
 * Deploys DemoToken + FlightDelayInsurance, seeds the pool with the PRD's
 * 10,000-token initial underwriting fund, and prints the addresses to paste
 * into oracle/.env and frontend/.env.
 *
 * Env: ORACLE_ADDRESS (the address oracle/.env's ORACLE_PRIVATE_KEY controls).
 * If unset, the deployer is used as a placeholder oracle -- fine for a first
 * smoke-test deploy, but you should setOracle() to the real oracle service's
 * address before relying on fulfillVerification from it.
 */
async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  const oracleAddress = process.env.ORACLE_ADDRESS ?? deployer.address;
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
  const insuranceAddress = await insurance.getAddress();
  console.log(`FlightDelayInsurance deployed at ${insuranceAddress}`);

  const approveTx = await token.approve(insuranceAddress, initialFund);
  await approveTx.wait();
  const fundTx = await insurance.fundPool(initialFund);
  await fundTx.wait();
  console.log(`Funded pool with ${initialFund} FDT`);

  // insurance is already mined at this point (waitForDeployment resolved above).
  const deployBlock = await ethers.provider.getBlockNumber();

  console.log("\n--- paste into oracle/.env ---");
  console.log(`RPC_URL=${process.env.SEPOLIA_RPC_URL ?? "<sepolia rpc url>"}`);
  console.log(`CONTRACT_ADDRESS=${insuranceAddress}`);
  console.log(`DEPLOY_BLOCK=${deployBlock}`);

  console.log("\n--- paste into frontend/.env ---");
  console.log(`VITE_RPC_URL=${process.env.SEPOLIA_RPC_URL ?? "<sepolia rpc url>"}`);
  console.log(`VITE_TOKEN_ADDRESS=${await token.getAddress()}`);
  console.log(`VITE_INSURANCE_ADDRESS=${insuranceAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
