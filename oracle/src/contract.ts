import { Contract, JsonRpcProvider, Wallet, NonceManager } from "ethers";
import { FLIGHT_DELAY_INSURANCE_ABI } from "./abi.js";

export function getProvider(rpcUrl: string) {
  return new JsonRpcProvider(rpcUrl);
}

export function getOracleWallet(provider: JsonRpcProvider, privateKey: string) {
  return new NonceManager(new Wallet(privateKey, provider));
}

export function getContract(providerOrSigner: JsonRpcProvider | NonceManager, address: string) {
  return new Contract(address, FLIGHT_DELAY_INSURANCE_ABI, providerOrSigner);
}

export interface FlightInfo {
  flightNo: string;
  origin: string;
  departureDate: string;
  scheduledDeparture: number;
  scheduledArrival: number;
  earliestVerification: number;
  sellable: boolean;
  exists: boolean;
}

export async function readFlight(contract: Contract, flightId: number): Promise<FlightInfo> {
  const flight = await contract.flights(flightId);
  return {
    flightNo: flight.flightNo,
    origin: flight.origin,
    departureDate: flight.departureDate,
    scheduledDeparture: Number(flight.scheduledDeparture),
    scheduledArrival: Number(flight.scheduledArrival),
    earliestVerification: Number(flight.earliestVerification),
    sellable: flight.sellable,
    exists: flight.exists,
  };
}

export async function isRequestFulfilled(contract: Contract, requestId: number): Promise<boolean> {
  const [, , exists, fulfilled] = await contract.verificationRequests(requestId);
  return exists && fulfilled;
}

export async function submitFulfillment(
  contract: Contract,
  args: {
    requestId: number;
    cancelled: boolean;
    actualArrival: number;
    dataDate: string;
    evidenceHash: string;
  },
  onSubmitted: (txHash: string) => void
): Promise<string> {
  const tx = await contract.fulfillVerification(
    args.requestId,
    args.cancelled,
    args.actualArrival,
    args.dataDate,
    args.evidenceHash
  );
  onSubmitted(tx.hash as string);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Oracle fulfillment transaction failed");
  return receipt.hash as string;
}
