/**
 * [Web발신] 요청 항목(1~6) 구현 방식 안내 메일
 */
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";

export const WEB_BALSIN_IMPL_REPORT_VERSION = "2026-05-26-impl-1";
export const DEFAULT_WEB_BALSIN_IMPL_TO = "samron3@naver.com";

/** Git 커밋 참고 (main) */
const COMMITS = {
  bithumbLedger: "5aae63e — fix(live-trade): bithumb sell uses ledger, sweep dust; box-range labels",
  uiSimBox: "1101524 — feat(ui): sim history dropdown, box cards P/L; email TV vs YStock pine diff",
};

export function buildWebBalsinImplementationReportContent() {
  const subject = `[YSTOCK] Web발신 구현 안내 (${WEB_BALSIN_IMPL_REPORT_VERSION})`;

  const text = `YSTOCK — [Web발신] 요청 사항 구현 방식 (${WEB_BALSIN_IMPL_REPORT_VERSION})

■ 1. 박스권 매매 — 1초·전 종목 시세?
구현: 전 종목 1초 폴링 아님.

· server/box-range/runner.js
  - setInterval 루프 기본 3000ms → env STOCK_BOX_RANGE_TICK_MS (최소 1000, 최대 30000)
  - 매 틱: armed/sim + modelId box-range 프로그램만
  - collectWatchSymbolsForProgram() → 감시 종목만 (기본 최대 10, STOCK_BOX_RANGE_MAX_SYMBOLS)
  - fetchBoxRangeLastPrices(감시 심볼들) — 카탈로그 S&P500 전체가 아님

· server/box-range/quotes.js
  - 시세 캐시 TTL 기본 1초 (STOCK_BOX_RANGE_QUOTE_TTL_MS)
  - 코인: 빗썸 WS + STOCK_BOX_RANGE_WS_FSM_MS(~80ms) 병행

1초로 바꾸려면: STOCK_BOX_RANGE_TICK_MS=1000 (API·CPU 부하 주의)


■ 2. 실매매 전량 매도 후 코인 소액 잔류
커밋: ${COMMITS.bithumbLedger}

2-1. 지정가 전량 API
· 빗썸 Open API v2에 «전량 지정가» 전용 없음
· 채택: ord_type=market, side=ask, volume=주문가능(balance) 수량

2-2. 서버 장부(캐시) + 폴링
· server/live-trade-bithumb-ledger.js (신규)
  - Map<userId, Map<base, { total, available, locked, syncedAtMs }>>
  - refreshBithumbLedgerForUser → getBithumbExchangeQtyMaps (reconcile)
  - deductBithumbLedgerAvailable — 매도 주문 직전 낙관적 차감
  - resolveSellVolumeFromLedger — min(앱 요청량, 장부 available, 거래소 fallback)
  - startBithumbLedgerPoller — 기본 10분 (STOCK_BITHUMB_LEDGER_POLL_MS, 최소 60초)
  - STOCK_BITHUMB_LEDGER_POLL=0 이면 폴러 off
· server/dev-sidecars.js — startBithumbLedgerPoller() 기동

· server/bithumb-trading-adapter.js
  - resolveBithumbSellVolumeForMarket()
  - executeBithumbLiveSellOrder({ userId, useExchangeAvailable })
    → 1차 시장가 매도 → 잔여가 최소주문 이상이면 2차 스윕(sweepRemainder)
  - executeBithumbLiveBuyOrder — 체결 후 refreshBithumbLedgerForUser
  - pollBithumbOrderFill — executed_volume → fillVolume 반환

· server/live-trade-portfolio-store.js
  - recordLiveTradeBuySync — crypto 시 orderMeta.fillVolume 우선 기록 (원화÷시세 오차 방지)

· server/box-range/runner-fsm.js, live-trade-auto-sell.js
  - 매도 시 userId 전달, 체결량(fillVolume)으로 장부 기록


■ 3. 박스권 탭 — 아이콘·한글명
커밋: ${COMMITS.bithumbLedger} (라벨), ${COMMITS.uiSimBox} (crypto API)

· src/components/BoxRangeTab.tsx
  - 미국: displaySymbolLabel — nameKo 있으면 «한글 (티커)»
  - 코인: cryptoKoFromName — «비트코인 (BTC)» 형태
  - logoUrlForSymbol — KR 6자리·crypto slug 정리

· server/create-app.js GET /api/box-range/catalog
  - market=us 시 names-ko.js getKoreanStockName → nameKo 필드 추가

· src/api.ts
  - fetchBoxRangeCatalog — ?market=kr|crypto 쿼리 수정 (이전 crypto 누락 수정)


■ 4. 거래내역 TAB → 시뮬레이션 프로그램 선택
커밋: ${COMMITS.uiSimBox}

· LiveTradeHistorySimProgramTabs(버튼) 삭제
· LiveTradeHistorySimProgramSelect.tsx — <select> 드롭다운 + 수익률 옵션 라벨
· LiveTradeProgramHoldingsMini.tsx — 프로그램 선택 시
  fetchLiveTradingPortfolio(programId) → holdings 필터 표시
· LiveTradeHistorySimSection.tsx — 드롭다운 + 보유 + 거래내역 패널


■ 5. TV 지표 vs 1H·4H·1D 프로그램
· 엔진: server/box-range/detect-pine.js (pine-horizontal-box-zones f_zoneEngine)
· TV pine-box-range-finder.pine(ER/ADX)과 다름 → 박스 개수 불일치 정상
· 차트: server/box-range/chart-overlay.js — catalog+store+live, 최대 24개
· 별도 메일 발송됨: [YSTOCK] TV vs 앱 박스권 차이 분석 (2026-05-26-pine-tv-1)
· 재발송: npm run email:box-range-pine-tv


■ 6. 박스권 기업 카드
커밋: ${COMMITS.uiSimBox}

· BoxRangeTab BoxRangePriceCard
  - 박스 기간: leftTime~rightTime (ko 날짜) + validBars
  - 예상 익절%: (top-mid)/mid
  - 예상 손절%: (bottom-mid)/mid
  - 중심/TP/SL 가격 유지


■ 주요 파일 목록
server/box-range/runner.js
server/box-range/quotes.js
server/live-trade-bithumb-ledger.js
server/bithumb-trading-adapter.js
server/box-range/runner-fsm.js
server/live-trade-auto-sell.js
server/create-app.js
src/components/BoxRangeTab.tsx
src/components/LiveTradeHistorySimSection.tsx
src/components/LiveTradeHistorySimProgramSelect.tsx
src/components/LiveTradeProgramHoldingsMini.tsx

— YSTOCK 자동 발송
`;

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>
<title>Web발신 구현 안내</title></head>
<body style="font-family:Malgun Gothic,sans-serif;line-height:1.6;color:#111;max-width:720px;">
<h1>[Web발신] 구현 방식 안내</h1>
<p>버전 <code>${WEB_BALSIN_IMPL_REPORT_VERSION}</code></p>

<h2>1. 박스권 시세 주기</h2>
<p><strong>전 종목 1초 폴링 없음.</strong> FSM 틱 기본 <strong>3초</strong> (<code>STOCK_BOX_RANGE_TICK_MS</code>), 감시 종목만 시세 조회(기본 ≤10). 캐시 TTL 1초. 코인 WS 별도.</p>

<h2>2. 빗썸 소액 잔류</h2>
<p><strong>2-1</strong> 지정가 전량 API 없음 → 시장가 + <code>balance</code> 한도.</p>
<p><strong>2-2</strong> <code>live-trade-bithumb-ledger.js</code> — 10분 폴링, 매매 직후 갱신, 매도 전 차감, <code>executeBithumbLiveSellOrder</code> 스윕. 매수 <code>fillVolume</code> 기록. 커밋 <code>5aae63e</code>.</p>

<h2>3. 박스권 탭 아이콘·한글</h2>
<ul>
<li>미국: API <code>nameKo</code> + «한글 (티커)»</li>
<li>국내: 6자리 코드 로고 URL</li>
<li>코인: 한글명·아이콘 slug, <code>?market=crypto</code></li>
</ul>

<h2>4. 시뮬 거래내역</h2>
<p>프로그램 <strong>드롭다운</strong> + 선택 시 <strong>현재 보유</strong> 미니 목록 + 거래내역. 커밋 <code>1101524</code>.</p>

<h2>5. TV vs 앱 박스</h2>
<p>엔진 상이 (Finder vs f_zoneEngine). 상세는 별도 메일 <em>2026-05-26-pine-tv-1</em>.</p>

<h2>6. 박스 카드</h2>
<p>기간·봉 수·예상 익절/손절 %·가격(중심/TP/SL).</p>

<h2>환경 변수 요약</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:0.9em;">
<tr><th>변수</th><th>기본</th><th>의미</th></tr>
<tr><td>STOCK_BOX_RANGE_TICK_MS</td><td>3000</td><td>박스 FSM 틱</td></tr>
<tr><td>STOCK_BOX_RANGE_MAX_SYMBOLS</td><td>10</td><td>감시 종목 수</td></tr>
<tr><td>STOCK_BITHUMB_LEDGER_POLL_MS</td><td>600000</td><td>장부 동기화</td></tr>
<tr><td>STOCK_BITHUMB_LEDGER_POLL</td><td>on</td><td>0=폴러 off</td></tr>
</table>

<p style="color:#64748b;margin-top:2rem;">YSTOCK · ${WEB_BALSIN_IMPL_REPORT_VERSION}</p>
</body></html>`;

  return { subject, text, html };
}

/**
 * @param {{ to?: string; dryRun?: boolean }} [opts]
 */
export async function sendWebBalsinImplementationReportEmail(opts = {}) {
  const to = String(opts.to ?? DEFAULT_WEB_BALSIN_IMPL_TO).trim();
  if (!to) throw new Error("수신 이메일 필요");
  const dryRun = Boolean(opts.dryRun);
  if (!dryRun && !isEmailSendingConfigured()) {
    const err = new Error("SMTP 미설정 — .env SMTP_*");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  const payload = buildWebBalsinImplementationReportContent();
  if (dryRun) return { to, dryRun: true, subject: payload.subject };
  await sendTransactionalEmail({
    to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
  return { to, dryRun: false, sent: true, subject: payload.subject };
}
