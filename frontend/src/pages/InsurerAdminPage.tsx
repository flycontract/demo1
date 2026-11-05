import { useCallback, useEffect, useState } from "react";
import { errMsg, fmtAddress, fmtToken, fmtUnixUtc, localInputToUnix } from "../lib/format";
import { useWallet } from "../lib/wallet";

type Msg = { text: string; kind: "error" | "success" } | null;

interface FlightRow {
  id: number;
  flightNo: string;
  origin: string;
  scheduledArrival: number;
  sellable: boolean;
}

export default function InsurerAdminPage() {
  const { insuranceRead, insurance, token, address } = useWallet();
  const [insurerAddr, setInsurerAddr] = useState<string | null>(null);
  const [oracleAddr, setOracleAddr] = useState<string | null>(null);
  const [poolBalance, setPoolBalance] = useState<bigint>(0n);
  const [reserved, setReserved] = useState<bigint>(0n);
  const [warningLine, setWarningLine] = useState<bigint>(0n);
  const [paused, setPaused] = useState(false);
  const [flights, setFlights] = useState<FlightRow[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const [fundAmount, setFundAmount] = useState("10000");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [newOracle, setNewOracle] = useState("");
  const [flightNo, setFlightNo] = useState("");
  const [origin, setOrigin] = useState("");
  const [scheduled, setScheduled] = useState("");

  const load = useCallback(async () => {
    const [ins, orc, bal, res, warn, isPaused, count] = await Promise.all([
      insuranceRead.insurer(),
      insuranceRead.oracle(),
      insuranceRead.poolBalance(),
      insuranceRead.reservedPayouts(),
      insuranceRead.WARNING_LINE(),
      insuranceRead.paused(),
      insuranceRead.flightCount(),
    ]);
    setInsurerAddr(ins);
    setOracleAddr(orc);
    setPoolBalance(bal);
    setReserved(res);
    setWarningLine(warn);
    setPaused(isPaused);

    const rows: FlightRow[] = [];
    for (let i = 1; i <= Number(count); i++) {
      const f = await insuranceRead.flights(i);
      rows.push({
        id: i,
        flightNo: f.flightNo,
        origin: f.origin,
        scheduledArrival: Number(f.scheduledArrival),
        sellable: f.sellable,
      });
    }
    setFlights(rows.reverse());
  }, [insuranceRead]);

  useEffect(() => {
    load();
  }, [load, refresh]);

  const isInsurer = address && insurerAddr && address.toLowerCase() === insurerAddr.toLowerCase();

  async function withBusy(fn: () => Promise<unknown>, successText: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ text: successText, kind: "success" });
      setRefresh((r) => r + 1);
    } catch (err) {
      setMsg({ text: errMsg(err), kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function doFundPool() {
    if (!insurance || !token) return;
    const amount = BigInt(fundAmount || "0");
    await withBusy(async () => {
      const insuranceAddr = await insurance.getAddress();
      const allowance: bigint = await token.allowance(address!, insuranceAddr);
      if (allowance < amount) {
        const tx = await token.approve(insuranceAddr, amount);
        await tx.wait();
      }
      const tx = await insurance.fundPool(amount);
      await tx.wait();
    }, `Funded pool with ${amount} FDT.`);
  }

  async function doWithdraw() {
    if (!insurance) return;
    const amount = BigInt(withdrawAmount || "0");
    await withBusy(async () => {
      const tx = await insurance.withdrawSurplus(amount);
      await tx.wait();
    }, `Withdrew ${amount} FDT.`);
  }

  async function doRegisterFlight() {
    if (!insurance) return;
    if (!flightNo || !origin || !scheduled) {
      setMsg({ text: "Fill in flight number, origin and scheduled arrival.", kind: "error" });
      return;
    }
    const ts = localInputToUnix(scheduled);
    await withBusy(async () => {
      const tx = await insurance.registerFlight(flightNo, origin.toUpperCase(), ts, true);
      await tx.wait();
      setFlightNo("");
      setOrigin("");
      setScheduled("");
    }, `Registered ${flightNo}.`);
  }

  async function toggleSellable(f: FlightRow) {
    if (!insurance) return;
    await withBusy(async () => {
      const tx = await insurance.setFlightSellable(f.id, !f.sellable);
      await tx.wait();
    }, `${f.flightNo} is now ${!f.sellable ? "sellable" : "not sellable"}.`);
  }

  async function togglePause() {
    if (!insurance) return;
    await withBusy(async () => {
      const tx = paused ? await insurance.unpause() : await insurance.pause();
      await tx.wait();
    }, paused ? "Sales resumed." : "Sales paused.");
  }

  async function doSetOracle() {
    if (!insurance || !newOracle) return;
    await withBusy(async () => {
      const tx = await insurance.setOracle(newOracle);
      await tx.wait();
      setNewOracle("");
    }, "Oracle address updated.");
  }

  return (
    <div>
      <h1>Insurer Admin</h1>
      <p className="subtitle">
        Insurer: {insurerAddr ? fmtAddress(insurerAddr) : "…"} · Oracle: {oracleAddr ? fmtAddress(oracleAddr) : "…"}
      </p>

      {!address && <div className="card">Connect your wallet to manage the pool and flights.</div>}
      {address && !isInsurer && (
        <div className="card">This wallet is not the insurer account, so write actions below will revert.</div>
      )}
      {msg && <p className={`status-msg ${msg.kind}`}>{msg.text}</p>}

      <div className="card">
        <h2>Pool</h2>
        <p>
          Balance {fmtToken(poolBalance)} · Reserved for open policies {fmtToken(reserved)} · Warning line{" "}
          {fmtToken(warningLine)} · Sales {paused ? "paused" : "open"}
        </p>
        <div className="form-row">
          <label>Fund pool (FDT)</label>
          <input value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} />
          <button disabled={busy || !isInsurer} onClick={doFundPool}>
            Fund
          </button>
        </div>
        <div className="form-row">
          <label>Withdraw surplus (FDT)</label>
          <input value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} placeholder="amount" />
          <button disabled={busy || !isInsurer} onClick={doWithdraw}>
            Withdraw
          </button>
        </div>
        <div className="form-row">
          <button className="secondary" disabled={busy || !isInsurer} onClick={togglePause}>
            {paused ? "Resume sales" : "Pause sales"}
          </button>
        </div>
        <div className="form-row">
          <label>Set oracle address</label>
          <input value={newOracle} onChange={(e) => setNewOracle(e.target.value)} placeholder="0x…" style={{ width: 340 }} />
          <button disabled={busy || !isInsurer} onClick={doSetOracle}>
            Update
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Register a flight</h2>
        <p className="subtitle" style={{ marginBottom: 12 }}>
          Only register flights whose schedule you've manually verified against the airline/airport (PRD §4). Terms
          are fixed after registration — pull a flight from sale with the toggle below instead of editing it.
        </p>
        <div className="form-row">
          <label>Flight number</label>
          <input value={flightNo} onChange={(e) => setFlightNo(e.target.value)} placeholder="CX 750" />
        </div>
        <div className="form-row">
          <label>Origin (IATA)</label>
          <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="BKK" style={{ width: 80 }} />
        </div>
        <div className="form-row">
          <label>Scheduled arrival (UTC)</label>
          <input type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} />
        </div>
        <button disabled={busy || !isInsurer} onClick={doRegisterFlight}>
          Register
        </button>
      </div>

      <div className="card">
        <h2>Registered flights</h2>
        {flights.length === 0 ? (
          <p className="empty">None yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Flight</th>
                <th>Origin</th>
                <th>Scheduled arrival</th>
                <th>Sellable</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {flights.map((f) => (
                <tr key={f.id}>
                  <td>{f.flightNo}</td>
                  <td>{f.origin}</td>
                  <td>{fmtUnixUtc(f.scheduledArrival)}</td>
                  <td>{f.sellable ? "Yes" : "No"}</td>
                  <td>
                    <button className="secondary" disabled={busy || !isInsurer} onClick={() => toggleSellable(f)}>
                      {f.sellable ? "Pull from sale" : "Make sellable"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
