import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "App.tsx");
let s = fs.readFileSync(p, "utf8");
s = s.replace(
  'title="\\uC870\\uD68C \\uC2E4\\uD328 \\uC885\\uBAA9 \\uBAA9\\uB85D"',
  'title="\uC870\uD68C \uC2E4\uD328 \uC885\uBAA9 \uBAA9\uB85D"',
);
fs.writeFileSync(p, s, "utf8");
console.log("ok");
