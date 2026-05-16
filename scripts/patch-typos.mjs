import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "App.tsx");
let s = fs.readFileSync(p, "utf8");

const TAB = "\uC0C1\uC2B9 \uC720\uB9DD"; // 상승 유망
for (const bad of [
  "\uC0C1\uC2B9 \uC720\uB9F9", // 유망
  "\uC0C1\uC2B9 \uC720\uB9F5", // 유망
  "\uC0C1\uC2B9 \uC720\uB9F5", // duplicate
]) {
  s = s.replaceAll(bad, TAB);
}

const CANDLE = "\uBD09"; // 봉
for (const bad of ["\uB4F1", "\uB4F9", "\uB515", "\uB969"]) {
  s = s.replaceAll(`{candleCount}${bad}</span>`, `{candleCount}${CANDLE}</span>`);
}

fs.writeFileSync(p, s, "utf8");
console.log("ok:", s.includes(TAB), s.includes(`{candleCount}${CANDLE}</span>`));
