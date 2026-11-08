import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const python = process.platform === "win32"
  ? resolve(root, ".venv", "Scripts", "python.exe")
  : resolve(root, ".venv", "bin", "python");

if (!existsSync(python)) {
  throw new Error(`Project Python environment not found at ${python}. Create .venv and install test_python dependencies first.`);
}

const result = spawnSync(
  python,
  [
    resolve(root, "test_python", "demo.py"),
    "--rpc-url",
    process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545",
    ...process.argv.slice(2),
  ],
  { cwd: root, stdio: "inherit" }
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
