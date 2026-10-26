import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";

const root = resolve(import.meta.dirname, "..");
const sensitive = [".env", "oracle/.env", "frontend/.env"];
const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root });
const files = listed.toString("utf8").split("\0").filter(Boolean).map((p) => p.replaceAll("\\", "/"));
const issues = [];
for (const file of sensitive) if (files.includes(file)) issues.push(`${file}: included in deliverable file set`);
const keys = [];
for (const file of sensitive.slice(0, 2)) {
  const localPath = resolve(root, file);
  if (!existsSync(localPath)) continue; // A fresh checkout has no private env files.
  const values = dotenv.parse(readFileSync(localPath));
  for (const [key, value] of Object.entries(values)) if (/PRIVATE_KEY$/.test(key) && value) keys.push(value);
}
for (const file of files) {
  if (/\.(png|jpg|jpeg|pdf|sqlite|lock|raw)$/i.test(file)) continue;
  let contents;
  try { contents = readFileSync(resolve(root, file), "utf8"); } catch { continue; }
  if (keys.some((key) => contents.includes(key))) issues.push(`${file}: local private key found`);
  if (/https?:\/\/[^\s/@]+:[^\s/@]+@/.test(contents)) issues.push(`${file}: credential-bearing URL found`);
}
console.log(`Secret scan: ${files.length} deliverable files inspected, ${issues.length} issue(s).`);
for (const issue of issues) console.log(`- ${issue}`);
if (issues.length) process.exitCode = 1;
