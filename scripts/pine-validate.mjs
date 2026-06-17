#!/usr/bin/env node
/**
 * Pine Script 로컬 검증 — pinescript_validator (pip) 래퍼
 * Usage: node scripts/pine-validate.mjs [file.pine ...]
 * Exit 0 = no errors
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: node scripts/pine-validate.mjs <file.pine> [...]");
  process.exit(2);
}

const missing = files.filter((f) => !existsSync(resolve(f)));
if (missing.length) {
  console.error("File not found:", missing.join(", "));
  process.exit(2);
}

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: "utf8", shell: true });
}

// python -m pinescript_validator.cli
let r = run("python", ["-m", "pinescript_validator.cli", ...files, "--json"]);
if (r.error?.code === "ENOENT" || r.status === 9009) {
  r = run("py", ["-m", "pinescript_validator.cli", ...files, "--json"]);
}

if (r.status === 9009 || (r.stderr && /No module named/.test(r.stderr))) {
  console.error(
    "pinescript_validator not installed.\n" +
      "  py -m pip install git+https://github.com/Poryaei/pine-script-validator.git",
  );
  process.exit(3);
}

let payload = null;
try {
  payload = JSON.parse(r.stdout || "{}");
} catch {
  // fallback text output
  if (r.stdout) console.log(r.stdout);
  if (r.stderr) console.error(r.stderr);
  process.exit(r.status ?? 1);
}

const diags = payload.diagnostics ?? payload.issues ?? payload.results ?? [];
const flat = Array.isArray(diags) ? diags : [payload];

let errors = 0;
let warnings = 0;
for (const d of flat) {
  const list = d.diagnostics ?? d.issues ?? (d.message ? [d] : []);
  for (const item of list) {
    const sev = (item.severity ?? item.level ?? "error").toLowerCase();
    const loc = item.line != null ? `:${item.line}` : "";
    const code = item.code ? ` (${item.code})` : "";
    const msg = item.message ?? String(item);
    console.log(`${sev}${loc}${code} — ${msg}`);
    if (sev === "error") errors++;
    else if (sev === "warning") warnings++;
  }
}

if (!flat.length && r.stdout && !payload.diagnostics) {
  console.log(r.stdout.trim() || "OK (no diagnostics)");
}

console.log(`\nPine validate: ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors > 0 ? 1 : 0);
