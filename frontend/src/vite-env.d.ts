/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL: string;
  readonly VITE_TOKEN_ADDRESS: string;
  readonly VITE_INSURANCE_ADDRESS: string;
  readonly VITE_CHAIN_ID: string;
  readonly VITE_CHAIN_NAME: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
