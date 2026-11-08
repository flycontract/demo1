import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const expectedChainId = mode === "sepolia" ? "11155111" : "31337";
  const deploymentBlock = Number(env.VITE_DEPLOY_BLOCK);
  const validAddress = /^0x[0-9a-fA-F]{40}$/;

  if (!["hardhat", "sepolia"].includes(mode)) {
    throw new Error(`Unsupported frontend mode "${mode}". Use "hardhat" or "sepolia".`);
  }
  if (env.VITE_CHAIN_ID !== expectedChainId) {
    throw new Error(
      `Frontend mode "${mode}" requires VITE_CHAIN_ID=${expectedChainId}; check its mode-specific env file.`
    );
  }
  if (!env.VITE_RPC_URL || !validAddress.test(env.VITE_TOKEN_ADDRESS ?? "") ||
      !validAddress.test(env.VITE_INSURANCE_ADDRESS ?? "")) {
    throw new Error(`Frontend mode "${mode}" requires an RPC URL and valid token/insurance addresses.`);
  }
  if (!Number.isSafeInteger(deploymentBlock) || deploymentBlock < 0) {
    throw new Error(`Frontend mode "${mode}" requires a valid VITE_DEPLOY_BLOCK.`);
  }

  return {
    plugins: [react()],
  };
});
