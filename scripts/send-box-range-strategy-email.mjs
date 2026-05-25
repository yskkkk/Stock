#!/usr/bin/env node
/**
 * 박스권 전략 변경 안내 — 가입(이메일 인증) 회원 전원 발송
 *
 *   node scripts/send-box-range-strategy-email.mjs           # 실제 발송
 *   node scripts/send-box-range-strategy-email.mjs --dry-run # 수신 목록만
 *   node scripts/send-box-range-strategy-email.mjs --force   # 이미 보낸 주소 재발송
 */
import { loadEnvFile } from "../server/load-env.js";
import { sendBoxRangeStrategyEmailToAllMembers } from "../server/notifications/box-range-strategy-email.js";

loadEnvFile();

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force");

const out = await sendBoxRangeStrategyEmailToAllMembers({ dryRun, force });
console.log(JSON.stringify(out, null, 2));
if (out.failed > 0) process.exitCode = 1;
