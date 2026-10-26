// DemoToken uses 0 decimals, so token amounts are plain integers -- no
// wei-style scaling anywhere in this app.
export function fmtToken(amount: bigint | number): string {
  return `${amount} FDT`;
}

export function fmtUnixUtc(ts: bigint | number): string {
  const n = Number(ts);
  if (n === 0) return "—";
  return new Date(n * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function fmtUnixHkt(ts: bigint | number): string {
  if (Number(ts) === 0) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(Number(ts) * 1000)) + " HKT";
}

export function txLink(hash: string): string | null {
  const base = import.meta.env.VITE_EXPLORER_URL as string | undefined;
  return base && /^https:\/\//.test(base) ? `${base.replace(/\/$/, "")}/tx/${hash}` : null;
}

export function fmtAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** For a <input type="datetime-local"> value (assumed UTC) -> unix seconds. */
export function localInputToUnix(value: string): number {
  return Math.floor(new Date(`${value}:00Z`).getTime() / 1000);
}

export function errMsg(err: unknown): string {
  const e = err as { shortMessage?: string; reason?: string; message?: string };
  return e.shortMessage ?? e.reason ?? e.message ?? String(err);
}
