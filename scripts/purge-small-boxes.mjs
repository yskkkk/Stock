#!/usr/bin/env node
/**
 * TF별 최소 박스 폭(%) 미달 박스 정리
 * - 카탈로그: server/.data/box-range-catalog-pro/{us|kr|crypto}/*.json 에서 제거
 * - state: server/.data/box-range-state.json 에서 idle/armed만 제거(보유중은 보호)
 */
import fs from "node:fs";
import path from "node:path";
import { resolveServerDataDir } from "../server/data-path.js";

const MIN = { "1h": 1, "4h": 3, "1d": 0 };
const CATALOG_ROOT = "box-range-catalog-pro";
const MARKETS = ["us", "kr", "crypto"];

function boxHeightPct(top, bottom) {
  const t = Number(top);
  const b = Number(bottom);
  const m = (t + b) * 0.5;
  if (!Number.isFinite(t) || !Number.isFinite(b) || t <= b || m <= 0) return 0;
  return ((t - b) / m) * 100;
}

function keepCatalogBox(b) {
  const tf = String(b?.timeframe ?? "").trim();
  const min = MIN[tf] ?? 0;
  if (min <= 0) return true;
  return boxHeightPct(b.top, b.bottom) >= min;
}

function purgeCatalog() {
  const root = path.join(resolveServerDataDir(), CATALOG_ROOT);
  /** @type {{ files: number; boxesBefore: number; boxesAfter: number; removed: number }} */
  const out = { files: 0, boxesBefore: 0, boxesAfter: 0, removed: 0 };
  for (const m of MARKETS) {
    const dir = path.join(root, m);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json") || f === "_index.json") continue;
      const p = path.join(dir, f);
      let o;
      try {
        o = JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        continue;
      }
      if (!o || !Array.isArray(o.boxes)) continue;
      out.files += 1;
      const before = o.boxes.length;
      out.boxesBefore += before;
      o.boxes = o.boxes.filter(keepCatalogBox);
      const after = o.boxes.length;
      out.boxesAfter += after;
      out.removed += Math.max(0, before - after);
      if (after !== before) {
        const tmp = `${p}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(o, null, 0), "utf8");
        fs.renameSync(tmp, p);
      }
    }
  }
  return out;
}

function keepStateBox(b) {
  const tf = String(b?.timeframe ?? "").trim();
  const min = MIN[tf] ?? 0;
  if (min <= 0) return true;
  // 보유중은 제거하지 않음(강제 청산 방지)
  if (b?.state === "in_position") return true;
  return boxHeightPct(b.top, b.bottom) >= min;
}

function purgeState() {
  const file = path.join(resolveServerDataDir(), "box-range-state.json");
  if (!fs.existsSync(file)) return { exists: false, before: 0, after: 0, removed: 0 };
  let o;
  try {
    o = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { exists: true, before: 0, after: 0, removed: 0, error: "parse-failed" };
  }
  const boxes = Array.isArray(o?.boxes) ? o.boxes : [];
  const before = boxes.length;
  const kept = boxes.filter(keepStateBox);
  const after = kept.length;
  if (after !== before) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ...o, boxes: kept }, null, 0), "utf8");
    fs.renameSync(tmp, file);
  }
  return { exists: true, before, after, removed: Math.max(0, before - after) };
}

const cat = purgeCatalog();
const st = purgeState();
console.log(JSON.stringify({ ok: true, minPct: MIN, catalog: cat, state: st }, null, 2));

