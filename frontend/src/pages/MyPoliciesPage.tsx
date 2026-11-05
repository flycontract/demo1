import { useCallback, useEffect, useState } from "react";
import { POLICY_STATUS_LABELS } from "../lib/abi";
import { errMsg, fmtToken, fmtUnixUtc } from "../lib/format";
import { useWallet } from "../lib/wallet";

interface PolicyRow {
  id: number;
  flightId: number;
  status: number; // 0 Active, 1 Verifying, 2 PaidOut, 3 ClosedNoPay, 4 Refunded
  flightNo: string;
  origin: string;
  scheduledArrival: number;
  resultFinal: boolean;
  resultCancelled: boolean;
  resultDelayMinutes: number;
  resultDataDate: string;
}

type Msg = { text: string; kind: "error" | "success" } | null;

const PILL_CLASS = ["pill-active", "pill-verifying", "pill-paid", "pill-nopay", "pill-refunded"];

export default function MyPoliciesPage() {
  const { insuranceRead, insurance, address } = useWallet();
  const [rows, setRows] = useState<PolicyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => {
    if (!address) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
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
          resultFinal: r.isFinal,
          resultCancelled: r.cancelled,
          resultDelayMinutes: Number(r.delayMinutes),
          resultDataDate: r.dataDate,
        });
      }
      out.sort((a, b) => b.id - a.id);
      setRows(out);
    } finally {
      setLoading(false);
    }
  }, [insuranceRead, address]);

  useEffect(() => {
    load();
  }, [load, refresh]);

  async function run(id: number, fn: () => Promise<unknown>, successText: string) {
    setBusyId(id);
    setMsg(null);
    try {
      await fn();
      setMsg({ text: successText, kind: "success" });
      setRefresh((r) => r + 1);
    } catch (err) {
      setMsg({ text: errMsg(err), kind: "error" });
    } finally {
      setBusyId(null);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const REPORT_TIMEOUT = 7 * 24 * 3600;

  function actionFor(row: PolicyRow) {
    if (!insurance) return null;
    if (row.status === 0) {
      // Active: request verification (settles immediately if a final result
      // is already cached for this flight; otherwise raises an oracle event).
      const refundable = !row.resultFinal && now > row.scheduledArrival + REPORT_TIMEOUT;
      return (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            disabled={busyId === row.id}
            onClick={() =>
              run(
                row.id,
                async () => {
                  const tx = await insurance.requestVerification(row.id);
                  await tx.wait();
                },
                "Verification requested."
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
                    const tx = await insurance.refundUnresolved(row.id);
                    await tx.wait();
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
                  const tx = await insurance.settlePolicy(row.id);
                  await tx.wait();
                },
                "Settled."
              )
            }
          >
            {busyId === row.id ? "Working…" : "Settle now"}
          </button>
        );
      }
      const refundable = now > row.scheduledArrival + REPORT_TIMEOUT;
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
                    const tx = await insurance.refundUnresolved(row.id);
                    await tx.wait();
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

      {!address && <div className="card">Connect your wallet to see your policies.</div>}
      {msg && <p className={`status-msg ${msg.kind}`}>{msg.text}</p>}

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
                  <td>{fmtUnixUtc(row.scheduledArrival)}</td>
                  <td>
                    <span className={`pill ${PILL_CLASS[row.status]}`}>{POLICY_STATUS_LABELS[row.status]}</span>
                  </td>
                  <td>
                    {row.resultFinal
                      ? row.resultCancelled
                        ? `Cancelled (data date ${row.resultDataDate})`
                        : `Delay ${row.resultDelayMinutes} min (data date ${row.resultDataDate})`
                      : "—"}
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
