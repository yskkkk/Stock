import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cssPath = path.join(root, "src", "index.css");

let s = fs.readFileSync(cssPath, "utf8");

const point = Buffer.from([0xec, 0xa0, 0x90]).toString("utf8");
s = s.replace(
  /\.pick-score:after\{content:"[^"]*;font-size/g,
  `.pick-score:after{content:"${point}";font-size`,
);

for (const [file, marker] of [
  ["telegram-sent.css", ".tag--telegram-btn"],
  ["modals.css", ".news-modal-backdrop"],
  ["macro-bar.css", ".macro-bar"],
  ["signal-chips.css", ".signal-tag--golden"],
  ["macro-info.css", ".macro-info-modal"],
  ["scan-timer.css", ".scan-status__next"],
  ["pick-quote.css", ".pick-quote__symbol"],
  ["profit-model.css", ".profit-model-modal"],
  ["crypto-tab.css", ".crypto-workspace"],
]) {
  const extraPath = path.join(root, "scripts", file);
  if (!s.includes(marker)) {
    s += "\n" + fs.readFileSync(extraPath, "utf8");
  }
}

fs.writeFileSync(cssPath, s, "utf8");
console.log("patched index.css");
