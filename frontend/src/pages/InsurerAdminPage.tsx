import { useCallback, useEffect, useState } from "react";
import { keccak256, toUtf8Bytes } from "ethers";
import { errMsg, fmtAddress, fmtToken, fmtUnixHkt, localInputToUnix, txLink } from "../lib/format";
import { useWallet } from "../lib/wallet";

type Msg = { text: string; kind: "error" | "success"; hash?: string } | null;

interface FlightRow {
  id: number;
  flightNo: string;
  origin: string;
  scheduledArrival: number;
  sellable: boolean;
}

export default function InsurerAdminPage() {
  const { insuranceRead, insurance, token, address, canWrite, configured, requireWritable } = useWallet();
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
  const [departure, setDeparture] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [aliases, setAliases] = useState("");
  const [planSourceUrl, setPlanSourceUrl] = useState("");
  const [planEvidence, setPlanEvidence] = useState("");
  const [planFetchedAt, setPlanFetchedAt] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const salesEnabled = import.meta.env.VITE_SALES_ENABLED === "true";

  const load = useCallback(async () => {
    if (!configured) return;
    try {
    setLoadError(null);
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
    } catch (err) { setLoadError(errMsg(err)); }
  }, [insuranceRead, configured]);

  useEffect(() => {
    load();
  }, [load, refresh]);

  const isInsurer = canWrite && address && insurerAddr && address.toLowerCase() === insurerAddr.toLowerCase();

  async function withBusy(fn: () => Promise<{ hash: string; wait: () => Promise<unknown> }>, successText: string) {
    setBusy(true);
    setMsg(null);
    try {
      await requireWritable();
      const tx = await fn();
      setMsg({ text: "Transaction pending on chain…", kind: "success", hash: tx.hash });
      await tx.wait();
      setMsg({ text: successText, kind: "success", hash: tx.hash });
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
        await requireWritable();
        const tx = await token.approve(insuranceAddr, amount);
        setMsg({ text: "Approval pending…", kind: "success", hash: tx.hash });
        await tx.wait();
      }
      await requireWritable();
      return insurance.fundPool(amount);
    }, `Funded pool with ${amount} FDT.`);
  }

  async function doWithdraw() {
    if (!insurance) return;
    const amount = BigInt(withdrawAmount || "0");
    await withBusy(async () => {
      return insurance.withdrawSurplus(amount);
    }, `Withdrew ${amount} FDT.`);
  }

  async function doRegisterFlight() {
    if (!insurance) return;
    if (!flightNo || !origin || !departure || !scheduled || !departureDate || !planSourceUrl || !planEvidence || !planFetchedAt) {
      setMsg({ text: "Fill in identity, both plan times, source URL, source evidence and fetch time.", kind: "error" });
      return;
    }
    const arrivalTs = localInputToUnix(scheduled);
    const departureTs = localInputToUnix(departure);
    const fetchedTs = localInputToUnix(planFetchedAt);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate) || !/^https:\/\//.test(planSourceUrl) || !Number.isFinite(arrivalTs) || !Number.isFinite(departureTs) || !Number.isFinite(fetchedTs)) {
      setMsg({ text: "Use a valid origin-local date, HTTPS source and UTC timestamps.", kind: "error" }); return;
    }
    await withBusy(async () => {
      const tx = await insurance.registerFlight({
        flightNo, origin: origin.toUpperCase(), departureDate, scheduledDeparture: departureTs,
        scheduledArrival: arrivalTs, planEvidenceHash: keccak256(toUtf8Bytes(planEvidence)),
        planSourceUrl, planFetchedAt: fetchedTs, aliases: aliases.split(",").map((s) => s.trim()).filter(Boolean), sellable: false,
      });
      setFlightNo("");
      setOrigin("");
      setScheduled("");
      return tx;
    }, `Registered ${flightNo} as not sellable. Preserve the exact evidence text separately.`);
  }

  async function toggleSellable(f: FlightRow) {
    if (!insurance) return;
    if (!f.sellable && !salesEnabled) { setMsg({ text: "Terms are awaiting approval; sales remain disabled.", kind: "error" }); return; }
    await withBusy(async () => {
      return insurance.setFlightSellable(f.id, !f.sellable);
    }, `${f.flightNo} is now ${!f.sellable ? "sellable" : "not sellable"}.`);
  }

  async function togglePause() {
    if (!insurance) return;
    await withBusy(async () => {
      if (paused && !salesEnabled) throw new Error("Sales cannot resume before the proposed terms are approved.");
      return paused ? insurance.unpause() : insurance.pause();
    }, paused ? "Sales resumed." : "Sales paused.");
  }

  async function doSetOracle() {
    if (!insurance || !newOracle) return;
    await withBusy(async () => {
      const tx = await insurance.setOracle(newOracle);
      setNewOracle("");
      return tx;
    }, "Oracle address updated.");
  }

  return (
    <div>
      <h1>Insurer Admin</h1>
      <p className="subtitle">
        Insurer: {insurerAddr ? fmtAddress(insurerAddr) : "…"} · Oracle: {oracleAddr ? fmtAddress(oracleAddr) : "…"}
      </p>
      {!configured && <p className="status-msg error">Contracts are not deployed; administration is unavailable.</p>}
      {!salesEnabled && <p className="status-msg error">Real sales gated pending approval of the proposed At gate terms and schedule evidence.</p>}
      {loadError && <p className="status-msg error">Admin read failed: {loadError}</p>}

      {!address && <div className="card">Connect your wallet to manage the pool and flights.</div>}
      {address && !isInsurer && (
        <div className="card">This wallet is not the insurer account, so write actions below will revert.</div>
      )}
      {msg && <p className={`status-msg ${msg.kind}`}>{msg.text} {msg.hash && txLink(msg.hash) && <a href={txLink(msg.hash)!} target="_blank" rel="noreferrer">Transaction</a>}</p>}

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
          <button className="secondary" disabled={busy || !isInsurer || (paused && !salesEnabled)} onClick={togglePause}>
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
        <div className="form-row"><label>Origin-local departure date</label><input type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} /></div>
        <div className="form-row"><label>Scheduled departure (UTC)</label><input type="datetime-local" value={departure} onChange={(e) => setDeparture(e.target.value)} /></div>
        <div className="form-row">
          <label>Scheduled arrival (UTC)</label>
          <input type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} />
        </div>
        <div className="form-row"><label>Codeshare aliases (comma-separated)</label><input value={aliases} onChange={(e) => setAliases(e.target.value)} /></div>
        <div className="form-row"><label>Official plan source URL</label><input value={planSourceUrl} onChange={(e) => setPlanSourceUrl(e.target.value)} style={{ width: 340 }} /></div>
        <div className="form-row"><label>Exact plan evidence text (hash only on chain)</label><textarea value={planEvidence} onChange={(e) => setPlanEvidence(e.target.value)} /></div>
        <div className="form-row"><label>Evidence fetched at (UTC)</label><input type="datetime-local" value={planFetchedAt} onChange={(e) => setPlanFetchedAt(e.target.value)} /></div>
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
                  <td>{fmtUnixHkt(f.scheduledArrival)}</td>
                  <td>{f.sellable ? "Yes" : "No"}</td>
                  <td>
                    <button className="secondary" disabled={busy || !isInsurer || (!f.sellable && !salesEnabled)} onClick={() => toggleSellable(f)}>
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
