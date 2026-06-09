import assert from "node:assert/strict";
import test from "node:test";
import {
  parseKrxListCsvAll,
  parseNaverAcStockPayload,
  searchKrStockIndexRows,
} from "./kr-stock-search-index.js";

const SAMPLE_CSV = `Code,Name,Market,Marcap
007660,이수페타시스,KOSDAQ,1000000000
005930,삼성전자,KOSPI,5000000000
`;

test("parseKrxListCsvAll assigns KQ suffix for KOSDAQ", () => {
  const rows = parseKrxListCsvAll(SAMPLE_CSV);
  const hit = rows.find((r) => r.code === "007660");
  assert.ok(hit);
  assert.equal(hit.symbol, "007660.KQ");
  assert.equal(hit.name, "이수페타시스");
});

test("searchKrStockIndexRows finds 이수페타시스 by Korean name", () => {
  const rows = parseKrxListCsvAll(SAMPLE_CSV);
  const hits = searchKrStockIndexRows(rows, "이수페타시스", 5);
  assert.equal(hits[0]?.symbol, "007660.KQ");
  assert.equal(hits[0]?.name, "이수페타시스");
});

test("parseNaverAcStockPayload maps autocomplete rows", () => {
  parseKrxListCsvAll(SAMPLE_CSV);
  const rows = parseNaverAcStockPayload({
    items: [["이수페타시스", [["이수페타시스", "007660", "stock"]]]],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.symbol, "007660.KQ");
});
