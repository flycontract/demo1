import { BrowserProvider, Contract, JsonRpcProvider, JsonRpcSigner } from "ethers";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { DEMO_TOKEN_ABI, FLIGHT_DELAY_INSURANCE_ABI } from "./abi";

declare global {
  interface Window {
    ethereum?: import("ethers").Eip1193Provider & { on?: (event: string, cb: (...args: unknown[]) => void) => void };
  }
}

const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS as string;
const INSURANCE_ADDRESS = import.meta.env.VITE_INSURANCE_ADDRESS as string;
const EXPECTED_CHAIN_ID = BigInt(import.meta.env.VITE_CHAIN_ID ?? "11155111");
const CHAIN_NAME = (import.meta.env.VITE_CHAIN_NAME as string) ?? "Sepolia";

interface WalletState {
  address: string | null;
  chainId: bigint | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  signer: JsonRpcSigner | null;
  token: Contract | null; // connected to signer when available
  insurance: Contract | null;
  /** Read-only contracts that work before a wallet is connected. */
  tokenRead: Contract;
  insuranceRead: Contract;
}

const readOnlyProvider = new JsonRpcProvider(import.meta.env.VITE_RPC_URL as string);
const tokenReadOnly = new Contract(TOKEN_ADDRESS, DEMO_TOKEN_ABI, readOnlyProvider);
const insuranceReadOnly = new Contract(INSURANCE_ADDRESS, FLIGHT_DELAY_INSURANCE_ABI, readOnlyProvider);

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<bigint | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setError(null);
    if (!window.ethereum) {
      setError("MetaMask (or another injected wallet) was not found in this browser.");
      return;
    }
    setConnecting(true);
    try {
      const provider = new BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const s = await provider.getSigner();
      const network = await provider.getNetwork();
      setSigner(s);
      setAddress(await s.getAddress());
      setChainId(network.chainId);
      window.ethereum.on?.("accountsChanged", () => window.location.reload());
      window.ethereum.on?.("chainChanged", () => window.location.reload());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConnecting(false);
    }
  }, []);

  const token = useMemo(() => (signer ? new Contract(TOKEN_ADDRESS, DEMO_TOKEN_ABI, signer) : null), [signer]);
  const insurance = useMemo(
    () => (signer ? new Contract(INSURANCE_ADDRESS, FLIGHT_DELAY_INSURANCE_ABI, signer) : null),
    [signer]
  );

  const value: WalletState = {
    address,
    chainId,
    connecting,
    error,
    connect,
    signer,
    token,
    insurance,
    tokenRead: tokenReadOnly,
    insuranceRead: insuranceReadOnly,
  };
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}

export function isWrongNetwork(chainId: bigint | null): boolean {
  return chainId !== null && chainId !== EXPECTED_CHAIN_ID;
}

export const EXPECTED_CHAIN_NAME = CHAIN_NAME;
export const TOKEN_ADDRESS_CONST = TOKEN_ADDRESS;
export const INSURANCE_ADDRESS_CONST = INSURANCE_ADDRESS;
