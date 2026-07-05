/**
 * S&P 500 한글 종목명 JSON 재생성 — names-ko-sp500.json
 * 우선순위: 기존 맵 → Naver API → pinion05 coverage100
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getKoreanStockName, hasHangul } from "../server/names-ko.js";
import { resolveUsKoreanStockNamesBatch } from "../server/us-naver-korean-name.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "../server/data/names-ko-sp500.json");
const SP500_CSV_URL =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv";
const PINION_URL =
  "https://raw.githubusercontent.com/pinion05/kr-us-stock-name-ticker-maps/main/data/us/us-stock-ticker-to-ko-en-coverage100.json";

function yahooSymbol(raw) {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "-");
}

const csvRes = await fetch(SP500_CSV_URL);
if (!csvRes.ok) throw new Error(`CSV HTTP ${csvRes.status}`);
const symbols = csvRes
  .text()
  .then((t) =>
    t
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .map((line) => yahooSymbol(line.split(",")[0]))
      .filter(Boolean),
  );

const pinionRes = await fetch(PINION_URL);
if (!pinionRes.ok) throw new Error(`pinion HTTP ${pinionRes.status}`);
const pinion = await pinionRes.json();

const companies = await symbols;
const need = companies.filter((s) => {
  const ko = getKoreanStockName(s);
  return !ko || !hasHangul(ko);
});
console.log(`S&P 500 ${companies.length}종목 — Naver 조회 ${need.length}건`);
const naverMap = await resolveUsKoreanStockNamesBatch(need, 10);

/** @type {Array<{ symbol: string; nameKo: string }>} */
const out = [];
/** @type {string[]} */
const noHangul = [];

for (const sym of companies) {
  const pin = pinion[sym] ?? pinion[sym.replace(/-/g, ".")];
  const pinKo = String(pin?.name_ko ?? "").trim();
  const nameKo =
    [getKoreanStockName(sym), naverMap.get(sym), pinKo].find(
      (v) => v && hasHangul(v),
    ) ?? null;
  if (nameKo) out.push({ symbol: sym, nameKo });
  else noHangul.push(sym);
}

out.sort((a, b) => a.symbol.localeCompare(b.symbol));
writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`저장: ${OUT} (${out.length}건, 한글 없음 ${noHangul.length})`);
if (noHangul.length) console.log("한글 없음:", noHangul.join(", "));
