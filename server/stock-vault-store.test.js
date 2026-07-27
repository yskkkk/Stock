import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveServerDataDir } from "./data-path.js";
import {
  listStockVaultItemsSync,
  mergeGoldenCrossHitsIntoVaultSync,
  removeStockVaultItemSync,
  upsertStockVaultItemSync,
} from "./stock-vault-store.js";

beforeEach(() => {
  process.env.STOCK_VAULT_STORE_TEST_FILE = `stock-vault-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
});

test("global vault rejects manual source upsert", () => {
  const sym = `TEST${Date.now()}.KS`;
  assert.throws(
    () =>
      upsertStockVaultItemSync({
        symbol: sym,
        name: "수동보관테스트",
        market: "kr",
        source: "manual",
      }),
    /invalid source/i,
  );
});

test("removed golden cross symbols stay dismissed", () => {
  const sym = `GC${Date.now()}.KS`;
  try {
    upsertStockVaultItemSync({
      symbol: sym,
      name: "골든크로스검증",
      market: "kr",
      source: "golden_cross",
      crosses: ["5>20"],
      scanDate: "2026-05-29",
    });
    assert.ok(removeStockVaultItemSync(sym));
    mergeGoldenCrossHitsIntoVaultSync([
      {
        symbol: sym,
        name: "골든크로스검증",
        market: "kr",
        crosses: ["5>20"],
        scanDate: "2026-05-29",
      },
    ]);
    assert.ok(!listStockVaultItemsSync().some((it) => it.symbol === sym));
  } finally {
    removeStockVaultItemSync(sym);
  }
});

test("test garbage names are not persisted in vault store", () => {
  const sym = `FAV${Date.now()}.KS`;
  upsertStockVaultItemSync({
    symbol: sym,
    name: "즐겨",
    market: "kr",
    source: "golden_cross",
    crosses: ["5>60"],
    scanDate: "2026-05-29",
  });
  assert.ok(!listStockVaultItemsSync().some((it) => it.symbol === sym));
});

test("corrupt vault store falls back to empty items", () => {
  const fileName = process.env.STOCK_VAULT_STORE_TEST_FILE;
  assert.ok(fileName);
  const fp = path.join(resolveServerDataDir(), fileName);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, "{not-json", "utf8");
  assert.deepEqual(listStockVaultItemsSync(), []);
});
