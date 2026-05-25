/**
 * 박스권 v2 — 코드·데이터 점검 보고서 (Q1~Q7 반영 후 재점검)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";
import { readProgramsStoreSync } from "../live-trade-programs-store.js";
import { BOX_RANGE_MODEL_ID, isBoxRangeProgram } from "../box-range/constants.js";
import { resolveBoxRangeMarketsForProgram } from "../box-range/migrate-active-programs.js";
import { resolveServerDataDir } from "../data-path.js";
import { readBoxRangeStoreSync } from "../box-range/store.js";
import { CATALOG_MARKETS } from "../box-range/catalog-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BOX_RANGE_AUDIT_REPORT_VERSION = "2026-05-26-audit-2-post-q7";

/** 운영자 기본 수신 (「나한테 보내」 요청 시) */
export const DEFAULT_AUDIT_REPORT_TO = "samron3@naver.com";

function rolloutFlagPath() {
  return path.join(
    resolveServerDataDir(),
    ".box-range-scenario-rollout-v2.json",
  );
}

function readRolloutFlagSync() {
  try {
    const p = rolloutFlagPath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function catalogStatsSync() {
  /** @type {Record<string, { exists: boolean; count: number }>} */
  const out = {};
  for (const m of CATALOG_MARKETS) {
    const idx = path.join(
      resolveServerDataDir(),
      "box-range-catalog",
      m,
      "_index.json",
    );
    if (!fs.existsSync(idx)) {
      out[m] = { exists: false, count: 0 };
      continue;
    }
    try {
      const o = JSON.parse(fs.readFileSync(idx, "utf8"));
      out[m] = {
        exists: true,
        count: Number(o.count) || (Array.isArray(o.symbols) ? o.symbols.length : 0),
      };
    } catch {
      out[m] = { exists: false, count: 0 };
    }
  }
  return out;
}

function analyzeProgramsSync() {
  const programs = readProgramsStoreSync().programs ?? [];
  /** @type {typeof programs} */
  const notBoxRange = [];
  /** @type {typeof programs} */
  const autoSellOn = [];
  /** @type {typeof programs} */
  const multiMarket = [];
  /** @type {typeof programs} */
  const armed = [];
  /** @type {typeof programs} */
  const sim = [];
  /** @type {typeof programs} */
  const armedDefault = [];

  for (const p of programs) {
    if (!isBoxRangeProgram(p)) notBoxRange.push(p);
    if (p.autoSellAtTarget !== false) autoSellOn.push(p);
    const mk = resolveBoxRangeMarketsForProgram(p);
    const n =
      Number(mk.kr) + Number(mk.us) + Number(mk.crypto);
    if (n > 1) multiMarket.push(p);
    if (p.status === "armed") {
      armed.push(p);
      if (!isBoxRangeProgram(p)) armedDefault.push(p);
    }
    if (p.status === "sim") sim.push(p);
  }

  const boxes = readBoxRangeStoreSync().boxes ?? [];
  const legacyCatalog = boxes.filter(
    (b) => b.catalogBoxId && !b.catalogMarket && b.state !== "closed",
  );

  return {
    total: programs.length,
    notBoxRange,
    autoSellOn,
    multiMarket,
    armed,
    armedDefault,
    sim,
    boxCount: boxes.length,
    openBoxes: boxes.filter((b) => b.state !== "closed").length,
    legacyCatalogBoxes: legacyCatalog.length,
  };
}

function programLines(list, fmt) {
  if (!list.length) return "· (없음)";
  return list.map(fmt).join("\n");
}

export function buildBoxRangeV2AuditReportContent() {
  const flag = readRolloutFlagSync();
  const analysis = analyzeProgramsSync();
  const catalog = catalogStatsSync();
  const slotsPerTick =
    process.env.STOCK_BOX_RANGE_CATALOG_SLOTS_PER_TICK ?? 20;
  const tossLive = process.env.TOSS_LIVE_ORDERS_ENABLED === "1";

  const subject =
    "[YSTOCK] 박스권 매매 로직 재점검 보고서 (Q1~Q7 반영 후)";

  const notBoxLines = programLines(analysis.notBoxRange, (p) =>
    `· ${p.name} (${p.id.slice(0, 8)}…) modelId=${p.modelId} status=${p.status} markets=${JSON.stringify(p.markets)} autoSell=${p.autoSellAtTarget !== false}`,
  );

  const armedDefaultLines = programLines(analysis.armedDefault, (p) =>
    `· ${p.name} — default 모델 armed → 박스권 FSM 아님, 스크리너·구 자동매도 경로`,
  );

  const text = `안녕하세요.

박스권 Q1~Q7 반영(commit cfbd0aa) 이후 매매 로직·서버 데이터를 다시 점검한 보고서입니다.
(보고서 ID: ${BOX_RANGE_AUDIT_REPORT_VERSION})


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
0. 한 줄 요약
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

· 코인·US/KR 카탈로그 FSM: 「하단 이탈 → 중심 재돌파」 매수, 상·하단 TP/SL — Q3(A)대로 구현됨.
· US/KR sim도 카탈로그 FSM 동작(Q4), KR 파일 카탈로그·탭 선택(Q1), US+코인 동시 러너(Q2) 반영됨.
· 아래 §4 잔여 버그·리스크는 운영 전 확인·수정 권장.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 반영된 Q1~Q7 (확인됨)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Q1 — KR/US 카탈로그 파일(box-range-catalog/kr|us), 상단 「박스권」 탭 시장 선택
Q2 — 프로그램 markets 복수 선택, 러너가 kr·us·crypto 동시 tick
Q3 — 매수: idle→armed(하단 이탈)→in_position(중심 재돌파) only
Q4 — US/KR sim도 tickCatalogProgram + FSM sim 매매
Q5 — executeLiveSellOrder + 회원 토스 API (TOSS_LIVE_ORDERS_ENABLED=1 시 실주문)
Q6 — 서버 기동 자동 v2 마이그레이션 중단 (STOCK_BOX_RANGE_ROLLOUT_FORCE=1 만)
Q7 — 안내/UI → 상단 「박스권」 탭 기준


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. 서버 데이터 스냅샷
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

· 프로그램 ${analysis.total}개 · armed ${analysis.armed.length} · sim ${analysis.sim.length}
· box-range 아님: ${analysis.notBoxRange.length}개 · autoSellAtTarget 켜짐: ${analysis.autoSellOn.length}개
· 복수 시장 프로그램: ${analysis.multiMarket.length}개
· 박스 state ${analysis.boxCount}개 (미청산 ${analysis.openBoxes}) · catalogMarket 없는 레거시 catalog 박스 ${analysis.legacyCatalogBoxes}개

카탈로그 인덱스:
· US: ${catalog.us.exists ? `있음 (${catalog.us.count}종목)` : "없음 — SP500 스캔 필요"}
· KR: ${catalog.kr.exists ? `있음 (${catalog.kr.count}종목)` : "없음 — KR 스캔 필요"}

롤아웃 플래그: ${flag ? `v${flag.version} done=${flag.done} migrated=${flag.migrated ?? "?"}` : "없음 (Q6: 자동 마이그레이션 안 함)"}
TOSS_LIVE_ORDERS_ENABLED: ${tossLive ? "1 (실주문 시도)" : "미설정/0 → 토스 매수·매도 simulated"}
카탈로그 연결 속도: 틱당 최대 ${slotsPerTick}슬롯/시장


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. 트랙별 동작 (현재 코드)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【코인】 detect.js 실시간 탐지 + FSM · armed→빗썸 · sim→simulated
【US/KR 카탈로그】 30분 스캔 파일 → syncCatalogTradingBoxes → FSM 동일
【매수】 lastPrice <= bottom → armed · breakAtMs 설정 → lastPrice >= mid → 매수
【매도】 lastPrice >= top(TP) 또는 <= bottom(SL) · crypto=빗썸 · us/kr=토스(회원키)
【시뮬 US/KR】 recordLiveTradeBuyAsync(simulated) — targets(top/bottom) 미저장(§4 참고)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. 발생 가능 버그·리스크 (우선순위)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[높음] US 실매매 armed 게이트 불일치
  · isProgramArmedForMarket("us")는 program.markets.us 만 보며 toss 레인 armed 여부를 안 봄.
  · 코인만 빗썸 arm한 프로그램에 us:true가 있으면 US live FSM 매수가 돌아갈 수 있음.
  · KR은 armedMarkets.kr 필요 — US와 비대칭.

[높음] modelId=default 프로그램이 armed인 경우 (박스권 FSM 미적용)
${armedDefaultLines}
  · onHighScorePickForLiveTrading(스크리너) + live-trade-auto-sell(ATR) 경로.
  · Q6(B) 수동 마이그레이션 전까지 의도된 상태이나, armed default는 위험.

[높음] 토스 arm 시 armedMarkets.kr=true 고정
  · US-only 프로그램도 toss arm하면 kr 플래그가 켜짐(실제 KR 매매는 mk.kr 필요).
  · 레인·시장 플래그 모델이 혼란스러움.

[중간] catalogMarket 없는 레거시 catalog 박스 + US·KR 동시 선택
  · boxMarketForProgram이 us를 우선 → KR 박스가 US 시장·USD 주문으로 처리될 수 있음.
  · 신규 연결 박스는 catalogMarket 저장됨. 기존 in-flight 박스는 점검 권장.

[중간] US/KR sim 매수 시 portfolio에 targetSellPrice/stopLossPrice 미기록
  · live US/KR만 recordLiveTradeBuySync+targets. sim은 UI·거래내역 TP/SL 빈칸 가능.

[중간] TOSS_LIVE_ORDERS_ENABLED≠1
  · 토스 buy/sell 모두 simulated=true. API 키만 등록해도 실주문은 env 켜야 함.

[중간] 카탈로그→프로그램 박스 연결 지연
  · 틱당 ${slotsPerTick}개 제한. eligible 박스 많으면 full 연결까지 수 분~.

[중간] 매수 실패 시 텔레그램은 1회만 (midNotifiedAtMs 선설정)
  · 재알림 없음. FSM은 armed 유지·매수 재시도는 함.

[중간] armed인데 해당 market lane 미활성 → in_position 매도 스킵
  · 포지션 stuck. disarm/수동 정리 필요.

[낮음] idle→armed 전환: 하단 「이탈」= lastPrice<=bottom 한 틱이면 충분
  · Pine 「터치 후 이탈」과 틱 단위 차이 — 급락·갭 시 오탐 가능.

[낮음] KR 카탈로그 universe.kr 비어 있으면 kr-scan no-op
  · server/.data/box-range-catalog/kr/_index.json 없으면 국내 탭 빈 목록.

[낮음] box-range 프로그램도 modelId=box-range면 스크리너 picks는 modelId 불일치로 스킵
  · 의도된 분리. default armed만 스크리너 매매 주의.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. default / box-range 아닌 프로그램 (${analysis.notBoxRange.length}개)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${notBoxLines}


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. 권장 조치 (우선순위)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1) US live도 armedMarkets 또는 toss-ready + toss arm 확인하도록 gate 수정
2) armed default 프로그램: box-range 전환 또는 disarm (Q6 수동)
3) 레거시 catalog 박스 catalogMarket 백필 또는 closed 처리
4) sim US/KR 매수에도 targets(top/bottom) 기록
5) 운영 시 TOSS_LIVE_ORDERS_ENABLED=1 + 회원 토스 API(계좌ID 포함) 확인
6) KR/US 카탈로그 스캔 폴러 가동·인덱스 생성 확인


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. 수동 점검 체크리스트
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

□ node scripts/send-box-range-v2-audit-report.mjs --dry-run (본 보고서 재생성)
□ armed box-range + us → toss arm 후 [box-range:buy] / TOSS_LIVE_ORDERS_ENABLED
□ us+ crypto → 빗썸만 arm 시 US FSM이 도는지 (버그 재현)
□ 상단 박스권 탭 US/KR 전환·로고·가격 카드
□ sim US/KR: 하단 이탈→중심 재돌파 후 sim-buy 로그


자동 점검 보고서입니다.

YSTOCK · ${BOX_RANGE_AUDIT_REPORT_VERSION}`;

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:'Malgun Gothic',Apple SD Gothic Neo,sans-serif;line-height:1.7;color:#1a1a1a;max-width:760px;margin:0 auto;padding:24px;">
<h1 style="font-size:1.2em;color:#1e40af;">박스권 매매 로직 재점검 (Q1~Q7 반영 후)</h1>
<p><code>${BOX_RANGE_AUDIT_REPORT_VERSION}</code></p>

<h2>0. 요약</h2>
<ul>
<li>FSM 매수 조건: <strong>하단 이탈 → 중심 재돌파</strong> (Q3)</li>
<li>US/KR sim·복수 시장·KR 카탈로그·토스 매도 구현 반영</li>
<li><strong>잔여 이슈</strong>: US armed gate, default armed 프로그램, sim TP/SL 미기록 등 (§4)</li>
</ul>

<h2>1. 데이터</h2>
<p>프로그램 ${analysis.total} · armed ${analysis.armed.length} · non-box-range ${analysis.notBoxRange.length}<br>
카탈로그 US ${catalog.us.count} / KR ${catalog.kr.count} · TOSS_LIVE=${tossLive ? "1" : "0"}</p>

<h2>2. 높은 우선순위 이슈</h2>
<ol>
<li><strong>US live</strong>: toss arm 없이 mk.us만으로 FSM live 매수 가능</li>
<li><strong>default armed</strong> ${analysis.armedDefault.length}개 — 박스권 FSM 아님</li>
<li><strong>toss arm</strong> → armedMarkets.kr=true (US-only와 불일치)</li>
</ol>

<h2>3. 중간</h2>
<ul>
<li>레거시 catalogMarket 없는 박스 + US/KR 동시</li>
<li>sim US/KR targets 미저장</li>
<li>TOSS_LIVE_ORDERS_ENABLED off 시 simulated만</li>
<li>카탈로그 슬롯 ${slotsPerTick}/틱</li>
</ul>

<h2>4. default 프로그램</h2>
<pre style="background:#f8fafc;padding:12px;font-size:0.85em;white-space:pre-wrap;">${notBoxLines.replace(/</g, "&lt;")}</pre>

<p style="color:#64748b;font-size:0.9em;margin-top:32px;">YSTOCK · ${BOX_RANGE_AUDIT_REPORT_VERSION}</p>
</body></html>`;

  return { subject, text, html, analysis, flag, catalog };
}

/**
 * @param {{ to?: string; dryRun?: boolean }} opts
 */
export async function sendBoxRangeV2AuditReportEmail(opts = {}) {
  const to = String(opts.to ?? DEFAULT_AUDIT_REPORT_TO).trim();
  if (!to) {
    throw new Error("수신 이메일이 필요합니다 (--to 또는 DEFAULT_AUDIT_REPORT_TO).");
  }
  const dryRun = Boolean(opts.dryRun);
  if (!dryRun && !isEmailSendingConfigured()) {
    const err = new Error("SMTP 미설정 — .env SMTP_* 또는 EMAIL_VERIFY_MOCK=1");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  const { subject, text, html, analysis } = buildBoxRangeV2AuditReportContent();
  if (dryRun) {
    return { to, dryRun: true, subject, analysis };
  }
  await sendTransactionalEmail({ to, subject, text, html });
  return { to, dryRun: false, subject, sent: true, analysis };
}
