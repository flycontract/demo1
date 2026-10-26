import { useCallback, useEffect, useState } from "react";
import { POLICY_STATUS_LABELS } from "../lib/abi";
import { errMsg, fmtToken, fmtUnixHkt, txLink } from "../lib/format";
import { useChainNow, useWallet } from "../lib/wallet";

interface PolicyRow {
  id: number;
  flightId: number;
  status: number; // 0 Active, 1 Verifying, 2 PaidOut, 3 ClosedNoPay, 4 Refunded
  flightNo: string;
  origin: string;
  scheduledArrival: number;
  scheduledDeparture: number;
  earliestVerification: number;
  resultFinal: boolean;
  resultCancelled: boolean;
  resultDelayMinutes: number;
  resultDataDate: string;
  evidenceHash: string;
}

type Msg = { text: string; kind: "error" | "success"; hash?: string } | null;

const PILL_CLASS = ["pill-active", "pill-verifying", "pill-paid", "pill-nopay", "pill-refunded"];

export default function MyPoliciesPage() {
  const { insuranceRead, insurance, address, canWrite, configured, requireWritable } = useWallet();
  const chainNow = useChainNow();
  const [rows, setRows] = useState<PolicyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [refresh, setRefresh] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address || !configured) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setLoadError(null);
      const filter = insuranceRead.filters.PolicyBought(null, address, null);
      const events = await insuranceRead.queryFilter(filter);
      const ids = [...new Set(events.map((e) => Number((e as unknown as { args: { policyId: bigint } }).args.policyId)))];

      const out: PolicyRow[] = [];
      for (const id of ids) {
        const p = await insuranceRead.policies(id);
        const flightId = Number(p.flightId);
        const f = await insuranceRead.flights(flightId);
        const r = await insuranceRead.flightResults(flightId);
        out.push({
          id,
          flightId,
          status: Number(p.status),
          flightNo: f.flightNo,
          origin: f.origin,
          scheduledArrival: Number(f.scheduledArrival),
          scheduledDeparture: Number(f.scheduledDeparture),
          earliestVerification: Number(f.earliestVerification),
          resultFinal: r.isFinal,
          resultCancelled: r.cancelled,
          resultDelayMinutes: Number(r.delayMinutes),
          resultDataDate: r.dataDate,
          evidenceHash: r.evidenceHash,
        });
      }
      out.sort((a, b) => b.id - a.id);
      setRows(out);
    } catch (err) {
      setLoadError(errMsg(err)); setRows([]);
    } finally {
      setLoading(false);
    }
  }, [insuranceRead, address, configured]);

  useEffect(() => {
    load();
  }, [load, refresh]);

  async function run(id: number, fn: () => Promise<{ hash: string; wait: () => Promise<unknown> }>, successText: string) {
    setBusyId(id);
    setMsg(null);
    try {
      await requireWritable();
      const tx = await fn();
      setMsg({ text: "Transaction pending on chain; a verification request is not a payout.", kind: "success", hash: tx.hash });
      await tx.wait();
      setMsg({ text: successText, kind: "success", hash: tx.hash });
      setRefresh((r) => r + 1);
    } catch (err) {
      setMsg({ text: errMsg(err), kind: "error" });
    } finally {
      setBusyId(null);
    }
  }

  const now = chainNow;
  const REPORT_TIMEOUT = 7 * 24 * 3600;

  function actionFor(row: PolicyRow) {
    if (!insurance || !canWrite || now === null) return null;
    if (row.status === 0) {
      // Active: request verification (settles immediately if a final result
      // is already cached for this flight; otherwise raises an oracle event).
      const refundable = !row.resultFinal && now >= row.scheduledArrival + REPORT_TIMEOUT;
      return (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            disabled={busyId === row.id || now < row.earliestVerification || refundable}
            onClick={() =>
              run(
                row.id,
                async () => insurance.requestVerification(row.id),
                "Verification requested; waiting for oracle result."
              )
            }
          >
            {busyId === row.id ? "Working…" : "Request verification"}
          </button>
          {refundable && (
            <button
              className="secondary"
              disabled={busyId === row.id}
              onClick={() =>
                run(
                  row.id,
                  async () => {
                  return insurance.refundUnresolved(row.id);
                  },
                  "Refunded."
                )
              }
            >
              Refund (no data after 7 days)
            </button>
          )}
        </div>
      );
    }
    if (row.status === 1) {
      // Verifying: our own request may still be in flight, or another
      // holder's request on the same flight may have already resolved it.
      if (row.resultFinal) {
        return (
          <button
            disabled={busyId === row.id}
            onClick={() =>
              run(
                row.id,
                async () => {
                  return insurance.settlePolicy(row.id);
                },
                "Settled."
              )
            }
          >
            {busyId === row.id ? "Working…" : "Settle now"}
          </button>
        );
      }
      const refundable = now >= row.scheduledArrival + REPORT_TIMEOUT;
      return (
        <div style={{ display: "flex", gap: 8 }}>
          <span className="status-msg">Waiting for the oracle…</span>
          {refundable && (
            <button
              className="secondary"
              disabled={busyId === row.id}
              onClick={() =>
                run(
                  row.id,
                  async () => {
                    return insurance.refundUnresolved(row.id);
                  },
                  "Refunded."
                )
              }
            >
              Refund (no data after 7 days)
            </button>
          )}
        </div>
      );
    }
    return null;
  }

  return (
    <div>
      <h1>My Policies</h1>
      <p className="subtitle">Policies bought by the connected wallet.</p>
      {!configured && <p className="status-msg error">Contracts are not deployed.</p>}
      {configured && chainNow === null && <p className="status-msg error">Chain time unavailable; actions disabled.</p>}
      {loadError && <p className="status-msg error">Policy read failed: {loadError}</p>}

      {!address && <div className="card">Connect your wallet to see your policies.</div>}
      {msg && <p className={`status-msg ${msg.kind}`}>{msg.text} {msg.hash && txLink(msg.hash) && <a href={txLink(msg.hash)!} target="_blank" rel="noreferrer">Transaction</a>}</p>}

      {address &&
        (loading ? (
          <p className="empty">Loading your policies…</p>
        ) : rows.length === 0 ? (
          <p className="empty">You haven't bought any policies yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Flight</th>
                <th>Scheduled arrival</th>
                <th>Status</th>
                <th>Result</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.flightNo} <span style={{ color: "#6b7099" }}>from {row.origin}</span>
                  </td>
                  <td>Departure {fmtUnixHkt(row.scheduledDeparture)}<br />Arrival {fmtUnixHkt(row.scheduledArrival)}<br />Verify from {fmtUnixHkt(row.earliestVerification)}<br />Final result deadline {fmtUnixHkt(row.scheduledArrival + REPORT_TIMEOUT)}</td>
                  <td>
                    <span className={`pill ${PILL_CLASS[row.status]}`}>{POLICY_STATUS_LABELS[row.status]}</span>
                  </td>
                  <td>
                    {row.resultFinal
                      ? row.resultCancelled
                        ? `Cancelled (data date ${row.resultDataDate})`
                        : `Delay ${row.resultDelayMinutes} min (data date ${row.resultDataDate})`
                      : row.status === 1 ? "Pending oracle; unknown is not on time" : "No final result"}
                    {row.resultFinal && <><br />Evidence <code title={row.evidenceHash}>{row.evidenceHash.slice(0, 12)}…</code></>}
                  </td>
                  <td>{actionFor(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      <p className="subtitle">
        Premium {fmtToken(10)}, payout {fmtToken(100)}. Payouts trigger automatically once the oracle reports a final
        result — no separate claim step.
      </p>
    </div>
  );
}
