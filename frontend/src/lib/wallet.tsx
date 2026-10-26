import { BrowserProvider, Contract, JsonRpcProvider, JsonRpcSigner, isAddress } from "ethers";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEMO_TOKEN_ABI, FLIGHT_DELAY_INSURANCE_ABI } from "./abi";

declare global {
  interface Window {
    ethereum?: import("ethers").Eip1193Provider & { on?: (event: string, cb: (...args: unknown[]) => void) => void; removeListener?: (event: string, cb: (...args: unknown[]) => void) => void };
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
  /** Ask the injected wallet to add (if needed) and switch to the expected chain. */
  switchNetwork: () => Promise<void>;
  signer: JsonRpcSigner | null;
  token: Contract | null; // connected to signer when available
  insurance: Contract | null;
  /** Read-only contracts that work before a wallet is connected. */
  tokenRead: Contract;
  insuranceRead: Contract;
  canWrite: boolean;
  configured: boolean;
  requireWritable: () => Promise<void>;
}

const readOnlyProvider = new JsonRpcProvider(import.meta.env.VITE_RPC_URL as string);
const deployed = isAddress(TOKEN_ADDRESS) && isAddress(INSURANCE_ADDRESS) &&
  TOKEN_ADDRESS !== "0x0000000000000000000000000000000000000000" &&
  INSURANCE_ADDRESS !== "0x0000000000000000000000000000000000000000";
const tokenReadOnly = new Contract(deployed ? TOKEN_ADDRESS : "0x0000000000000000000000000000000000000001", DEMO_TOKEN_ABI, readOnlyProvider);
const insuranceReadOnly = new Contract(deployed ? INSURANCE_ADDRESS : "0x0000000000000000000000000000000000000001", FLIGHT_DELAY_INSURANCE_ABI, readOnlyProvider);

/**
 * EIP-3085 / EIP-3326 params for the expected chain. `blockExplorerUrls` is
 * deliberately omitted: a local Hardhat chain has no explorer, and MetaMask's
 * manual "add a network" form otherwise refuses to save without one.
 */
const EXPECTED_CHAIN_PARAMS = {
  chainId: `0x${EXPECTED_CHAIN_ID.toString(16)}`,
  chainName: CHAIN_NAME,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: [import.meta.env.VITE_RPC_URL as string],
};

async function requestExpectedChain(): Promise<void> {
  const eth = window.ethereum;
  if (!eth) throw new Error("MetaMask (or another injected wallet) was not found in this browser.");
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: EXPECTED_CHAIN_PARAMS.chainId }],
    });
  } catch (err) {
    // 4902: the wallet does not know this chain yet, so add it first.
    if ((err as { code?: number }).code === 4902) {
      await eth.request({ method: "wallet_addEthereumChain", params: [EXPECTED_CHAIN_PARAMS] });
      return;
    }
    throw err;
  }
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<bigint | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectingRef = useRef(false);

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;
    const changed = () => {
      // MetaMask can emit accountsChanged while the initial connection request
      // resolves. The connection below reads the final account and chain.
      if (connectingRef.current) return;
      setSigner(null); setAddress(null); setChainId(null);
      setError("Wallet changed. Reconnect before sending a transaction.");
    };
    eth.on?.("accountsChanged", changed);
    eth.on?.("chainChanged", changed);
    return () => { eth.removeListener?.("accountsChanged", changed); eth.removeListener?.("chainChanged", changed); };
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    if (!window.ethereum) {
      setError("MetaMask (or another injected wallet) was not found in this browser.");
      return;
    }
    connectingRef.current = true;
    setConnecting(true);
    try {
      const provider = new BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const s = await provider.getSigner();
      const network = await provider.getNetwork();
      setSigner(s);
      setAddress(await s.getAddress());
      setChainId(network.chainId);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  }, []);

  const switchNetwork = useCallback(async () => {
    setError(null);
    try {
      await requestExpectedChain();
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const canWrite = deployed && !!signer && !!address && chainId === EXPECTED_CHAIN_ID;
  const requireWritable = useCallback(async () => {
    if (!deployed) throw new Error("Contracts are not deployed or configured yet.");
    if (!window.ethereum || !address || !signer) throw new Error("Connect your wallet before sending a transaction.");
    const [chainHex, accounts] = await Promise.all([
      window.ethereum.request({ method: "eth_chainId" }),
      window.ethereum.request({ method: "eth_accounts" }),
    ]);
    if (BigInt(String(chainHex)) !== EXPECTED_CHAIN_ID) throw new Error(`Switch wallet to ${CHAIN_NAME}.`);
    if (!Array.isArray(accounts) || !accounts.some((a) => String(a).toLowerCase() === address.toLowerCase()))
      throw new Error("Wallet account changed. Reconnect first.");
    if ((await readOnlyProvider.getNetwork()).chainId !== EXPECTED_CHAIN_ID) throw new Error("Read RPC is on the wrong chain.");
  }, [address, signer]);
  const token = useMemo(() => (canWrite ? new Contract(TOKEN_ADDRESS, DEMO_TOKEN_ABI, signer) : null), [canWrite, signer]);
  const insurance = useMemo(
    () => (canWrite ? new Contract(INSURANCE_ADDRESS, FLIGHT_DELAY_INSURANCE_ABI, signer) : null),
    [canWrite, signer]
  );

  const value: WalletState = {
    address,
    chainId,
    connecting,
    error,
    connect,
    switchNetwork,
    signer,
    token,
    insurance,
    tokenRead: tokenReadOnly,
    insuranceRead: insuranceReadOnly,
    canWrite,
    configured: deployed,
    requireWritable,
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
 * Returns null on stale or failed reads; callers must disable time-sensitive actions.
 */
export function useChainNow(): number | null {
  const [chainNow, setChainNow] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const update = async () => {
      try {
        if (!deployed) { if (alive) setChainNow(null); return; }
        if ((await readOnlyProvider.getNetwork()).chainId !== EXPECTED_CHAIN_ID) {
          if (alive) setChainNow(null);
          return;
        }
        const block = await readOnlyProvider.getBlock("latest");
        if (alive) setChainNow(block?.timestamp ?? null);
      } catch {
        if (alive) setChainNow(null);
      }
    };
    void update();
    const timer = window.setInterval(() => void update(), 12_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return chainNow;
}

export const EXPECTED_CHAIN_NAME = CHAIN_NAME;
export const TOKEN_ADDRESS_CONST = TOKEN_ADDRESS;
export const INSURANCE_ADDRESS_CONST = INSURANCE_ADDRESS;
