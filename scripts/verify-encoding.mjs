import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

const bad = [];
const stringWithQ = /(["'`])(?:(?!\1).)*\?{2,}(?:(?!\1).)*\1/g;

for (const file of walk(root)) {
  if (file.includes(`${path.sep}i18n${path.sep}`)) continue;
  const s = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  for (const m of s.matchAll(stringWithQ)) {
    if (m[0].includes("?? false") || m[0].includes("?? true")) continue;
    if (/\?\?\s*[a-zA-Z_.[\]"'0-9`]/.test(m[0])) continue;
    if (/\?\?\s*["'`]/.test(m[0])) continue;
    bad.push(`${rel}: ${m[0].slice(0, 80)}`);
  }
}

if (bad.length) {
  console.error("Corrupted Korean string literals (??):");
  for (const line of bad) console.error(" ", line);
  process.exit(1);
}
console.log("encoding check ok");
