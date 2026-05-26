#!/usr/bin/env node
/** Pine 카탈로그 건강·최신 여부 점검 */
import { loadEnvFile } from "../server/load-env.js";
import {
  readCatalogIndexSync,
  readSymbolCatalogSync,
  resolveCatalogRootDir,
  summarizeCatalogRootSync,
} from "../server/box-range/catalog-store.js";
import {
  BOX_RANGE_CATALOG_DIR_PINE,
  BOX_RANGE_CRYPTO_CATALOG_SYMBOL,
} from "../server/box-range/constants.js";

loadEnvFile();

const root = resolveCatalogRootDir();
const ageMin = (ms) =>
  ms > 0 ? `${((Date.now() - ms) / 60_000).toFixed(0)}분 전` : "—";

console.log(`catalogRoot: ${root}`);
for (const market of ["us", "kr", "crypto"]) {
  const sum = summarizeCatalogRootSync(root, market);
  let idxAge = "—";
  try {
    const idx = readCatalogIndexSync(market);
    idxAge = ageMin(idx.updatedAtMs ?? 0);
  } catch {
    /* */
  }
  console.log(
    `[${market}] symbols=${sum.symbols} withBoxes=${sum.withBoxes} total=${sum.total} · 1h=${sum.byTf["1h"]} 4h=${sum.byTf["4h"]} 1d=${sum.byTf["1d"]} · index ${idxAge}`,
  );
}

const btc = readSymbolCatalogSync(BOX_RANGE_CRYPTO_CATALOG_SYMBOL, "crypto");
if (btc) {
  const elig = btc.boxes.filter((b) => b.tradeEligible && !b.consumedAtMs);
  console.log(
    `\nBTC ${BOX_RANGE_CRYPTO_CATALOG_SYMBOL}: updated ${ageMin(btc.updatedAtMs)} · boxes=${btc.boxes.length} eligible=${elig.length}${btc.scanError ? ` · scanError=${btc.scanError}` : ""}`,
  );
  for (const tf of ["1h", "4h", "1d"]) {
    const n = elig.filter((b) => b.timeframe === tf).length;
    if (n > 0) {
      const sample = elig.find((b) => b.timeframe === tf);
      console.log(
        `  ${tf}: ${n} · mid≈${sample?.mid?.toLocaleString("ko-KR")} bottom<top=${sample && sample.top > sample.bottom}`,
      );
    }
  }
} else {
  console.log(`\nBTC: 카탈로그 없음 — npm run box-range:catalog:refresh 실행 필요`);
}

const aapl = readSymbolCatalogSync("AAPL", "us");
if (aapl) {
  console.log(
    `\n샘플 AAPL: updated ${ageMin(aapl.updatedAtMs)} · boxes=${aapl.boxes.length}`,
  );
}
