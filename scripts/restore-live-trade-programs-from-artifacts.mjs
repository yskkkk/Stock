#!/usr/bin/env node
/**
 * sim-feedback·dedup 흔적에서 삭제된 프로그램 등록 행 복구(체결 내역은 portfolio 백업 없으면 복구 불가).
 * 사용: node scripts/restore-live-trade-programs-from-artifacts.mjs <email>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "../server/.data");

function normEmail(email) {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

const email = normEmail(process.argv[2]);
if (!email || !email.includes("@")) {
  console.error(
    "Usage: node scripts/restore-live-trade-programs-from-artifacts.mjs <email>",
  );
  process.exit(1);
}

const users = JSON.parse(
  fs.readFileSync(path.join(DATA, "users.json"), "utf8"),
).users;
const user = users.find((u) => normEmail(u.email) === email);
if (!user) {
  console.error(`No user: ${email}`);
  process.exit(1);
}

const programsPath = path.join(DATA, "live-trade-programs.json");
const store = JSON.parse(fs.readFileSync(programsPath, "utf8"));
const existing = new Set((store.programs ?? []).map((p) => p.id));
const now = Date.now();

/** @type {Record<string, { name: string; minScoreRatio?: number; status?: string }>} */
const fromSim = {};
try {
  const sim = JSON.parse(
    fs.readFileSync(path.join(DATA, "live-trade-sim-feedback.json"), "utf8"),
  );
  for (const [id, row] of Object.entries(sim.byProgram ?? {})) {
    fromSim[id] = {
      name: row.programName || "복구된 시뮬 프로그램",
      minScoreRatio: row.suggestedPatch?.minScoreRatio ?? 0.8,
      status: "paused",
    };
  }
} catch {
  /* ignore */
}

/** @type {Set<string>} */
const fromDedup = new Set();
try {
  const dedup = JSON.parse(
    fs.readFileSync(path.join(DATA, "live-trade-dedup.json"), "utf8"),
  );
  for (const key of Object.keys(dedup)) {
    const m = key.match(/^live:([^:]+):/);
    if (m) fromDedup.add(m[1]);
  }
} catch {
  /* ignore */
}

let n = 0;
function pushProgram(id, meta) {
  if (existing.has(id)) return;
  store.programs.push({
    id,
    userId: user.id,
    ownerEmail: email,
    name: meta.name,
    modelId: "default",
    markets: { kr: false, us: false, crypto: true },
    minScoreRatio: meta.minScoreRatio ?? 0.8,
    maxOpenPositions: 5,
    orderAmountKrw: 10000,
    orderAmountUsd: null,
    status: meta.status ?? "paused",
    armedAtMs: null,
    lastRunAtMs: null,
    lastError: null,
    simAutoBuy: true,
    autoSellAtTarget: true,
    takeProfitPct: 5,
    stopLossPct: -3,
    sellHorizon: "short",
    sellSettingsVersion: 2,
    armedMarkets: { kr: false, crypto: false },
    createdAtMs: now,
    updatedAtMs: now,
  });
  existing.add(id);
  n++;
}

for (const [id, meta] of Object.entries(fromSim)) {
  pushProgram(id, meta);
}

let liveIdx = 1;
for (const id of fromDedup) {
  if (existing.has(id)) continue;
  pushProgram(id, {
    name: `복구·실매매 ${liveIdx++}`,
    status: "paused",
  });
}

if (n === 0) {
  console.log("Nothing to restore (already present or no artifacts).");
  process.exit(0);
}

const tmp = `${programsPath}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(store, null, 0), "utf8");
fs.renameSync(tmp, programsPath);
console.log(`Restored ${n} program(s) for ${email} (${user.id})`);
console.log(
  "Note: portfolio trades were not recovered — re-arm only after reviewing settings.",
);
