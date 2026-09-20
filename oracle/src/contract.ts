import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { FLIGHT_DELAY_INSURANCE_ABI } from "./abi.js";
import { config } from "./config.js";

export function getProvider() {
  return new JsonRpcProvider(config.rpcUrl);
}

export function getOracleWallet(provider: JsonRpcProvider) {
  return new Wallet(config.oraclePrivateKey, provider);
}

export function getContract(providerOrSigner: JsonRpcProvider | Wallet) {
  return new Contract(config.contractAddress, FLIGHT_DELAY_INSURANCE_ABI, providerOrSigner);
}

export interface FlightInfo {
  flightNo: string;
  origin: string;
  scheduledArrival: number;
  sellable: boolean;
  exists: boolean;
}

export async function readFlight(contract: Contract, flightId: number): Promise<FlightInfo> {
  const [flightNo, origin, scheduledArrival, sellable, exists] = await contract.flights(flightId);
  return { flightNo, origin, scheduledArrival: Number(scheduledArrival), sellable, exists };
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
    delayMinutes: number;
    dataDate: string;
    evidenceHash: string;
  }
): Promise<string> {
  const tx = await contract.fulfillVerification(
    args.requestId,
    args.cancelled,
    args.actualArrival,
    args.delayMinutes,
    args.dataDate,
    args.evidenceHash
  );
  const receipt = await tx.wait();
  return receipt.hash as string;
}
