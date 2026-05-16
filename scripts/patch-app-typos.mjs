import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "App.tsx");
let s = fs.readFileSync(p, "utf8");

const BONG = "\uB4F9"; // 봉 — file had wrong syllable U+B515 display as 듹; actual bad char:
const BAD_CANDLE = "\uB515"; // 듹 in file per read tool
const MA_LABEL = "\uC77C\uB445\uC774\uD3C9"; // 일봉이평 (wrong)
const MA_FIX = "\uC77C\uB445\uC774\uD3C9".replace("\uB445", "\uBD09"); // 일봉이평

// Fix candle unit: {candleCount} + wrong char
s = s.replace(`{candleCount}${BAD_CANDLE}</span>`, `{candleCount}${BONG}</span>`);
s = s.replace(`{candleCount}\uB4F9</span>`, `{candleCount}\uBD09</span>`);

// Fix MA chip label
s = s.replace(`["ma", "${MA_LABEL}", showMa`, `["ma", "\uC77C\uBD09\uC774\uD3C9", showMa`);

fs.writeFileSync(p, s, "utf8");

const check = fs.readFileSync(p, "utf8");
console.log(
  "candle ok:",
  check.includes("{candleCount}\uBD09</span>"),
  "ma ok:",
  check.includes("\uC77C\uBD09\uC774\uD3C9"),
);
