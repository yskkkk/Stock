#!/usr/bin/env node
/**
 * 등록 프로그램을 로그인 계정(userId)에 수동 귀속.
 * 사용: node scripts/assign-live-trade-program-owner.mjs <email> <programId> [programId...]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "../server/.data");
const USERS_FILE = path.join(DATA, "users.json");
const PROGRAMS_FILE = path.join(DATA, "live-trade-programs.json");

function normEmail(email) {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

const email = normEmail(process.argv[2]);
const ids = process.argv.slice(3).map((s) => String(s).trim()).filter(Boolean);

if (!email || !email.includes("@") || ids.length === 0) {
  console.error(
    "Usage: node scripts/assign-live-trade-program-owner.mjs <email> <programId> [...]",
  );
  process.exit(1);
}

const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8")).users ?? [];
const user = users.find((u) => normEmail(u.email) === email);
if (!user) {
  console.error(`No user for email: ${email}`);
  process.exit(1);
}

const store = JSON.parse(fs.readFileSync(PROGRAMS_FILE, "utf8"));
let n = 0;
for (const p of store.programs ?? []) {
  if (!ids.includes(p.id)) continue;
  p.userId = user.id;
  p.ownerEmail = email;
  p.updatedAtMs = Date.now();
  n++;
}
if (n === 0) {
  console.error("No matching program ids:", ids.join(", "));
  process.exit(1);
}
const tmp = `${PROGRAMS_FILE}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(store, null, 0), "utf8");
fs.renameSync(tmp, PROGRAMS_FILE);
console.log(`Assigned ${n} program(s) to ${email} (${user.id})`);
