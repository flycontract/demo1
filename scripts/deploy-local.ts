import hre from "hardhat";

async function main() {
  const { ethers } = hre;
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 31337n) {
    throw new Error(`Local deployment requires chain ID 31337; connected to ${network.chainId}`);
  }

  const [insurer, oracle] = await ethers.getSigners();
  const initialFund = 10_000n;
  const insurerAddress = await insurer.getAddress();
  const oracleAddress = await oracle.getAddress();

  const Token = await ethers.getContractFactory("DemoToken", insurer);
  const token = await Token.deploy(initialFund);
  await token.waitForDeployment();

  const Insurance = await ethers.getContractFactory("FlightDelayInsurance", insurer);
  const insurance = await Insurance.deploy(await token.getAddress(), oracleAddress);
  await insurance.waitForDeployment();
  const insuranceDeployment = await insurance.deploymentTransaction()?.wait();
  if (!insuranceDeployment) {
    throw new Error("Could not read the insurance deployment receipt");
  }

  const approveTx = await token.approve(await insurance.getAddress(), initialFund);
  await approveTx.wait();
  const fundTx = await insurance.fundPool(initialFund);
  await fundTx.wait();

  const deploymentBlock = insuranceDeployment.blockNumber;
  console.log("Local contracts deployed and pool funded.");
  console.log(`Insurer: ${insurerAddress}`);
  console.log(`Oracle: ${oracleAddress} (Hardhat's second signer, printed as Account #1; zero-based)`);
  console.log(`Token: ${await token.getAddress()}`);
  console.log(`Insurance: ${await insurance.getAddress()}`);
  console.log(`Insurance deployment block: ${deploymentBlock}`);
  console.log(`Oracle RPC_URL=${process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545"}`);
  console.log(`Oracle CHAIN_ID=${network.chainId}`);
  console.log(`Oracle CONTRACT_ADDRESS=${await insurance.getAddress()}`);
  console.log(`Oracle DEPLOY_BLOCK=${deploymentBlock}`);
}

main().catch((error) => {
  console.error("Local deployment failed:", error);
  process.exitCode = 1;
});
