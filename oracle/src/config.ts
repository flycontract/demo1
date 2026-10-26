import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  rpcUrl: required("RPC_URL"),
  contractAddress: required("CONTRACT_ADDRESS"),
  chainId: Number(process.env.CHAIN_ID ?? "11155111"),
  deployBlock: Number(process.env.DEPLOY_BLOCK ?? "0"),
  oraclePrivateKey: required("ORACLE_PRIVATE_KEY"),
  dbPath: process.env.DB_PATH ?? "./oracle.sqlite",
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? "60000"),
  httpTimeoutMs: Number(process.env.HTTP_TIMEOUT_MS ?? "20000"),
  maxDailyRefresh: Number(process.env.MAX_DAILY_REFRESH ?? "3"),
  minRefreshIntervalMs: Number(process.env.MIN_REFRESH_INTERVAL_MS ?? "14400000"),
  confirmations: Number(process.env.CONFIRMATIONS ?? "2"),
  eventChunkSize: Number(process.env.EVENT_CHUNK_SIZE ?? "500"),
  reorgOverlap: Number(process.env.REORG_OVERLAP ?? "12"),
};
