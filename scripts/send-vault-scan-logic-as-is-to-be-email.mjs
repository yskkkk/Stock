#!/usr/bin/env node
/**
 * 종목보관함(vault) 스캔 로직 최근 변경 AS-IS / TO-BE 리포트 생성·메일 발송
 *
 * node scripts/send-vault-scan-logic-as-is-to-be-email.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { loadEnvFile } from "../server/load-env.js";

loadEnvFile();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes("--dry-run");
const TO_EMAIL = String(
  process.env.AGENT_EMAIL_TO ??
    process.env.BOX_RANGE_REPORT_EMAIL ??
    "samron3@naver.com",
).trim();

const PERIOD = "2026-06-17 ~ 2026-06-23";
const now = new Date();
const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
const reportName = `VAULT_SCAN_LOGIC_ASIS_TOBE_${stamp}.md`;
const reportPath = path.join(__dirname, "..", reportName);

/** @type {string[]} */
const lines = [];

lines.push("# 종목보관함 스캔 로직 AS-IS / TO-BE 보고서");
lines.push("");
lines.push(`- 생성: ${now.toISOString()}`);
lines.push(`- 대상 기간: ${PERIOD}`);
lines.push(`- 수신: ${TO_EMAIL}`);
lines.push("");
lines.push("---");
lines.push("");
lines.push("## 요약");
lines.push("");
lines.push(
  "최근 1주일간 **매집봉·바닥캔들·저점기울기·US 유니버스·일괄 스캔 운영** 로직이 연속 개선되었습니다.",
);
lines.push(
  "핵심 방향: Pine 세력통합 프리셋 정렬, 형태 필터 완화·RVOL·맥락 중심, US 주봉 나스닥 확대, 사용자 중지 스캔 존중.",
);
lines.push("");
lines.push("| # | 스캔 | 변경 요지 |");
lines.push("|---|------|-----------|");
lines.push("| 1 | 매집봉 | 윗꼬리·몸통 형태 조건 제거 → RVOL·본전맥락·점수 중심 |");
lines.push("| 2 | 매집봉 | 장대 음봉만 제외, 도지·짧은 음봉 허용 |");
lines.push("| 3 | 매집봉 | US 일봉 토스 전체(~1만), 주봉 나스닥 전종목 |");
lines.push("| 4 | 바닥캔들 | 고점 대비 → 종가 SMA 대비 하락, RVOL·게이트 완화 |");
lines.push("| 5 | 저점기울기 | 일봉 → 주봉 전환 |");
lines.push("| 6 | 일괄 스캔 | env 강제 ON 제거, 사용자 중지·미완료 복구만 |");
lines.push("");
lines.push("---");
lines.push("");
lines.push("## 1. 매집봉 (book-accumulation)");
lines.push("");
lines.push("### 1-1. 윗꼬리·캔들 형태 조건");
lines.push("");
lines.push("| 항목 | AS-IS | TO-BE |");
lines.push("|------|-------|-------|");
lines.push(
  "| 형태 필터 | 윗꼬리 비율 ≥ minUpperPct **또는** 작은 몸통·소양봉 | **형태 조건 전면 제거** (RVOL·맥락·점수만) |",
);
lines.push(
  "| 연속창(consec) | RVOL + 형태(윗꼬리/몸통) 동시 충족 | **RVOL ≥ effRvol×0.92** 만 충족하면 카운트 |",
);
lines.push(
  "| 점수 | shapeUpper +15 / shapeSmall +10 | 형태 점수 **삭제** |",
);
lines.push(
  "| peak 분배 | RVOL + 양봉 + bodyPct≥55 | RVOL + 양봉 **만** (몸통 크기 조건 없음) |",
);
lines.push("");
lines.push("> 커밋: 68d2c01(윗꼬리 제거), 545d39a(형태 조건 제거)");
lines.push("");
lines.push("### 1-2. 음봉(하락봉) 처리");
lines.push("");
lines.push("| 항목 | AS-IS | TO-BE |");
lines.push("|------|-------|-------|");
lines.push(
  "| 1차 | 음봉 무관 (형태만 RVOL) | **close ≥ open** (양봉/도지만) |",
);
lines.push(
  "| 2차(현재) | — | **장대 음봉만 제외**: close<open **AND** bodyPct > maxBearBodyPct(35%) |",
);
lines.push(
  "| 허용 | — | 도지·짧은 몸통 음봉 **허용** |",
);
lines.push("");
lines.push(
  "> 커밋: a8581e1(양봉 필수) → cc12d74(장대 음봉만 제외로 완화)",
);
lines.push("");
lines.push("### 1-3. 서버 기본값 (Pine 세력통합 사용자 프리셋)");
lines.push("");
lines.push("| 파라미터 | AS-IS(추정) | TO-BE(현재) |");
lines.push("|----------|-------------|-------------|");
lines.push("| preset | 보통/엄격 혼재 | **느슨** |");
lines.push("| minRvol | 2.0 전후 | **1.5** |");
lines.push("| needDrop | true | **false** (하락 선행 OFF) |");
lines.push("| needCostCtx | false/선택 | **true** (본전 맥락 필수) |");
lines.push("| maxBearBodyPct | — | **35** (장대 음봉 기준) |");
lines.push("");
lines.push("> 커밋: 0d53a6b · 파일: server/book-accumulation/constants.js");
lines.push("");
lines.push("### 1-4. 스캔 유니버스·타임프레임");
lines.push("");
lines.push("| 구분 | AS-IS | TO-BE |");
lines.push("|------|-------|-------|");
lines.push(
  "| US 일봉 매집 | S&P500 (~500) | **토스 US 전체** NMS+NYQ+ASE (~1만, scope=toss-us) |",
);
lines.push(
  "| US 주봉 매집 | S&P500 | **나스닥(NMS) 전종목** (scope=nasdaq) |",
);
lines.push(
  "| KR 매집 | kr-top | **sp500** (KR+US sp500 리스트) |",
);
lines.push(
  "| 고속 스캔 TF | 선택적 | **1d·1wk 항상** (BOOK_ACCUM_FAST_TIMEFRAMES) |",
);
lines.push(
  "| US fallback | 단일 소스 | toss-us 실패 시 **nasdaq → sp500** 체인 |",
);
lines.push("");
lines.push("> 커밋: 3a03174, dc1b5a1, 8bdc244");
lines.push("");
lines.push("---");
lines.push("");
lines.push("## 2. 바닥캔들 (bottom-candle)");
lines.push("");
lines.push("| 항목 | AS-IS | TO-BE |");
lines.push("|------|-------|-------|");
lines.push(
  "| 하락 기준 | lookback **고점(high)** 대비 종가 하락률 | lookback **종가 SMA(closeSmaAt)** 대비 하락률 |",
);
lines.push(
  "| minDropPct (일봉) | 5% | **3%** |",
);
lines.push(
  "| minDropPct (주봉) | 8% | **6%** |",
);
lines.push(
  "| RVOL 게이트 | rvol ≥ rvolMin **필수** (미충족 시 탐지 불가) | **게이트 제거** — 점수에만 반영 (최대 25점) |",
);
lines.push(
  "| 갭(gap) 게이트 | gapOk **필수** | **게이트 제거** — 점수·패턴 분기만 유지 |",
);
lines.push(
  "| bNoGap 패턴 | isInflection + !gDual + !gAny | **pivot2** (전환/fallBull) + isBull |",
);
lines.push(
  "| bGapPivot / bFallBull | volOk + gapOk 필수 | vol/gap 게이트 **없음**, ctxDrop + 패턴만 |",
);
lines.push("");
lines.push("> 커밋: 05f6404 · 파일: server/bottom-candle-detect.js, pine-saeryeok-bottom-candle.pine");
lines.push("");
lines.push("---");
lines.push("");
lines.push("## 3. 저점기울기 (candle-low-slope)");
lines.push("");
lines.push("| 항목 | AS-IS | TO-BE |");
lines.push("|------|-------|-------|");
lines.push("| 차트 TF | **1d (일봉)** | **1wk (주봉)** |");
lines.push(
  "| 캔들 소스 | 일봉 loadStock 1d | 주봉 loadStock + **미완성 주봉 trim** (candlesForWeeklyMaScan) |",
);
lines.push(
  "| 상태 키 | krLastScanDate / usLastScanDate | **krWeeklyLastScanDate / usWeeklyLastScanDate** |",
);
lines.push(
  "| vault·UI·이메일 | 1d 필터 | **1wk 기준** 통일 |",
);
lines.push("");
lines.push("> 커밋: f925eb8 · 파일: server/candle-low-slope-scan.js");
lines.push("");
lines.push("---");
lines.push("");
lines.push("## 4. US vault 주봉 유니버스 (golden-cross·정배열·120·저점기울기·매집 공통)");
lines.push("");
lines.push("| 항목 | AS-IS | TO-BE |");
lines.push("|------|-------|-------|");
lines.push(
  "| US 일봉 vault | S&P500 (loadUniverse.us) | **변경 없음** — S&P500 |",
);
lines.push(
  "| US 주봉 vault | S&P500 | **나스닥(NMS) 전종목** (fetchNasdaqEquityUniverse) |",
);
lines.push(
  "| KR vault | kr-top | **변경 없음** |",
);
lines.push(
  "| scope 해석 | loadUniverse 고정 | resolveVaultScanUniverseScope(market, timeframe) |",
);
lines.push("");
lines.push("> 커밋: dc1b5a1 · 파일: server/universe.js, 각 *-scan.js");
lines.push("");
lines.push("---");
lines.push("");
lines.push("## 5. 일괄 스캔 스크립트 (run-all-scheduled-scans.mjs)");
lines.push("");
lines.push("| 항목 | AS-IS | TO-BE |");
lines.push("|------|-------|-------|");
lines.push(
  "| env 플래그 | **forceEnableAllScheduledScans()** — 모든 STOCK_*=1 강제 | **제거** — .env 설정 존중 |",
);
lines.push(
  "| 실행 대상 | vault·바닥·매집·박스·스크리너 등 **전부 무조건** | scheduled-scan-policy 기반 **복구 필요 + 미중지** 만 |",
);
lines.push(
  "| 사용자 중지 | 무시하고 재시작 | poller-registry **user-stopped** 이면 **skip** |",
);
lines.push(
  "| 스크리너 | runScreeningOnce 미 export / await 불완 | **export + await** 완료 대기 |",
);
lines.push(
  "| 잘못 재시작된 박스/스크리너 | — | reconcile-user-stopped-scans.mjs + **운영자 메일** |",
);
lines.push("");
lines.push("> 커밋: 995e8ce → 34561e8 → 506cb30");
lines.push("> 신규: server/scheduled-scan-policy.js, scripts/reconcile-user-stopped-scans.mjs");
lines.push("");
lines.push("---");
lines.push("");
lines.push("## 6. 운영·UI (참고)");
lines.push("");
lines.push("| 항목 | AS-IS | TO-BE |");
lines.push("|------|-------|-------|");
lines.push(
  "| vault 스캔 버튼 | 스캔 중에도 클릭 가능 | **서버 스캔 중 비활성 + 유형별 진행률** 표시 |",
);
lines.push(
  "| 워커 타임아웃 | 30분 | **제거** (장시간 스캔 허용) |",
);
lines.push(
  "| 스케줄 일괄 실행 | 없음 | **run-all-scheduled-scans.mjs** 추가 |",
);
lines.push("");
lines.push("> 커밋: 732316f, fa3c7bc, 170e2d6");
lines.push("");
lines.push("---");
lines.push("");
lines.push("## 영향·운영 참고");
lines.push("");
lines.push(
  "1. **매집봉 히트 수 증가 예상** — 형태·윗꼬리 제거, US 유니버스 ~20배 확대, RVOL 1.5·하락 OFF.",
);
lines.push(
  "2. **바닥캔들 히트 수 증가 예상** — 하락 기준 완화(3%), RVOL·갭 하드 게이트 제거.",
);
lines.push(
  "3. **저점기울기 결과 집합 변경** — 일봉→주봉 전환으로 기존 vault 항목과 **교집합 낮을 수 있음**.",
);
lines.push(
  "4. **all-scans 스크립트** — env로 꺼 둔 스캔은 더 이상 강제 실행되지 않음. 미완료·장애 복구만.",
);
lines.push(
  "5. Pine·서버 동기화 — 매집봉·바닥캔들 Pine 스크립트도 동일 커밋에서 맞춤.",
);
lines.push("");
lines.push("---");
lines.push("");
lines.push("## 관련 커밋 (시간순)");
lines.push("");
const commits = [
  ["117f944", "주봉 바닥캔들·매집봉 스캔 및 보관함 필터"],
  ["8bdc244", "NASDAQ 고속 매집봉 스캔 + Yahoo 튜닝"],
  ["3a03174", "매집 US 토스 전체 확대, 일·주봉 항상"],
  ["f925eb8", "저점기울기 일봉→주봉"],
  ["68d2c01", "매집 윗꼬리 기준 제거"],
  ["545d39a", "매집 캔들 형태 조건 제거"],
  ["0d53a6b", "매집 서버 기본값 Pine 세력통합 정렬"],
  ["05f6404", "바닥캔들 SMA 하락·RVOL 게이트 제거"],
  ["a8581e1", "매집 양봉 필수"],
  ["cc12d74", "매집 장대 음봉만 제외"],
  ["dc1b5a1", "US 주봉 나스닥 유니버스"],
  ["995e8ce", "all-scans 전체 강제 실행"],
  ["34561e8", "all-scans 스크리너 await 수정"],
  ["506cb30", "all-scans 사용자 중지 존중"],
];
for (const [hash, msg] of commits) {
  lines.push(`- \`${hash}\` ${msg}`);
}
lines.push("");
lines.push("— YSTOCK vault scan logic report —");

fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
console.log("Wrote", reportPath);

if (dryRun) {
  console.log("[dry-run] email skipped");
  process.exit(0);
}

await new Promise((resolve, reject) => {
  const child = spawn(
    process.execPath,
    ["scripts/send-report-email.mjs", TO_EMAIL, reportPath],
    { cwd: path.join(__dirname, ".."), stdio: "inherit" },
  );
  child.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error(`email exit ${code}`)),
  );
});

console.log("Email sent to", TO_EMAIL);
