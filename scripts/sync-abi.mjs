import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const targets = [
  ["contracts/FlightDelayInsurance.sol/FlightDelayInsurance.json", "oracle/src/generatedInsuranceAbi.ts", "FLIGHT_DELAY_INSURANCE_ABI"],
  ["contracts/FlightDelayInsurance.sol/FlightDelayInsurance.json", "frontend/src/lib/generatedInsuranceAbi.ts", "FLIGHT_DELAY_INSURANCE_ABI"],
  ["contracts/DemoToken.sol/DemoToken.json", "frontend/src/lib/generatedTokenAbi.ts", "DEMO_TOKEN_ABI"],
];
let changed = false;
for (const [artifact, target, name] of targets) {
  const abi = JSON.parse(readFileSync(resolve(root, "artifacts", artifact), "utf8")).abi;
  const expected = `// Generated from Hardhat artifacts by scripts/sync-abi.mjs. Do not hand edit.\nexport const ${name} = ${JSON.stringify(abi, null, 2)} as const;\n`;
  const path = resolve(root, target);
  let current = "";
  try { current = readFileSync(path, "utf8"); } catch { /* first generation */ }
  if (current !== expected) {
    changed = true;
    if (process.argv.includes("--write")) writeFileSync(path, expected);
    else console.error(`ABI out of sync: ${target}`);
  }
}
if (changed && !process.argv.includes("--write")) process.exitCode = 1;
