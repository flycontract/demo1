import { BrowserProvider, Contract, JsonRpcProvider, JsonRpcSigner } from "ethers";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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

/**
 * The contracts enforce their time rules with `block.timestamp` (the 24h sale
 * cutoff and the 7-day refund timeout), so the UI has to read that clock too.
 * `Date.now()` disagrees whenever the chain does not follow wall time -- e.g. a
 * local chain started in the past for a real-data replay (scripts/local-e2e.ts),
 * where the browser clock would wrongly report "Sales closed" -- and a skewed
 * browser clock could otherwise enable a transaction the contract will revert.
 * Returns null until the first block is read; callers fall back to the local clock.
 */
export function useChainNow(): number | null {
  const [chainNow, setChainNow] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const block = await readOnlyProvider.getBlock("latest");
        if (alive && block) setChainNow(block.timestamp);
      } catch {
        // leave it null; the caller falls back to the browser clock
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return chainNow;
}

export const EXPECTED_CHAIN_NAME = CHAIN_NAME;
export const TOKEN_ADDRESS_CONST = TOKEN_ADDRESS;
export const INSURANCE_ADDRESS_CONST = INSURANCE_ADDRESS;
