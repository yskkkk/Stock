#!/usr/bin/env node
/**
 * 장 마감 보유 종목 브리핑 즉시 발송
 *
 *   node scripts/send-holdings-close-digest.mjs
 *   node scripts/send-holdings-close-digest.mjs --email samron3@naver.com --force
 *   node scripts/send-holdings-close-digest.mjs --dry-run
 */
import { loadEnvFile } from "../server/load-env.js";
import { isEmailSendingConfigured } from "../server/email-sender.js";
import { tickHoldingsCloseDigestEmail } from "../server/notifications/holdings-close-digest-email.js";

loadEnvFile();

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force") || !args.has("--scheduled");
const emailIdx = process.argv.indexOf("--email");
const email =
  emailIdx >= 0 ? String(process.argv[emailIdx + 1] ?? "").trim() : "";
const marketIdx = process.argv.indexOf("--market");
const marketRaw = marketIdx >= 0 ? String(process.argv[marketIdx + 1] ?? "") : "all";
const market =
  marketRaw === "kr" || marketRaw === "us" || marketRaw === "all"
    ? marketRaw
    : "all";

if (!dryRun && !isEmailSendingConfigured()) {
  console.error("SMTP not configured (SMTP_HOST). Abort.");
  process.exit(1);
}

const result = await tickHoldingsCloseDigestEmail({
  dryRun,
  force,
  market,
  email: email || undefined,
});

console.log(JSON.stringify(result, null, 2));
if (!result.ok && result.reason && result.sent === 0) {
  process.exit(1);
}
