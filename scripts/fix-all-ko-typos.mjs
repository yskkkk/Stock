import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 잘못된 음절 → 올바른 음절 (파일 전체 치환) */
const GLOBAL = [
  ["\uC77C\uB445\uC774\uD3C9", "\uC77C\uBD09\uC774\uD3C9"], // 일봉이평 → 일봉이평
  ["\uC77C\uB445", "\uC77C\uBD09"], // 일봉 → 일봉 (단독)
  ["\uC720\uB9F9", "\uC720\uB9DD"], // 유망 → 유망
  ["\uC720\uB9F5", "\uC720\uB9DD"], // 유망 → 유망
  ["\uD14C\uB808\uADF8\uB7A8", "\uD154\uB808\uADF8\uB7A8"], // 텔레그램 → 텔레그램
  ["{candleCount}\uB515</span>", "{candleCount}\uBD09</span>"],
  ["{candleCount}\uB4F9</span>", "{candleCount}\uBD09</span>"],
  ["{candleCount}\uB4F1</span>", "{candleCount}\uBD09</span>"],
];

const FILE_PATCHES = {
  "src/App.tsx": [
    ['["ma", "\uC77C\uBD09\uC774\uD3C9", showMa', '["ma", "\uC774\uD3C9(\uC77C)", showMa'],
    ['["ma", "\uC77C\uB445\uC774\uD3C9", showMa', '["ma", "\uC774\uD3C9(\uC77C)", showMa'],
  ],
};

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === ".git") continue;
      walk(p, out);
    } else if (/\.(tsx?|jsx?|mjs)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

let filesChanged = 0;
for (const abs of walk(root)) {
  const rel = path.relative(root, abs).replace(/\\/g, "/");
  let s = fs.readFileSync(abs, "utf8");
  const before = s;
  for (const [a, b] of GLOBAL) {
    if (s.includes(a)) s = s.split(a).join(b);
  }
  const patches = FILE_PATCHES[rel];
  if (patches) {
    for (const [a, b] of patches) {
      s = s.split(a).join(b);
    }
  }
  if (s !== before) {
    fs.writeFileSync(abs, s, "utf8");
    filesChanged++;
    console.log("fixed:", rel);
  }
}

console.log("done,", filesChanged, "file(s)");
