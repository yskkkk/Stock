#!/usr/bin/env node
/**
 * 빗썸 잔고 ↔ 앱 보유 동기화 (CLI)
 *   node scripts/reconcile-bithumb-holdings.mjs [--dry-run] [--user=email]
 */
import { loadEnvFile } from "../server/load-env.js";

loadEnvFile();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const userArg = args.find((a) => a.startsWith("--user="));
const email = userArg ? userArg.slice("--user=".length) : null;

const { findUserByEmailSync, listUsersSync } = await import("../server/users-store.js");
const { reconcileBithumbHoldingsForUser } = await import(
  "../server/live-trade-bithumb-reconcile.js"
);

const user = email
  ? findUserByEmailSync(email)
  : listUsersSync()[0];
if (!user) {
  console.error("user not found");
  process.exit(1);
}

const result = await reconcileBithumbHoldingsForUser(user.id, { dryRun });
console.log(JSON.stringify(result, null, 2));
