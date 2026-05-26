/**
 * 박스권 카탈로그는 많은데 알림이 없는 이유 — 구현 상세·진단 메일
 */
import fs from "node:fs";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";
import { resolveServerDataDir } from "../data-path.js";
import {
  resolveCatalogRootDir,
  summarizeCatalogRootSync,
  catalogDirForRoot,
  readSymbolCatalogSync,
} from "../box-range/catalog-store.js";
import { readBoxRangeStoreSync } from "../box-range/store.js";
import {
  readProgramsStoreSync,
  listArmedLiveTradeProgramsForRunnerSync,
  listSimActiveProgramsForRunnerSync,
} from "../live-trade-programs-store.js";
import { isBoxRangeProgram, BOX_RANGE_MODEL_ID } from "../box-range/constants.js";
import { isTelegramNotifyEnabled } from "../telegram-notify.js";
import { resolvePineDetectOpts } from "../box-range/detect-pine.js";

export const BOX_ALERT_WHY_NONE_VERSION = "2026-05-26-box-alert-why-1";
export const DEFAULT_BOX_ALERT_WHY_TO = "samron3@naver.com";

/**
 * @param {"us"|"kr"|"crypto"} market
 */
function catalogEligibleStats(market) {
  const root = resolveCatalogRootDir();
  const summary = summarizeCatalogRootSync(root, market);
  const dir = catalogDirForRoot(market, root);
  let eligible = 0;
  let consumed = 0;
  if (!fs.existsSync(dir)) {
    return { eligible, consumed, summary };
  }
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "_index.json") continue;
    const sym = f.replace(/\.json$/i, "");
    const cat = readSymbolCatalogSync(sym, market, root);
    if (!cat?.boxes) continue;
    for (const b of cat.boxes) {
      if (b.consumedAtMs) consumed += 1;
      else if (b.tradeEligible !== false) eligible += 1;
    }
  }
  return { eligible, consumed, summary };
}

function programSnapshot() {
  const all = readProgramsStoreSync().programs;
  const boxPrograms = all.filter(isBoxRangeProgram);
  const sim = listSimActiveProgramsForRunnerSync().filter(isBoxRangeProgram);
  const armedRunner = listArmedLiveTradeProgramsForRunnerSync().filter(
    isBoxRangeProgram,
  );
  const armedAll = boxPrograms.filter((p) => p.status === "armed");
  const paused = boxPrograms.filter((p) => p.status === "paused");
  const draft = boxPrograms.filter(
    (p) => p.status !== "sim" && p.status !== "armed" && p.status !== "paused",
  );
  return {
    modelId: BOX_RANGE_MODEL_ID,
    total: boxPrograms.length,
    sim: sim.length,
    armedAll: armedAll.length,
    armedRunner: armedRunner.length,
    paused: paused.length,
    other: draft.length,
    simNames: sim.map((p) => `${p.name} (${p.id.slice(0, 8)})`),
    armedRunnerNames: armedRunner.map((p) => p.name ?? p.id),
    armedUsOnly: armedAll.filter(
      (p) => p.markets?.us && !p.markets?.kr && !p.markets?.crypto,
    ).length,
    markets: boxPrograms.map((p) => ({
      name: p.name,
      status: p.status,
      mk: p.markets,
      armedMarkets: p.armedMarkets,
    })),
  };
}

function storeFsmSnapshot() {
  const boxes = readBoxRangeStoreSync().boxes;
  /** @type {Record<string, number>} */
  const byState = {};
  let catalogLinked = 0;
  let midNotified = 0;
  let tradeEligible = 0;
  for (const b of boxes) {
    byState[b.state] = (byState[b.state] ?? 0) + 1;
    if (b.catalogBoxId) catalogLinked += 1;
    if (b.midNotifiedAtMs) midNotified += 1;
    if (b.tradeEligible !== false && b.state !== "closed") tradeEligible += 1;
  }
  return {
    total: boxes.length,
    byState,
    catalogLinked,
    midNotified,
    tradeEligible,
  };
}

export function buildBoxAlertWhyNoneReportContent() {
  const tgOn = isTelegramNotifyEnabled();
  const pineOpts = resolvePineDetectOpts({});
  const catalogRoot = resolveCatalogRootDir();
  const dataDir = resolveServerDataDir();
  const us = catalogEligibleStats("us");
  const kr = catalogEligibleStats("kr");
  const crypto = catalogEligibleStats("crypto");
  const prog = programSnapshot();
  const fsm = storeFsmSnapshot();
  const tickMs = Number(process.env.STOCK_BOX_RANGE_TICK_MS ?? 3000);
  const slotsPerTick = Number(
    process.env.STOCK_BOX_RANGE_CATALOG_SLOTS_PER_TICK ?? 20,
  );
  const runnerOff = process.env.STOCK_BOX_RANGE_RUNNER === "0";
  const sp500Off = process.env.STOCK_BOX_RANGE_SP500_SCAN === "0";

  const text = `YSTOCK — 박스권은 많은데 알림이 없는 이유 (구현 상세) (${BOX_ALERT_WHY_NONE_VERSION})

■ 한 줄 결론
「수백 종목 카탈로그 박스」≠「텔레그램 알림 대상」입니다.
박스권 텔레그램은 라이브·시뮬 프로그램 FSM이 돌아가는 박스 1건당,
「하단 이탈(armed) → 중심선 재돌파」가 실시간으로 일어날 때 1회만 갑니다.
카탈로그에만 있고 프로그램에 연결·시세·상태 조건이 안 맞으면 알림 0건이 정상입니다.

■ 지금 서버 스냅샷 (발송 시점)
텔레그램(주식봇): ${tgOn ? "설정됨" : "미설정 — 알림 불가"}
박스 runner: ${runnerOff ? "OFF (STOCK_BOX_RANGE_RUNNER=0)" : `ON (틱 ${tickMs}ms)`}
S&P500 카탈로그 스캔: ${sp500Off ? "OFF" : "ON (30분 주기)"}
데이터: ${dataDir}
카탈로그 루트: ${catalogRoot}

[카탈로그 박스 수 — 파일 저장만]
· US: 종목 ${us.summary.symbols} / 박스 ${us.summary.total} (1h ${us.summary.byTf["1h"]} · 4h ${us.summary.byTf["4h"]} · 1d ${us.summary.byTf["1d"]})
  → tradeEligible(미소진): ${us.eligible} · consumed: ${us.consumed}
· KR: 종목 ${kr.summary.symbols} / 박스 ${kr.summary.total} · eligible ${kr.eligible} · consumed ${kr.consumed}
· Crypto: 종목 ${crypto.summary.symbols} / 박스 ${crypto.summary.total} · eligible ${crypto.eligible}

[프로그램 modelId=${prog.modelId}]
· 박스권 프로그램 수: ${prog.total}
· 시뮬(sim) 실행 중: ${prog.sim} ${prog.simNames.length ? `→ ${prog.simNames.join(", ")}` : "(없음)"}
· 실매매(armed) 전체: ${prog.armedAll}
· runner가 armed로 잡는 수: ${prog.armedRunner} ${prog.armedRunnerNames.length ? `→ ${prog.armedRunnerNames.join(", ")}` : "(없음)"}
  ※ listArmedLiveTradeProgramsForRunnerSync = KR·코인 armedMarkets만 (US 단독 armed 제외)
· US만 켠 armed 프로그램: ${prog.armedUsOnly}건 → runner·FSM·알림 안 돎
· paused/기타: ${prog.paused + prog.other}

[box-range-state.json — FSM 연결 박스]
· 저장 박스: ${fsm.total} · 카탈로그 연결: ${fsm.catalogLinked}
· 상태: ${JSON.stringify(fsm.byState)}
· tradeEligible 활성: ${fsm.tradeEligible}
· 과거 중심 알림 보냄(midNotifiedAtMs): ${fsm.midNotified}

■ 알림이 나가는 유일한 코드 경로
1) server/dev-sidecars.js → startBoxRangeRunnerPoller() (기본 3초)
2) server/box-range/runner.js tickBoxRangeTrading()
   · 대상: status=sim 전부 + status=armed 이면서 armedMarkets.kr|crypto
   · modelId 반드시 "box-range"
3) 카탈로그 → 프로그램 store: catalog-trading-sync.js
   · 틱당 최대 ${slotsPerTick}개만 신규 연결 (수백 종목이 한 번에 안 붙음)
   · tradeEligible && !consumedAtMs 만
4) quotes.js → isBoxRangeQuoteFresh (기본 5초) 아니면 그 박스 틱 스킵
5) runner-fsm.js: idle→(가격≤하단)→armed (알림 없음)
   armed→(가격≥중심 & breakAtMs)→ box-range-telegram.js 1회
6) TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID

■ 카탈로그에만 있을 때 (흔함)
· 30분마다 sp500/kr/crypto 스캔 → .data/${catalogRoot}/ 아래 JSON
· 앱 박스권 탭·차트는 JSON 읽기만
· 이 단계에서 텔레그램/이메일 푸시 없음

■ 알림 0건 체크리스트
1) 박스권 프로그램 sim/armed(KR·코인 lane) 미실행
2) US만 armed → runner 목록 제외 (live-trade-programs-store.js 447행)
3) paused / modelId ≠ box-range
4) 카탈로그→store 연결 틱당 ${slotsPerTick}개 제한
5) FSM idle — 가격이 하단 이탈 전 → armed·중심 알림 없음
6) midNotifiedAtMs 이미 있음 — 같은 박스 재알림 없음
7) 시세 stale (5초 초과)
8) 텔레그램 env 없음
9) STOCK_BOX_RANGE_RUNNER=0
10) 「추천 고득점」알림 기대 — notifyHighScorePick 별도 (박스 무관)

■ FSM
idle ─(현재가≤하단)→ armed ─(현재가≥중심)→ 📱 텔레그램 1회 → (매수) in_position → closed

■ 환경변수
STOCK_BOX_RANGE_RUNNER / TICK_MS / CATALOG_SLOTS_PER_TICK / QUOTE_MAX_STALE_MS
TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID

■ 소스
runner.js · runner-fsm.js · box-range-telegram.js · catalog-trading-sync.js · quotes.js · sp500-scan-runner.js

— YSTOCK 자동 발송
`;

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>
<title>박스권 알림 없음</title></head>
<body style="font-family:Malgun Gothic,sans-serif;line-height:1.6;color:#111;max-width:900px;">
<h1>박스권은 많은데 알림이 없는 이유</h1>
<p><strong>카탈로그 박스 ≠ 알림.</strong> 텔레그램은 FSM «하단 이탈 후 중심 재돌파» 1회만.</p>

<h2>스냅샷</h2>
<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:0.9em;">
<tr><td>텔레그램</td><td>${tgOn ? "✅" : "❌ 미설정"}</td></tr>
<tr><td>Runner</td><td>${runnerOff ? "❌ OFF" : `✅ ${tickMs}ms`}</td></tr>
<tr><td>US 카탈로그</td><td>${us.summary.total}박스 · eligible ${us.eligible}</td></tr>
<tr><td>KR</td><td>${kr.summary.total} · eligible ${kr.eligible}</td></tr>
<tr><td>시뮬 프로그램</td><td>${prog.sim}</td></tr>
<tr><td>armed (runner)</td><td>${prog.armedRunner} (KR·코인만)</td></tr>
<tr><td>US-only armed</td><td>${prog.armedUsOnly} → runner 제외</td></tr>
<tr><td>FSM store</td><td>${fsm.total} · ${JSON.stringify(fsm.byState)} · 알림 ${fsm.midNotified}</td></tr>
</table>

<h2>3층 구조</h2>
<ol><li>카탈로그 JSON — UI만, 알림 없음</li>
<li>프로그램 store — 틱당 ${slotsPerTick}개 연결</li>
<li>텔레그램 — 중심 재돌파 1회</li></ol>

<h2>FSM</h2>
<pre style="background:#f1f5f9;padding:12px;">idle → armed → 📱(중심) → in_position → closed</pre>

<p style="color:#64748b;">${BOX_ALERT_WHY_NONE_VERSION}</p>
</body></html>`;

  const subject = `[YSTOCK] 박스권 알림 없음 — 구현·원인 (${BOX_ALERT_WHY_NONE_VERSION})`;
  return {
    subject,
    text,
    html,
    snapshot: { tgOn, us, kr, crypto, prog, fsm, tickMs, slotsPerTick },
  };
}

/**
 * @param {{ to?: string; dryRun?: boolean }} [opts]
 */
export async function sendBoxAlertWhyNoneReportEmail(opts = {}) {
  const to = String(opts.to ?? DEFAULT_BOX_ALERT_WHY_TO).trim();
  if (!to) throw new Error("수신 이메일 필요");
  const dryRun = Boolean(opts.dryRun);
  if (!dryRun && !isEmailSendingConfigured()) {
    const err = new Error("SMTP 미설정");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  const payload = buildBoxAlertWhyNoneReportContent();
  if (dryRun) return { to, dryRun: true, ...payload };
  await sendTransactionalEmail({
    to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
  return {
    to,
    dryRun: false,
    sent: true,
    subject: payload.subject,
    snapshot: payload.snapshot,
  };
}
