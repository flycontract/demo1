import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const binary = resolve(root, "node_modules/hardhat/internal/cli/cli.js");
const result = spawnSync(process.execPath, [binary, "run", "scripts/local-e2e.cjs", "--network", "hardhat"], {
  cwd: root, stdio: "inherit", env: {
    ...process.env,
    DOTENV_CONFIG_PATH: resolve(root, "scripts/local-only-empty.env"),
    LOCAL_INITIAL_DATE: "2026-10-21T00:00:00Z",
  },
});
process.exitCode = result.status ?? 1;
