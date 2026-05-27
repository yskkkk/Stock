/**
 * TradingView Pine(박스Finder) vs YSTOCK 박스권 — 차이 원인 분석 메일
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";
import { BOX_RANGE_MAX_DETECTED } from "../box-range/constants.js";
import { getPinePreset } from "../box-range/detect-pine.js";
import { resolveServerDataDir } from "../data-path.js";
import { summarizeCatalogRootSync } from "../box-range/catalog-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PINE_TV_VS_YSTOCK_REPORT_VERSION = "2026-05-28-pine-tv-v2-parity-1";

export const DEFAULT_PINE_TV_REPORT_TO = "samron3@naver.com";

function readFileHead(rel, maxLines = 40) {
  try {
    const p = path.join(__dirname, "..", "..", rel);
    const lines = fs.readFileSync(p, "utf8").split(/\r?\n/).slice(0, maxLines);
    return lines.join("\n");
  } catch {
    return "(파일 읽기 실패)";
  }
}

function catalogCounts() {
  const root = resolveServerDataDir();
  const pine = path.join(root, "box-range-catalog-pine");
  const legacy = path.join(root, "box-range-catalog");
  return {
    pine: summarizeCatalogRootSync(pine, "crypto"),
    legacy: fs.existsSync(legacy)
      ? summarizeCatalogRootSync(legacy, "crypto")
      : null,
  };
}

export function buildPineTvVsYstockReportContent() {
  const preset1h = getPinePreset("1h");
  const preset4h = getPinePreset("4h");
  const preset1d = getPinePreset("1d");
  const cat = catalogCounts();

  const analysis = {
    conclusion:
      "YSTOCK 박스권 엔진을 TradingView의 PRO V2(ER+고저 퍼센타일+POC+거절점수)와 '코드 한 글자도 안 틀리게' 맞추려면, TV도 scripts/pine-box-range-pro-v2-ma.pine(또는 동일 로직)로 비교해야 합니다. 현재 서버·차트는 동일 V2 엔진(box-range-v2-core.js)로 1h/4h/1d를 탐지합니다.",
    tvLikelyScript: "scripts/pine-box-range-finder.pine",
    ystockEngine: "server/box-range/box-range-v2-core.js (PRO V2: ER+80/20+POC+score)",
    tvParityScript: "scripts/pine-box-range-pro-v2-ma.pine",
    chartOverlayCap: 24,
    liveDetectMax: BOX_RANGE_MAX_DETECTED,
    catalogCrypto: cat.pine,
  };

  const text = `YSTOCK — TradingView 박스 vs 앱 박스권 비교 (${PINE_TV_VS_YSTOCK_REPORT_VERSION})

■ 결론
${analysis.conclusion}

■ TV에서 박스가 훨씬 많은 주요 이유(대부분은 스크립트 불일치)
1) 스크립트 불일치
   · TV: pine-box-range-finder.pine — boxLen·ER·ADX·폭순위·연속 enterBars → 횡보 후보가 많음
   · YSTOCK: box-range-v2-core.js — ER+고저 퍼센타일(80/20)+POC+거절점수+확장/병합 — TV Finder와 다른 축
2) 표시 필터
   · 박스권 탭: tradeEligible && !consumedAtMs 인 박스만 카드
   · 차트 오버레이: 최대 ${analysis.chartOverlayCap}개, catalog+프로그램 store+라이브 탐지 합침 후 dedupe
   · 라이브 탐지 1회당 TF별 최대 ${analysis.liveDetectMax}개
3) 데이터·봉
   · TV 차트 TF = 사용자가 고른 1H
   · YSTOCK BTC 차트: 1h·4h·1d 동시 탐지 후 클라이언트가 차트 봉에 맞게 필터 가능
   · 캔들 소스: loadStock(Yahoo/빗썸) — TV 거래소·시간대와 미세 차이 가능
4) 매매 프로그램 FSM
   · 프로그램은 카탈로그 전체가 아니라 감시 종목·활성 박스만 (틱 기본 3초, STOCK_BOX_RANGE_TICK_MS)

■ YSTOCK 엔진/프리셋 참고(레거시 Pine f_zoneEngine)
1h: lb=${preset1h.lb} minB=${preset1h.minB} maxPct=${preset1h.maxPct}%
4h: lb=${preset4h.lb} minB=${preset4h.minB} maxPct=${preset4h.maxPct}%
1d: lb=${preset1d.lb} minB=${preset1d.minB} maxPct=${preset1d.maxPct}%
※ 위 프리셋은 Pine f_zoneEngine용이며, 현재 PRO V2 엔진은 box-range-v2-core.js 를 사용합니다.

■ TV pine-box-range-finder 기본값(요약)
boxLen=12, maxBoxPct=3%, maxAdx=22, maxEr=0.38, rankLen=80, maxRank=28, enterBars=2
→ ER/ADX/순위 필터가 YSTOCK f_zoneEngine과 완전히 다른 축

■ crypto 카탈로그(box-range-catalog-pine) 집계
symbols=${cat.pine?.symbols ?? 0} boxes=${cat.pine?.total ?? 0} (byTf ${JSON.stringify(cat.pine?.byTf ?? {})})

■ 완전 동일하게 맞추려면(추천)
A) TradingView에 ${analysis.tvParityScript} 를 적용해 비교 (YSTOCK V2 엔진과 동일 축)
B) TV에서 finder(pine-box-range-finder)를 계속 쓰고 싶으면, YSTOCK에 finder 포팅(대규모) — 별도 작업

■ 관련 파일
· scripts/pine-box-range-finder.pine
· scripts/pine-horizontal-box-zones.pine
· server/box-range/detect-pine.js, chart-overlay.js, catalog-scan-shared.js
· server/box-range/runner.js (STOCK_BOX_RANGE_TICK_MS 기본 3000)

— YSTOCK 자동 발송
`;

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>
<title>TV vs YSTOCK 박스권</title></head><body style="font-family:Malgun Gothic,sans-serif;line-height:1.55;color:#111;">
<h1>TradingView vs YSTOCK 박스권 비교</h1>
<p><strong>${analysis.conclusion}</strong></p>

<h2>1. 스크립트가 다름</h2>
<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:0.9em;">
<tr><th></th><th>TradingView (추정)</th><th>YSTOCK</th></tr>
<tr><td>파일</td><td><code>pine-box-range-finder.pine</code></td><td><code>box-range-v2-core.js</code> (PRO V2)</td></tr>
<tr><td>탐지</td><td>ER·ADX·폭 순위·boxLen 창</td><td>ER·고저 퍼센타일(80/20)·POC·거절점수·확장</td></tr>
<tr><td>박스 수</td><td>많음 (횡보 필터 완화 시)</td><td>적음 (엔진·eligible·상한)</td></tr>
</table>

<h2>0. 동일 비교용 TradingView 스크립트</h2>
<p>TradingView에서 아래 스크립트로 비교하면 YSTOCK과 같은 축(같은 판정식)으로 맞출 수 있습니다.</p>
<pre style="background:#f8fafc;padding:12px;font-size:0.85em;">${readFileHead("scripts/pine-box-range-pro-v2-ma.pine", 24).replace(/</g, "&lt;")}</pre>

<h2>2. YSTOCK 표시 상한</h2>
<ul>
<li>차트 오버레이 최대 <strong>${analysis.chartOverlayCap}</strong>개</li>
<li>라이브 탐지 TF당 최대 <strong>${analysis.liveDetectMax}</strong>개</li>
<li>박스권 탭: 매매 사용·미소진 박스만</li>
</ul>

<h2>3. 1H·4H·1D 프로그램</h2>
<p>단일 <code>modelId: box-range</code> 프로그램이 세 TF를 동시에 FSM 처리합니다. TV 1H만 본 것과 개수가 다를 수 있습니다.</p>
<pre style="background:#f1f5f9;padding:12px;font-size:0.85em;">1h preset: ${JSON.stringify(preset1h)}
4h preset: ${JSON.stringify(preset4h)}
1d preset: ${JSON.stringify(preset1d)}</pre>

<h2>4. BTC 카탈로그 (pine)</h2>
<pre style="background:#f8fafc;padding:12px;">${JSON.stringify(cat.pine, null, 2)}</pre>

<h2>5. TV Finder 스크립트 앞부분</h2>
<pre style="background:#f8fafc;padding:12px;font-size:0.75em;white-space:pre-wrap;">${readFileHead("scripts/pine-box-range-finder.pine", 25).replace(/</g, "&lt;")}</pre>

<p style="color:#64748b;font-size:0.9em;">${PINE_TV_VS_YSTOCK_REPORT_VERSION}</p>
</body></html>`;

  const subject = `[YSTOCK] TV vs 앱 박스권 차이 분석 (${PINE_TV_VS_YSTOCK_REPORT_VERSION})`;
  return { subject, text, html, analysis };
}

/**
 * @param {{ to?: string; dryRun?: boolean }} [opts]
 */
export async function sendPineTvVsYstockReportEmail(opts = {}) {
  const to = String(opts.to ?? DEFAULT_PINE_TV_REPORT_TO).trim();
  if (!to) throw new Error("수신 이메일 필요");
  const dryRun = Boolean(opts.dryRun);
  if (!dryRun && !isEmailSendingConfigured()) {
    const err = new Error("SMTP 미설정");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  const payload = buildPineTvVsYstockReportContent();
  if (dryRun) return { to, dryRun: true, ...payload };
  await sendTransactionalEmail({
    to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
  return { to, dryRun: false, sent: true, subject: payload.subject };
}
