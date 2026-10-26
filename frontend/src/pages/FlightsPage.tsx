import { useCallback, useEffect, useState } from "react";
import { errMsg, fmtToken, fmtUnixHkt, txLink } from "../lib/format";
import { useWallet, useChainNow } from "../lib/wallet";

interface FlightRow {
  id: number;
  flightNo: string;
  origin: string;
  scheduledArrival: number;
  scheduledDeparture: number;
  earliestVerification: number;
  planEvidenceHash: string;
  planSourceUrl: string;
  sellable: boolean;
}

type Msg = { text: string; kind: "error" | "success"; hash?: string } | null;

export default function FlightsPage() {
  const { insuranceRead, insurance, token, address, canWrite, configured, requireWritable } = useWallet();
  const chainNow = useChainNow();
  const [flights, setFlights] = useState<FlightRow[]>([]);
  const [owned, setOwned] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [refresh, setRefresh] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    if (!configured) { setFlights([]); setLoading(false); return; }
    try {
      setLoadError(null);
      const count = Number(await insuranceRead.flightCount());
      const rows: FlightRow[] = [];
      for (let i = 1; i <= count; i++) {
        const f = await insuranceRead.flights(i);
        rows.push({
          id: i,
          flightNo: f.flightNo,
          origin: f.origin,
          scheduledArrival: Number(f.scheduledArrival),
          scheduledDeparture: Number(f.scheduledDeparture),
          earliestVerification: Number(f.earliestVerification),
          planEvidenceHash: f.planEvidenceHash,
          planSourceUrl: f.planSourceUrl,
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
    } catch (err) {
      setLoadError(errMsg(err)); setFlights([]);
    } finally {
      setLoading(false);
    }
  }, [insuranceRead, address, configured]);

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
      await requireWritable();
      const insuranceAddr = await insurance.getAddress();
      const premium: bigint = await insuranceRead.PREMIUM();
      const allowance: bigint = await token.allowance(address, insuranceAddr);
      if (allowance < premium) {
        setMsg({ text: "Waiting for approval signature…", kind: "success" });
        await requireWritable();
        const approveTx = await token.approve(insuranceAddr, premium);
        setMsg({ text: "Approval pending on chain…", kind: "success", hash: approveTx.hash });
        await approveTx.wait();
      }
      await requireWritable();
      setMsg({ text: "Waiting for purchase signature…", kind: "success" });
      const tx = await insurance.buyPolicy(flightId);
      setMsg({ text: "Purchase pending on chain…", kind: "success", hash: tx.hash });
      await tx.wait();
      setMsg({ text: `Bought a policy on flight ${flightId}.`, kind: "success", hash: tx.hash });
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
      await requireWritable();
      const tx = await token.faucet();
      setMsg({ text: "Faucet transaction pending…", kind: "success", hash: tx.hash });
      await tx.wait();
      setMsg({ text: "Claimed 200 FDT from the faucet.", kind: "success", hash: tx.hash });
    } catch (err) {
      setMsg({ text: errMsg(err), kind: "error" });
    }
  }

  const now = chainNow;
  const salesEnabled = import.meta.env.VITE_SALES_ENABLED === "true";

  return (
    <div>
      <h1>Registered Flights</h1>
      <p className="subtitle">
        Teaching-demo terms v1: HKIA “At gate” versus frozen official planned arrival; explicit cancellation also pays. One source can be late or corrected. Sales close 24h before scheduled departure. Premium {fmtToken(10)}, payout {fmtToken(100)} for ≥7200 seconds or cancellation. FDT has no cash value.
      </p>
      {!configured && <p className="status-msg error">Contracts are not deployed. Addresses are pending.</p>}
      {!salesEnabled && <p className="status-msg error">Sales are currently closed. Each flight needs a verified official plan before sale.</p>}
      {now === null && configured && <p className="status-msg error">Chain time is unavailable; time-sensitive actions are disabled.</p>}
      {loadError && <p className="status-msg error">Flight read failed: {loadError}</p>}

      {address && configured && (
        <div className="card">
          <button className="secondary" disabled={!canWrite} onClick={claimFaucet}>
            Claim 200 FDT from faucet
          </button>
        </div>
      )}

      {msg && <p className={`status-msg ${msg.kind}`}>{msg.text} {msg.hash && txLink(msg.hash) && <a href={txLink(msg.hash)!} target="_blank" rel="noreferrer">Transaction</a>}</p>}

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
              <th>Cutoff / verification</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {flights.map((f) => {
              const cutoffPassed = now === null || now + 24 * 3600 > f.scheduledDeparture;
              const alreadyOwned = owned[f.id];
              const canBuy = salesEnabled && canWrite && f.sellable && !cutoffPassed && !alreadyOwned;
              return (
                <tr key={f.id}>
                  <td>{f.flightNo}</td>
                  <td>{f.origin}</td>
                  <td>Departure {fmtUnixHkt(f.scheduledDeparture)}<br />Arrival {fmtUnixHkt(f.scheduledArrival)}</td>
                  <td>Buy by {fmtUnixHkt(f.scheduledDeparture - 86400)}<br />Verify from {fmtUnixHkt(f.earliestVerification)}<br />Result by {fmtUnixHkt(f.scheduledArrival + 604800)}<br />Plan evidence <code title={f.planEvidenceHash}>{f.planEvidenceHash.slice(0, 12)}…</code>{/^https:\/\//.test(f.planSourceUrl) && <> · <a href={f.planSourceUrl} target="_blank" rel="noreferrer">source</a></>}</td>
                  <td>
                    {!salesEnabled ? "Sales gated" : !f.sellable
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
