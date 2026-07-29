import { test, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJsonStoreSync, writeJsonStoreSync, invalidateJsonStoreReadCache, stripUtf8Bom } from "./store-json.js";

/** @type {string | undefined} */
let prevDataDir;
/** @type {string | undefined} */
let tmpDir;

beforeEach(() => {
  prevDataDir = process.env.STOCK_DATA_DIR;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "store-json-test-"));
  process.env.STOCK_DATA_DIR = tmpDir;
  invalidateJsonStoreReadCache("granville-scan-state.json");
  invalidateJsonStoreReadCache("corrupt-sample.json");
  invalidateJsonStoreReadCache("sample.json");
  invalidateJsonStoreReadCache("normalize-fail.json");
  invalidateJsonStoreReadCache("read-fail-sample.json");
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.STOCK_DATA_DIR;
  else process.env.STOCK_DATA_DIR = prevDataDir;
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("readJsonStoreSync strips UTF-8 BOM before parse", () => {
  const fileName = "granville-scan-state.json";
  fs.writeFileSync(path.join(tmpDir, fileName), "\uFEFF{}", "utf8");

  const state = readJsonStoreSync(
    fileName,
    (raw) => ({ ok: raw && typeof raw === "object" }),
    () => ({ ok: false }),
  );

  assert.equal(state.ok, true);
  const healed = fs.readFileSync(path.join(tmpDir, fileName), "utf8");
  assert.notEqual(healed.charCodeAt(0), 0xfeff);
});

test("readJsonStoreSync strips BOM after leading whitespace", () => {
  const fileName = "granville-scan-state.json";
  fs.writeFileSync(path.join(tmpDir, fileName), " \uFEFF{}", "utf8");

  const state = readJsonStoreSync(
    fileName,
    (raw) => ({ ok: raw && typeof raw === "object" }),
    () => ({ ok: false }),
  );

  assert.equal(state.ok, true);
});

test("stripUtf8Bom removes BOM at start", () => {
  assert.equal(stripUtf8Bom("\uFEFF{}"), "{}");
  assert.equal(stripUtf8Bom(" \uFEFF{}"), "{}");
});

test("readJsonStoreSync restores defaults on corrupt JSON", () => {
  const fileName = "corrupt-sample.json";
  fs.writeFileSync(path.join(tmpDir, fileName), "{not-json", "utf8");

  const state = readJsonStoreSync(
    fileName,
    () => ({ ok: true }),
    () => ({ ok: false }),
  );

  assert.deepEqual(state, { ok: false });
  const backups = fs.readdirSync(tmpDir).filter((f) => f.includes(".corrupt-"));
  assert.ok(backups.length >= 1);
  const healed = fs.readFileSync(path.join(tmpDir, fileName), "utf8");
  assert.equal(JSON.parse(healed).ok, false);
});

test("readJsonStoreSync restores defaults when normalize throws", () => {
  const fileName = "normalize-fail.json";
  fs.writeFileSync(path.join(tmpDir, fileName), JSON.stringify({ bad: true }), "utf8");

  const state = readJsonStoreSync(
    fileName,
    () => {
      throw new Error("normalize boom");
    },
    () => ({ ok: false }),
  );

  assert.deepEqual(state, { ok: false });
  const backups = fs.readdirSync(tmpDir).filter((f) => f.includes(".corrupt-"));
  assert.ok(backups.length >= 1);
});

test("readJsonStoreSync restores defaults on read failure without throwing", () => {
  const fileName = "read-fail-sample.json";
  // 디렉터리로 위장 — readFileSync 실패 → 기본값 복구(throw 없음)
  fs.mkdirSync(path.join(tmpDir, fileName));

  const state = readJsonStoreSync(
    fileName,
    () => ({ ok: true }),
    () => ({ ok: false }),
  );

  assert.deepEqual(state, { ok: false });
});

test("writeJsonStoreSync writes without BOM", () => {
  const fileName = "sample.json";
  writeJsonStoreSync(fileName, { n: 1 });
  const raw = fs.readFileSync(path.join(tmpDir, fileName), "utf8");
  assert.notEqual(raw.charCodeAt(0), 0xfeff);
  assert.equal(JSON.parse(raw).n, 1);
});
