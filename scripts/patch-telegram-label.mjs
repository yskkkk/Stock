import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "App.tsx");
let s = fs.readFileSync(p, "utf8");

const TEL = "\uD154\uB808\uADF8\uB7A8";
s = s.replace(/\uD14C\uB808\uADF8\uB7A8/g, TEL);
s = s.replace(
  /<nav className="main-tabs" aria-label="[^"]*"/,
  '<nav className="main-tabs" aria-label="\uBA54\uC778 \uBA54\uB274"',
);
s = s.replace(
  /(className="tag-reset"[\s\S]*?)aria-label="[^"]*"/,
  `$1aria-label="\uC624\uB298 ${TEL} \uC54C\uB9BC \uC774\uB825 \uCD08\uAE30\uD654"`,
);

fs.writeFileSync(p, s, "utf8");
console.log("patched");
