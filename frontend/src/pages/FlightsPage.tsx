import { useCallback, useEffect, useState } from "react";
import { errMsg, fmtToken, fmtUnixUtc } from "../lib/format";
import { useWallet, useChainNow } from "../lib/wallet";

interface FlightRow {
  id: number;
  flightNo: string;
  origin: string;
  scheduledArrival: number;
  sellable: boolean;
}

type Msg = { text: string; kind: "error" | "success" } | null;

export default function FlightsPage() {
  const { insuranceRead, insurance, token, address } = useWallet();
  const chainNow = useChainNow();
  const [flights, setFlights] = useState<FlightRow[]>([]);
  const [owned, setOwned] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const count = Number(await insuranceRead.flightCount());
      const rows: FlightRow[] = [];
      for (let i = 1; i <= count; i++) {
        const f = await insuranceRead.flights(i);
        rows.push({
          id: i,
          flightNo: f.flightNo,
          origin: f.origin,
          scheduledArrival: Number(f.scheduledArrival),
          sellable: f.sellable,
        });
      }
      rows.reverse();
      setFlights(rows);

      if (address) {
        const ownedMap: Record<number, boolean> = {};
        for (const r of rows) ownedMap[r.id] = await insuranceRead.hasPolicyForFlight(r.id, address);
        setOwned(ownedMap);
      } else {
        setOwned({});
      }
    } finally {
      setLoading(false);
    }
  }, [insuranceRead, address]);

  useEffect(() => {
    load();
  }, [load, refresh]);

  async function buy(flightId: number) {
    if (!insurance || !token || !address) {
      setMsg({ text: "Connect your wallet first.", kind: "error" });
      return;
    }
    setBusyId(flightId);
    setMsg(null);
    try {
      const insuranceAddr = await insurance.getAddress();
      const premium: bigint = await insuranceRead.PREMIUM();
      const allowance: bigint = await token.allowance(address, insuranceAddr);
      if (allowance < premium) {
        const approveTx = await token.approve(insuranceAddr, premium);
        await approveTx.wait();
      }
      const tx = await insurance.buyPolicy(flightId);
      await tx.wait();
      setMsg({ text: `Bought a policy on flight ${flightId}.`, kind: "success" });
      setRefresh((r) => r + 1);
    } catch (err) {
      setMsg({ text: errMsg(err), kind: "error" });
    } finally {
      setBusyId(null);
    }
  }

  async function claimFaucet() {
    if (!token) {
      setMsg({ text: "Connect your wallet first.", kind: "error" });
      return;
    }
    setMsg(null);
    try {
      const tx = await token.faucet();
      await tx.wait();
      setMsg({ text: "Claimed 200 FDT from the faucet.", kind: "success" });
    } catch (err) {
      setMsg({ text: errMsg(err), kind: "error" });
    }
  }

  // Must match the contract's own check (`block.timestamp + 24h <= scheduledArrival`).
  const now = chainNow ?? Math.floor(Date.now() / 1000);

  return (
    <div>
      <h1>Registered Flights</h1>
      <p className="subtitle">
        Insurer-verified Hong Kong arrivals. Sales close 24h before the scheduled arrival. Premium {fmtToken(10)},
        payout {fmtToken(100)} for a delay ≥120 min or a cancellation.
      </p>

      {address && (
        <div className="card">
          <button className="secondary" onClick={claimFaucet}>
            Claim 200 FDT from faucet
          </button>
        </div>
      )}

      {msg && <p className={`status-msg ${msg.kind}`}>{msg.text}</p>}

      {loading ? (
        <p className="empty">Loading flights…</p>
      ) : flights.length === 0 ? (
        <p className="empty">No flights registered yet. The insurer can add some from the Admin page.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Flight</th>
              <th>Origin</th>
              <th>Scheduled arrival</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {flights.map((f) => {
              const cutoffPassed = now + 24 * 3600 > f.scheduledArrival;
              const alreadyOwned = owned[f.id];
              const canBuy = f.sellable && !cutoffPassed && !alreadyOwned;
              return (
                <tr key={f.id}>
                  <td>{f.flightNo}</td>
                  <td>{f.origin}</td>
                  <td>{fmtUnixUtc(f.scheduledArrival)}</td>
                  <td>
                    {!f.sellable
                      ? "Not sellable"
                      : cutoffPassed
                        ? "Sales closed"
                        : alreadyOwned
                          ? "You're insured"
                          : "On sale"}
                  </td>
                  <td>
                    <button disabled={!canBuy || busyId === f.id} onClick={() => buy(f.id)}>
                      {busyId === f.id ? "Buying…" : `Buy (${fmtToken(10)})`}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
