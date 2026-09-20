import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";
import type { HardhatUserConfig } from "hardhat/config";

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? "";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

// Local replay setup (see README / notes). HKIA's historical API only publishes
// data for dates that have already passed, while buyPolicy() requires the chain
// clock to be at least 24h before the scheduled arrival. To replay a real HKIA
// date on a local chain, start the node in the past: set LOCAL_INITIAL_DATE
// (e.g. 2026-09-16T00:00:00Z). Leave it unset to use the real current time.
const LOCAL_INITIAL_DATE = process.env.LOCAL_INITIAL_DATE;
const LOCAL_RPC_URL = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
    },
  },
  networks: {
    // Used by `npm run local:node` (hardhat node) and by in-process scripts.
    hardhat: LOCAL_INITIAL_DATE !== undefined && LOCAL_INITIAL_DATE !== ""
      ? { initialDate: LOCAL_INITIAL_DATE }
      : {},
    // The running `hardhat node` on 127.0.0.1:8545, used by `--network localhost`.
    localhost: {
      url: LOCAL_RPC_URL,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};

export default config;
