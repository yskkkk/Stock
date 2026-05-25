#!/usr/bin/env node
/**
 * 박스권 v2 시나리오 — 전체 프로그램 적용 + 안내 메일
 * 사용: node server/box-range/apply-scenario-rollout.js [--dry-run-email] [--force] [--no-email]
 */
import { loadEnvFile } from "../load-env.js";
import { ensureBoxRangeScenarioRolloutOnce } from "./migrate-active-programs.js";

loadEnvFile();

const args = new Set(process.argv.slice(2));
const dryRunEmail = args.has("--dry-run-email");
const force = args.has("--force");
const noEmail = args.has("--no-email");
const emailForce = args.has("--email-force") || force;

async function main() {
  const migrate = await ensureBoxRangeScenarioRolloutOnce({
    force: true,
    sendEmail: !noEmail,
    emailDryRun: dryRunEmail,
    emailForce,
  });
  console.log(JSON.stringify(migrate, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
